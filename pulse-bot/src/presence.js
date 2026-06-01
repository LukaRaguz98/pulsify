// Custom Bot Status & Presence Management (bot side) — PULSIFY-30.
//
// A Discord bot has ONE global presence. The dashboard lets every server author
// its own presence config (guild_presence), and a single global pointer
// (bot_presence_state.active_guild_id) names the guild whose config currently
// DRIVES the bot. This module:
//   • loads the active guild's config + watches both tables over realtime,
//   • on a rotation tick, resolves dynamic placeholders ({servers}, {members},
//     {tickets}, {giveaways}, {mod_actions}, {uptime}) against live data and
//     calls client.user.setPresence(),
//   • honours maintenance mode (forces dnd + the maintenance text) and UTC
//     schedule windows (override the rotation while active).
//
// The status model, activity kinds, placeholder swap and config normalisation
// MIRROR pulsify-web-app/lib/presence.ts — keep the two in sync (same as
// giveaways.js ↔ lib/giveaways.ts, scheduler.js ↔ lib/automations.ts).

const { ActivityType } = require("discord.js");
const { getCurrentVersion } = require("./version");

// ── Catalog (mirror of lib/presence.ts) ─────────────────────────────────────

const ACTIVITY_TYPE_MAP = {
  playing: ActivityType.Playing, // 0
  streaming: ActivityType.Streaming, // 1
  listening: ActivityType.Listening, // 2
  watching: ActivityType.Watching, // 3
  custom: ActivityType.Custom, // 4
  competing: ActivityType.Competing, // 5
};

const VALID_STATUS = new Set(["online", "idle", "dnd", "invisible"]);

const PRESENCE_LIMITS = {
  maxActivities: 10,
  minIntervalSeconds: 15,
  maxIntervalSeconds: 3600,
  maxTextLength: 128,
  maxSchedules: 10,
};

const DEFAULT_PRESENCE = { status: "online", kind: "playing", text: "Powered by Pulsify" };
const MAINTENANCE_DEFAULT_TEXT = "🔧 Under maintenance — back soon";

function fmtNum(n) {
  return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "0";
}

/** Swap {token} placeholders for live values. Mirror of lib/presence.ts. */
function resolvePlaceholders(text, vars) {
  if (!text) return "";
  return text.replace(/\{(servers|members|tickets|giveaways|mod_actions|uptime)\}/g, (_m, key) => {
    const v = vars ? vars[key] : undefined;
    if (v == null) return "";
    return typeof v === "number" ? fmtNum(v) : String(v);
  });
}

function normaliseStatus(v) {
  return VALID_STATUS.has(v) ? v : "online";
}

function normaliseKind(v) {
  return Object.prototype.hasOwnProperty.call(ACTIVITY_TYPE_MAP, v) ? v : "playing";
}

function clampInterval(n) {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 30;
  return Math.max(PRESENCE_LIMITS.minIntervalSeconds, Math.min(PRESENCE_LIMITS.maxIntervalSeconds, Math.round(v)));
}

function normaliseActivity(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = typeof raw.text === "string" ? raw.text.slice(0, PRESENCE_LIMITS.maxTextLength) : "";
  const kind = normaliseKind(raw.kind);
  if (!text && kind !== "custom") return null;
  const activity = { kind, text };
  if (typeof raw.emoji === "string" && raw.emoji.trim()) activity.emoji = raw.emoji.trim().slice(0, 64);
  if (typeof raw.stream_url === "string" && raw.stream_url.trim()) activity.stream_url = raw.stream_url.trim();
  return activity;
}

function normaliseTime(v) {
  if (typeof v !== "string") return "00:00";
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return "00:00";
  const h = Math.max(0, Math.min(23, Number(m[1])));
  const mi = Math.max(0, Math.min(59, Number(m[2])));
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

function normaliseSchedule(raw) {
  if (!raw || typeof raw !== "object") return null;
  const activity = normaliseActivity(raw.activity);
  if (!activity) return null;
  const days = Array.isArray(raw.days)
    ? [...new Set(raw.days.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6))]
    : [];
  return { days, start: normaliseTime(raw.start), end: normaliseTime(raw.end), activity };
}

/** Build a typed config from a raw DB row. Mirror of lib/presence.ts. */
function normalisePresenceConfig(row, guildId) {
  const activities = Array.isArray(row && row.activities)
    ? row.activities.map(normaliseActivity).filter(Boolean)
    : [];
  const schedules = Array.isArray(row && row.schedules)
    ? row.schedules.map(normaliseSchedule).filter(Boolean)
    : [];
  return {
    guildId,
    enabled: (row && row.enabled) === true,
    status: normaliseStatus(row && row.status),
    activities: activities.slice(0, PRESENCE_LIMITS.maxActivities),
    rotationEnabled: (row && row.rotation_enabled) !== false,
    rotationIntervalSeconds: clampInterval((row && row.rotation_interval_seconds) ?? 30),
    schedules: schedules.slice(0, PRESENCE_LIMITS.maxSchedules),
    maintenanceMode: (row && row.maintenance_mode) === true,
    maintenanceText: typeof (row && row.maintenance_text) === "string" ? row.maintenance_text : "",
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** "3d 4h" / "5h 12m" / "8m" — compact uptime from milliseconds. */
function formatUptime(ms) {
  if (!ms || ms < 0) return "0m";
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Is `now` (UTC) inside the schedule window? Windows may wrap past midnight. */
function scheduleMatches(schedule, now) {
  const day = now.getUTCDay();
  if (schedule.days.length > 0 && !schedule.days.includes(day)) return false;
  const cur = now.getUTCHours() * 60 + now.getUTCMinutes();
  const [sh, sm] = schedule.start.split(":").map(Number);
  const [eh, em] = schedule.end.split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (start === end) return false;
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

// ── Module ──────────────────────────────────────────────────────────────────

function createPresence(client, supabase) {
  // The live config driving the bot (null = default presence) + which guild
  // authored it.
  let activeGuildId = null;
  let config = null;
  let rotationIndex = 0;
  let tickTimer = null;
  let currentIntervalMs = 30000;

  // ── Dynamic placeholder resolution ─────────────────────────────────────────
  async function resolveVars(guildId) {
    const vars = {
      servers: client.guilds.cache.size,
      uptime: formatUptime(client.uptime),
      members: 0,
      tickets: 0,
      giveaways: 0,
      mod_actions: 0,
    };
    const guild = guildId ? client.guilds.cache.get(guildId) : null;
    if (guild) vars.members = guild.memberCount ?? 0;
    if (!guildId) return vars;

    // Open tickets for the active guild (allow-all RLS, readable by anon).
    try {
      const { count } = await supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("guild_id", guildId)
        .neq("status", "closed");
      vars.tickets = count ?? 0;
    } catch {
      /* table may not exist in older DBs — leave 0 */
    }
    // Active giveaways for the active guild.
    try {
      const { count } = await supabase
        .from("giveaways")
        .select("id", { count: "exact", head: true })
        .eq("guild_id", guildId)
        .eq("status", "active");
      vars.giveaways = count ?? 0;
    } catch {
      /* leave 0 */
    }
    // Moderation actions in the last 24h. moderation_logs is service-role RLS —
    // the bot's anon role may read 0 here; that's a graceful, non-breaking
    // fallback (documented in the migration / plan).
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("moderation_logs")
        .select("id", { count: "exact", head: true })
        .eq("guild_id", guildId)
        .gte("created_at", since);
      vars.mod_actions = count ?? 0;
    } catch {
      /* leave 0 */
    }
    return vars;
  }

  // ── Pick the activity to show right now ─────────────────────────────────────
  // Precedence: maintenance → schedule window → rotation. Returns
  // { status, activity } or null to fall back to the default presence.
  function selectActivity() {
    if (!config) return null;

    if (config.maintenanceMode) {
      return {
        status: "dnd",
        activity: { kind: "custom", text: config.maintenanceText || MAINTENANCE_DEFAULT_TEXT },
      };
    }

    const now = new Date();
    const scheduled = config.schedules.find((s) => scheduleMatches(s, now));
    if (scheduled) return { status: config.status, activity: scheduled.activity };

    if (config.activities.length === 0) return null;
    if (!config.rotationEnabled) {
      return { status: config.status, activity: config.activities[0] };
    }
    const idx = rotationIndex % config.activities.length;
    return { status: config.status, activity: config.activities[idx] };
  }

  /** Build the discord.js activity object from our activity + resolved vars. */
  function buildActivity(activity, vars) {
    const type = ACTIVITY_TYPE_MAP[activity.kind] ?? ActivityType.Playing;
    const resolved = resolvePlaceholders(activity.text, vars);
    const emoji = activity.emoji ? `${activity.emoji} ` : "";

    if (activity.kind === "custom") {
      // Custom status: the text lives in `state`; `name` is ignored by clients
      // but must be present.
      return { name: "Custom Status", type, state: `${emoji}${resolved}`.trim() || "…" };
    }
    const obj = { name: `${emoji}${resolved}`.trim() || "…", type };
    if (activity.kind === "streaming") {
      obj.url = activity.stream_url || "https://twitch.tv/pulsify";
    }
    return obj;
  }

  async function applyPresence() {
    try {
      if (!client.user) return;
      const pick = selectActivity();
      if (!pick) {
        // Default presence — shows the live Pulse version (newest
        // resources/notes/vX.Y.Z.txt) so the bot's status reflects what it runs.
        const version = await getCurrentVersion();
        client.user.setPresence({
          status: DEFAULT_PRESENCE.status,
          activities: [{ name: `${DEFAULT_PRESENCE.text} [${version}]`, type: ActivityType.Playing }],
        });
        return;
      }
      const vars = await resolveVars(activeGuildId);
      client.user.setPresence({
        status: normaliseStatus(pick.status),
        activities: [buildActivity(pick.activity, vars)],
      });
    } catch (err) {
      console.warn("[Pulse] Failed to apply presence:", err.message);
    }
  }

  // ── Rotation timer ──────────────────────────────────────────────────────────
  function desiredIntervalMs() {
    if (!config || config.maintenanceMode || !config.rotationEnabled) return 60000;
    return clampInterval(config.rotationIntervalSeconds) * 1000;
  }

  function armTimer() {
    const want = desiredIntervalMs();
    if (tickTimer && want === currentIntervalMs) return;
    if (tickTimer) clearInterval(tickTimer);
    currentIntervalMs = want;
    tickTimer = setInterval(() => {
      rotationIndex += 1;
      void applyPresence();
    }, currentIntervalMs);
    if (tickTimer.unref) tickTimer.unref();
  }

  // ── Load + realtime ─────────────────────────────────────────────────────────
  async function reload() {
    try {
      const { data: state } = await supabase
        .from("bot_presence_state")
        .select("active_guild_id")
        .eq("id", 1)
        .maybeSingle();
      activeGuildId = state?.active_guild_id ?? null;

      if (!activeGuildId) {
        config = null;
      } else {
        const { data: row } = await supabase
          .from("guild_presence")
          .select("*")
          .eq("guild_id", activeGuildId)
          .maybeSingle();
        const next = normalisePresenceConfig(row, activeGuildId);
        // A disabled config doesn't drive the bot — revert to default.
        config = next.enabled ? next : null;
      }
      rotationIndex = 0;
      console.log(
        config
          ? `[Pulse] Presence driven by guild ${activeGuildId} (${config.activities.length} activit${config.activities.length === 1 ? "y" : "ies"}${config.maintenanceMode ? ", maintenance" : ""}).`
          : "[Pulse] Presence using default (no active guild).",
      );
    } catch (err) {
      console.warn("[Pulse] Presence reload failed:", err.message);
    }
  }

  function subscribe() {
    supabase
      .channel("presence-state-watch")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bot_presence_state" },
        () => {
          void (async () => {
            await reload();
            armTimer();
            await applyPresence();
          })();
        },
      )
      .subscribe();

    supabase
      .channel("guild-presence-watch")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guild_presence" },
        (payload) => {
          const row = payload.new ?? payload.old;
          // Only react to the guild currently driving the presence.
          if (!row || row.guild_id !== activeGuildId) return;
          void (async () => {
            await reload();
            armTimer();
            await applyPresence();
          })();
        },
      )
      .subscribe();
  }

  async function start() {
    await reload();
    subscribe();
    // Settle like the giveaway system before the first paint, then keep the
    // rotation timer running.
    setTimeout(() => {
      void applyPresence();
      armTimer();
    }, 5000);
    console.log("[Pulse] Presence system started.");
  }

  return { start, reload, applyPresence };
}

module.exports = {
  createPresence,
  // Exported for the mirrored-logic test suite.
  resolvePlaceholders,
  normalisePresenceConfig,
  formatUptime,
  scheduleMatches,
};
