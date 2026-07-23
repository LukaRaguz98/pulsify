"use strict";

// Server Statistics Channels (bot side) — PULSIFY-57.
//
// The DASHBOARD owns the config (create/edit/duplicate/delete/reorder/enable via
// the API routes under /api/discord/guild/[guildId]/statistics-channels). This
// module owns EVERY Discord operation:
//   • provisions the channel (a locked voice channel or a category header),
//   • renames it when the tracked value CHANGES, and
//   • tears it down when the row is disabled or deleted.
//
// A realtime subscription makes new/edited rows act promptly; a 10-minute sweep
// keeps values fresh. Discord rate-limits channel renames hard (≈2 / 10 min /
// channel), so we compare against the stored `last_value` and only rename when
// the number actually moved.
//
// Value formatting + name rendering mirror
// pulsify-web-app/lib/statistics-channels.ts — keep the two in sync.

const { PermissionFlagsBits, ChannelType, Routes } = require("discord.js");

const SYNC_MS = 10 * 60 * 1000; // value-refresh sweep cadence
const NAME_MAX = 100;
const MEMBER_FETCH_TTL_MS = 60 * 60 * 1000; // throttle full member fetches to 1/h/guild

// stat_type -> { token, kind }. `kind: 'text'` values (server age) skip number
// formatting; everything else gets thousands separators.
const STAT_META = {
  total_members: { token: "members", kind: "count" },
  humans: { token: "humans", kind: "count" },
  bots: { token: "bots", kind: "count" },
  online: { token: "online", kind: "count" },
  boosts: { token: "boosts", kind: "count" },
  boost_level: { token: "level", kind: "count" },
  roles: { token: "roles", kind: "count" },
  channels: { token: "channels", kind: "count" },
  voice_channels: { token: "voice", kind: "count" },
  text_channels: { token: "text", kind: "count" },
  server_age: { token: "age", kind: "text" },
  emojis: { token: "emojis", kind: "count" },
  stickers: { token: "stickers", kind: "count" },
  new_today: { token: "today", kind: "count" },
  new_week: { token: "week", kind: "count" },
  total_messages: { token: "messages", kind: "count" },
  active_members: { token: "active", kind: "count" },
};

function formatValue(statType, raw) {
  if (raw === null || raw === undefined) return null;
  const meta = STAT_META[statType];
  if (meta && meta.kind === "text") return String(raw);
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return String(raw);
  return n.toLocaleString("en-US");
}

function renderName(template, statType, formattedValue) {
  const meta = STAT_META[statType];
  let out = template && template.trim() ? template : "{value}";
  out = out.replace(/\{value\}/gi, formattedValue);
  if (meta) out = out.replace(new RegExp(`\\{${meta.token}\\}`, "gi"), formattedValue);
  return out.slice(0, NAME_MAX);
}

function formatServerAge(createdMs, now) {
  const days = Math.max(0, Math.floor((now - createdMs) / 86_400_000));
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  if (years > 0) return months > 0 ? `${years}y ${months}mo` : `${years}y`;
  if (months > 0) {
    const rem = days % 30;
    return rem > 0 ? `${months}mo ${rem}d` : `${months}mo`;
  }
  return `${days}d`;
}

function createStatisticsChannels(client, supabase) {
  let timer = null;
  // guild_id -> ms of last full member fetch (throttle humans/bots/online).
  const memberFetchedAt = new Map();
  // row.id currently being provisioned, so a burst can't double-create.
  const provisioning = new Set();
  // row.id -> last seen sync_requested_at, to detect "Sync now" nudges.
  const syncSeen = new Map();

  // ── Supabase-backed value helpers ──────────────────────────────────────────

  async function countEvents(guildId, eventType, sinceIso) {
    let q = supabase
      .from("analytics_events")
      .select("*", { count: "exact", head: true })
      .eq("guild_id", guildId)
      .eq("event_type", eventType);
    if (sinceIso) q = q.gte("created_at", sinceIso);
    const { count } = await q;
    return count ?? 0;
  }

  async function activeMemberCount(guildId) {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data } = await supabase
      .from("analytics_events")
      .select("user_id")
      .eq("guild_id", guildId)
      .eq("event_type", "message")
      .gte("created_at", weekAgo)
      .limit(10_000);
    if (!data) return 0;
    return new Set(data.map((r) => r.user_id).filter(Boolean)).size;
  }

  // Best-effort full member cache for humans/bots, throttled per guild.
  async function ensureMembers(guild) {
    if (guild.members.cache.size >= guild.memberCount) return;
    const last = memberFetchedAt.get(guild.id) ?? 0;
    if (Date.now() - last < MEMBER_FETCH_TTL_MS) return;
    memberFetchedAt.set(guild.id, Date.now());
    try {
      await guild.members.fetch({ time: 60_000 });
    } catch {
      // Missing intent / too large — humans/bots fall back to null below.
    }
  }

  // Online count via Discord's with_counts REST endpoint — works without the
  // (privileged) Presence intent, which the bot doesn't request.
  async function approxPresence(guildId) {
    try {
      const data = await client.rest.get(Routes.guild(guildId), {
        query: new URLSearchParams({ with_counts: "true" }),
      });
      const n = data?.approximate_presence_count;
      return typeof n === "number" ? n : null;
    } catch {
      return null;
    }
  }

  // Compute every value the given stat types need. Values that can't be
  // determined come back null (the sweep then leaves that channel untouched).
  async function computeValues(guild, statTypes) {
    const set = new Set(statTypes);
    const now = Date.now();
    const values = {};

    const needsMemberList = set.has("humans") || set.has("bots");
    if (needsMemberList) await ensureMembers(guild).catch(() => {});

    if (set.has("total_members")) values.total_members = guild.memberCount;
    if (needsMemberList) {
      const bots = guild.members.cache.filter((m) => m.user.bot).size;
      const cachedEnough = guild.members.cache.size >= guild.memberCount;
      values.bots = cachedEnough || bots > 0 ? bots : null;
      values.humans = values.bots === null ? null : Math.max(0, guild.memberCount - values.bots);
    }
    if (set.has("online")) values.online = await approxPresence(guild.id);
    if (set.has("boosts")) values.boosts = guild.premiumSubscriptionCount ?? 0;
    if (set.has("boost_level")) values.boost_level = guild.premiumTier ?? 0;
    if (set.has("roles")) values.roles = guild.roles.cache.size;
    if (set.has("channels")) values.channels = guild.channels.cache.filter((c) => c.type !== ChannelType.GuildCategory).size;
    if (set.has("voice_channels")) values.voice_channels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice).size;
    if (set.has("text_channels")) {
      values.text_channels = guild.channels.cache.filter((c) =>
        c.type === ChannelType.GuildText ||
        c.type === ChannelType.GuildAnnouncement ||
        c.type === ChannelType.GuildForum ||
        c.type === ChannelType.GuildMedia,
      ).size;
    }
    if (set.has("emojis")) values.emojis = guild.emojis.cache.size;
    if (set.has("stickers")) values.stickers = guild.stickers.cache.size;
    if (set.has("server_age")) values.server_age = formatServerAge(guild.createdTimestamp, now);

    if (set.has("new_today")) values.new_today = await countEvents(guild.id, "member_join", new Date(now - 86_400_000).toISOString()).catch(() => null);
    if (set.has("new_week")) values.new_week = await countEvents(guild.id, "member_join", new Date(now - 7 * 86_400_000).toISOString()).catch(() => null);
    if (set.has("total_messages")) values.total_messages = await countEvents(guild.id, "message").catch(() => null);
    if (set.has("active_members")) values.active_members = await activeMemberCount(guild.id).catch(() => null);

    return values;
  }

  // ── Provisioning + rename ──────────────────────────────────────────────────

  async function resolveChannel(guild, id) {
    if (!id) return null;
    return guild.channels.fetch(id, { force: false }).catch(() => null);
  }

  // @everyone permission overwrites for a stat (always a locked voice channel):
  //   admins   → deny View Channel (private; Discord shows a clean padlock).
  //   everyone → deny Connect so nobody joins, but everyone sees the name
  //              (speaker icon + small lock).
  function overwritesFor(guild, row) {
    if (row.visibility === "admins") {
      return [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }];
    }
    return [{ id: guild.id, deny: [PermissionFlagsBits.Connect] }];
  }

  // Re-apply visibility to an existing channel without clobbering other
  // overwrites — surgically edits only the @everyone entry (null = clear).
  async function applyVisibility(guild, channel, row) {
    const opts =
      row.visibility === "admins"
        ? { ViewChannel: false, Connect: null }
        : { ViewChannel: null, Connect: false };
    await channel.permissionOverwrites
      .edit(guild.roles.everyone, opts, { reason: "Pulse statistics channel visibility" })
      .catch(() => {});
  }

  async function provision(guild, row, initialName) {
    const me = guild.members.me;
    if (!me || !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      await recordError(row.id, "Pulse is missing the Manage Channels permission.");
      return null;
    }
    try {
      const parent =
        row.category_id && guild.channels.cache.get(row.category_id)?.type === ChannelType.GuildCategory
          ? row.category_id
          : undefined;
      return await guild.channels.create({
        name: initialName,
        type: ChannelType.GuildVoice,
        parent,
        permissionOverwrites: overwritesFor(guild, row),
      });
    } catch (err) {
      await recordError(row.id, `Couldn't create the channel: ${err.message}`);
      return null;
    }
  }

  async function recordError(rowId, message) {
    await supabase
      .from("statistics_channels")
      .update({ last_error: message, updated_at: new Date().toISOString() })
      .eq("id", rowId)
      .then(() => {}, () => {});
  }

  async function writeSynced(rowId, valueStr, channelId) {
    const patch = {
      last_value: valueStr,
      last_synced_at: new Date().toISOString(),
      last_error: null,
      // Heal any legacy 'category' rows — everything is a voice channel now.
      channel_type: "voice",
      updated_at: new Date().toISOString(),
    };
    if (channelId) patch.channel_id = channelId;
    await supabase.from("statistics_channels").update(patch).eq("id", rowId).then(() => {}, () => {});
  }

  /** Bring one row's Discord channel in line with its current value. Returns the
   *  channel it acted on (so callers can re-apply visibility), or null. */
  async function syncRow(guild, row, value, force) {
    if (provisioning.has(row.id)) return null;
    const formatted = value === null || value === undefined ? null : formatValue(row.stat_type, value);
    // Value couldn't be computed (e.g. online without the Presence intent) —
    // leave the channel as-is and note why, but don't spam on every sweep.
    if (formatted === null) {
      if (!row.last_value) await recordError(row.id, "This statistic isn't available yet (Pulse may need the Presence or Server Members intent).");
      return null;
    }
    const desiredName = renderName(row.name_template, row.stat_type, formatted);
    const valueStr = String(value);

    let channel = await resolveChannel(guild, row.channel_id);
    // Stat channels are always voice now. If an existing channel is a leftover
    // category (from the removed category variant), drop it and re-provision as a
    // voice channel so it shows up correctly.
    if (channel && channel.type !== ChannelType.GuildVoice) {
      await channel.delete("Pulse statistics channel — converting to voice").catch(() => {});
      channel = null;
    }
    if (!channel) {
      provisioning.add(row.id);
      try {
        channel = await provision(guild, row, desiredName);
      } finally {
        provisioning.delete(row.id);
      }
      if (!channel) return null;
      await writeSynced(row.id, valueStr, channel.id);
      console.log(
        `[Pulse] Provisioned stat voice ${channel.id} (${row.stat_type}) in guild ${guild.id}.`,
      );
      return channel;
    }

    // Manual channels only refresh when explicitly synced, once they have a value.
    if (row.update_mode === "manual" && !force && row.last_value !== null && row.last_value !== undefined) {
      return channel;
    }
    // Change-detection: only rename when the rendered name actually differs.
    if (channel.name === desiredName && row.last_value === valueStr) return channel;
    if (channel.name === desiredName) {
      await writeSynced(row.id, valueStr, channel.id);
      return channel;
    }
    try {
      await channel.setName(desiredName, "Pulse statistics channel update");
      await writeSynced(row.id, valueStr, channel.id);
    } catch (err) {
      // A 429 here means we hit Discord's rename bucket — surface it; the next
      // sweep retries once the bucket resets.
      await recordError(row.id, `Rename failed: ${err.message}`);
    }
    return channel;
  }

  async function teardown(guildId, channelId) {
    if (!channelId) return;
    const guild = client.guilds.cache.get(guildId);
    const channel = guild ? await resolveChannel(guild, channelId) : null;
    if (channel) await channel.delete("Pulse statistics channel removed").catch(() => {});
  }

  // Provision/refresh every enabled row of a guild in one pass.
  async function syncGuild(guild, rows, force) {
    const enabled = rows.filter((r) => r.enabled);
    if (enabled.length === 0) return;
    const values = await computeValues(guild, enabled.map((r) => r.stat_type)).catch(() => ({}));
    for (const row of enabled) {
      await syncRow(guild, row, values[row.stat_type], force).catch((err) =>
        console.warn(`[Pulse] stat-channel sync failed (${row.id}):`, err.message),
      );
    }
  }

  // ── Sweep (all guilds) ──────────────────────────────────────────────────────

  async function sweep({ force = false } = {}) {
    const { data: rows, error } = await supabase.from("statistics_channels").select("*");
    if (error) {
      console.warn("[Pulse] statistics_channels load failed:", error.message);
      return;
    }
    const byGuild = new Map();
    for (const row of rows ?? []) {
      if (!byGuild.has(row.guild_id)) byGuild.set(row.guild_id, []);
      byGuild.get(row.guild_id).push(row);
      syncSeen.set(row.id, row.sync_requested_at ?? null);
    }
    for (const [guildId, guildRows] of byGuild) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      // In the interval sweep, only auto rows refresh; manual ones still get
      // provisioned + an initial value on their first pass.
      const due = force ? guildRows : guildRows.filter((r) => r.update_mode === "auto" || !r.last_value);
      await syncGuild(guild, due, force).catch(() => {});
    }
  }

  // ── Realtime ────────────────────────────────────────────────────────────────

  function subscribe() {
    supabase
      .channel("statistics-channels-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "statistics_channels" }, (payload) => {
        void handleChange(payload).catch((err) =>
          console.warn("[Pulse] stat-channel realtime error:", err.message),
        );
      })
      .subscribe();
  }

  async function handleChange(payload) {
    if (payload.eventType === "DELETE") {
      const old = payload.old;
      if (old?.channel_id) await teardown(old.guild_id, old.channel_id);
      if (old?.id) syncSeen.delete(old.id);
      return;
    }
    const row = payload.new;
    if (!row) return;
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) return;

    // Disabled → tear the Discord channel down and clear the stored id.
    if (!row.enabled) {
      if (row.channel_id) {
        await teardown(row.guild_id, row.channel_id);
        await supabase
          .from("statistics_channels")
          .update({ channel_id: null, last_value: null, updated_at: new Date().toISOString() })
          .eq("id", row.id)
          .then(() => {}, () => {});
      }
      return;
    }

    // A "Sync now" nudge (or a fresh insert/edit) forces an immediate refresh.
    const prevSeen = syncSeen.get(row.id);
    const forced = row.sync_requested_at && row.sync_requested_at !== prevSeen;
    syncSeen.set(row.id, row.sync_requested_at ?? null);

    const values = await computeValues(guild, [row.stat_type]).catch(() => ({}));
    const channel = await syncRow(guild, row, values[row.stat_type], !!forced || payload.eventType === "INSERT").catch(() => null);
    // Re-apply visibility so an edit that flips everyone↔admins updates the
    // channel's lock (creation already sets it correctly).
    if (channel) await applyVisibility(guild, channel, row).catch(() => {});
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async function start() {
    subscribe();
    // Initial provisioning + value pass for every configured guild.
    await sweep({ force: false }).catch((err) =>
      console.warn("[Pulse] initial statistics-channel sweep failed:", err.message),
    );
    timer = setInterval(() => void sweep().catch(() => {}), SYNC_MS);
    console.log("[Pulse] Statistics Channels started.");
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  /**
   * Force an immediate refresh of one guild's statistics channels (PULSIFY-61,
   * /statchannel refresh). Reuses syncGuild with force=true so even manual-mode
   * rows re-render — the same path the dashboard's "Sync now" nudge takes, but
   * direct rather than via a realtime round-trip. Returns a small summary for the
   * command reply. Throws on a load error so the caller can report it.
   */
  async function refreshGuild(guild) {
    const { data: rows, error } = await supabase
      .from("statistics_channels")
      .select("*")
      .eq("guild_id", guild.id);
    if (error) throw new Error(error.message);
    const enabled = (rows ?? []).filter((r) => r.enabled);
    if (enabled.length > 0) await syncGuild(guild, enabled, true);
    return { total: rows?.length ?? 0, enabled: enabled.length };
  }

  return { start, stop, refreshGuild };
}

module.exports = { createStatisticsChannels };
