// DDoS Protection & Security Monitoring (bot side) — PULSIFY-52.
//
// The bot owns runtime. It samples activity (commands, component interactions,
// messages, member joins, ticket/giveaway/application actions), runs the
// detection engine against each guild's configured rules, records detected
// `security_events`, applies the configured automatic `security_mitigations`,
// raises dashboard + Discord alerts, ENFORCES the active mitigations (lockdown /
// blocked users / paused modules) and expires temporary mitigations (recovery).
//
// The detection engine, rule shape, mitigation catalogue and severity model
// MIRROR pulsify-web-app/lib/security.ts — keep the two in sync (same as
// polls.js ↔ lib/polls.ts). The dashboard configures the rules + monitors; this
// module is the writer of events/mitigations and the enforcer.

const { Events, MessageFlags } = require("discord.js");
const { recordNotification } = require("./notifications");
const { getGuildAccent } = require("./guild-accent");

const TICK_MS = 30 * 1000; // recovery + window-prune sweep
// Per (guild,pattern[,actor]) cooldown between raising duplicate events, so one
// sustained flood produces a steady trickle of events, not thousands.
const DETECT_COOLDOWN_MS = 60 * 1000;

// ── Catalogue (mirror of lib/security.ts) ─────────────────────────────────────

const SEVERITY_ORDER = ["low", "medium", "high", "critical"];
// Severity has no colour of its own: security alerts wear the guild's accent
// like every other Pulse embed, and the level is stated in the alert's text.
const SEVERITY_LABEL = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };

function normSeverity(v) {
  return SEVERITY_ORDER.includes(v) ? v : "medium";
}
function escalateSeverity(base, steps) {
  const idx = Math.min(SEVERITY_ORDER.length - 1, Math.max(0, SEVERITY_ORDER.indexOf(normSeverity(base)) + steps));
  return SEVERITY_ORDER[idx];
}

const PATTERN_META = {
  request_spike:      { label: "Request spike",                 scope: "global", module: "commands" },
  command_abuse:      { label: "Excessive command usage",       scope: "user",   module: "commands" },
  failed_actions:     { label: "Repeated failed actions",       scope: "user",   module: "commands" },
  ticket_spam:        { label: "Mass ticket creation",          scope: "global", module: "tickets" },
  giveaway_spam:      { label: "Mass giveaway joins",           scope: "user",   module: "giveaways" },
  application_spam:   { label: "Mass application submissions",   scope: "user",   module: "applications" },
  api_abuse:          { label: "Repeated API abuse",            scope: "user",   module: "api" },
  member_join_burst:  { label: "Member join burst",             scope: "global", module: "members" },
  automated_spam:     { label: "Automated spam behaviour",      scope: "user",   module: "messages" },
};
const ALL_PATTERNS = Object.keys(PATTERN_META);
const MODULE_LABELS = {
  commands: "Commands", tickets: "Tickets", giveaways: "Giveaways", applications: "Applications",
  automations: "Automations", messages: "Messages", members: "Members", api: "API",
};

// Per-mitigation targeting (mirror of lib/security.ts MITIGATION_META.targets).
const MITIGATION_TARGET = {
  notify: "server", increase_cooldown: "module", restrict_commands: "user",
  pause_module: "module", block_user: "user", pause_submissions: "server", lockdown: "server",
};
const MITIGATION_LABEL = {
  notify: "Notify administrators", increase_cooldown: "Increase cooldowns",
  restrict_commands: "Restrict command usage", pause_module: "Disable vulnerable feature",
  block_user: "Block abusive member", pause_submissions: "Pause ticket / application submissions",
  lockdown: "Enable server lockdown",
};

function defaultRule(pattern) {
  switch (pattern) {
    case "request_spike":     return { enabled: true, threshold: 120, window_seconds: 30, severity: "high",   actions: ["notify", "increase_cooldown"], mitigation_seconds: 600 };
    case "command_abuse":     return { enabled: true, threshold: 25,  window_seconds: 30, severity: "medium", actions: ["notify", "restrict_commands"], mitigation_seconds: 300 };
    case "failed_actions":    return { enabled: true, threshold: 15,  window_seconds: 60, severity: "medium", actions: ["notify", "block_user"], mitigation_seconds: 600 };
    case "ticket_spam":       return { enabled: true, threshold: 10,  window_seconds: 60, severity: "high",   actions: ["notify", "pause_submissions"], mitigation_seconds: 600 };
    case "giveaway_spam":     return { enabled: true, threshold: 20,  window_seconds: 60, severity: "medium", actions: ["notify", "restrict_commands"], mitigation_seconds: 300 };
    case "application_spam":  return { enabled: true, threshold: 8,   window_seconds: 120, severity: "medium", actions: ["notify", "pause_submissions"], mitigation_seconds: 600 };
    case "api_abuse":         return { enabled: true, threshold: 60,  window_seconds: 30, severity: "high",   actions: ["notify", "block_user"], mitigation_seconds: 600 };
    case "member_join_burst": return { enabled: true, threshold: 15,  window_seconds: 60, severity: "high",   actions: ["notify"], mitigation_seconds: 0 };
    case "automated_spam":    return { enabled: true, threshold: 30,  window_seconds: 30, severity: "medium", actions: ["notify", "block_user"], mitigation_seconds: 300 };
    default:                  return { enabled: false, threshold: 50, window_seconds: 60, severity: "medium", actions: ["notify"], mitigation_seconds: 300 };
  }
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function normRule(pattern, raw) {
  const base = defaultRule(pattern);
  const r = raw && typeof raw === "object" ? raw : {};
  const actions = Array.isArray(r.actions) ? r.actions.filter((a) => MITIGATION_TARGET[a]) : base.actions;
  return {
    enabled: r.enabled === undefined ? base.enabled : Boolean(r.enabled),
    threshold: num(r.threshold, base.threshold),
    window_seconds: num(r.window_seconds, base.window_seconds),
    severity: normSeverity(r.severity),
    actions,
    mitigation_seconds: num(r.mitigation_seconds, base.mitigation_seconds),
  };
}

function normLockdown(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: Boolean(r.enabled),
    event_threshold: num(r.event_threshold, 5),
    window_seconds: num(r.window_seconds, 120),
    min_severity: normSeverity(r.min_severity),
  };
}

function normConfig(row) {
  if (!row) return null;
  const rules = {};
  const rawRules = row.rules && typeof row.rules === "object" ? row.rules : {};
  for (const p of ALL_PATTERNS) rules[p] = normRule(p, rawRules[p]);
  return {
    guild_id: row.guild_id,
    enabled: Boolean(row.enabled),
    alert_channel_id: row.alert_channel_id || null,
    rules,
    auto_lockdown: normLockdown(row.auto_lockdown),
    lockdown_active: Boolean(row.lockdown_active),
  };
}

// Pure detection — MIRROR of lib/security.ts evaluatePattern.
function evaluatePattern(pattern, rule, samples, now) {
  const meta = PATTERN_META[pattern];
  const cutoff = now - rule.window_seconds * 1000;
  let count = 0;
  let actorId = null;
  if (meta.scope === "global") {
    for (const s of samples) if (s.ts >= cutoff) count++;
  } else {
    const byUser = new Map();
    for (const s of samples) {
      if (s.ts < cutoff || !s.userId) continue;
      byUser.set(s.userId, (byUser.get(s.userId) || 0) + 1);
    }
    for (const [uid, c] of byUser) if (c > count) { count = c; actorId = uid; }
  }
  const triggered = rule.enabled && count >= rule.threshold;
  const over = rule.threshold > 0 ? Math.floor(count / rule.threshold) - 1 : 0;
  const severity = triggered ? escalateSeverity(rule.severity, Math.max(0, over)) : rule.severity;
  return { triggered, count, threshold: rule.threshold, window_seconds: rule.window_seconds, severity, actorId };
}

// ── Module ────────────────────────────────────────────────────────────────────

function createSecurity(client, supabase) {
  const configs = new Map(); // guildId -> normalised config
  // samples: key `${guildId}:${pattern}` -> [{ ts, userId }]
  const samples = new Map();
  // last time we raised an event for a key (`${guildId}:${pattern}:${actor||'-'}`)
  const lastDetect = new Map();
  // active mitigations per guild for fast enforcement reads
  // guildId -> { lockdown: bool, blockedUsers: Set, pausedModules: Set, submissionsPaused: bool }
  const enforce = new Map();
  let tickTimer = null;

  function getEnforce(guildId) {
    let e = enforce.get(guildId);
    if (!e) { e = { lockdown: false, blockedUsers: new Set(), pausedModules: new Set(), submissionsPaused: false }; enforce.set(guildId, e); }
    return e;
  }

  // ── Sampling ────────────────────────────────────────────────────────────────

  function pushSample(guildId, pattern, userId) {
    const key = `${guildId}:${pattern}`;
    let arr = samples.get(key);
    if (!arr) { arr = []; samples.set(key, arr); }
    arr.push({ ts: Date.now(), userId: userId || null });
    // Hard cap so a flood can't grow memory unbounded.
    if (arr.length > 5000) arr.splice(0, arr.length - 5000);
  }

  // Feed one or more patterns from a single activity, then evaluate them.
  function track(guildId, patterns, userId) {
    if (!guildId) return;
    const cfg = configs.get(guildId);
    if (!cfg || !cfg.enabled) return;
    const list = Array.isArray(patterns) ? patterns : [patterns];
    for (const pattern of list) {
      if (!PATTERN_META[pattern]) continue;
      pushSample(guildId, pattern, userId);
      void evaluate(guildId, pattern);
    }
  }

  // Public convenience taps (called from index.js gateway handlers).
  function onCommand(guildId, userId) { track(guildId, ["request_spike", "command_abuse"], userId); }
  function onMessage(guildId, userId) { track(guildId, "automated_spam", userId); }
  function onMemberJoin(guildId, userId) { track(guildId, "member_join_burst", userId); }
  function onFailedAction(guildId, userId) { track(guildId, "failed_actions", userId); }

  // ── Detection → events + mitigations ──────────────────────────────────────────

  async function evaluate(guildId, pattern) {
    try {
      const cfg = configs.get(guildId);
      if (!cfg || !cfg.enabled) return;
      const rule = cfg.rules[pattern];
      if (!rule || !rule.enabled) return;
      const arr = samples.get(`${guildId}:${pattern}`) || [];
      const result = evaluatePattern(pattern, rule, arr, Date.now());
      if (!result.triggered) return;

      const cdKey = `${guildId}:${pattern}:${result.actorId || "-"}`;
      const last = lastDetect.get(cdKey) || 0;
      if (Date.now() - last < DETECT_COOLDOWN_MS) return;
      lastDetect.set(cdKey, Date.now());

      await raiseDetection(cfg, pattern, rule, result);
    } catch (err) {
      console.error("[Pulse] security evaluate failed:", err.message);
    }
  }

  async function raiseDetection(cfg, pattern, rule, result) {
    const meta = PATTERN_META[pattern];
    const guildId = cfg.guild_id;

    // Resolve an actor display name for per-user patterns (best-effort).
    let actorName = null;
    if (result.actorId) {
      const guild = client.guilds.cache.get(guildId);
      const member = guild ? await guild.members.fetch(result.actorId).catch(() => null) : null;
      actorName = member?.displayName ?? null;
    }

    // Record the event.
    const { data: ev } = await supabase
      .from("security_events")
      .insert({
        guild_id: guildId,
        pattern,
        module: meta.module,
        severity: result.severity,
        status: "open",
        actor_id: result.actorId,
        actor_name: actorName,
        count: result.count,
        threshold: result.threshold,
        window_seconds: result.window_seconds,
        source: "auto",
        details: {},
      })
      .select("id")
      .single()
      .then((r) => r, () => ({ data: null }));

    const eventId = ev?.id ?? null;

    // Apply the rule's automatic mitigations.
    const applied = [];
    for (const action of rule.actions) {
      if (action === "notify") continue; // notification is implicit below
      const ok = await applyMitigation(cfg, {
        action,
        module: MITIGATION_TARGET[action] === "module" ? meta.module : null,
        targetUserId: MITIGATION_TARGET[action] === "user" ? result.actorId : null,
        targetUserName: MITIGATION_TARGET[action] === "user" ? actorName : null,
        reason: `${meta.label}: ${result.count} in ${result.window_seconds}s (limit ${result.threshold}).`,
        source: "rule",
        pattern,
        eventId,
        durationSeconds: rule.mitigation_seconds,
      });
      if (ok) applied.push(MITIGATION_LABEL[action]);
    }

    if (applied.length > 0 && eventId) {
      await supabase.from("security_events").update({ status: "mitigated" }).eq("id", eventId);
    }

    // Dashboard notification.
    const who = meta.scope === "user" ? (actorName ? `${actorName} ` : result.actorId ? `<@${result.actorId}> ` : "") : "";
    await recordNotification(supabase, {
      guildId,
      type: "security_alert",
      severity: result.severity === "critical" || result.severity === "high" ? "error" : "warning",
      title: `Security alert: ${meta.label}`,
      body: `${who}${result.count} in ${result.window_seconds}s (limit ${result.threshold}).${applied.length ? ` Applied: ${applied.join(", ")}.` : ""}`,
      link: `/dashboard/${guildId}/security`,
      actorId: result.actorId,
      actorName,
      metadata: { pattern, severity: result.severity },
    });

    // Discord alert.
    await sendAlert(cfg, {
      severity: result.severity,
      title: `Security alert — ${meta.label}`,
      lines: [
        `**Severity:** ${SEVERITY_LABEL[result.severity]}`,
        `**Detected:** ${who}${result.count} in ${result.window_seconds}s (limit ${result.threshold})`,
        `**Module:** ${MODULE_LABELS[meta.module]}`,
        applied.length
          ? `**Mitigations:** ${applied.map((a) => `\`${a}\``).join(" ")}`
          : "**Mitigations:** none configured",
      ],
    });

    console.log(`[Pulse] Security: ${meta.label} in ${guildId} (${result.count}/${result.threshold}, ${result.severity}).`);

    // Auto-lockdown check.
    await maybeAutoLockdown(cfg, result.severity);
  }

  async function applyMitigation(cfg, m) {
    try {
      // lockdown is handled by maybeAutoLockdown / dashboard, not as a per-rule action here.
      if (m.action === "lockdown") return false;
      const expiresAt = m.durationSeconds > 0 ? new Date(Date.now() + m.durationSeconds * 1000).toISOString() : null;
      await supabase.from("security_mitigations").insert({
        guild_id: cfg.guild_id,
        action: m.action,
        module: m.module,
        target_user_id: m.targetUserId,
        target_user_name: m.targetUserName,
        reason: m.reason,
        source: m.source,
        pattern: m.pattern,
        event_id: m.eventId,
        active: true,
        started_at: new Date().toISOString(),
        expires_at: expiresAt,
      });
      applyToEnforce(cfg.guild_id, m.action, m.module, m.targetUserId, true);
      return true;
    } catch (err) {
      console.error("[Pulse] security applyMitigation failed:", err.message);
      return false;
    }
  }

  function applyToEnforce(guildId, action, module, userId, on) {
    const e = getEnforce(guildId);
    if (action === "pause_submissions") e.submissionsPaused = on;
    else if (action === "pause_module" && module) { if (on) e.pausedModules.add(module); else e.pausedModules.delete(module); }
    else if ((action === "block_user" || action === "restrict_commands") && userId) { if (on) e.blockedUsers.add(userId); else e.blockedUsers.delete(userId); }
  }

  async function maybeAutoLockdown(cfg, severity) {
    const ld = cfg.auto_lockdown;
    if (!ld.enabled || cfg.lockdown_active) return;
    // Count recent events at/above min severity across the window.
    const cutoff = new Date(Date.now() - ld.window_seconds * 1000).toISOString();
    const { data } = await supabase
      .from("security_events")
      .select("severity")
      .eq("guild_id", cfg.guild_id)
      .gte("created_at", cutoff)
      .limit(1000);
    const minRank = SEVERITY_ORDER.indexOf(ld.min_severity);
    const qualifying = (data || []).filter((e) => SEVERITY_ORDER.indexOf(normSeverity(e.severity)) >= minRank).length;
    if (qualifying < ld.event_threshold) return;

    await enableLockdown(cfg, `Auto-lockdown: ${qualifying} ${ld.min_severity}+ events in ${ld.window_seconds}s.`);
  }

  async function enableLockdown(cfg, reason) {
    const nowIso = new Date().toISOString();
    await supabase.from("security_configs").update({ lockdown_active: true, lockdown_reason: reason, lockdown_since: nowIso, updated_at: nowIso }).eq("guild_id", cfg.guild_id);
    await supabase.from("security_mitigations").insert({ guild_id: cfg.guild_id, action: "lockdown", source: "lockdown", reason, active: true, started_at: nowIso });
    cfg.lockdown_active = true;
    getEnforce(cfg.guild_id).lockdown = true;
    await recordNotification(supabase, {
      guildId: cfg.guild_id, type: "security_mitigation", severity: "error",
      title: "Server lockdown enabled", body: reason, link: `/dashboard/${cfg.guild_id}/security`,
    });
    await sendAlert(cfg, { severity: "critical", title: "Server lockdown ENABLED", lines: [reason, "All Pulse-driven actions are blocked until an admin lifts the lockdown."] });
    console.log(`[Pulse] Security: lockdown enabled in ${cfg.guild_id} — ${reason}`);
  }

  // ── Alerts ────────────────────────────────────────────────────────────────────

  async function sendAlert(cfg, { severity, title, lines }) {
    if (!cfg.alert_channel_id) return;
    try {
      const channel = await client.channels.fetch(cfg.alert_channel_id).catch(() => null);
      if (!channel?.isTextBased?.()) return;
      await channel.send({
        flags: MessageFlags.IsComponentsV2,
        components: [
          {
            type: 17,
            // The guild's accent, like every other Pulse embed — the severity is
            // spelled out in the title and the footer ("… — Critical"), so it
            // doesn't need a colour to carry it.
            accent_color: await getGuildAccent(supabase, cfg.guild_id),
            components: [
              { type: 10, content: "**Pulse — Security**" },
              { type: 10, content: `# ${title}` },
              { type: 14, divider: true, spacing: 1 },
              ...lines.filter(Boolean).map((l) => ({ type: 10, content: l })),
              { type: 10, content: `-# Pulse — DDoS Protection — ${SEVERITY_LABEL[normSeverity(severity)]}` },
            ],
          },
        ],
      }).catch(() => {});
    } catch {
      /* best-effort */
    }
  }

  // ── Enforcement (read by index.js before running actions) ─────────────────────

  function isLockdown(guildId) { return getEnforce(guildId).lockdown; }
  function isUserBlocked(guildId, userId) { return getEnforce(guildId).blockedUsers.has(userId); }
  function isModulePaused(guildId, module) { return getEnforce(guildId).pausedModules.has(module); }
  function submissionsPaused(guildId) { return getEnforce(guildId).submissionsPaused; }

  /**
   * Single gate for a command/interaction. Returns { allowed, reason }. Also
   * feeds the failed_actions detector when it blocks, so probing shows up.
   */
  function checkAllowed(guildId, userId, module) {
    const e = getEnforce(guildId);
    if (e.lockdown) { onFailedAction(guildId, userId); return { allowed: false, reason: "This server is in security lockdown — actions are temporarily blocked." }; }
    if (e.blockedUsers.has(userId)) { onFailedAction(guildId, userId); return { allowed: false, reason: "Your actions are temporarily restricted by server security." }; }
    if (module && e.pausedModules.has(module)) { return { allowed: false, reason: `${MODULE_LABELS[module] || "This feature"} is temporarily paused by server security.` }; }
    return { allowed: true };
  }

  // ── Interaction classifier (own listener) ─────────────────────────────────────

  function onInteraction(interaction) {
    try {
      const guildId = interaction.guildId;
      if (!guildId) return;
      const cfg = configs.get(guildId);
      if (!cfg || !cfg.enabled) return;
      const userId = interaction.user?.id;
      const id = interaction.customId || "";

      // Chat-input commands are tracked from index.js (onCommand). Here we tap
      // component + modal interactions, classifying by custom_id prefix.
      if (interaction.isChatInputCommand?.()) return;
      if (!id) return;

      const tracks = ["request_spike", "api_abuse"]; // every interaction is a request
      if (id.startsWith("tkt:open") || id.startsWith("tkt:form:")) tracks.push("ticket_spam");
      else if (id.startsWith("gw:join:")) tracks.push("giveaway_spam");
      else if (id.startsWith("apl:form:") || id.startsWith("apl:open")) tracks.push("application_spam");

      track(guildId, tracks, userId);
    } catch {
      /* never break the gateway */
    }
  }

  // ── Persistence / cache ────────────────────────────────────────────────────────

  async function reload() {
    const { data, error } = await supabase.from("security_configs").select("*");
    if (error) { console.warn("[Pulse] security configs load failed:", error.message); return; }
    configs.clear();
    for (const row of data || []) {
      const cfg = normConfig(row);
      if (cfg) configs.set(cfg.guild_id, cfg);
    }
    await reloadMitigations();
    console.log(`[Pulse] Loaded security config for ${configs.size} guild(s).`);
  }

  async function reloadMitigations() {
    enforce.clear();
    const { data } = await supabase.from("security_mitigations").select("*").eq("active", true);
    for (const m of data || []) {
      const e = getEnforce(m.guild_id);
      if (m.action === "lockdown") e.lockdown = true;
      else applyToEnforce(m.guild_id, m.action, m.module, m.target_user_id, true);
    }
    // Reconcile lockdown flag from configs too.
    for (const cfg of configs.values()) if (cfg.lockdown_active) getEnforce(cfg.guild_id).lockdown = true;
  }

  function subscribe() {
    supabase
      .channel("security-configs-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "security_configs" }, (payload) => {
        if (payload.eventType === "DELETE") { if (payload.old?.guild_id) { configs.delete(payload.old.guild_id); enforce.delete(payload.old.guild_id); } return; }
        const cfg = normConfig(payload.new);
        if (cfg) {
          configs.set(cfg.guild_id, cfg);
          getEnforce(cfg.guild_id).lockdown = cfg.lockdown_active;
        }
      })
      .subscribe();
    supabase
      .channel("security-mitigations-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "security_mitigations" }, (payload) => {
        const row = payload.new || payload.old;
        if (!row?.guild_id) return;
        // A manual lockdown insert or any change: re-derive enforcement from DB
        // (cheap + always correct, avoids tracking individual rows in memory).
        void reloadMitigations();
        if (row.action === "lockdown") {
          const cfg = configs.get(row.guild_id);
          if (cfg) cfg.lockdown_active = payload.eventType !== "DELETE" && row.active;
        }
      })
      .subscribe();
  }

  // ── Recovery sweep ──────────────────────────────────────────────────────────────

  async function tick() {
    try {
      // Expire temporary mitigations whose time is up (recovery).
      const nowIso = new Date().toISOString();
      const { data: expired } = await supabase
        .from("security_mitigations")
        .select("id, guild_id, action, module, target_user_id, target_user_name")
        .eq("active", true)
        .not("expires_at", "is", null)
        .lte("expires_at", nowIso)
        .limit(200);
      for (const m of expired || []) {
        await supabase.from("security_mitigations").update({ active: false, ended_at: nowIso, ended_by: "auto" }).eq("id", m.id);
        applyToEnforce(m.guild_id, m.action, m.module, m.target_user_id, false);
        const cfg = configs.get(m.guild_id);
        await recordNotification(supabase, {
          guildId: m.guild_id, type: "security_recovered", severity: "success",
          title: `Mitigation lifted: ${MITIGATION_LABEL[m.action] || m.action}`,
          body: "The temporary protection has expired and normal operation has resumed.",
          link: `/dashboard/${m.guild_id}/security`,
        });
        if (cfg) await sendAlert(cfg, { severity: "low", title: `Mitigation lifted — ${MITIGATION_LABEL[m.action] || m.action}`, lines: ["The temporary protection expired and normal operation has resumed."] });
      }

      // Prune old samples to keep memory bounded (drop anything older than 1h).
      const cutoff = Date.now() - 3_600_000;
      for (const [key, arr] of samples) {
        const kept = arr.filter((s) => s.ts >= cutoff);
        if (kept.length) samples.set(key, kept); else samples.delete(key);
      }
      // Prune stale detect cooldowns.
      for (const [key, ts] of lastDetect) if (Date.now() - ts > 3_600_000) lastDetect.delete(key);
    } catch (err) {
      console.error("[Pulse] security tick failed:", err.message);
    }
  }

  async function start() {
    await reload();
    subscribe();
    client.on(Events.InteractionCreate, onInteraction);
    setTimeout(() => {
      void tick();
      tickTimer = setInterval(() => void tick(), TICK_MS);
      if (tickTimer.unref) tickTimer.unref();
    }, 15_000);
    console.log("[Pulse] DDoS Protection system started.");
  }

  return {
    start,
    reload,
    track,
    onCommand,
    onMessage,
    onMemberJoin,
    onFailedAction,
    checkAllowed,
    isLockdown,
    isUserBlocked,
    isModulePaused,
    submissionsPaused,
  };
}

module.exports = { createSecurity };
