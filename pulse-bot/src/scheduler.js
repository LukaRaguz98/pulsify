// Scheduled Automations engine (bot side).
//
// Reads workflow definitions from `scheduled_automations`, fires the ones whose
// next_run_at has arrived (a once-a-minute tick), runs the matching action with
// retries, and writes every attempt to `automation_runs`. A realtime
// subscription keeps the in-memory cache fresh and picks up dashboard "Run now"
// requests (the run_requested_at column) for immediate one-off runs.
//
// The schedule maths here MIRRORS pulsify-web-app/lib/automations.ts. Keep the
// two in sync so the dashboard's "next run" preview matches when we actually
// fire.

const {
  MessageFlags,
  PermissionFlagsBits,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
} = require("discord.js");
const { recordNotification } = require("./notifications");

/**
 * Components V2 container for scheduled reports — matches the look of the bot's
 * other embeds (slash replies, moderation alerts): `#` heading, body text
 * block(s), a divider, and a `-#` footer carrying a relative timestamp. Falsy
 * `body` entries are skipped. No emoji in the heading — the accent bar carries
 * the branding, per the Pulse embed design language.
 */
function buildScheduleContainer({ colorInt, title, body, footerLabel }) {
  const unix = Math.floor(Date.now() / 1000);
  const components = [{ type: 10, content: `# ${title}` }];
  for (const block of body) if (block) components.push({ type: 10, content: block });
  components.push({ type: 14, divider: true, spacing: 1 });
  components.push({ type: 10, content: `-# Pulse · ${footerLabel} <t:${unix}:R>` });
  return { type: 17, accent_color: colorInt, components };
}

// ── Timezone-aware schedule maths (mirror of lib/automations.ts) ───────────────

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function getLocalParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const map = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: WEEKDAY_INDEX[map.weekday] ?? 0,
  };
}

function tzOffsetMs(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUTC - date.getTime();
}

function localToUtc(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = tzOffsetMs(new Date(guess), timeZone);
  let utc = guess - offset;
  const offset2 = tzOffsetMs(new Date(utc), timeZone);
  if (offset2 !== offset) utc = guess - offset2;
  return new Date(utc);
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValidTimezone(tz) {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function normaliseTime(v) {
  if (typeof v !== "string") return "09:00";
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return "09:00";
  const h = Math.max(0, Math.min(23, Number(m[1])));
  const mi = Math.max(0, Math.min(59, Number(m[2])));
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

const CRON_FIELDS = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 6 },
];

function parseCronField(token, field) {
  const out = new Set();
  for (const part of token.split(",")) {
    let range = part;
    let step = 1;
    const slash = part.split("/");
    if (slash.length === 2) {
      range = slash[0];
      step = Number(slash[1]);
      if (!Number.isInteger(step) || step < 1) return null;
    } else if (slash.length > 2) {
      return null;
    }
    let lo;
    let hi;
    if (range === "*") {
      lo = field.min;
      hi = field.max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-");
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = Number(range);
      hi = Number(range);
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
    if (field.max === 6) {
      if (lo === 7) lo = 0;
      if (hi === 7) hi = 0;
    }
    if (lo > hi || lo < field.min || hi > field.max) return null;
    for (let i = lo; i <= hi; i += step) out.add(i);
  }
  return out.size ? out : null;
}

function parseCron(expr) {
  const tokens = String(expr ?? "").trim().split(/\s+/);
  if (tokens.length !== 5) return null;
  const sets = tokens.map((t, i) => parseCronField(t, CRON_FIELDS[i]));
  if (sets.some((s) => s === null)) return null;
  return { minute: sets[0], hour: sets[1], dom: sets[2], month: sets[3], dow: sets[4] };
}

function computeNextRun(type, config, timezone, from = new Date()) {
  const tz = isValidTimezone(timezone) ? timezone : "UTC";
  config = config || {};

  if (type === "interval") {
    const every = Math.max(1, Number(config.every) || 1);
    const unitMs =
      config.unit === "minutes" ? 60000 : config.unit === "days" ? 86400000 : 3600000;
    return new Date(from.getTime() + every * unitMs);
  }

  if (type === "cron") {
    const parsed = parseCron(config.expr);
    if (!parsed) return null;
    let cursor = Math.floor(from.getTime() / 60000) * 60000 + 60000;
    const limit = cursor + 367 * 86400000;
    while (cursor <= limit) {
      const p = getLocalParts(new Date(cursor), tz);
      const domRestricted = parsed.dom.size !== 31;
      const dowRestricted = parsed.dow.size !== 7;
      const domOk = parsed.dom.has(p.day);
      const dowOk = parsed.dow.has(p.weekday);
      const dayOk =
        domRestricted && dowRestricted ? domOk || dowOk : domOk && dowOk;
      if (
        parsed.minute.has(p.minute) &&
        parsed.hour.has(p.hour) &&
        parsed.month.has(p.month) &&
        dayOk
      ) {
        return new Date(cursor);
      }
      cursor += 60000;
    }
    return null;
  }

  const [h, m] = normaliseTime(config.time).split(":").map(Number);
  const base = getLocalParts(from, tz);
  for (let offset = 0; offset <= 400; offset++) {
    const d = new Date(Date.UTC(base.year, base.month - 1, base.day + offset));
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const weekday = d.getUTCDay();

    if (type === "weekly") {
      const days = Array.isArray(config.days) ? config.days : [1];
      if (!days.includes(weekday)) continue;
    } else if (type === "monthly") {
      const wanted = Math.min(Number(config.day) || 1, daysInMonth(y, mo));
      if (day !== wanted) continue;
    }

    const candidate = localToUtc(y, mo, day, h, m, tz);
    if (candidate.getTime() > from.getTime()) return candidate;
  }
  return null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function resolvePlaceholders(text, guild) {
  return String(text ?? "")
    .replace(/\{server\}/g, guild.name)
    .replace(/\{memberCount\}/g, String(guild.memberCount ?? 0));
}

const PERIOD_MS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000 };

function createScheduler(client, supabase) {
  // id -> row
  const cache = new Map();
  // id -> last-seen run_requested_at (so we only fire each request once)
  const manualSeen = new Map();
  // ids currently executing — prevents overlapping runs of the same workflow
  const running = new Set();
  let tickTimer = null;

  // ── Persistence ────────────────────────────────────────────────────────────

  async function reload() {
    const { data, error } = await supabase.from("scheduled_automations").select("*");
    if (error) {
      console.warn("[Pulse] scheduled_automations load failed:", error.message);
      return;
    }
    cache.clear();
    for (const row of data ?? []) {
      cache.set(row.id, row);
      if (!manualSeen.has(row.id)) manualSeen.set(row.id, row.run_requested_at ?? null);
      // Backfill a missing next_run_at for enabled rows so they start firing.
      if (row.enabled && !row.next_run_at) {
        const next = computeNextRun(row.schedule_type, row.schedule_config, row.timezone);
        if (next) {
          row.next_run_at = next.toISOString();
          await supabase
            .from("scheduled_automations")
            .update({ next_run_at: row.next_run_at })
            .eq("id", row.id);
        }
      }
    }
    console.log(`[Pulse] Loaded ${cache.size} scheduled automation(s).`);
  }

  async function logRun(row, { status, detail, attempt, durationMs, triggeredBy }) {
    try {
      await supabase.from("automation_runs").insert({
        automation_id: row.id,
        guild_id: row.guild_id,
        automation_name: row.name,
        action_type: row.action_type,
        status,
        detail: detail ? String(detail).slice(0, 500) : null,
        attempt: attempt ?? 1,
        duration_ms: typeof durationMs === "number" ? durationMs : null,
        triggered_by: triggeredBy ?? "schedule",
      });
    } catch (err) {
      console.warn("[Pulse] automation_runs insert threw:", err.message);
    }
  }

  // Persist run bookkeeping. Scheduled runs advance next_run_at; manual/test
  // runs leave the cadence untouched (only last_run + counters move).
  async function updateAfterRun(row, { status, advanceSchedule }) {
    const patch = {
      last_run_at: new Date().toISOString(),
      last_status: status,
    };
    if (status === "success" || status === "failed") {
      patch.run_count = (row.run_count ?? 0) + 1;
      if (status === "failed") patch.fail_count = (row.fail_count ?? 0) + 1;
    }
    if (advanceSchedule && row.enabled) {
      const next = computeNextRun(row.schedule_type, row.schedule_config, row.timezone);
      patch.next_run_at = next ? next.toISOString() : null;
    }
    Object.assign(row, patch);
    await supabase.from("scheduled_automations").update(patch).eq("id", row.id);
  }

  // ── Conditions ───────────────────────────────────────────────────────────

  function checkConditions(row, guild) {
    const c = row.conditions || {};
    const count = guild.memberCount ?? 0;
    if (c.min_members != null && count < c.min_members) {
      return `Skipped: server has ${count} members (min ${c.min_members}).`;
    }
    if (c.max_members != null && count > c.max_members) {
      return `Skipped: server has ${count} members (max ${c.max_members}).`;
    }
    return null;
  }

  // ── Action executors ───────────────────────────────────────────────────────
  // Each returns a short success detail string, or throws on failure.

  async function runAnnouncement(row, guild) {
    const cfg = row.action_config || {};
    const channel = await guild.channels.fetch(cfg.channel_id).catch(() => null);
    if (!channel || !channel.isTextBased()) throw new Error("Target channel not found or not text-based.");
    let content = resolvePlaceholders(cfg.message, guild);
    const allowedMentions = { parse: [] };
    if (cfg.mention === "everyone") {
      content = `@everyone ${content}`;
      allowedMentions.parse = ["everyone"];
    } else if (cfg.mention === "here") {
      content = `@here ${content}`;
      allowedMentions.parse = ["everyone"];
    }
    await channel.send({ content: content.slice(0, 2000), allowedMentions });
    return `Posted to #${channel.name}.`;
  }

  async function runAnalyticsSummary(row, guild) {
    const cfg = row.action_config || {};
    const channel = await guild.channels.fetch(cfg.channel_id).catch(() => null);
    if (!channel || !channel.isTextBased()) throw new Error("Target channel not found or not text-based.");

    const period = PERIOD_MS[cfg.period] ? cfg.period : "24h";
    const since = new Date(Date.now() - PERIOD_MS[period]).toISOString();

    const countOf = async (eventType) => {
      const { count } = await supabase
        .from("analytics_events")
        .select("id", { count: "exact", head: true })
        .eq("guild_id", guild.id)
        .eq("event_type", eventType)
        .gte("created_at", since);
      return count ?? 0;
    };
    const [messages, joins, leaves, commands] = await Promise.all([
      countOf("message"),
      countOf("member_join"),
      countOf("member_leave"),
      countOf("command"),
    ]);

    const periodLabel = period === "24h" ? "last 24 hours" : period === "7d" ? "last 7 days" : "last 30 days";
    const net = joins - leaves;
    const container = buildScheduleContainer({
      colorInt: 0x8b5cf6,
      title: `${guild.name} — activity digest`,
      body: [
        `A summary of the ${periodLabel}.`,
        `**Messages:** ${messages.toLocaleString()} · **Commands:** ${commands.toLocaleString()}\n` +
          `**Members:** ${(guild.memberCount ?? 0).toLocaleString()}\n` +
          `**Joins:** +${joins.toLocaleString()} · **Leaves:** -${leaves.toLocaleString()} · ` +
          `**Net:** ${net >= 0 ? "+" : ""}${net.toLocaleString()}`,
      ],
      footerLabel: "Digest",
    });
    await channel.send({ flags: MessageFlags.IsComponentsV2, components: [container] });
    return `Posted ${periodLabel} digest to #${channel.name}.`;
  }

  // Fetch the bot's highest role position so we only attempt role changes we can
  // actually perform (Discord rejects managing roles >= the bot's top role).
  function canManageRole(guild, role) {
    const me = guild.members.me;
    if (!me) return false;
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return false;
    return me.roles.highest.comparePositionTo(role) > 0;
  }

  async function syncRole(row, guild, mode) {
    const cfg = row.action_config || {};
    const role = await guild.roles.fetch(cfg.role_id).catch(() => null);
    if (!role) throw new Error("Role not found.");
    if (!canManageRole(guild, role)) throw new Error(`Missing permission or role hierarchy to manage @${role.name}.`);

    const members = await guild.members.fetch();
    let changed = 0;
    for (const member of members.values()) {
      if (member.user.bot) continue;
      const has = member.roles.cache.has(role.id);
      try {
        if ((mode === "add_to_all") && !has) {
          await member.roles.add(role);
          changed++;
        } else if ((mode === "remove_from_all") && has) {
          await member.roles.remove(role);
          changed++;
        }
      } catch {
        // Skip individual members the bot can't modify; keep going.
      }
    }
    const verb = mode === "add_to_all" ? "Added" : "Removed";
    return `${verb} @${role.name} for ${changed} member(s).`;
  }

  async function runScheduledModeration(row, guild) {
    const cfg = row.action_config || {};
    const channel = await guild.channels.fetch(cfg.channel_id).catch(() => null);
    if (!channel) throw new Error("Target channel not found.");
    const everyone = guild.roles.everyone;
    if (cfg.operation === "lock") {
      await channel.permissionOverwrites.edit(everyone, { SendMessages: false });
      return `Locked #${channel.name}.`;
    }
    if (cfg.operation === "unlock") {
      await channel.permissionOverwrites.edit(everyone, { SendMessages: null });
      return `Unlocked #${channel.name}.`;
    }
    if (cfg.operation === "slowmode") {
      const secs = Math.max(0, Math.min(21600, Number(cfg.slowmode_seconds) || 0));
      await channel.setRateLimitPerUser(secs);
      return secs > 0 ? `Set ${secs}s slowmode on #${channel.name}.` : `Cleared slowmode on #${channel.name}.`;
    }
    throw new Error(`Unknown moderation operation "${cfg.operation}".`);
  }

  async function runRecurringEvent(row, guild) {
    const cfg = row.action_config || {};
    const start = new Date(Date.now() + 60000); // Discord requires a future start.
    const duration = Math.max(15, Math.min(1440, Number(cfg.duration_minutes) || 60));
    const end = new Date(start.getTime() + duration * 60000);
    const event = await guild.scheduledEvents.create({
      name: String(cfg.event_name || "Recurring event").slice(0, 100),
      scheduledStartTime: start,
      scheduledEndTime: end,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.External,
      entityMetadata: { location: String(cfg.location || "See description").slice(0, 100) },
      description: cfg.description ? String(cfg.description).slice(0, 1000) : undefined,
    });
    return `Created event "${event.name}".`;
  }

  async function runInactivityCleanup(row, guild) {
    const cfg = row.action_config || {};
    const channel = await guild.channels.fetch(cfg.channel_id).catch(() => null);
    if (!channel || !channel.isTextBased()) throw new Error("Report channel not found or not text-based.");

    const days = Math.max(1, Math.min(365, Number(cfg.inactive_days) || 30));
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const cutoffJoin = Date.now() - days * 86400000;

    // Active = anyone who sent a tracked message in the window.
    const { data: events } = await supabase
      .from("analytics_events")
      .select("user_id")
      .eq("guild_id", guild.id)
      .eq("event_type", "message")
      .gte("created_at", since);
    const active = new Set((events ?? []).map((e) => e.user_id).filter(Boolean));

    const members = await guild.members.fetch();
    const inactive = [];
    for (const member of members.values()) {
      if (member.user.bot) continue;
      if (active.has(member.id)) continue;
      // Don't flag members who only just joined.
      if (member.joinedTimestamp && member.joinedTimestamp > cutoffJoin) continue;
      inactive.push(member);
    }

    let removed = 0;
    let roleName = null;
    if (cfg.mode === "remove_role" && cfg.role_id) {
      const role = await guild.roles.fetch(cfg.role_id).catch(() => null);
      if (role && canManageRole(guild, role)) {
        roleName = role.name;
        for (const member of inactive) {
          if (member.roles.cache.has(role.id)) {
            try {
              await member.roles.remove(role);
              removed++;
            } catch {
              /* skip */
            }
          }
        }
      }
    }

    const sample = inactive.slice(0, 25).map((m) => `• ${m.user.tag}`).join("\n");
    const container = buildScheduleContainer({
      colorInt: 0x94a3b8,
      title: "Inactivity report",
      body: [
        `**${inactive.length}** member(s) have had no tracked activity in the last **${days}** day(s).` +
          (roleName ? `\nRemoved @${roleName} from **${removed}** of them.` : ""),
        sample ? `**Sample**\n${sample.slice(0, 1024)}` : null,
      ],
      footerLabel: "Housekeeping",
    });
    await channel.send({ flags: MessageFlags.IsComponentsV2, components: [container] });

    return `Flagged ${inactive.length} inactive member(s)${roleName ? `, removed role from ${removed}` : ""}.`;
  }

  async function dispatch(row, guild) {
    switch (row.action_type) {
      case "announcement":
      case "welcome_reminder":
        return runAnnouncement(row, guild);
      case "analytics_summary":
        return runAnalyticsSummary(row, guild);
      case "role_sync":
        return syncRole(row, guild, row.action_config?.mode === "remove_from_all" ? "remove_from_all" : "add_to_all");
      case "temp_role_removal":
        return syncRole(row, guild, "remove_from_all");
      case "scheduled_moderation":
        return runScheduledModeration(row, guild);
      case "recurring_event":
        return runRecurringEvent(row, guild);
      case "inactivity_cleanup":
        return runInactivityCleanup(row, guild);
      default:
        throw new Error(`Unknown action type "${row.action_type}".`);
    }
  }

  // ── Orchestration ──────────────────────────────────────────────────────────

  async function execute(row, triggeredBy) {
    if (running.has(row.id)) return;
    running.add(row.id);
    const advanceSchedule = triggeredBy === "schedule";
    try {
      const guild = client.guilds.cache.get(row.guild_id);
      if (!guild) {
        // Bot isn't in this guild (anymore) — don't reschedule into a void.
        await logRun(row, { status: "skipped", detail: "Bot is not in this server.", triggeredBy });
        await updateAfterRun(row, { status: "skipped", advanceSchedule });
        return;
      }

      const skip = checkConditions(row, guild);
      if (skip) {
        await logRun(row, { status: "skipped", detail: skip, triggeredBy });
        await updateAfterRun(row, { status: "skipped", advanceSchedule });
        return;
      }

      const maxAttempts = Math.max(1, Math.min(6, (row.max_retries ?? 0) + 1));
      let attempt = 1;
      let lastError = null;
      while (attempt <= maxAttempts) {
        const startedAt = Date.now();
        try {
          const detail = await dispatch(row, guild);
          await logRun(row, { status: "success", detail, attempt, durationMs: Date.now() - startedAt, triggeredBy });
          await updateAfterRun(row, { status: "success", advanceSchedule });
          console.log(`[Pulse] Automation "${row.name}" ran in ${guild.name} (${triggeredBy}).`);
          return;
        } catch (err) {
          lastError = err;
          if (attempt < maxAttempts) {
            await logRun(row, {
              status: "retrying",
              detail: `Attempt ${attempt} failed: ${err.message}`,
              attempt,
              durationMs: Date.now() - startedAt,
              triggeredBy,
            });
          }
          attempt++;
        }
      }

      // Out of attempts — record the failure and alert the dashboard.
      await logRun(row, {
        status: "failed",
        detail: lastError ? lastError.message : "Unknown error",
        attempt: maxAttempts,
        triggeredBy,
      });
      await updateAfterRun(row, { status: "failed", advanceSchedule });
      console.warn(`[Pulse] Automation "${row.name}" failed in ${row.guild_id}:`, lastError?.message);
      await recordNotification(supabase, {
        guildId: row.guild_id,
        type: "bot_warning",
        title: `Automation "${row.name}" failed`,
        body: lastError ? lastError.message : "Unknown error",
        link: `/dashboard/${row.guild_id}/scheduled`,
        metadata: { automation_id: row.id, action_type: row.action_type },
      });
    } finally {
      running.delete(row.id);
    }
  }

  // Fire every enabled workflow whose next_run_at has arrived. Cooldown acts as
  // a guard against accidental double-fires.
  async function tick() {
    const now = Date.now();
    for (const row of cache.values()) {
      if (!row.enabled || !row.next_run_at) continue;
      // Leave workflows for guilds we're not in untouched — don't fire them or
      // advance their schedule until the bot is back in the server.
      if (!client.guilds.cache.has(row.guild_id)) continue;
      if (new Date(row.next_run_at).getTime() > now) continue;
      const cooldownMs = (row.cooldown_minutes ?? 0) * 60000;
      if (cooldownMs && row.last_run_at && now - new Date(row.last_run_at).getTime() < cooldownMs) {
        continue;
      }
      // Run sequentially-ish: don't await the whole loop on one slow action, but
      // do let each manage its own running-guard.
      void execute(row, "schedule");
    }
  }

  // ── Realtime: definition edits + "Run now" requests ─────────────────────────

  function subscribe() {
    supabase
      .channel("scheduled-automations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scheduled_automations" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const id = payload.old?.id;
            if (id) {
              cache.delete(id);
              manualSeen.delete(id);
            }
            return;
          }
          const row = payload.new;
          if (!row) return;
          cache.set(row.id, row);

          // A changed run_requested_at means the dashboard asked for a one-off
          // run. Fire it once; ignore our own bookkeeping writes (unchanged).
          const seen = manualSeen.get(row.id) ?? null;
          if (row.run_requested_at && row.run_requested_at !== seen) {
            manualSeen.set(row.id, row.run_requested_at);
            void execute(row, "manual");
          }
        },
      )
      .subscribe();
  }

  async function start() {
    await reload();
    subscribe();
    // Align the first tick to the top of the next minute, then run every minute.
    const msToNextMinute = 60000 - (Date.now() % 60000);
    setTimeout(() => {
      void tick();
      tickTimer = setInterval(() => void tick(), 60000);
      if (tickTimer.unref) tickTimer.unref();
    }, msToNextMinute);
    console.log("[Pulse] Scheduler started.");
  }

  return { start, reload };
}

module.exports = { createScheduler, computeNextRun, parseCron };
