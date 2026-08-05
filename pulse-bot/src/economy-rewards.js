// Economy Rewards & Earning engine (bot side) — PULSIFY-47.
//
// PULSIFY-45 paid Pulse Coins at FIXED rates hard-coded in economy.js. This
// module replaces those with a per-guild, configurable earning system: it owns
// the in-memory reward config cache (kept fresh by realtime on
// economy_reward_settings), the anti-abuse state (cooldowns, daily caps, dedup),
// the multiplier resolution and every award path. economy.js stays the low-level
// ledger (adjust/transfer/wallet); this module decides WHAT to pay and WHEN.
//
// Reputation is never granted here — it stays the computed trust score. It only
// acts as an earning MULTIPLIER (read live via economy.getGlobalReputation,
// cached) so trusted members earn a little more.
//
// The pure helpers (defaults, normalise, multipliers, streaks, baseAmountFor,
// simulate) MIRROR pulsify-web-app/lib/economy-rewards.ts — keep them in sync.

const { MessageFlags } = require("discord.js");
const {
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  replyContainer,
  replyNotice,
  buildNoticeContainer,
  text,
  divider,
} = require("./commands");

const DAY_MS = 86_400_000;

// ── Reward source catalogue (mirror) ─────────────────────────────────────────

const REWARD_SOURCES = [
  { key: "message", category: "activity", reason: "activity_message", label: "Messages sent", rateLimited: true },
  { key: "voice", category: "activity", reason: "activity_voice", label: "Voice activity", rateLimited: true },
  { key: "command", category: "activity", reason: "activity_command", label: "Command use", rateLimited: true },
  { key: "reaction", category: "activity", reason: "activity_reaction", label: "Reactions received", rateLimited: true },
  { key: "activeDay", category: "activity", reason: "activity_active_day", label: "Active day" },
  { key: "helpful", category: "activity", reason: "activity_helpful", label: "Helpful contribution" },
  { key: "participation", category: "event", reason: "event_participation", label: "Event interest" },
  { key: "attendance", category: "event", reason: "event_attendance", label: "Event attendance" },
  { key: "completion", category: "event", reason: "event_completion", label: "Event completion" },
  { key: "hosting", category: "event", reason: "event_hosting", label: "Event hosting" },
  { key: "participation", category: "giveaway", reason: "giveaway_entry", label: "Giveaway entry" },
  { key: "win", category: "giveaway", reason: "giveaway_win", label: "Giveaway win" },
  { key: "hosting", category: "giveaway", reason: "giveaway_hosting", label: "Giveaway hosting" },
  { key: "completion", category: "onboarding", reason: "onboarding_complete", label: "Onboarding complete" },
  { key: "profile", category: "onboarding", reason: "onboarding_profile", label: "Profile complete" },
  { key: "verification", category: "onboarding", reason: "onboarding_verify", label: "Verification" },
  { key: "roleSelection", category: "onboarding", reason: "onboarding_roles", label: "Role selection" },
  { key: "levelUp", category: "progression", reason: "level_up", label: "Level up" },
  { key: "milestone", category: "progression", reason: "milestone", label: "Milestone reached" },
  { key: "daily", category: "daily", reason: "daily", label: "Daily reward" },
  { key: "weekly", category: "daily", reason: "weekly", label: "Weekly reward" },
];

function sourceMeta(category, key) {
  return REWARD_SOURCES.find((s) => s.category === category && s.key === key) ?? null;
}

const REWARD_LIMITS = {
  maxAmount: 1_000_000,
  maxCooldownSeconds: 86_400,
  maxDailyCap: 10_000_000,
  maxMultiplier: 10,
  maxBonusPct: 500,
  maxStreakBonus: 1_000_000,
  maxMilestones: 10,
  maxStreak: 100_000,
  maxIgnored: 100,
  maxAccountAgeDays: 365,
  maxLabel: 60,
};

// ── Normalisation helpers (mirror) ────────────────────────────────────────────

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
function clampFloat(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function bool(v, fallback) {
  return typeof v === "boolean" ? v : fallback;
}
function toStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.length > 0);
}
function isoOrNull(v) {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function defaultRewardConfig() {
  return {
    enabled: true,
    activity: {
      message: { enabled: true, amount: 4, cooldownSeconds: 60, dailyCap: 500 },
      voice: { enabled: true, amount: 1, cooldownSeconds: 0, dailyCap: 500 },
      command: { enabled: false, amount: 1, cooldownSeconds: 60, dailyCap: 100 },
      reaction: { enabled: true, amount: 1, cooldownSeconds: 30, dailyCap: 100 },
      activeDay: { enabled: true, amount: 25 },
      helpful: { enabled: true, amount: 50 },
    },
    event: {
      participation: { enabled: true, amount: 25 },
      attendance: { enabled: true, amount: 50 },
      completion: { enabled: true, amount: 75 },
      hosting: { enabled: true, amount: 150 },
    },
    giveaway: {
      participation: { enabled: true, amount: 10 },
      win: { enabled: true, amount: 250 },
      hosting: { enabled: true, amount: 50 },
      multiplier: 1,
    },
    onboarding: {
      completion: { enabled: true, amount: 50 },
      profile: { enabled: true, amount: 25 },
      verification: { enabled: true, amount: 25 },
      roleSelection: { enabled: true, amount: 15 },
    },
    progression: {
      levelUp: { enabled: true, base: 25, perLevel: 5 },
      milestone: { enabled: true, amount: 100 },
    },
    daily: { enabled: true, amount: 50, streakBonus: 5, streakMax: 200, milestones: [{ streak: 7, bonus: 100 }, { streak: 30, bonus: 500 }] },
    weekly: { enabled: true, amount: 250, streakBonus: 25, streakMax: 500, milestones: [{ streak: 4, bonus: 500 }] },
    multipliers: {
      reputation: { enabled: false, maxBonusPct: 50 },
      event: { enabled: false, value: 1.5 },
      booster: { enabled: true, value: 1.5 },
      premium: { enabled: false, value: 1.25 },
      seasonal: { enabled: false, value: 2, label: "", startsAt: null, endsAt: null },
    },
    antiAbuse: { ignoredChannelIds: [], ignoredRoleIds: [], minAccountAgeDays: 0, globalDailyCap: 0 },
    notify: { dm: false, channelId: null },
  };
}

function normRateLimited(raw, def) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: bool(s.enabled, def.enabled),
    amount: clampInt(s.amount, 0, REWARD_LIMITS.maxAmount, def.amount),
    cooldownSeconds: clampInt(s.cooldownSeconds, 0, REWARD_LIMITS.maxCooldownSeconds, def.cooldownSeconds),
    dailyCap: clampInt(s.dailyCap, 0, REWARD_LIMITS.maxDailyCap, def.dailyCap),
  };
}
function normFlat(raw, def) {
  const s = raw && typeof raw === "object" ? raw : {};
  return { enabled: bool(s.enabled, def.enabled), amount: clampInt(s.amount, 0, REWARD_LIMITS.maxAmount, def.amount) };
}
function normMilestones(raw, def) {
  if (!Array.isArray(raw)) return def;
  const seen = new Set();
  const out = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const streak = clampInt(m.streak, 1, REWARD_LIMITS.maxStreak, 0);
    const bonus = clampInt(m.bonus, 0, REWARD_LIMITS.maxStreakBonus, 0);
    if (streak < 1 || bonus < 1 || seen.has(streak)) continue;
    seen.add(streak);
    out.push({ streak, bonus });
  }
  return out.sort((a, b) => a.streak - b.streak).slice(0, REWARD_LIMITS.maxMilestones);
}
function normStreak(raw, def) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: bool(s.enabled, def.enabled),
    amount: clampInt(s.amount, 0, REWARD_LIMITS.maxAmount, def.amount),
    streakBonus: clampInt(s.streakBonus, 0, REWARD_LIMITS.maxStreakBonus, def.streakBonus),
    streakMax: clampInt(s.streakMax, 0, REWARD_LIMITS.maxStreakBonus, def.streakMax),
    milestones: normMilestones(s.milestones, def.milestones),
  };
}
function normMult(raw, def) {
  const s = raw && typeof raw === "object" ? raw : {};
  return { enabled: bool(s.enabled, def.enabled), value: clampFloat(s.value, 1, REWARD_LIMITS.maxMultiplier, def.value) };
}

function normaliseRewardSettings(row) {
  const base = defaultRewardConfig();
  if (!row) return base;
  const enabled = bool(row.enabled, base.enabled);
  const s = row.settings && typeof row.settings === "object" ? row.settings : {};
  const a = s.activity && typeof s.activity === "object" ? s.activity : {};
  const ev = s.event && typeof s.event === "object" ? s.event : {};
  const gw = s.giveaway && typeof s.giveaway === "object" ? s.giveaway : {};
  const ob = s.onboarding && typeof s.onboarding === "object" ? s.onboarding : {};
  const pr = s.progression && typeof s.progression === "object" ? s.progression : {};
  const mu = s.multipliers && typeof s.multipliers === "object" ? s.multipliers : {};
  const aa = s.antiAbuse && typeof s.antiAbuse === "object" ? s.antiAbuse : {};
  const nt = s.notify && typeof s.notify === "object" ? s.notify : {};
  const lvl = pr.levelUp && typeof pr.levelUp === "object" ? pr.levelUp : {};
  const rep = mu.reputation && typeof mu.reputation === "object" ? mu.reputation : {};
  const sea = mu.seasonal && typeof mu.seasonal === "object" ? mu.seasonal : {};

  return {
    enabled,
    activity: {
      message: normRateLimited(a.message, base.activity.message),
      voice: normRateLimited(a.voice, base.activity.voice),
      command: normRateLimited(a.command, base.activity.command),
      reaction: normRateLimited(a.reaction, base.activity.reaction),
      activeDay: normFlat(a.activeDay, base.activity.activeDay),
      helpful: normFlat(a.helpful, base.activity.helpful),
    },
    event: {
      participation: normFlat(ev.participation, base.event.participation),
      attendance: normFlat(ev.attendance, base.event.attendance),
      completion: normFlat(ev.completion, base.event.completion),
      hosting: normFlat(ev.hosting, base.event.hosting),
    },
    giveaway: {
      participation: normFlat(gw.participation, base.giveaway.participation),
      win: normFlat(gw.win, base.giveaway.win),
      hosting: normFlat(gw.hosting, base.giveaway.hosting),
      multiplier: clampFloat(gw.multiplier, 1, REWARD_LIMITS.maxMultiplier, base.giveaway.multiplier),
    },
    onboarding: {
      completion: normFlat(ob.completion, base.onboarding.completion),
      profile: normFlat(ob.profile, base.onboarding.profile),
      verification: normFlat(ob.verification, base.onboarding.verification),
      roleSelection: normFlat(ob.roleSelection, base.onboarding.roleSelection),
    },
    progression: {
      levelUp: {
        enabled: bool(lvl.enabled, base.progression.levelUp.enabled),
        base: clampInt(lvl.base, 0, REWARD_LIMITS.maxAmount, base.progression.levelUp.base),
        perLevel: clampInt(lvl.perLevel, 0, REWARD_LIMITS.maxAmount, base.progression.levelUp.perLevel),
      },
      milestone: normFlat(pr.milestone, base.progression.milestone),
    },
    daily: normStreak(s.daily, base.daily),
    weekly: normStreak(s.weekly, base.weekly),
    multipliers: {
      reputation: {
        enabled: bool(rep.enabled, base.multipliers.reputation.enabled),
        maxBonusPct: clampInt(rep.maxBonusPct, 0, REWARD_LIMITS.maxBonusPct, base.multipliers.reputation.maxBonusPct),
      },
      event: normMult(mu.event, base.multipliers.event),
      booster: normMult(mu.booster, base.multipliers.booster),
      premium: normMult(mu.premium, base.multipliers.premium),
      seasonal: {
        enabled: bool(sea.enabled, base.multipliers.seasonal.enabled),
        value: clampFloat(sea.value, 1, REWARD_LIMITS.maxMultiplier, base.multipliers.seasonal.value),
        label: typeof sea.label === "string" ? sea.label.slice(0, REWARD_LIMITS.maxLabel) : base.multipliers.seasonal.label,
        startsAt: isoOrNull(sea.startsAt),
        endsAt: isoOrNull(sea.endsAt),
      },
    },
    antiAbuse: {
      ignoredChannelIds: toStringArray(aa.ignoredChannelIds).slice(0, REWARD_LIMITS.maxIgnored),
      ignoredRoleIds: toStringArray(aa.ignoredRoleIds).slice(0, REWARD_LIMITS.maxIgnored),
      minAccountAgeDays: clampInt(aa.minAccountAgeDays, 0, REWARD_LIMITS.maxAccountAgeDays, base.antiAbuse.minAccountAgeDays),
      globalDailyCap: clampInt(aa.globalDailyCap, 0, REWARD_LIMITS.maxDailyCap, base.antiAbuse.globalDailyCap),
    },
    notify: { dm: bool(nt.dm, base.notify.dm), channelId: typeof nt.channelId === "string" && nt.channelId ? nt.channelId : null },
  };
}

// ── Multipliers (mirror) ──────────────────────────────────────────────────────

function seasonalActive(s, now) {
  if (!s.enabled) return false;
  if (s.startsAt && now < Date.parse(s.startsAt)) return false;
  if (s.endsAt && now > Date.parse(s.endsAt)) return false;
  return true;
}

function combinedMultiplier(cfg, ctx) {
  const m = cfg.multipliers;
  const applied = [];
  if (m.reputation.enabled && m.reputation.maxBonusPct > 0 && typeof ctx.reputation === "number") {
    const factor = 1 + (Math.max(0, Math.min(100, ctx.reputation)) / 100) * (m.reputation.maxBonusPct / 100);
    if (factor > 1) applied.push({ key: "reputation", label: "Reputation", factor });
  }
  if (m.event.enabled && ctx.category === "event" && m.event.value > 1) applied.push({ key: "event", label: "Event", factor: m.event.value });
  if (m.booster.enabled && ctx.isBooster && m.booster.value > 1) applied.push({ key: "booster", label: "Server booster", factor: m.booster.value });
  if (m.premium.enabled && ctx.isPremium && m.premium.value > 1) applied.push({ key: "premium", label: "Premium", factor: m.premium.value });
  if (m.seasonal.enabled && m.seasonal.value > 1 && seasonalActive(m.seasonal, ctx.now ?? Date.now())) {
    applied.push({ key: "seasonal", label: m.seasonal.label || "Seasonal", factor: m.seasonal.value });
  }
  const raw = applied.reduce((f, x) => f * x.factor, 1);
  return { factor: Math.min(raw, REWARD_LIMITS.maxMultiplier), applied };
}

function applyMultipliers(base, cfg, ctx) {
  if (base <= 0) return 0;
  return Math.max(0, Math.round(base * combinedMultiplier(cfg, ctx).factor));
}

// ── Streaks (mirror) ──────────────────────────────────────────────────────────

function dayIndex(ms) {
  return Math.floor(ms / DAY_MS);
}
function weekIndex(ms) {
  return Math.floor(ms / (DAY_MS * 7));
}

function resolveStreakClaim(cfg, nowMs, lastIndex, prevStreak, periodFn) {
  const fn = periodFn || dayIndex;
  const idx = fn(nowMs);
  const base = cfg.amount;
  if (lastIndex !== null && lastIndex !== undefined && idx <= lastIndex) {
    return { claimable: false, streak: prevStreak, amount: 0, base, streakBonus: 0, milestoneBonus: 0, periodIndex: idx };
  }
  const consecutive = lastIndex !== null && lastIndex !== undefined && idx === lastIndex + 1;
  const streak = consecutive ? Math.max(1, prevStreak) + 1 : 1;
  const streakBonus = Math.min(cfg.streakMax, cfg.streakBonus * (streak - 1));
  const milestone = cfg.milestones.find((m) => m.streak === streak);
  const milestoneBonus = milestone ? milestone.bonus : 0;
  return { claimable: true, streak, amount: base + streakBonus + milestoneBonus, base, streakBonus, milestoneBonus, periodIndex: idx };
}

// ── Base payout resolution (mirror of baseAmountFor) ──────────────────────────

function baseAmountFor(cfg, category, key, n) {
  const count = n || 1;
  switch (category) {
    case "activity": {
      const src = cfg.activity[key];
      return src ? { enabled: src.enabled, base: src.amount } : { enabled: false, base: 0 };
    }
    case "event": {
      const src = cfg.event[key];
      return src ? { enabled: src.enabled, base: src.amount } : { enabled: false, base: 0 };
    }
    case "giveaway": {
      if (key === "multiplier") return { enabled: false, base: 0 };
      const src = cfg.giveaway[key];
      return src ? { enabled: src.enabled, base: Math.round(src.amount * cfg.giveaway.multiplier) } : { enabled: false, base: 0 };
    }
    case "onboarding": {
      const src = cfg.onboarding[key];
      return src ? { enabled: src.enabled, base: src.amount } : { enabled: false, base: 0 };
    }
    case "progression": {
      if (key === "levelUp") {
        const l = cfg.progression.levelUp;
        return { enabled: l.enabled, base: l.base + l.perLevel * Math.max(1, count) };
      }
      return { enabled: cfg.progression.milestone.enabled, base: cfg.progression.milestone.amount };
    }
    default:
      return { enabled: false, base: 0 };
  }
}

const fmt = (n) => Math.max(0, Math.round(Number(n) || 0)).toLocaleString();

// ── Module ───────────────────────────────────────────────────────────────────

const VOICE_TICK_MS = 60 * 1000;
const REP_TTL_MS = 10 * 60 * 1000;
const PREMIUM_TTL_MS = 30 * 60 * 1000;
const DEDUP_MAX = 5000; // cap in-memory dedup/cap maps so a long-running bot doesn't grow unbounded

function createEconomyRewards(client, supabase, economy) {
  const configs = new Map(); // guildId -> normalised config
  const cooldowns = new Map(); // `${guild}:${user}:${key}` -> lastMs
  const dailyCaps = new Map(); // `${guild}:${user}:${key}` -> { day, total }
  const activeDay = new Map(); // `${guild}:${user}` -> dayIndex (last active-day bonus)
  const reactionDedup = new Map(); // `${messageId}:${reactorId}` -> true
  const eventRsvps = new Map(); // eventId -> Set(userId) (for completion payout)
  const repCache = new Map(); // userId -> { score, at }
  const premiumCache = new Map(); // guildId -> { value, at }
  let voiceTimer = null;

  function trim(map) {
    if (map.size > DEDUP_MAX) {
      // Drop the oldest ~20% (insertion order) — cheap, bounded memory.
      const drop = Math.floor(map.size * 0.2);
      let i = 0;
      for (const k of map.keys()) {
        map.delete(k);
        if (++i >= drop) break;
      }
    }
  }

  async function getConfig(guildId) {
    if (configs.has(guildId)) return configs.get(guildId);
    const { data } = await supabase
      .from("economy_reward_settings")
      .select("enabled, settings")
      .eq("guild_id", guildId)
      .maybeSingle();
    const cfg = normaliseRewardSettings(data ?? null);
    configs.set(guildId, cfg);
    return cfg;
  }

  // ── Anti-abuse helpers ──────────────────────────────────────────────────────

  function onCooldown(guildId, userId, key, seconds) {
    if (seconds <= 0) return false;
    const k = `${guildId}:${userId}:${key}`;
    const last = cooldowns.get(k) ?? 0;
    const now = Date.now();
    if (now - last < seconds * 1000) return true;
    cooldowns.set(k, now);
    trim(cooldowns);
    return false;
  }

  /** Clamp `amount` so this source (and the global cap) aren't exceeded today.
   * Returns the grantable amount (0 if capped out) and records the spend. */
  function applyCap(guildId, userId, key, amount, cap, globalCap) {
    const today = dayIndex(Date.now());
    const take = (mapKey, limit) => {
      if (limit <= 0) return amount; // unlimited
      const cur = dailyCaps.get(mapKey);
      const total = cur && cur.day === today ? cur.total : 0;
      return Math.max(0, Math.min(amount, limit - total));
    };
    let grantable = amount;
    grantable = Math.min(grantable, take(`${guildId}:${userId}:${key}`, cap));
    grantable = Math.min(grantable, take(`${guildId}:${userId}:__all`, globalCap));
    if (grantable <= 0) return 0;
    // Record against both counters.
    for (const [mapKey, limit] of [[`${guildId}:${userId}:${key}`, cap], [`${guildId}:${userId}:__all`, globalCap]]) {
      if (limit <= 0) continue;
      const cur = dailyCaps.get(mapKey);
      const total = cur && cur.day === today ? cur.total : 0;
      dailyCaps.set(mapKey, { day: today, total: total + grantable });
    }
    trim(dailyCaps);
    return grantable;
  }

  function tooNew(cfg, createdTimestamp) {
    if (!cfg.antiAbuse.minAccountAgeDays || !createdTimestamp) return false;
    const ageDays = (Date.now() - createdTimestamp) / DAY_MS;
    return ageDays < cfg.antiAbuse.minAccountAgeDays;
  }

  function ignored(cfg, member, channelId) {
    if (channelId && cfg.antiAbuse.ignoredChannelIds.includes(channelId)) return true;
    if (cfg.antiAbuse.ignoredRoleIds.length > 0 && member?.roles?.cache) {
      for (const roleId of cfg.antiAbuse.ignoredRoleIds) if (member.roles.cache.has(roleId)) return true;
    }
    return false;
  }

  // ── Multiplier context lookups (cached — these ride hot paths) ──────────────

  async function reputationScore(userId, createdTimestamp) {
    const cached = repCache.get(userId);
    if (cached && Date.now() - cached.at < REP_TTL_MS) return cached.score;
    let score = null;
    try {
      const rep = await economy.getGlobalReputation(userId, createdTimestamp ?? null);
      score = rep ? rep.score : null;
    } catch {
      score = null;
    }
    repCache.set(userId, { score, at: Date.now() });
    trim(repCache);
    return score;
  }

  async function guildPremium(guild) {
    const cached = premiumCache.get(guild.id);
    if (cached && Date.now() - cached.at < PREMIUM_TTL_MS) return cached.value;
    let value = false;
    try {
      // A server counts as premium when its owner holds a paid Pulsify plan
      // (per-user subscription that gates every server they run — PULSIFY-29).
      const ownerId = guild.ownerId;
      if (ownerId) {
        const { data } = await supabase
          .from("subscriptions")
          .select("plan, status")
          .eq("user_id", ownerId)
          .maybeSingle();
        value = !!data && data.plan && data.plan !== "free" && ["active", "trialing"].includes(data.status);
      }
    } catch {
      value = false;
    }
    premiumCache.set(guild.id, { value, at: Date.now() });
    return value;
  }

  // ── Core grant ──────────────────────────────────────────────────────────────
  //
  // target: a GuildMember (preferred — carries premiumSince, roles, user) OR a
  // minimal { id, name, createdTimestamp? } for hooks that only have an id
  // (e.g. giveaway winners). opts: { n, note, cap (per-source daily cap), member
  // (for booster/ignored checks), createdTimestamp, channelId, dmCategoryLabel }.
  async function grant(guild, target, category, key, opts = {}) {
    try {
      const cfg = await getConfig(guild.id);
      if (!cfg.enabled) return 0;
      const { enabled, base } = baseAmountFor(cfg, category, key, opts.n);
      if (!enabled || base <= 0) return 0;

      const member = opts.member ?? (target && target.roles ? target : null);
      const createdTimestamp = opts.createdTimestamp ?? member?.user?.createdTimestamp ?? null;
      if (tooNew(cfg, createdTimestamp)) return 0;
      if (member && ignored(cfg, member, opts.channelId ?? null)) return 0;

      const ctx = { category, now: Date.now() };
      if (cfg.multipliers.reputation.enabled) ctx.reputation = await reputationScore(target.id, createdTimestamp);
      ctx.isBooster = !!(member && member.premiumSince);
      if (cfg.multipliers.premium.enabled) ctx.isPremium = await guildPremium(guild);

      let amount = applyMultipliers(base, cfg, ctx);
      const cap = opts.cap ?? 0;
      amount = applyCap(guild.id, target.id, key, amount, cap, cfg.antiAbuse.globalDailyCap);
      if (amount <= 0) return 0;

      const meta = sourceMeta(category, key);
      const kind = category === "activity" ? "earn" : "reward";
      const userName = target.name ?? member?.displayName ?? target.displayName ?? null;
      // Rate-limited sources fire constantly (per message, per voice tick), so
      // their ledger rows are rolled up per day rather than written per award —
      // see supabase/migrations/20260701_economy_activity_rollup.sql. Everything
      // else is a discrete event worth its own row.
      const newBalance = await economy.adjust(target.id, userName, amount, kind, meta ? meta.reason : key, {
        guildId: guild.id,
        guildName: guild.name,
        note: opts.note ?? null,
        rollup: !!meta?.rateLimited,
      });
      if (newBalance === null) return 0;

      // Optional earn DM (off by default; never for high-frequency activity).
      if (cfg.notify.dm && category !== "activity") {
        void notifyEarn(target.id, amount, meta ? meta.label : key, guild.name).catch(() => {});
      }
      return amount;
    } catch (err) {
      console.warn("[Pulse] reward grant failed:", err.message);
      return 0;
    }
  }

  async function notifyEarn(userId, amount, label, guildName) {
    try {
      const user = await client.users.fetch(userId).catch(() => null);
      if (!user) return;
      await user.send({
        flags: MessageFlags.IsComponentsV2,
        components: [
          buildNoticeContainer(
            `You earned **${fmt(amount)} Pulse Coins** — ${label}${guildName ? ` in ${guildName}` : ""}.`,
          ),
        ],
      });
    } catch {
      /* DMs closed — ignore */
    }
  }

  // ── Activity hooks ───────────────────────────────────────────────────────────

  /** First activity of the UTC day → the "active day" bonus (community
   * participation). Called from message/voice/command paths. */
  async function maybeActiveDay(guild, member, channelId) {
    const cfg = await getConfig(guild.id);
    if (!cfg.enabled || !cfg.activity.activeDay.enabled || cfg.activity.activeDay.amount <= 0) return;
    const key = `${guild.id}:${member.id}`;
    const today = dayIndex(Date.now());
    if (activeDay.get(key) === today) return;
    activeDay.set(key, today);
    trim(activeDay);
    await grant(guild, member, "activity", "activeDay", { member, channelId });
  }

  async function onMessage(message) {
    try {
      if (!message.guild || message.author?.bot || !message.member) return;
      const cfg = await getConfig(message.guild.id);
      if (!cfg.enabled) return;
      const src = cfg.activity.message;
      if (src.enabled && src.amount > 0 && !ignored(cfg, message.member, message.channelId)) {
        if (!onCooldown(message.guild.id, message.author.id, "message", src.cooldownSeconds)) {
          await grant(message.guild, message.member, "activity", "message", {
            member: message.member,
            channelId: message.channelId,
            cap: src.dailyCap,
          });
        }
      }
      await maybeActiveDay(message.guild, message.member, message.channelId);
    } catch (err) {
      console.warn("[Pulse] reward onMessage failed:", err.message);
    }
  }

  async function onCommand(interaction) {
    try {
      if (!interaction.guild) return;
      const cfg = await getConfig(interaction.guild.id);
      if (!cfg.enabled || !cfg.activity.command.enabled || cfg.activity.command.amount <= 0) return;
      const member =
        interaction.member && interaction.member.roles
          ? interaction.member
          : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return;
      if (ignored(cfg, member, interaction.channelId)) return;
      if (onCooldown(interaction.guild.id, interaction.user.id, "command", cfg.activity.command.cooldownSeconds)) return;
      await grant(interaction.guild, member, "activity", "command", { member, channelId: interaction.channelId, cap: cfg.activity.command.dailyCap });
      await maybeActiveDay(interaction.guild, member, interaction.channelId);
    } catch (err) {
      console.warn("[Pulse] reward onCommand failed:", err.message);
    }
  }

  /** A reaction was added — reward the message AUTHOR (they received it). */
  async function onReaction(reaction, user) {
    try {
      if (user?.bot) return;
      if (reaction.partial) await reaction.fetch().catch(() => {});
      const msg = reaction.message;
      if (msg?.partial) await msg.fetch().catch(() => {});
      const guild = msg?.guild;
      if (!guild || !msg.author || msg.author.bot) return;
      if (msg.author.id === user.id) return; // no self-react farming
      const cfg = await getConfig(guild.id);
      if (!cfg.enabled || !cfg.activity.reaction.enabled || cfg.activity.reaction.amount <= 0) return;
      if (cfg.antiAbuse.ignoredChannelIds.includes(msg.channelId)) return;

      // Dedup: one payout per (message, reactor) so toggling a reaction can't farm.
      const dedupKey = `${msg.id}:${user.id}`;
      if (reactionDedup.has(dedupKey)) return;
      reactionDedup.set(dedupKey, true);
      trim(reactionDedup);

      if (onCooldown(guild.id, msg.author.id, "reaction", cfg.activity.reaction.cooldownSeconds)) return;
      const member = await guild.members.fetch(msg.author.id).catch(() => null);
      await grant(guild, member ?? { id: msg.author.id, name: msg.author.username }, "activity", "reaction", {
        member,
        channelId: msg.channelId,
        cap: cfg.activity.reaction.dailyCap,
      });
    } catch (err) {
      console.warn("[Pulse] reward onReaction failed:", err.message);
    }
  }

  async function voiceTick() {
    for (const guild of client.guilds.cache.values()) {
      let cfg;
      try {
        cfg = await getConfig(guild.id);
      } catch {
        continue;
      }
      if (!cfg.enabled || !cfg.activity.voice.enabled || cfg.activity.voice.amount <= 0) continue;

      const byChannel = new Map();
      for (const vs of guild.voiceStates.cache.values()) {
        const channelId = vs.channelId;
        if (!channelId || channelId === guild.afkChannelId) continue;
        const member = vs.member;
        if (!member || member.user?.bot) continue;
        if (!byChannel.has(channelId)) byChannel.set(channelId, []);
        byChannel.get(channelId).push(member);
      }
      for (const [channelId, members] of byChannel) {
        if (cfg.antiAbuse.ignoredChannelIds.includes(channelId)) continue;
        if (members.length < 2) continue; // alone earns nothing (anti-farm)
        for (const member of members) {
          if (ignored(cfg, member, channelId)) continue;
          await grant(guild, member, "activity", "voice", { member, channelId, cap: cfg.activity.voice.dailyCap });
        }
        await Promise.all(members.map((m) => maybeActiveDay(guild, m, channelId)));
      }
    }
  }

  /** Helpful contribution — called when a member resolves/handles a ticket. */
  async function awardHelpful(guild, userId, userName) {
    if (!guild || !userId) return 0;
    const member = await guild.members.fetch(userId).catch(() => null);
    return grant(guild, member ?? { id: userId, name: userName ?? null }, "activity", "helpful", { member });
  }

  // ── Progression hooks ─────────────────────────────────────────────────────────

  async function awardLevelUp(guild, member, newLevel) {
    return grant(guild, member, "progression", "levelUp", { member, n: newLevel, note: `Reached level ${newLevel}` });
  }
  async function awardMilestone(guild, userId, userName, milestoneName) {
    const member = await guild?.members?.fetch(userId).catch(() => null);
    return grant(guild, member ?? { id: userId, name: userName ?? null }, "progression", "milestone", { member, note: milestoneName ?? null });
  }

  // ── Giveaway hooks ─────────────────────────────────────────────────────────────

  async function awardGiveawayEntry(guild, member) {
    return grant(guild, member, "giveaway", "participation", { member });
  }
  async function awardGiveawayWin(guild, winners, prize) {
    let total = 0;
    for (const w of winners ?? []) {
      total += await grant(guild, { id: w.id, name: w.name }, "giveaway", "win", { note: prize ? `Won "${prize}"` : null });
    }
    return total;
  }
  async function awardGiveawayHosting(guild, hostId, hostName, prize) {
    if (!hostId) return 0;
    const member = await guild?.members?.fetch(hostId).catch(() => null);
    return grant(guild, member ?? { id: hostId, name: hostName ?? null }, "giveaway", "hosting", { member, note: prize ? `Hosted "${prize}"` : null });
  }

  // ── Onboarding hooks ────────────────────────────────────────────────────────────

  async function awardOnboarding(guild, member, step = "completion") {
    const valid = ["completion", "profile", "verification", "roleSelection"];
    if (!valid.includes(step)) step = "completion";
    return grant(guild, member, "onboarding", step, { member });
  }

  // ── Event hooks ──────────────────────────────────────────────────────────────────

  async function onEventCreate(scheduledEvent) {
    try {
      const guild = scheduledEvent.guild ?? client.guilds.cache.get(scheduledEvent.guildId);
      const creatorId = scheduledEvent.creatorId;
      if (!guild || !creatorId) return;
      const member = await guild.members.fetch(creatorId).catch(() => null);
      await grant(guild, member ?? { id: creatorId, name: scheduledEvent.creator?.username ?? null }, "event", "hosting", {
        member,
        note: scheduledEvent.name ?? null,
      });
    } catch (err) {
      console.warn("[Pulse] reward onEventCreate failed:", err.message);
    }
  }

  async function onEventUserAdd(scheduledEvent, user) {
    try {
      if (user?.bot) return;
      const guild = scheduledEvent.guild ?? client.guilds.cache.get(scheduledEvent.guildId);
      if (!guild) return;
      // Track RSVPs so completion can pay them out when the event ends.
      let set = eventRsvps.get(scheduledEvent.id);
      if (!set) {
        set = new Set();
        eventRsvps.set(scheduledEvent.id, set);
      }
      set.add(user.id);
      const member = await guild.members.fetch(user.id).catch(() => null);
      await grant(guild, member ?? { id: user.id, name: user.username }, "event", "participation", { member, note: scheduledEvent.name ?? null });
    } catch (err) {
      console.warn("[Pulse] reward onEventUserAdd failed:", err.message);
    }
  }

  /** Event status transitions: ACTIVE → reward attendees in the channel;
   * COMPLETED → reward everyone who RSVP'd. */
  async function onEventUpdate(oldEvent, newEvent) {
    try {
      const guild = newEvent.guild ?? client.guilds.cache.get(newEvent.guildId);
      if (!guild) return;
      const ACTIVE = 2;
      const COMPLETED = 3;
      const was = oldEvent?.status;
      const now = newEvent.status;
      if (now === was) return;

      if (now === ACTIVE && newEvent.channelId) {
        // Attendance: members currently in the event's voice/stage channel.
        const channel = await client.channels.fetch(newEvent.channelId).catch(() => null);
        const members = channel?.members ? [...channel.members.values()] : [];
        for (const member of members) {
          if (member.user?.bot) continue;
          await grant(guild, member, "event", "attendance", { member, note: newEvent.name ?? null });
        }
      } else if (now === COMPLETED) {
        const set = eventRsvps.get(newEvent.id);
        if (set) {
          for (const userId of set) {
            const member = await guild.members.fetch(userId).catch(() => null);
            await grant(guild, member ?? { id: userId, name: null }, "event", "completion", { member, note: newEvent.name ?? null });
          }
          eventRsvps.delete(newEvent.id);
        }
      }
    } catch (err) {
      console.warn("[Pulse] reward onEventUpdate failed:", err.message);
    }
  }

  // ── Daily / weekly claim ─────────────────────────────────────────────────────────

  /** Resolve + atomically claim the daily/weekly reward. Returns
   * { claimed, amount, streak, balance, nextInMs, result }. */
  async function claim(guild, member, kind) {
    const cfg = await getConfig(guild.id);
    const streakCfg = kind === "weekly" ? cfg.weekly : cfg.daily;
    if (!cfg.enabled || !streakCfg.enabled) {
      return { claimed: false, disabled: true };
    }
    const periodFn = kind === "weekly" ? weekIndex : dayIndex;
    const periodMs = kind === "weekly" ? DAY_MS * 7 : DAY_MS;

    const { data: row } = await supabase
      .from("economy_streaks")
      .select("daily_last_index, daily_streak, weekly_last_index, weekly_streak")
      .eq("guild_id", guild.id)
      .eq("user_id", member.id)
      .maybeSingle();
    const lastIndex = row ? (kind === "weekly" ? row.weekly_last_index : row.daily_last_index) : null;
    const prevStreak = row ? (kind === "weekly" ? row.weekly_streak : row.daily_streak) : 0;

    const now = Date.now();
    const result = resolveStreakClaim(streakCfg, now, lastIndex === undefined ? null : lastIndex, prevStreak ?? 0, periodFn);
    if (!result.claimable) {
      const nextStart = (result.periodIndex + 1) * periodMs;
      return { claimed: false, alreadyClaimed: true, streak: prevStreak ?? 0, nextInMs: Math.max(0, nextStart - now) };
    }

    // Multipliers apply to the claim too (reputation / premium / seasonal —
    // booster needs the member object, which we have).
    const ctx = { category: "daily", now };
    if (cfg.multipliers.reputation.enabled) ctx.reputation = await reputationScore(member.id, member.user?.createdTimestamp);
    ctx.isBooster = !!member.premiumSince;
    if (cfg.multipliers.premium.enabled) ctx.isPremium = await guildPremium(guild);
    const payout = applyMultipliers(result.amount, cfg, ctx);

    const { data, error } = await supabase.rpc("economy_claim_streak", {
      p_guild_id: guild.id,
      p_user_id: member.id,
      p_user_name: member.displayName,
      p_kind: kind,
      p_period_index: result.periodIndex,
      p_new_streak: result.streak,
      p_amount: payout,
      p_guild_name: guild.name,
      p_reason: kind,
    });
    if (error) {
      console.warn("[Pulse] economy_claim_streak failed:", error.message);
      return { claimed: false, error: true };
    }
    const r = Array.isArray(data) ? data[0] : data;
    if (!r || !r.claimed) {
      const nextStart = (result.periodIndex + 1) * periodMs;
      return { claimed: false, alreadyClaimed: true, streak: prevStreak ?? 0, nextInMs: Math.max(0, nextStart - now) };
    }
    return { claimed: true, amount: payout, streak: result.streak, balance: Number(r.new_balance), result };
  }

  async function handleClaimCommand({ interaction, guild, ephemeral }, kind) {
    const colorHex = await getPulseColor(supabase, guild.id);
    const member = interaction.member && interaction.member.roles ? interaction.member : await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      await replyNotice(interaction, "Couldn't find your membership.");
      return;
    }
    const res = await claim(guild, member, kind);
    const label = kind === "weekly" ? "Weekly reward" : "Daily reward";

    if (res.disabled) {
      await replyNotice(interaction, `The ${kind} reward isn't enabled in this server.`);
      return;
    }
    if (res.error) {
      await replyNotice(interaction, "Something went wrong claiming your reward. Try again in a moment.");
      return;
    }
    if (!res.claimed) {
      const next = Math.floor((Date.now() + (res.nextInMs ?? 0)) / 1000);
      await replyNotice(interaction, `You've already claimed your ${kind} reward. Come back <t:${next}:R>.`);
      return;
    }

    // Short claim confirmation — no header badge (see the embed conventions on
    // buildPulseContainer): three lines don't carry a thumbnail.
    const body = [
      text(`You claimed your ${kind} reward!`),
      divider(),
      text(`**+${fmt(res.amount)} Pulse Coins**` + (res.result.streakBonus + res.result.milestoneBonus > 0 ? `\n-# Includes a streak bonus` : "")),
      text(`**${res.streak}-${kind === "weekly" ? "week" : "day"} streak**\n-# New balance: ${fmt(res.balance)} coins`),
    ];
    await replyContainer(
      interaction,
      buildPulseContainer({
        colorHex,
        title: label,
        subtitle: member.displayName,
        body,
        footer: "Pulse — Global economy",
      }),
      null,
      ephemeral,
    );
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────────

  async function reload() {
    const { data, error } = await supabase.from("economy_reward_settings").select("guild_id, enabled, settings");
    if (error) {
      console.warn("[Pulse] reward settings load failed:", error.message);
      return;
    }
    configs.clear();
    for (const row of data ?? []) configs.set(row.guild_id, normaliseRewardSettings(row));
    console.log(`[Pulse] Loaded reward config for ${configs.size} guild(s).`);
  }

  function subscribe() {
    supabase
      .channel("economy-reward-settings-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "economy_reward_settings" }, (payload) => {
        const guildId = payload.new?.guild_id ?? payload.old?.guild_id;
        if (!guildId) return;
        if (payload.eventType === "DELETE") {
          configs.delete(guildId);
          return;
        }
        if (payload.new) configs.set(guildId, normaliseRewardSettings(payload.new));
      })
      .subscribe();
  }

  async function start() {
    await reload();
    subscribe();
    setTimeout(() => {
      void voiceTick();
      voiceTimer = setInterval(() => void voiceTick(), VOICE_TICK_MS);
      if (voiceTimer.unref) voiceTimer.unref();
    }, 20_000);
    console.log("[Pulse] Economy rewards engine started.");
  }

  return {
    start,
    reload,
    getConfig,
    // activity
    onMessage,
    onCommand,
    onReaction,
    awardHelpful,
    // progression
    awardLevelUp,
    awardMilestone,
    // giveaways
    awardGiveawayEntry,
    awardGiveawayWin,
    awardGiveawayHosting,
    // onboarding
    awardOnboarding,
    // events
    onEventCreate,
    onEventUserAdd,
    onEventUpdate,
    // daily/weekly
    claim,
    handleClaimCommand,
  };
}

module.exports = {
  createEconomyRewards,
  // Pure helpers exported for unit tests + reuse.
  REWARD_SOURCES,
  REWARD_LIMITS,
  defaultRewardConfig,
  normaliseRewardSettings,
  combinedMultiplier,
  applyMultipliers,
  seasonalActive,
  resolveStreakClaim,
  baseAmountFor,
  dayIndex,
  weekIndex,
};
