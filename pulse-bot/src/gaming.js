// Gaming Analytics — bot side (PULSIFY-64).
//
// This module owns the TRUTH of gaming activity. Discord broadcasts what a
// member is playing through presence but keeps no history, so the bot turns
// presence TRANSITIONS into sessions: a start, an end, and a duration. Every
// statistic in Analytics › Gaming is a GROUP BY over `gaming_sessions`; nothing
// else writes to it.
//
// THE STATE MACHINE (one open session per member, enforced by a unique partial
// index in 20260629_gaming_analytics.sql):
//
//     no game  --start-->  open session
//     open     --stop-->   closed session
//     open     --switch--> close old, open new
//     open     --same-->   no-op (presence fires constantly; most updates are
//                          status/avatar changes with the game unchanged)
//
// RESTART RECOVERY. A restart leaves sessions open with no observer. On ready
// the bot reconciles every open row against live presence: still playing the
// same game → adopt the session and keep counting; anything else → close it
// with `source = 'recovered'` and an ESTIMATED end, so a crash never inflates
// "longest session" records with days of phantom playtime.
//
// PRIVACY IS ENFORCED AT WRITE TIME, not on read. Presence is personal data:
// an ignored role, an ignored member, an ignored game or a member opt-out means
// no row is ever created, so opting out leaves nothing behind to filter later.
//
// Settings math mirrors pulsify-web-app/lib/gaming.ts — keep the two in sync
// (same stance as invites.js ↔ lib/invites.ts).

const { Events, ActivityType, MessageFlags } = require("discord.js");
const featureGate = require("./feature-gate");
const { limitFor } = require("./billing");
const {
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  editNotice,
  text,
} = require("./commands");
const { getDashboardUrl } = require("./version");

/** Force-close sessions running longer than this — a client that crashed without
 *  emitting a presence update would otherwise stay "playing" forever. */
const MAX_SESSION_HOURS = 16;
/** How often the stale sweep runs. */
const SWEEP_MS = 5 * 60 * 1000;
/** Presence is a firehose; adopt-on-ready waits for the cache to populate. */
const READY_DELAY_MS = 20_000;

// ── Pure helpers (mirror of lib/gaming.ts) ────────────────────────────────────

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

const DEFAULT_CONFIG = {
  enabled: false,
  ignored_roles: [],
  ignored_members: [],
  ignored_games: [],
  retention_days: 90,
  anonymize_stats: false,
  allow_member_opt_out: true,
  min_session_seconds: 120,
  track_competing: true,
};

/** Grouping key for a game name. Discord clients disagree about casing and
 *  stray whitespace, and without normalising the same game splits into several
 *  rows in every ranking. */
function gameKeyOf(name) {
  return String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function toStringArray(v) {
  if (!Array.isArray(v)) return [];
  // Drop nullish entries BEFORE stringifying: String(null) is "null", which
  // survives a truthiness filter and lands in the config as a literal "null"
  // id that matches nothing and shows up in the dashboard's ignore list.
  return v.filter((x) => x != null).map((x) => String(x)).filter(Boolean);
}

function normaliseGamingSettings(row) {
  const base = { ...DEFAULT_CONFIG };
  if (!row) return base;
  const enabled = typeof row.enabled === "boolean" ? row.enabled : base.enabled;
  const s = row.settings && typeof row.settings === "object" ? row.settings : {};
  const bool = (v, d) => (v == null ? d : Boolean(v));
  return {
    enabled,
    ignored_roles: toStringArray(s.ignored_roles),
    ignored_members: toStringArray(s.ignored_members),
    // Stored as display names by the dashboard; compared as keys.
    ignored_games: toStringArray(s.ignored_games).map(gameKeyOf),
    retention_days: clampInt(s.retention_days, 0, 3650, base.retention_days),
    anonymize_stats: bool(s.anonymize_stats, base.anonymize_stats),
    allow_member_opt_out: bool(s.allow_member_opt_out, base.allow_member_opt_out),
    min_session_seconds: clampInt(s.min_session_seconds, 0, 3600, base.min_session_seconds),
    track_competing: bool(s.track_competing, base.track_competing),
  };
}

/**
 * The single playable activity in a presence, or null.
 *
 * Discord reports several activities at once — a game, a Spotify listen and a
 * custom status can all be live. "What are you playing" has one answer, so we
 * pick one deliberately:
 *   • Playing (0)   — the real signal.
 *   • Competing (5) — ranked/competitive modes; configurable because some
 *                     servers consider it noise.
 *   • Streaming (1) — the member is broadcasting. The activity name is the game
 *                     for Twitch streams, so it counts as playing AND raises
 *                     the streaming flag on the live card.
 * Everything else is explicitly not a game: Listening (2) is Spotify, Watching
 * (3) is a video, Custom (4) is a status message that would otherwise be
 * recorded as a game called "hello world".
 */
function pickGameActivity(presence, cfg) {
  const activities = presence?.activities ?? [];
  const allowed = [ActivityType.Playing];
  if (cfg?.track_competing !== false) allowed.push(ActivityType.Competing);

  const playing = activities.find((a) => allowed.includes(a.type) && a.name);
  if (playing) return { name: playing.name, applicationId: playing.applicationId ?? null };

  // A stream with a game name attached still tells us what they're playing.
  const streaming = activities.find((a) => a.type === ActivityType.Streaming && a.name);
  if (streaming) return { name: streaming.name, applicationId: streaming.applicationId ?? null };

  return null;
}

/**
 * "3h 42m" / "48m" / "35s". Playtime is read at a glance far more often than it
 * is compared precisely, so seconds only appear when there is nothing bigger.
 */
function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Is the member broadcasting right now (drives the live card's badge)? */
function isStreaming(presence) {
  return (presence?.activities ?? []).some((a) => a.type === ActivityType.Streaming);
}

/**
 * Should this member/game be recorded at all? Returns a reason string when the
 * answer is no, which the caller logs at debug level and nothing else — the
 * point of write-time privacy is that excluded members leave no trace.
 */
function exclusionReason(cfg, optedOut, member, gameKey) {
  if (!cfg.enabled) return "disabled";
  if (!member || member.user?.bot) return "bot";
  if (optedOut) return "opted_out";
  if (cfg.ignored_members.includes(member.id)) return "ignored_member";
  if (cfg.ignored_games.includes(gameKey)) return "ignored_game";
  if (cfg.ignored_roles.length > 0) {
    const roles = member.roles?.cache;
    if (roles && cfg.ignored_roles.some((r) => roles.has(r))) return "ignored_role";
  }
  return null;
}

// ── Module ───────────────────────────────────────────────────────────────────

function createGaming(client, supabase) {
  /** guild_id → normalised settings. */
  const configs = new Map();
  /** guild_id → Set(user_id) that opted out. */
  const optOuts = new Map();
  /** `${guildId}:${userId}` → { id, gameKey, startedAt } for open sessions. */
  const open = new Map();

  let sweepTimer = null;

  const keyOf = (guildId, userId) => `${guildId}:${userId}`;

  function configFor(guildId) {
    return configs.get(guildId) ?? DEFAULT_CONFIG;
  }

  function isOptedOut(guildId, userId) {
    return optOuts.get(guildId)?.has(userId) ?? false;
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  async function reloadConfigs() {
    const { data, error } = await supabase.from("gaming_settings").select("*");
    if (error) {
      console.warn("[Pulse] gaming settings load failed:", error.message);
      return;
    }
    configs.clear();
    for (const row of data ?? []) configs.set(row.guild_id, normaliseGamingSettings(row));
    console.log(`[Pulse] Loaded gaming settings for ${configs.size} guild(s).`);
  }

  async function reloadOptOuts() {
    const { data, error } = await supabase.from("gaming_opt_outs").select("guild_id, user_id");
    if (error) {
      console.warn("[Pulse] gaming opt-outs load failed:", error.message);
      return;
    }
    optOuts.clear();
    for (const row of data ?? []) {
      if (!optOuts.has(row.guild_id)) optOuts.set(row.guild_id, new Set());
      optOuts.get(row.guild_id).add(row.user_id);
    }
  }

  function subscribe() {
    supabase
      .channel("gaming-settings-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "gaming_settings" }, (payload) => {
        const guildId = payload.new?.guild_id ?? payload.old?.guild_id;
        if (!guildId) return;
        if (payload.eventType === "DELETE") configs.delete(guildId);
        else configs.set(guildId, normaliseGamingSettings(payload.new));
      })
      .subscribe();

    supabase
      .channel("gaming-opt-outs-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "gaming_opt_outs" }, (payload) => {
        const guildId = payload.new?.guild_id ?? payload.old?.guild_id;
        const userId = payload.new?.user_id ?? payload.old?.user_id;
        if (!guildId || !userId) return;
        if (payload.eventType === "DELETE") optOuts.get(guildId)?.delete(userId);
        else {
          if (!optOuts.has(guildId)) optOuts.set(guildId, new Set());
          optOuts.get(guildId).add(userId);
        }
      })
      .subscribe();
  }

  // ── Session writes ─────────────────────────────────────────────────────────

  async function openSession(member, game, presence) {
    const guildId = member.guild.id;
    const gameKey = gameKeyOf(game.name);
    const voice = member.voice?.channel ?? null;

    const row = {
      guild_id: guildId,
      user_id: member.id,
      user_name: member.displayName ?? member.user?.username ?? null,
      game_name: game.name,
      game_key: gameKey,
      application_id: game.applicationId ?? null,
      started_at: new Date().toISOString(),
      source: "presence",
      voice_channel_id: voice?.id ?? null,
      voice_channel_name: voice?.name ?? null,
      was_streaming: isStreaming(presence),
    };

    const { data, error } = await supabase
      .from("gaming_sessions")
      .insert(row)
      .select("id, started_at")
      .single();

    if (error) {
      // The unique partial index rejects a second open session for the same
      // member. That means our in-memory map drifted from the database (a
      // missed close, or two shards racing) — resync rather than retrying, so
      // the member's playtime is never double-counted.
      if (error.code === "23505") {
        await adoptOpenSession(guildId, member.id);
        return;
      }
      console.warn("[Pulse] gaming session open failed:", error.message);
      return;
    }

    open.set(keyOf(guildId, member.id), {
      id: data.id,
      gameKey,
      startedAt: new Date(data.started_at).getTime(),
    });
  }

  /**
   * Close an open session. `endedAt`/`source` are overridden by the recovery
   * path, which is estimating rather than observing.
   *
   * Sessions shorter than the guild's `min_session_seconds` are DELETED instead
   * of closed: alt-tabbing through a launcher is not a play session, and
   * keeping the rows would skew every average in the module.
   */
  async function closeSession(guildId, userId, { endedAt = new Date(), source = null } = {}) {
    const mapKey = keyOf(guildId, userId);
    const entry = open.get(mapKey);
    if (!entry) return;
    open.delete(mapKey);

    const duration = Math.max(0, Math.round((endedAt.getTime() - entry.startedAt) / 1000));
    const cfg = configFor(guildId);

    if (duration < cfg.min_session_seconds) {
      const { error } = await supabase.from("gaming_sessions").delete().eq("id", entry.id);
      if (error) console.warn("[Pulse] gaming session discard failed:", error.message);
      return;
    }

    const patch = {
      ended_at: endedAt.toISOString(),
      duration_seconds: duration,
    };
    if (source) patch.source = source;

    const { error } = await supabase.from("gaming_sessions").update(patch).eq("id", entry.id);
    if (error) console.warn("[Pulse] gaming session close failed:", error.message);
  }

  /** Pull an existing open row back into memory after an index collision. */
  async function adoptOpenSession(guildId, userId) {
    const { data, error } = await supabase
      .from("gaming_sessions")
      .select("id, game_key, started_at")
      .eq("guild_id", guildId)
      .eq("user_id", userId)
      .is("ended_at", null)
      .maybeSingle();
    if (error || !data) return;
    open.set(keyOf(guildId, userId), {
      id: data.id,
      gameKey: data.game_key,
      startedAt: new Date(data.started_at).getTime(),
    });
  }

  // ── Presence ───────────────────────────────────────────────────────────────

  async function onPresenceUpdate(_oldPresence, newPresence) {
    const guild = newPresence?.guild;
    const member = newPresence?.member;
    if (!guild || !member) return;

    const cfg = configFor(guild.id);
    if (!cfg.enabled) return;

    const game = pickGameActivity(newPresence, cfg);
    const mapKey = keyOf(guild.id, member.id);
    const current = open.get(mapKey);

    // Stopped playing.
    if (!game) {
      if (current) await closeSession(guild.id, member.id);
      return;
    }

    const gameKey = gameKeyOf(game.name);

    // Excluded — and if a session is somehow open (the exclusion was added
    // mid-session), close it so the member stops accumulating immediately.
    if (exclusionReason(cfg, isOptedOut(guild.id, member.id), member, gameKey)) {
      if (current) await closeSession(guild.id, member.id);
      return;
    }

    // Same game: presence fires on avatar/status/activity-detail changes too,
    // and re-opening on every one of them would shred a two-hour session into
    // hundreds of fragments.
    if (current && current.gameKey === gameKey) return;

    // Switched games: close the old session before opening the new one, or the
    // unique index rejects the insert.
    if (current) await closeSession(guild.id, member.id);

    await openSession(member, game, newPresence);
  }

  // ── Recovery + sweep ───────────────────────────────────────────────────────

  /**
   * Reconcile the database's open sessions against live presence after a
   * restart. Still playing the same game → adopt and keep counting. Otherwise
   * close with an estimate, flagged `source = 'recovered'` so the analytics can
   * tell an observed end from a guessed one.
   *
   * The estimate is the session start plus MAX_SESSION_HOURS, capped at now —
   * deliberately NOT `now`, because a bot that was down for a week would
   * otherwise record a week-long session.
   */
  async function recoverOpenSessions() {
    const { data, error } = await supabase
      .from("gaming_sessions")
      .select("id, guild_id, user_id, game_key, started_at")
      .is("ended_at", null);

    if (error) {
      console.warn("[Pulse] gaming recovery load failed:", error.message);
      return;
    }

    let adopted = 0;
    let recovered = 0;

    for (const row of data ?? []) {
      const guild = client.guilds.cache.get(row.guild_id);
      const member = guild?.members?.cache?.get(row.user_id);
      const cfg = configFor(row.guild_id);
      const game = member ? pickGameActivity(member.presence, cfg) : null;

      if (game && gameKeyOf(game.name) === row.game_key) {
        open.set(keyOf(row.guild_id, row.user_id), {
          id: row.id,
          gameKey: row.game_key,
          startedAt: new Date(row.started_at).getTime(),
        });
        adopted += 1;
        continue;
      }

      const startedAt = new Date(row.started_at).getTime();
      const cap = startedAt + MAX_SESSION_HOURS * 3600 * 1000;
      const endedAt = new Date(Math.min(Date.now(), cap));
      open.set(keyOf(row.guild_id, row.user_id), {
        id: row.id,
        gameKey: row.game_key,
        startedAt,
      });
      await closeSession(row.guild_id, row.user_id, { endedAt, source: "recovered" });
      recovered += 1;
    }

    if (adopted || recovered) {
      console.log(`[Pulse] Gaming recovery — adopted ${adopted}, closed ${recovered}.`);
    }
  }

  /**
   * Force-close sessions that have outlived MAX_SESSION_HOURS. A client that
   * crashes (or a member who goes invisible) never emits the closing presence
   * update, so without this the session stays open forever and every "currently
   * playing" count slowly fills with ghosts.
   */
  async function sweep() {
    const cutoff = Date.now() - MAX_SESSION_HOURS * 3600 * 1000;
    for (const [mapKey, entry] of [...open.entries()]) {
      if (entry.startedAt > cutoff) continue;
      const [guildId, userId] = mapKey.split(":");
      await closeSession(guildId, userId, {
        endedAt: new Date(entry.startedAt + MAX_SESSION_HOURS * 3600 * 1000),
        source: "recovered",
      });
    }
  }

  // ── Member opt-out ─────────────────────────────────────────────────────────

  /**
   * A member excluding themselves. Closes any session in flight, records the
   * opt-out, and optionally purges their history — the module's answer to "stop
   * tracking me", which must work without granting them dashboard access.
   */
  async function optOut(guildId, userId, { purgeHistory = false } = {}) {
    await closeSession(guildId, userId);

    const { error } = await supabase
      .from("gaming_opt_outs")
      .upsert({ guild_id: guildId, user_id: userId, purge_history: purgeHistory }, { onConflict: "guild_id,user_id" });
    if (error) {
      console.warn("[Pulse] gaming opt-out failed:", error.message);
      return false;
    }

    if (!optOuts.has(guildId)) optOuts.set(guildId, new Set());
    optOuts.get(guildId).add(userId);

    if (purgeHistory) {
      const { error: delErr } = await supabase
        .from("gaming_sessions")
        .delete()
        .eq("guild_id", guildId)
        .eq("user_id", userId);
      if (delErr) console.warn("[Pulse] gaming history purge failed:", delErr.message);
    }
    return true;
  }

  async function optIn(guildId, userId) {
    const { error } = await supabase
      .from("gaming_opt_outs")
      .delete()
      .eq("guild_id", guildId)
      .eq("user_id", userId);
    if (error) {
      console.warn("[Pulse] gaming opt-in failed:", error.message);
      return false;
    }
    optOuts.get(guildId)?.delete(userId);
    return true;
  }

  // ── Slash commands ─────────────────────────────────────────────────────────
  //
  // All five read through the same aggregate RPCs the dashboard uses, so a
  // number quoted in Discord always matches the number on the page. They are
  // deliberately a PEEK: top few rows plus a link to Analytics › Gaming, which
  // is where filtering, history and exports live.

  const SHOWN = 10;
  const absTime = (date) => `<t:${Math.floor(date.getTime() / 1000)}:R>`;

  /** Shared preamble: defer, verify the module is on, resolve branding. */
  async function begin(interaction, guild, ephemeral) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });
    if (!configFor(guild.id).enabled) {
      await editNotice(
        interaction,
        "Gaming analytics isn't switched on for this server. An admin can enable it under Analytics › Gaming.",
      );
      return null;
    }
    const colorHex = await getPulseColor(supabase, guild.id);
    // No dedicated gamepad badge yet — the ranking/progression glyph is the
    // closest fit and keeps these embeds consistent with /rank and /leaderboard.
    const icon = await loadPulseIcon("stats", colorHex);
    return { colorHex, icon };
  }

  function render(interaction, brand, guild, title, body, footer) {
    return interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        buildPulseContainer({
          iconUrl: brand.icon ? `attachment://${brand.icon.name}` : null,
          colorHex: brand.colorHex,
          title,
          subtitle: `Pulse — ${guild.name}`,
          body,
          footer: footer ?? "Pulse — Gaming",
        }),
      ],
      files: brand.icon ? [brand.icon] : [],
    });
  }

  /**
   * The retention window every command reads through, as an ISO string.
   *
   * The SHORTER of the guild owner's plan `analyticsRetentionDays` and the
   * guild's own configured retention — the same two bounds Analytics › Gaming
   * applies, in the same order, so a number quoted in Discord always matches
   * the dashboard. Falls back to the guild setting alone if the plan lookup
   * fails, rather than showing more history than the plan allows.
   */
  async function sinceFor(guild) {
    const configured = configFor(guild.id).retention_days;

    let planDays = 0;
    try {
      const plan = await featureGate.getGuildPlan(supabase, guild);
      const limit = limitFor(plan, "analyticsRetentionDays");
      planDays = Number.isFinite(limit) ? limit : 0;
    } catch {
      planDays = 0;
    }

    const candidates = [configured, planDays].filter((d) => d > 0);
    if (candidates.length === 0) return null;
    return new Date(Date.now() - Math.min(...candidates) * 86400_000).toISOString();
  }

  async function handleOverview({ interaction, guild, ephemeral }) {
    const brand = await begin(interaction, guild, ephemeral);
    if (!brand) return;

    const since = await sinceFor(guild);
    const [overview, games] = await Promise.all([
      supabase.rpc("get_gaming_overview", { p_guild_id: guild.id, p_since: since }),
      supabase.rpc("get_gaming_games", { p_guild_id: guild.id, p_since: since }),
    ]);

    if (overview.error) {
      console.error(`[Pulse] /gaming overview failed in ${guild.id}:`, overview.error.message);
      return editNotice(interaction, "I couldn't load the gaming stats. Try again shortly.");
    }

    const o = overview.data?.[0];
    if (!o || Number(o.total_sessions) === 0) {
      return render(
        interaction,
        brand,
        guild,
        "Server gaming",
        [text("Nothing tracked yet. As soon as members start playing, their sessions appear here.")],
        "Pulse — Gaming",
      );
    }

    const top = (games.data ?? [])
      .slice()
      .sort((a, b) => Number(b.total_seconds) - Number(a.total_seconds))
      .slice(0, 3);

    const lines = [
      `**${formatDuration(o.total_seconds)}** played across **${o.total_sessions}** sessions`,
      `**${o.unique_games}** games — **${o.unique_players}** players`,
      `**${o.active_today}** played today — **${o.active_week}** this week`,
      `Average session **${formatDuration(o.avg_session_seconds)}** — longest **${formatDuration(o.longest_seconds)}**`,
    ];
    if (Number(o.currently_playing) > 0) {
      lines.push(`**${o.currently_playing}** playing right now`);
    }

    const body = [text(lines.join("\n"))];
    if (top.length > 0) {
      body.push(
        text(
          ["**Most played**", ...top.map((g, i) => `${i + 1}. **${g.game_name}** — ${formatDuration(g.total_seconds)}`)].join(
            "\n",
          ),
        ),
      );
    }
    body.push(text(`-# Full analytics: ${getDashboardUrl(guild.id)}/gaming`));

    return render(interaction, brand, guild, "Server gaming", body);
  }

  async function handleProfile({ interaction, guild, ephemeral }) {
    const brand = await begin(interaction, guild, ephemeral);
    if (!brand) return;

    const target = interaction.options.getUser("user") ?? interaction.user;
    const since = await sinceFor(guild);

    if (isOptedOut(guild.id, target.id)) {
      return editNotice(
        interaction,
        target.id === interaction.user.id
          ? "You've opted out of gaming tracking, so there's nothing to show. Use `/gaming opt-in` to start again."
          : "That member has opted out of gaming tracking.",
      );
    }

    const { data, error } = await supabase.rpc("get_gaming_players", {
      p_guild_id: guild.id,
      p_since: since,
    });
    if (error) {
      console.error(`[Pulse] /gaming profile failed in ${guild.id}:`, error.message);
      return editNotice(interaction, "I couldn't load that profile. Try again shortly.");
    }

    const rows = data ?? [];
    const me = rows.find((r) => r.user_id === target.id);
    if (!me) {
      return render(
        interaction,
        brand,
        guild,
        `Gaming — ${target.username}`,
        [text("No tracked sessions yet.")],
      );
    }

    const ranked = rows.slice().sort((a, b) => Number(b.total_seconds) - Number(a.total_seconds));
    const rank = ranked.findIndex((r) => r.user_id === target.id) + 1;

    // Recent games: a small direct read, since the aggregate RPC is per-member
    // totals rather than a history.
    const { data: recent } = await supabase
      .from("gaming_sessions")
      .select("game_name, started_at, duration_seconds, ended_at")
      .eq("guild_id", guild.id)
      .eq("user_id", target.id)
      .order("started_at", { ascending: false })
      .limit(5);

    const lines = [
      `**${formatDuration(me.total_seconds)}** total — rank **#${rank}** of ${ranked.length}`,
      `**${me.total_sessions}** sessions across **${me.unique_games}** games`,
      `Average **${formatDuration(me.avg_session_seconds)}** — longest **${formatDuration(me.longest_seconds)}**`,
    ];
    if (me.favourite_game) {
      lines.push(`Favourite **${me.favourite_game}** — ${formatDuration(me.favourite_seconds)}`);
    }
    if (me.currently_playing) lines.push("Playing right now");

    const body = [text(lines.join("\n"))];
    if ((recent ?? []).length > 0) {
      body.push(
        text(
          [
            "**Recently played**",
            ...recent.map((r) => {
              const when = absTime(new Date(r.started_at));
              const dur = r.ended_at ? formatDuration(r.duration_seconds) : "in progress";
              return `**${r.game_name}** — ${dur} — ${when}`;
            }),
          ].join("\n"),
        ),
      );
    }

    return render(interaction, brand, guild, `Gaming — ${target.username}`, body);
  }

  async function handleLeaderboard({ interaction, guild, ephemeral }) {
    const brand = await begin(interaction, guild, ephemeral);
    if (!brand) return;

    const period = interaction.options.getString("period") ?? "week";
    const board = interaction.options.getString("board") ?? "playtime";

    // The caller's period, then bounded by retention exactly as sinceFor does —
    // "all time" means "as far back as this server is allowed to look".
    const windows = { day: 1, week: 7, month: 30, all: null };
    const requested = windows[period] ?? 7;
    const retentionSince = await sinceFor(guild);
    const requestedSince =
      requested == null ? null : new Date(Date.now() - requested * 86400_000).toISOString();
    const since =
      retentionSince && requestedSince
        ? (retentionSince > requestedSince ? retentionSince : requestedSince)
        : (retentionSince ?? requestedSince);

    const { data, error } = await supabase.rpc("get_gaming_players", {
      p_guild_id: guild.id,
      p_since: since,
    });
    if (error) {
      console.error(`[Pulse] /gaming leaderboard failed in ${guild.id}:`, error.message);
      return editNotice(interaction, "I couldn't load the leaderboard. Try again shortly.");
    }

    const sorters = {
      playtime: (a, b) => Number(b.total_seconds) - Number(a.total_seconds),
      sessions: (a, b) => Number(b.total_sessions) - Number(a.total_sessions),
      longest: (a, b) => Number(b.longest_seconds) - Number(a.longest_seconds),
      variety: (a, b) => Number(b.unique_games) - Number(a.unique_games),
    };
    const valueOf = {
      playtime: (r) => formatDuration(r.total_seconds),
      sessions: (r) => `${r.total_sessions} sessions`,
      longest: (r) => formatDuration(r.longest_seconds),
      variety: (r) => `${r.unique_games} games`,
    };
    const titles = {
      playtime: "Playtime",
      sessions: "Sessions",
      longest: "Longest session",
      variety: "Most games played",
    };

    const anonymous = configFor(guild.id).anonymize_stats;
    const rows = (data ?? []).slice().sort(sorters[board] ?? sorters.playtime).slice(0, SHOWN);

    const periodLabel = { day: "Today", week: "This week", month: "This month", all: "All time" }[period] ?? "This week";

    if (rows.length === 0) {
      return render(interaction, brand, guild, `Gaming leaderboard — ${titles[board] ?? "Playtime"}`, [
        text(`Nothing tracked for ${periodLabel.toLowerCase()} yet.`),
      ]);
    }

    const body = [
      text(
        rows
          .map((r, i) => {
            const who = anonymous ? `Player ${i + 1}` : r.user_name ?? "Unknown member";
            return `**${i + 1}.** ${who} — ${(valueOf[board] ?? valueOf.playtime)(r)}`;
          })
          .join("\n"),
      ),
      text(`-# ${periodLabel} — full boards: ${getDashboardUrl(guild.id)}/gaming`),
    ];

    return render(interaction, brand, guild, `Gaming leaderboard — ${titles[board] ?? "Playtime"}`, body);
  }

  async function handleGames({ interaction, guild, ephemeral }) {
    const brand = await begin(interaction, guild, ephemeral);
    if (!brand) return;

    const sort = interaction.options.getString("sort") ?? "playtime";
    const since = await sinceFor(guild);

    const { data, error } = await supabase.rpc("get_gaming_games", {
      p_guild_id: guild.id,
      p_since: since,
    });
    if (error) {
      console.error(`[Pulse] /gaming games failed in ${guild.id}:`, error.message);
      return editNotice(interaction, "I couldn't load the game list. Try again shortly.");
    }

    const sorters = {
      playtime: (a, b) => Number(b.total_seconds) - Number(a.total_seconds),
      players: (a, b) => Number(b.unique_players) - Number(a.unique_players),
      sessions: (a, b) => Number(b.total_sessions) - Number(a.total_sessions),
      alphabetical: (a, b) => String(a.game_name).localeCompare(String(b.game_name)),
    };
    const rows = (data ?? []).slice().sort(sorters[sort] ?? sorters.playtime).slice(0, SHOWN);

    if (rows.length === 0) {
      return render(interaction, brand, guild, "Games played here", [
        text("No games tracked yet."),
      ]);
    }

    const body = [
      text(
        rows
          .map((g, i) => {
            const players = `${g.unique_players} player${Number(g.unique_players) === 1 ? "" : "s"}`;
            const live = Number(g.currently_playing) > 0 ? ` — ${g.currently_playing} playing now` : "";
            return `**${i + 1}. ${g.game_name}**\n-# ${formatDuration(g.total_seconds)} — ${players} — ${g.total_sessions} sessions${live}`;
          })
          .join("\n\n"),
      ),
      text(`-# Full rankings and trends: ${getDashboardUrl(guild.id)}/gaming`),
    ];

    return render(interaction, brand, guild, "Games played here", body);
  }

  async function handleCurrentlyPlaying({ interaction, guild, ephemeral }) {
    const brand = await begin(interaction, guild, ephemeral);
    if (!brand) return;

    const { data, error } = await supabase
      .from("gaming_sessions")
      .select("user_id, user_name, game_name, started_at, was_streaming, voice_channel_name")
      .eq("guild_id", guild.id)
      .is("ended_at", null)
      .order("started_at", { ascending: true })
      .limit(25);

    if (error) {
      console.error(`[Pulse] /gaming currently-playing failed in ${guild.id}:`, error.message);
      return editNotice(interaction, "I couldn't load live activity. Try again shortly.");
    }

    const rows = data ?? [];
    if (rows.length === 0) {
      return render(interaction, brand, guild, "Playing right now", [
        text("Nobody is playing anything right now."),
      ]);
    }

    const anonymous = configFor(guild.id).anonymize_stats;
    const shown = rows.slice(0, SHOWN);

    const body = [
      text(
        shown
          .map((r, i) => {
            const who = anonymous ? `Player ${i + 1}` : r.user_name ?? "Unknown member";
            const elapsed = formatDuration((Date.now() - new Date(r.started_at).getTime()) / 1000);
            const extras = [
              r.was_streaming ? "streaming" : null,
              r.voice_channel_name ? `in ${r.voice_channel_name}` : null,
            ].filter(Boolean);
            const suffix = extras.length > 0 ? ` — ${extras.join(" — ")}` : "";
            return `**${who}** — ${r.game_name}\n-# ${elapsed} so far${suffix}`;
          })
          .join("\n\n"),
      ),
    ];
    if (rows.length > shown.length) {
      body.push(text(`-# and ${rows.length - shown.length} more`));
    }

    return render(interaction, brand, guild, "Playing right now", body);
  }

  /** Member-facing privacy controls — the reason opt-out lives in its own table. */
  async function handleOptOut({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });
    const cfg = configFor(guild.id);
    if (!cfg.allow_member_opt_out) {
      return editNotice(interaction, "This server doesn't offer gaming opt-out.");
    }
    const purge = interaction.options.getBoolean("delete-history") ?? false;
    const ok = await optOut(guild.id, interaction.user.id, { purgeHistory: purge });
    if (!ok) return editNotice(interaction, "I couldn't save that. Try again shortly.");
    return editNotice(
      interaction,
      purge
        ? "You're opted out of gaming tracking and your recorded sessions have been deleted."
        : "You're opted out of gaming tracking. Your existing sessions stay recorded — re-run with `delete-history: True` to remove them.",
    );
  }

  async function handleOptIn({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });
    const ok = await optIn(guild.id, interaction.user.id);
    if (!ok) return editNotice(interaction, "I couldn't save that. Try again shortly.");
    return editNotice(interaction, "You're being tracked again. New sessions will appear in the server's gaming stats.");
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async function start() {
    await reloadConfigs();
    await reloadOptOuts();
    subscribe();

    client.on(Events.PresenceUpdate, (oldP, newP) => {
      void onPresenceUpdate(oldP, newP).catch((e) =>
        console.warn("[Pulse] gaming presence failed:", e.message),
      );
    });

    // Presence and member caches need a moment to populate before recovery can
    // tell "still playing" from "stopped while we were down".
    setTimeout(() => {
      void recoverOpenSessions().then(() => {
        sweepTimer = setInterval(() => void sweep(), SWEEP_MS);
        if (sweepTimer.unref) sweepTimer.unref();
      });
    }, READY_DELAY_MS);

    console.log("[Pulse] Gaming analytics started.");
  }

  return {
    start,
    reloadConfigs,
    reloadOptOuts,
    sweep,
    recoverOpenSessions,
    optOut,
    optIn,
    configFor,
    // Exposed for the /gaming command handlers.
    openSessions: open,
    handleOverview,
    handleProfile,
    handleLeaderboard,
    handleGames,
    handleCurrentlyPlaying,
    handleOptOut,
    handleOptIn,
  };
}

module.exports = {
  createGaming,
  // Pure helpers exported for reuse + tests.
  normaliseGamingSettings,
  gameKeyOf,
  pickGameActivity,
  isStreaming,
  exclusionReason,
  formatDuration,
  DEFAULT_CONFIG,
  MAX_SESSION_HOURS,
};
