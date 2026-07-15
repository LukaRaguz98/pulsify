// Invite Tracking & Referral System — bot side (PULSIFY-60).
//
// This module owns the TRUTH of invite tracking. It mirrors each guild's Discord
// invite list into `invites`, and on every join it diffs the use counts to work
// out which invite (and therefore which inviter) was used, writes an
// `invited_members` row, evaluates the join against the guild's valid-invite
// rules + anti-abuse, grants milestone rewards to the inviter, and reacts to
// leaves / rejoins. A periodic sweep re-evaluates pending joins (a member who
// has now stayed long enough / completed onboarding becomes valid), grants any
// newly-earned rewards, revokes rewards when a count drops (if configured) and
// raises suspicious-spike alerts.
//
// Settings math + validity evaluation mirror pulsify-web-app/lib/invites.ts —
// keep the two in sync (same stance as birthdays.js ↔ lib/birthdays.ts).

const { Events, MessageFlags } = require("discord.js");
const { recordNotification } = require("./notifications");
const { buildPulseContainer, getPulseColor, loadPulseIcon, text } = require("./commands");

const SWEEP_MS = 10 * 60 * 1000; // every 10 minutes
const DISCORD_EPOCH = 1_420_070_400_000;

// ── Pure helpers (mirror of lib/invites.ts) ───────────────────────────────────

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

const DEFAULT_CONFIG = {
  enabled: false,
  min_account_age_days: 7,
  min_stay_hours: 0,
  require_onboarding: false,
  require_verification: false,
  require_no_flags: true,
  min_activity_messages: 0,
  exclude_alts: true,
  block_self_invites: true,
  block_alt_farming: true,
  rejoin_window_hours: 24,
  max_rejoins: 3,
  spike_threshold: 20,
  dedup_rewards: true,
  rewards_stack: true,
  remove_on_drop: false,
  notify_channel_id: null,
  notify_on_join: false,
  notify_on_valid: false,
  notify_on_milestone: true,
  notify_on_reward: true,
  notify_on_invalid: false,
};

function normaliseInviteSettings(row) {
  const base = { ...DEFAULT_CONFIG };
  if (!row) return base;
  const enabled = typeof row.enabled === "boolean" ? row.enabled : base.enabled;
  const s = row.settings && typeof row.settings === "object" ? row.settings : {};
  const bool = (v, d) => (v == null ? d : Boolean(v));
  return {
    enabled,
    min_account_age_days: clampInt(s.min_account_age_days, 0, 3650, base.min_account_age_days),
    min_stay_hours: clampInt(s.min_stay_hours, 0, 24 * 90, base.min_stay_hours),
    require_onboarding: bool(s.require_onboarding, base.require_onboarding),
    require_verification: bool(s.require_verification, base.require_verification),
    require_no_flags: bool(s.require_no_flags, base.require_no_flags),
    min_activity_messages: clampInt(s.min_activity_messages, 0, 100_000, base.min_activity_messages),
    exclude_alts: bool(s.exclude_alts, base.exclude_alts),
    block_self_invites: bool(s.block_self_invites, base.block_self_invites),
    block_alt_farming: bool(s.block_alt_farming, base.block_alt_farming),
    rejoin_window_hours: clampInt(s.rejoin_window_hours, 0, 24 * 30, base.rejoin_window_hours),
    max_rejoins: clampInt(s.max_rejoins, 0, 50, base.max_rejoins),
    spike_threshold: clampInt(s.spike_threshold, 0, 1000, base.spike_threshold),
    dedup_rewards: bool(s.dedup_rewards, base.dedup_rewards),
    rewards_stack: bool(s.rewards_stack, base.rewards_stack),
    remove_on_drop: bool(s.remove_on_drop, base.remove_on_drop),
    notify_channel_id: typeof s.notify_channel_id === "string" && s.notify_channel_id ? s.notify_channel_id : null,
    notify_on_join: bool(s.notify_on_join, base.notify_on_join),
    notify_on_valid: bool(s.notify_on_valid, base.notify_on_valid),
    notify_on_milestone: bool(s.notify_on_milestone, base.notify_on_milestone),
    notify_on_reward: bool(s.notify_on_reward, base.notify_on_reward),
    notify_on_invalid: bool(s.notify_on_invalid, base.notify_on_invalid),
  };
}

/** Anti-abuse (fake) → permanent invalid → time-dependent pending → valid. */
function evaluateInvite(cfg, i) {
  if (cfg.block_self_invites && i.isSelf) return { status: "fake", reason: "self_invite" };
  if (cfg.block_alt_farming && i.isAlt) return { status: "fake", reason: "alt_account" };
  if (cfg.max_rejoins > 0 && i.rejoinCount >= cfg.max_rejoins) return { status: "fake", reason: "rejoin_abuse" };
  if (cfg.min_account_age_days > 0 && i.accountAgeDays < cfg.min_account_age_days) return { status: "invalid", reason: "account_too_young" };
  if (cfg.exclude_alts && i.isAlt) return { status: "invalid", reason: "likely_alt" };
  if (cfg.require_no_flags && i.hasActiveFlags) return { status: "invalid", reason: "moderation_flags" };
  if (cfg.min_stay_hours > 0 && i.stayHours < cfg.min_stay_hours) return { status: "pending", reason: "awaiting_stay" };
  if (cfg.require_onboarding && !i.completedOnboarding) return { status: "pending", reason: "awaiting_onboarding" };
  if (cfg.require_verification && !i.verified) return { status: "pending", reason: "awaiting_verification" };
  if (cfg.min_activity_messages > 0 && i.activityMessages < cfg.min_activity_messages) return { status: "pending", reason: "awaiting_activity" };
  return { status: "valid", reason: null };
}

function snowflakeToDate(id) {
  try {
    const ms = Number(BigInt(id) >> 22n) + DISCORD_EPOCH;
    return Number.isFinite(ms) ? new Date(ms) : null;
  } catch {
    return null;
  }
}

function accountAgeDays(date, now = new Date()) {
  if (!date) return 0;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
}

function hoursBetween(from, to = new Date()) {
  const d = from instanceof Date ? from : new Date(from);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, (to.getTime() - d.getTime()) / 3_600_000);
}

// ── Module factory ────────────────────────────────────────────────────────────

function createInvites(client, supabase) {
  const configs = new Map(); // guildId -> normalised config
  // guildId -> Map<code, { uses, inviterId, inviterName, channelId }>
  const inviteCache = new Map();
  const vanityUses = new Map(); // guildId -> uses
  let sweepTimer = null;
  let sweeping = false;

  function getConfig(guildId) {
    return configs.get(guildId) ?? { ...DEFAULT_CONFIG };
  }

  async function reloadConfigs() {
    const { data, error } = await supabase.from("invite_settings").select("*");
    if (error) {
      console.warn("[Pulse] invite settings load failed:", error.message);
      return;
    }
    configs.clear();
    for (const row of data ?? []) configs.set(row.guild_id, normaliseInviteSettings(row));
    console.log(`[Pulse] Loaded invite settings for ${configs.size} guild(s).`);
  }

  function subscribe() {
    supabase
      .channel("invite-settings-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "invite_settings" }, (payload) => {
        const guildId = payload.new?.guild_id ?? payload.old?.guild_id;
        if (!guildId) return;
        if (payload.eventType === "DELETE") configs.delete(guildId);
        else configs.set(guildId, normaliseInviteSettings(payload.new));
      })
      .subscribe();
  }

  // ── Invite cache ─────────────────────────────────────────────────────────────

  async function cacheGuild(guild) {
    try {
      const invites = await guild.invites.fetch();
      const map = new Map();
      const rows = [];
      for (const inv of invites.values()) {
        map.set(inv.code, {
          uses: inv.uses ?? 0,
          inviterId: inv.inviter?.id ?? null,
          inviterName: inv.inviter?.username ?? null,
          channelId: inv.channelId ?? null,
        });
        rows.push({
          guild_id: guild.id,
          code: inv.code,
          inviter_id: inv.inviter?.id ?? null,
          inviter_name: inv.inviter?.username ?? null,
          channel_id: inv.channelId ?? null,
          uses: inv.uses ?? 0,
          max_uses: inv.maxUses ?? 0,
          max_age: inv.maxAge ?? 0,
          temporary: Boolean(inv.temporary),
          is_vanity: false,
          created_at: inv.createdAt ? inv.createdAt.toISOString() : null,
          last_seen_at: new Date().toISOString(),
          deleted_at: null,
        });
      }
      inviteCache.set(guild.id, map);
      if (rows.length) {
        await supabase.from("invites").upsert(rows, { onConflict: "guild_id,code" }).then(
          () => {},
          (err) => console.warn(`[Pulse] invites upsert failed for ${guild.id}:`, err?.message),
        );
      }
    } catch (err) {
      // Missing Manage Server permission or the intent — attribution degrades to
      // "unknown" but the rest of the module keeps working.
      inviteCache.set(guild.id, new Map());
      if (err?.code !== 50013) console.warn(`[Pulse] invite cache failed for ${guild.id}:`, err?.message);
    }
    // Vanity URL (Community servers) — tracked separately.
    try {
      if (guild.features?.includes("VANITY_URL")) {
        const v = await guild.fetchVanityData();
        vanityUses.set(guild.id, v.uses ?? 0);
      }
    } catch {
      /* no vanity / no perms */
    }
  }

  async function onInviteCreate(invite) {
    const guildId = invite.guild?.id;
    if (!guildId) return;
    const map = inviteCache.get(guildId) ?? new Map();
    map.set(invite.code, {
      uses: invite.uses ?? 0,
      inviterId: invite.inviter?.id ?? null,
      inviterName: invite.inviter?.username ?? null,
      channelId: invite.channelId ?? null,
    });
    inviteCache.set(guildId, map);
    await supabase
      .from("invites")
      .upsert(
        {
          guild_id: guildId,
          code: invite.code,
          inviter_id: invite.inviter?.id ?? null,
          inviter_name: invite.inviter?.username ?? null,
          channel_id: invite.channelId ?? null,
          uses: invite.uses ?? 0,
          max_uses: invite.maxUses ?? 0,
          max_age: invite.maxAge ?? 0,
          temporary: Boolean(invite.temporary),
          is_vanity: false,
          created_at: invite.createdAt ? invite.createdAt.toISOString() : new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          deleted_at: null,
        },
        { onConflict: "guild_id,code" },
      )
      .then(() => {}, () => {});
  }

  async function onInviteDelete(invite) {
    const guildId = invite.guild?.id;
    if (!guildId) return;
    inviteCache.get(guildId)?.delete(invite.code);
    await supabase
      .from("invites")
      .update({ deleted_at: new Date().toISOString() })
      .eq("guild_id", guildId)
      .eq("code", invite.code)
      .then(() => {}, () => {});
  }

  // Diff the live invite list against the cache to find the used code. Handles
  // the three cases: a normal invite's uses ticked up, a one-time invite that
  // used its last charge and vanished, and the vanity URL.
  async function resolveUsedInvite(guild) {
    const cached = inviteCache.get(guild.id) ?? new Map();
    let live;
    try {
      live = await guild.invites.fetch();
    } catch {
      return { code: null, inviterId: null, inviterName: null, source: "unknown" };
    }

    let used = null;
    for (const inv of live.values()) {
      const prev = cached.get(inv.code);
      const prevUses = prev?.uses ?? 0;
      if ((inv.uses ?? 0) > prevUses) {
        used = { code: inv.code, inviterId: inv.inviter?.id ?? null, inviterName: inv.inviter?.username ?? null, source: "normal" };
        break;
      }
    }

    // A one-time invite that hit its cap is now absent from the live list.
    if (!used) {
      const liveCodes = new Set(live.map((i) => i.code));
      for (const [code, prev] of cached) {
        if (!liveCodes.has(code)) {
          used = { code, inviterId: prev.inviterId, inviterName: prev.inviterName, source: "normal" };
          break;
        }
      }
    }

    // Refresh the cache from the live list either way.
    const nextMap = new Map();
    for (const inv of live.values()) {
      nextMap.set(inv.code, {
        uses: inv.uses ?? 0,
        inviterId: inv.inviter?.id ?? null,
        inviterName: inv.inviter?.username ?? null,
        channelId: inv.channelId ?? null,
      });
    }
    inviteCache.set(guild.id, nextMap);

    // Vanity URL fallback.
    if (!used && guild.features?.includes("VANITY_URL")) {
      try {
        const v = await guild.fetchVanityData();
        const prev = vanityUses.get(guild.id) ?? 0;
        vanityUses.set(guild.id, v.uses ?? 0);
        if ((v.uses ?? 0) > prev) {
          used = { code: v.code ?? "vanity", inviterId: null, inviterName: null, source: "vanity" };
        }
      } catch {
        /* ignore */
      }
    }

    return used ?? { code: null, inviterId: null, inviterName: null, source: "unknown" };
  }

  // ── Retention / validity inputs ────────────────────────────────────────────────

  async function isLikelyAlt(guildId, userId) {
    try {
      const { data } = await supabase
        .from("alt_investigations")
        .select("risk_level")
        .eq("guild_id", guildId)
        .eq("user_id", userId)
        .maybeSingle();
      const level = String(data?.risk_level ?? "").toLowerCase();
      return level === "high" || level === "critical";
    } catch {
      return false;
    }
  }

  async function hasActiveFlags(guildId, userId) {
    try {
      const { count } = await supabase
        .from("moderation_logs")
        .select("id", { count: "exact", head: true })
        .eq("guild_id", guildId)
        .eq("user_id", userId);
      return (count ?? 0) > 0;
    } catch {
      return false;
    }
  }

  async function activityMessageCount(guildId, userId) {
    try {
      const { count } = await supabase
        .from("analytics_events")
        .select("id", { count: "exact", head: true })
        .eq("guild_id", guildId)
        .eq("user_id", userId)
        .eq("event_type", "message");
      return count ?? 0;
    } catch {
      return 0;
    }
  }

  async function onboardingState(guildId, userId) {
    try {
      const { data } = await supabase
        .from("onboarding_member_progress")
        .select("status, completed_at, verified")
        .eq("guild_id", guildId)
        .eq("user_id", userId)
        .maybeSingle();
      return {
        completed: data?.status === "completed" || Boolean(data?.completed_at),
        verified: Boolean(data?.verified),
      };
    } catch {
      return { completed: false, verified: false };
    }
  }

  // Build the ValidityInput for a member. `cfg` gates the expensive lookups so we
  // only query what the guild's rules actually need.
  async function buildValidityInput(cfg, guild, row, inviterId) {
    const now = new Date();
    const accountDate = row.account_created_at ? new Date(row.account_created_at) : snowflakeToDate(row.user_id);
    const input = {
      accountAgeDays: accountAgeDays(accountDate, now),
      stayHours: hoursBetween(row.joined_at, now),
      completedOnboarding: row.completed_onboarding,
      verified: row.verified,
      hasActiveFlags: false,
      activityMessages: 0,
      isAlt: row.is_alt,
      isSelf: inviterId != null && inviterId === row.user_id,
      rejoinCount: row.rejoin_count ?? 0,
    };
    if (cfg.exclude_alts || cfg.block_alt_farming) input.isAlt = input.isAlt || (await isLikelyAlt(guild.id, row.user_id));
    if (cfg.require_no_flags) input.hasActiveFlags = await hasActiveFlags(guild.id, row.user_id);
    if (cfg.min_activity_messages > 0) input.activityMessages = await activityMessageCount(guild.id, row.user_id);
    if (cfg.require_onboarding || cfg.require_verification) {
      const ob = await onboardingState(guild.id, row.user_id);
      input.completedOnboarding = input.completedOnboarding || ob.completed;
      input.verified = input.verified || ob.verified;
    }
    return input;
  }

  // ── Join attribution ───────────────────────────────────────────────────────────

  async function onMemberJoin(member) {
    if (member.user?.bot) return;
    const guild = member.guild;
    const cfg = getConfig(guild.id);
    // Always attribute (so history is complete even before enabling), but skip
    // the heavier validity + reward work when the module is off.
    const used = await resolveUsedInvite(guild);

    const accountDate = member.user?.createdAt ?? snowflakeToDate(member.id);
    const now = new Date();

    // Existing episode? (rejoin)
    const { data: existing } = await supabase
      .from("invited_members")
      .select("*")
      .eq("guild_id", guild.id)
      .eq("user_id", member.id)
      .maybeSingle();

    let rejoinCount = 0;
    if (existing) {
      const leftAt = existing.left_at ? new Date(existing.left_at) : null;
      const withinWindow =
        leftAt && cfg.rejoin_window_hours > 0 && hoursBetween(leftAt, now) <= cfg.rejoin_window_hours;
      rejoinCount = (existing.rejoin_count ?? 0) + (leftAt ? 1 : 0);
      // A rapid rejoin doesn't reset the count that anti-abuse cares about.
      if (!withinWindow && leftAt && cfg.rejoin_window_hours > 0) {
        // Outside the window — still a rejoin, but not "rapid".
      }
    }

    const inviterId = used.inviterId;
    const baseRow = {
      guild_id: guild.id,
      user_id: member.id,
      user_name: member.user?.username ?? null,
      inviter_id: inviterId,
      inviter_name: used.inviterName,
      invite_code: used.code,
      source: used.source,
      account_created_at: accountDate ? accountDate.toISOString() : null,
      joined_at: now.toISOString(),
      left_at: null,
      is_bonus: false,
      rejoin_count: rejoinCount,
      completed_onboarding: existing?.completed_onboarding ?? false,
      verified: existing?.verified ?? false,
      updated_at: now.toISOString(),
    };

    // Evaluate the initial status.
    let verdict = { status: "pending", reason: null };
    if (cfg.enabled) {
      const input = await buildValidityInput(cfg, guild, { ...baseRow, is_alt: existing?.is_alt ?? false }, inviterId);
      verdict = evaluateInvite(cfg, input);
      baseRow.is_alt = input.isAlt;
    }

    await supabase
      .from("invited_members")
      .upsert(
        { ...baseRow, status: verdict.status, fake_reason: verdict.reason },
        { onConflict: "guild_id,user_id" },
      )
      .then(() => {}, (err) => console.warn(`[Pulse] invited_members upsert failed:`, err?.message));

    if (!cfg.enabled) return;

    // Notifications for the join.
    if (cfg.notify_on_join && verdict.status !== "fake") {
      await postInviteNotice(guild, cfg, {
        type: "invite_joined",
        title: `${member.user?.username ?? "A member"} joined`,
        body: inviterId ? `Invited by <@${inviterId}>.` : `Joined via ${used.source === "vanity" ? "the vanity URL" : "an unknown invite"}.`,
        targetId: member.id,
        targetName: member.user?.username,
      });
    }
    if (verdict.status === "fake" || verdict.status === "invalid") {
      if (cfg.notify_on_invalid) {
        await postInviteNotice(guild, cfg, {
          type: "invite_invalid",
          title: `${member.user?.username ?? "A join"} flagged ${verdict.status}`,
          body: reasonText(verdict.reason),
          severity: verdict.status === "fake" ? "warning" : "info",
          targetId: member.id,
          targetName: member.user?.username,
        });
      }
    }

    // Valid at join (no time-based rules) → let the inviter know. Referral
    // rewards are Member Milestones (metric `invites`) granted by the milestone
    // sweep, so nothing to pay out here.
    if (verdict.status === "valid" && inviterId && cfg.notify_on_valid) {
      await postInviteNotice(guild, cfg, {
        type: "invite_valid",
        title: `A valid invite for ${used.inviterName ?? "an inviter"}`,
        body: `${member.user?.username ?? "A member"} counts as a valid invite.`,
        targetId: inviterId,
        targetName: used.inviterName,
      });
    }
  }

  async function onMemberLeave(member) {
    const guild = member.guild;
    const { data: row } = await supabase
      .from("invited_members")
      .select("*")
      .eq("guild_id", guild.id)
      .eq("user_id", member.id)
      .maybeSingle();
    if (!row) return;
    const now = new Date();
    // Keep fake/invalid as-is (they never counted); valid/pending become 'left'.
    const nextStatus = row.status === "fake" || row.status === "invalid" ? row.status : "left";
    await supabase
      .from("invited_members")
      .update({ left_at: now.toISOString(), status: nextStatus, is_active: false, updated_at: now.toISOString() })
      .eq("guild_id", guild.id)
      .eq("user_id", member.id);

  }

  // ── Notices ──────────────────────────────────────────────────────────────────
  //
  // Referral REWARDS are Member Milestones with the `invites` metric — the
  // milestone sweep (pulse-bot/src/milestones.js) grants them against the
  // inviter's valid-invite count, which get_member_milestone_metrics returns.
  // This module only owns attribution, scoring and the dashboard notices below.

  function reasonText(reason) {
    const labels = {
      self_invite: "Self-invite detected.",
      alt_account: "Alt account farming detected.",
      rejoin_abuse: "Rapid rejoin abuse detected.",
      account_too_young: "The account is too new.",
      likely_alt: "The account is a likely alt.",
      moderation_flags: "The member has active moderation flags.",
    };
    return labels[reason] ?? "Did not meet the valid-invite rules.";
  }

  async function postInviteNotice(guild, cfg, opts) {
    await recordNotification(supabase, {
      guildId: guild.id,
      type: opts.type,
      severity: opts.severity,
      title: opts.title,
      body: opts.body,
      link: `/dashboard/${guild.id}/invites`,
      targetId: opts.targetId,
      targetName: opts.targetName,
    });
  }

  // ── Sweep ──────────────────────────────────────────────────────────────────────

  async function sweepGuild(guild) {
    const cfg = getConfig(guild.id);
    if (!cfg.enabled) return;

    // Re-evaluate pending joins — stay time / onboarding / activity may now pass.
    const { data: pending } = await supabase
      .from("invited_members")
      .select("*")
      .eq("guild_id", guild.id)
      .eq("status", "pending");

    for (const row of pending ?? []) {
      const member = await guild.members.fetch(row.user_id).catch(() => null);
      if (!member) continue; // still counted as pending until they leave
      const input = await buildValidityInput(cfg, guild, row, row.inviter_id);
      const verdict = evaluateInvite(cfg, input);
      if (verdict.status === "pending") continue;
      await supabase
        .from("invited_members")
        .update({
          status: verdict.status,
          fake_reason: verdict.reason,
          is_alt: input.isAlt,
          completed_onboarding: input.completedOnboarding,
          verified: input.verified,
          is_active: input.activityMessages > 0,
          updated_at: new Date().toISOString(),
        })
        .eq("guild_id", guild.id)
        .eq("user_id", row.user_id);
      if (verdict.status === "valid" && row.inviter_id && cfg.notify_on_valid) {
        await postInviteNotice(guild, cfg, {
          type: "invite_valid",
          title: `A valid invite for ${row.inviter_name ?? "an inviter"}`,
          body: `${row.user_name ?? "A member"} now counts as a valid invite.`,
          targetId: row.inviter_id,
          targetName: row.inviter_name,
        });
      }
    }

    await detectSpike(guild, cfg);
  }

  // Suspicious spike: one inviter driving an unusual number of joins in the last
  // hour. Raises a single dashboard alert per sweep when the threshold is passed.
  async function detectSpike(guild, cfg) {
    if (cfg.spike_threshold <= 0) return;
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { data } = await supabase
      .from("invited_members")
      .select("inviter_id, inviter_name")
      .eq("guild_id", guild.id)
      .gte("joined_at", since);
    if (!data || data.length === 0) return;
    const counts = new Map();
    for (const r of data) {
      if (!r.inviter_id) continue;
      counts.set(r.inviter_id, (counts.get(r.inviter_id) ?? 0) + 1);
    }
    for (const [inviterId, n] of counts) {
      if (n < cfg.spike_threshold) continue;
      const name = data.find((r) => r.inviter_id === inviterId)?.inviter_name;
      await recordNotification(supabase, {
        guildId: guild.id,
        type: "invite_spike",
        severity: "warning",
        title: `Suspicious invite spike from ${name ?? "an inviter"}`,
        body: `${n} joins in the last hour — review for invite farming.`,
        link: `/dashboard/${guild.id}/invites`,
        targetId: inviterId,
        targetName: name,
        metadata: { count: n, window: "1h" },
      }).catch(() => {});
    }
  }

  async function sweep() {
    if (sweeping) return;
    sweeping = true;
    try {
      for (const guild of client.guilds.cache.values()) {
        await sweepGuild(guild).catch((err) => console.warn(`[Pulse] invite sweep failed for ${guild.id}:`, err.message));
      }
    } finally {
      sweeping = false;
    }
  }

  // ── Slash commands ───────────────────────────────────────────────────────────

  async function replyEphemeral(interaction, guild, title, lines, withIcon = false) {
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = withIcon ? await loadPulseIcon("invite", colorHex) : null;
    const container = buildPulseContainer({
      iconUrl: icon ? `attachment://${icon.name}` : undefined,
      colorHex,
      title,
      body: lines.map((l) => text(l)),
      footer: "Pulse — Invites",
    });
    const components = [container];
    const files = icon ? [icon] : [];
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ components, files, flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    } else {
      await interaction.reply({ components, files, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
    }
  }

  async function statsForInviter(guildId, inviterId) {
    const [{ data: rows }, { data: adj }] = await Promise.all([
      supabase.from("invited_members").select("status, left_at").eq("guild_id", guildId).eq("inviter_id", inviterId),
      supabase.from("invite_adjustments").select("amount").eq("guild_id", guildId).eq("user_id", inviterId).eq("kind", "bonus"),
    ]);
    const s = { total: 0, valid: 0, pending: 0, invalid: 0, fake: 0, left: 0, retained: 0 };
    for (const r of rows ?? []) {
      s.total++;
      if (r.status === "valid") {
        s.valid++;
        if (!r.left_at) s.retained++;
      } else if (r.status === "pending") s.pending++;
      else if (r.status === "invalid") s.invalid++;
      else if (r.status === "fake") s.fake++;
      else if (r.status === "left") s.left++;
    }
    s.bonus = Math.max(0, (adj ?? []).reduce((a, x) => a + (x.amount ?? 0), 0));
    s.score = s.valid + s.bonus - s.fake;
    return s;
  }

  async function handleInvitesCommand({ interaction, guild }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const target = interaction.options.getUser("user") ?? interaction.user;
    const s = await statsForInviter(guild.id, target.id);
    const who = target.id === interaction.user.id ? "Your invites" : `${target.username}'s invites`;
    const lines = [
      `**Score ${s.score}** — ${s.valid} valid, ${s.bonus} bonus, ${s.fake} fake`,
      `-# ${s.retained} retained · ${s.pending} pending · ${s.left} left · ${s.invalid} invalid`,
    ];
    if (s.total === 0 && s.bonus === 0) lines.push("No tracked invites yet — share an invite link to get started.");
    await replyEphemeral(interaction, guild, who, lines, true);
  }

  async function handleLeaderboardCommand({ interaction, guild }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const period = interaction.options.getString("period") ?? "all";
    const ms = period === "day" ? 86_400_000 : period === "week" ? 7 * 86_400_000 : period === "month" ? 30 * 86_400_000 : null;
    const since = ms ? new Date(Date.now() - ms).toISOString() : null;
    const { data, error } = await supabase.rpc("get_invite_leaderboard", { p_guild_id: guild.id, p_since: since });
    if (error) {
      await replyEphemeral(interaction, guild, "Invite leaderboard", ["Couldn't load the leaderboard right now."]);
      return;
    }
    // Merge all-time bonus for the all-time board only.
    let bonusMap = new Map();
    if (!since) {
      const { data: adj } = await supabase.from("invite_adjustments").select("user_id, amount").eq("guild_id", guild.id).eq("kind", "bonus");
      for (const a of adj ?? []) if (a.user_id) bonusMap.set(a.user_id, (bonusMap.get(a.user_id) ?? 0) + (a.amount ?? 0));
    }
    const ranked = (data ?? [])
      .map((r) => {
        const bonus = Math.max(0, bonusMap.get(r.inviter_id) ?? 0);
        return { id: r.inviter_id, name: r.inviter_name, valid: Number(r.valid ?? 0), fake: Number(r.fake ?? 0), score: Number(r.valid ?? 0) + bonus - Number(r.fake ?? 0) };
      })
      .sort((a, b) => b.score - a.score || b.valid - a.valid)
      .slice(0, 10);
    const label = period === "day" ? "today" : period === "week" ? "this week" : period === "month" ? "this month" : "all time";
    if (ranked.length === 0) {
      await replyEphemeral(interaction, guild, "Invite leaderboard", [`No tracked invites for ${label} yet.`], true);
      return;
    }
    const medals = ["🥇", "🥈", "🥉"];
    const lines = ranked.map((r, i) => `${medals[i] ?? `**${i + 1}.**`} <@${r.id}> — **${r.score}** (${r.valid} valid)`);
    lines.unshift(`-# Ranked by invite score — ${label}`);
    await replyEphemeral(interaction, guild, "Invite leaderboard", lines, true);
  }

  // Referral rewards are Member Milestones with the `invites` metric, so
  // /invite-rewards lists those milestones + the member's progress.
  async function handleRewardsCommand({ interaction, guild }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const { data: milestones } = await supabase
      .from("milestones")
      .select("name, threshold, rewards, enabled, metric")
      .eq("guild_id", guild.id)
      .eq("metric", "invites")
      .eq("enabled", true)
      .order("threshold", { ascending: true });
    if (!milestones || milestones.length === 0) {
      await replyEphemeral(interaction, guild, "Invite rewards", [
        "No invite rewards are set up yet.",
        "-# Admins create them as invite milestones in Engagement › Milestones.",
      ]);
      return;
    }
    const s = await statsForInviter(guild.id, interaction.user.id);
    const valid = s.valid + s.bonus;
    const roleName = (id) => guild.roles.cache.get(id)?.name;
    const lines = milestones.map((m) => {
      const roles = Array.isArray(m.rewards) ? m.rewards.map((r) => roleName(r.role_id)).filter(Boolean) : [];
      const reward = roles.length ? ` — ${roles.join(", ")}` : "";
      const done = valid >= m.threshold;
      const mark = done ? "✓" : `${valid}/${m.threshold}`;
      return `**${m.name}** — ${m.threshold} valid${reward} ${done ? `(${mark})` : `— ${mark}`}`;
    });
    lines.unshift(`-# You have **${valid}** valid invite${valid === 1 ? "" : "s"}`);
    await replyEphemeral(interaction, guild, "Invite rewards", lines, true);
  }

  async function start() {
    await reloadConfigs();
    subscribe();
    client.on(Events.InviteCreate, (invite) => void onInviteCreate(invite));
    client.on(Events.InviteDelete, (invite) => void onInviteDelete(invite));
    client.on(Events.GuildMemberAdd, (member) => void onMemberJoin(member).catch((e) => console.warn("[Pulse] invite join failed:", e.message)));
    client.on(Events.GuildMemberRemove, (member) => void onMemberLeave(member).catch(() => {}));
    // Prime the invite cache once the guild list is ready.
    setTimeout(() => {
      for (const guild of client.guilds.cache.values()) void cacheGuild(guild);
      void sweep();
      sweepTimer = setInterval(() => void sweep(), SWEEP_MS);
      if (sweepTimer.unref) sweepTimer.unref();
    }, 20_000);
    // Cache invites for guilds joined after start.
    client.on(Events.GuildCreate, (guild) => void cacheGuild(guild));
    console.log("[Pulse] Invite tracking started.");
  }

  return {
    start,
    reloadConfigs,
    sweep,
    handleInvitesCommand,
    handleLeaderboardCommand,
    handleRewardsCommand,
  };
}

module.exports = {
  createInvites,
  // Pure helpers exported for reuse + tests.
  normaliseInviteSettings,
  evaluateInvite,
  snowflakeToDate,
  accountAgeDays,
  hoursBetween,
  DEFAULT_CONFIG,
};
