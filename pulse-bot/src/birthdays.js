// Birthday System — bot side (PULSIFY-58).
//
// MEMBERS author their own birthday (via /birthday or the Pulsify member
// profile). ADMINS configure the per-guild behaviour from the dashboard
// (birthday_settings). This module owns the CELEBRATION: a periodic sweep that,
// once the configured local hour is reached, finds members whose birthday is
// "today" (evaluated in their own timezone), posts the announcement, grants the
// configured rewards (Pulse Coins / XP / custom roles), assigns a temporary
// birthday role (reusing the temporary_roles table with source 'birthday' so the
// existing temp-role sweep auto-removes it), and writes a birthday_events row.
// The unique (guild, user, year) index makes the whole thing idempotent — a
// member is celebrated at most once per calendar year no matter how often the
// sweep runs.
//
// Date + settings math mirrors pulsify-web-app/lib/birthdays.ts — keep in sync.

const { Events, MessageFlags } = require("discord.js");
const { recordNotification } = require("./notifications");
const { buildPulseContainer, getPulseColor, loadPulseIcon, text } = require("./commands");

const SWEEP_MS = 15 * 60 * 1000; // every 15 minutes

// ── Pure helpers (mirror of lib/birthdays.ts) ─────────────────────────────────

const MONTHS = [
  { name: "January", days: 31 },
  { name: "February", days: 29 },
  { name: "March", days: 31 },
  { name: "April", days: 30 },
  { name: "May", days: 31 },
  { name: "June", days: 30 },
  { name: "July", days: 31 },
  { name: "August", days: 31 },
  { name: "September", days: 30 },
  { name: "October", days: 31 },
  { name: "November", days: 30 },
  { name: "December", days: 31 },
];
const monthName = (m) => MONTHS[m - 1]?.name ?? "";
const daysInMonth = (m) => MONTHS[m - 1]?.days ?? 31;
const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

const DEFAULT_BIRTHDAY_MESSAGE =
  "Happy birthday, {mention}! Everyone at {server} wishes you an amazing day.";

function isValidTimeZone(tz) {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function partsInTimeZone(date, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      hour12: false,
    });
    const map = {};
    for (const p of fmt.formatToParts(date)) {
      if (p.type !== "literal") map[p.type] = Number(p.value);
    }
    let hour = map.hour ?? 0;
    if (hour === 24) hour = 0;
    return { year: map.year, month: map.month, day: map.day, hour };
  } catch {
    if ((timeZone || "UTC") !== "UTC") return partsInTimeZone(date, "UTC");
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
    };
  }
}

function effectiveDay(month, day, year) {
  if (month === 2 && day === 29 && !isLeapYear(year)) return 28;
  return day;
}

function birthdayOccursOn(month, day, parts) {
  return parts.month === month && parts.day === effectiveDay(month, day, parts.year);
}

function daysUntilBirthday(month, day, now, timeZone) {
  const t = partsInTimeZone(now, timeZone);
  const today = Date.UTC(t.year, t.month - 1, t.day);
  let next = Date.UTC(t.year, month - 1, effectiveDay(month, day, t.year));
  if (next < today) {
    const ny = t.year + 1;
    next = Date.UTC(ny, month - 1, effectiveDay(month, day, ny));
  }
  return Math.round((next - today) / 86_400_000);
}

function ageInYear(birthYear, calendarYear) {
  if (!birthYear) return null;
  return Math.max(0, calendarYear - birthYear);
}

function formatBirthday(month, day, year, showYear) {
  const base = `${monthName(month)} ${day}`;
  return year && showYear ? `${base}, ${year}` : base;
}

function countdownLabel(days) {
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return `in ${days} days`;
  if (days < 30) {
    const w = Math.round(days / 7);
    return `in ${w} week${w === 1 ? "" : "s"}`;
  }
  const mo = Math.round(days / 30);
  return `in ${mo} month${mo === 1 ? "" : "s"}`;
}

function validateBirthday(month, day, year, now = new Date()) {
  if (!Number.isInteger(month) || month < 1 || month > 12) return "Pick a valid month.";
  if (!Number.isInteger(day) || day < 1) return "Pick a valid day.";
  if (day > daysInMonth(month)) return `${monthName(month)} only has ${daysInMonth(month)} days.`;
  if (year != null && year !== 0) {
    if (!Number.isInteger(year)) return "Enter a valid year.";
    if (year < 1900) return "Year must be 1900 or later.";
    if (year > now.getUTCFullYear() - 13) return "You must be at least 13 to use this.";
    if (month === 2 && day === 29 && !isLeapYear(year)) return `${year} is not a leap year.`;
  }
  return null;
}

function clampInt(v, min, max, fallback) {
  const num = Number(v);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function httpsUrlOrNull(v) {
  if (typeof v !== "string" || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const DEFAULT_CONFIG = {
  enabled: false,
  channel_id: null,
  announce_hour: 9,
  timezone: "UTC",
  message: DEFAULT_BIRTHDAY_MESSAGE,
  mention: "user",
  image_url: null,
  button_label: null,
  button_url: null,
  role_id: null,
  role_auto_assign: true,
  role_auto_remove: true,
  role_duration_hours: 24,
  reward_coins: 0,
  reward_xp: 0,
  reward_role_ids: [],
};

function normaliseBirthdaySettings(row) {
  const base = { ...DEFAULT_CONFIG, reward_role_ids: [] };
  if (!row) return base;
  const enabled = typeof row.enabled === "boolean" ? row.enabled : base.enabled;
  const s = row.settings && typeof row.settings === "object" ? row.settings : {};
  const tz = typeof s.timezone === "string" && isValidTimeZone(s.timezone) ? s.timezone : base.timezone;
  const roleIds = Array.isArray(s.reward_role_ids)
    ? [...new Set(s.reward_role_ids.filter((x) => typeof x === "string" && x))].slice(0, 10)
    : [];
  return {
    enabled,
    channel_id: typeof s.channel_id === "string" && s.channel_id ? s.channel_id : null,
    announce_hour: clampInt(s.announce_hour, 0, 23, base.announce_hour),
    timezone: tz,
    message: typeof s.message === "string" && s.message.trim() ? s.message.slice(0, 500) : base.message,
    mention: s.mention === "none" || s.mention === "here" || s.mention === "everyone" ? s.mention : "user",
    image_url: httpsUrlOrNull(s.image_url),
    button_label: typeof s.button_label === "string" && s.button_label.trim() ? s.button_label.slice(0, 80) : null,
    button_url: httpsUrlOrNull(s.button_url),
    role_id: typeof s.role_id === "string" && s.role_id ? s.role_id : null,
    role_auto_assign: s.role_auto_assign == null ? true : Boolean(s.role_auto_assign),
    role_auto_remove: s.role_auto_remove == null ? true : Boolean(s.role_auto_remove),
    role_duration_hours: clampInt(s.role_duration_hours, 1, 24 * 14, base.role_duration_hours),
    reward_coins: clampInt(s.reward_coins, 0, 1_000_000, 0),
    reward_xp: clampInt(s.reward_xp, 0, 1_000_000, 0),
    reward_role_ids: roleIds,
  };
}

function renderBirthdayMessage(template, ctx) {
  return template
    .replace(/\{user\}/g, ctx.user)
    .replace(/\{mention\}/g, ctx.mention)
    .replace(/\{server\}/g, ctx.server)
    .replace(/\{age\}/g, String(ctx.age))
    .replace(/\{date\}/g, ctx.date);
}

// ── Module factory ────────────────────────────────────────────────────────────

function createBirthdays(client, supabase, economy, leveling) {
  const configs = new Map(); // guildId -> normalised config
  let sweepTimer = null;
  let sweeping = false;

  function getConfig(guildId) {
    return configs.get(guildId) ?? { ...DEFAULT_CONFIG, reward_role_ids: [] };
  }

  async function reload() {
    const { data, error } = await supabase.from("birthday_settings").select("*");
    if (error) {
      console.warn("[Pulse] birthday settings load failed:", error.message);
      return;
    }
    configs.clear();
    for (const row of data ?? []) configs.set(row.guild_id, normaliseBirthdaySettings(row));
    console.log(`[Pulse] Loaded birthday settings for ${configs.size} guild(s).`);
  }

  function subscribe() {
    supabase
      .channel("birthday-settings-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "birthday_settings" }, (payload) => {
        const guildId = payload.new?.guild_id ?? payload.old?.guild_id;
        if (!guildId) return;
        if (payload.eventType === "DELETE") configs.delete(guildId);
        else configs.set(guildId, normaliseBirthdaySettings(payload.new));
      })
      .subscribe();
  }

  // ── Announcement ─────────────────────────────────────────────────────────────

  async function buildAnnouncement(guild, member, cfg, birthday, celebrationYear) {
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("birthday", colorHex);
    const age = birthday.show_year ? ageInYear(birthday.birth_year, celebrationYear) : null;
    const mentionText =
      cfg.mention === "everyone" ? "@everyone" : cfg.mention === "here" ? "@here" : `<@${member.id}>`;
    const rendered = renderBirthdayMessage(cfg.message, {
      user: member.displayName,
      mention: mentionText,
      server: guild.name,
      age: age == null ? "" : age,
      date: formatBirthday(birthday.birth_month, birthday.birth_day, birthday.birth_year, birthday.show_year),
    });

    const body = [text(rendered)];
    if (age != null) body.push(text(`-# Turning ${age} today`));
    if (cfg.image_url) body.push({ type: 12, items: [{ media: { url: cfg.image_url } }] });

    const actions = [];
    if (cfg.button_label && cfg.button_url) {
      actions.push({ type: 1, components: [{ type: 2, style: 5, label: cfg.button_label, url: cfg.button_url }] });
    }

    const container = buildPulseContainer({
      iconUrl: icon ? `attachment://${icon.name}` : guild.iconURL?.({ size: 128 }) || member.displayAvatarURL({ size: 128 }),
      colorHex,
      title: "Happy Birthday",
      subtitle: member.displayName,
      body,
      footer: "Pulse — Birthday",
      actions,
      noSpacer: Boolean(cfg.image_url),
    });

    const allowedMentions =
      cfg.mention === "none"
        ? { parse: [] }
        : cfg.mention === "user"
          ? { users: [member.id] }
          : { parse: ["everyone"] };

    return { container, files: icon ? [icon] : [], allowedMentions };
  }

  // ── Rewards + roles ─────────────────────────────────────────────────────────

  async function grantRewards(guild, member, cfg) {
    const granted = {};
    // Pulse Coins (global economy — a flat admin-set amount, not multiplied).
    if (cfg.reward_coins > 0 && economy?.adjust) {
      const newBalance = await economy
        .adjust(member.id, member.displayName, cfg.reward_coins, "reward", "birthday", {
          guildId: guild.id,
          guildName: guild.name,
        })
        .catch(() => null);
      if (newBalance != null) granted.coins = cfg.reward_coins;
    }
    // XP (server-local; routed through leveling so level-ups still fire).
    if (cfg.reward_xp > 0 && leveling?.awardBonusXp) {
      await leveling.awardBonusXp(guild, member, cfg.reward_xp).catch(() => {});
      granted.xp = cfg.reward_xp;
    }
    // Permanent custom reward roles (additive).
    const rewardRoles = [];
    for (const roleId of cfg.reward_role_ids) {
      try {
        if (!member.roles.cache.has(roleId)) {
          await member.roles.add(roleId, "Pulse birthday reward").catch(() => {});
        }
        rewardRoles.push(roleId);
      } catch {
        /* role above bot / missing perms — skip */
      }
    }
    if (rewardRoles.length) granted.roles = rewardRoles;
    return granted;
  }

  // Assign the temporary birthday role now and (when auto-removing) register it
  // in temporary_roles so the existing temp-role sweep removes it at expiry.
  async function assignBirthdayRole(guild, member, cfg) {
    if (!cfg.role_id || !cfg.role_auto_assign) return null;
    const role = guild.roles.cache.get(cfg.role_id);
    if (!role) return null;
    try {
      if (!member.roles.cache.has(cfg.role_id)) {
        await member.roles.add(cfg.role_id, "Pulse birthday role");
      }
    } catch {
      return null; // role above the bot / missing perms
    }
    if (cfg.role_auto_remove) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + cfg.role_duration_hours * 3_600_000);
      try {
        await supabase.from("temporary_roles").insert({
          guild_id: guild.id,
          user_id: member.id,
          user_name: member.displayName,
          role_id: cfg.role_id,
          role_name: role.name,
          source: "birthday",
          reason: "Birthday role",
          assigned_by: null,
          assigned_by_name: "Pulse",
          expires_at: expiresAt.toISOString(),
          notify_user: false,
          notify_admin: false,
        });
      } catch (err) {
        // A lingering active grant (unique index) just means it's already tracked.
        if (err?.code !== "23505") console.warn("[Pulse] birthday temp-role insert failed:", err?.message);
      }
    }
    return cfg.role_id;
  }

  // ── Celebrate one member ──────────────────────────────────────────────────────

  async function celebrate(guild, member, cfg, birthday, celebrationYear) {
    const age = ageInYear(birthday.birth_year, celebrationYear);
    // Claim the celebration idempotently: only the insert that CREATES the row
    // proceeds (unique guild+user+year). A racing sweep hits 23505 and bails.
    const { error: insErr } = await supabase.from("birthday_events").insert({
      guild_id: guild.id,
      user_id: member.id,
      user_name: member.displayName,
      year: celebrationYear,
      age,
      announced: false,
    });
    if (insErr) {
      if (insErr.code !== "23505") console.warn("[Pulse] birthday_events insert failed:", insErr.message);
      return;
    }

    const rewards = await grantRewards(guild, member, cfg);
    const roleId = await assignBirthdayRole(guild, member, cfg);

    let messageId = null;
    if (birthday.announce && cfg.channel_id) {
      try {
        const channel = await client.channels.fetch(cfg.channel_id).catch(() => null);
        if (channel?.isTextBased?.()) {
          const { container, files, allowedMentions } = await buildAnnouncement(guild, member, cfg, birthday, celebrationYear);
          const sent = await channel
            .send({ flags: MessageFlags.IsComponentsV2, components: [container], files, allowedMentions })
            .catch(() => null);
          messageId = sent?.id ?? null;
        }
      } catch {
        /* announcement failure must never break reward granting */
      }
    }

    // Finalise the history row with what actually happened.
    await supabase
      .from("birthday_events")
      .update({ announced: Boolean(messageId), channel_id: cfg.channel_id, message_id: messageId, role_id: roleId, rewards })
      .eq("guild_id", guild.id)
      .eq("user_id", member.id)
      .eq("year", celebrationYear);

    await recordNotification(supabase, {
      guildId: guild.id,
      type: "birthday_today",
      title: `${member.displayName}'s birthday${age != null ? ` (turning ${age})` : ""}`,
      link: `/dashboard/${guild.id}/birthdays`,
      targetId: member.id,
      targetName: member.displayName,
      metadata: { year: celebrationYear, age },
    });
  }

  // ── Sweep ──────────────────────────────────────────────────────────────────────

  async function sweepGuild(guild) {
    const cfg = getConfig(guild.id);
    if (!cfg.enabled || !cfg.channel_id) return;

    const now = new Date();
    // Only celebrate once the guild's local clock has reached the announce hour.
    if (partsInTimeZone(now, cfg.timezone).hour < cfg.announce_hour) return;

    const { data: birthdays } = await supabase
      .from("member_birthdays")
      .select("*")
      .eq("guild_id", guild.id);
    if (!birthdays || birthdays.length === 0) return;

    const guildYear = partsInTimeZone(now, cfg.timezone).year;
    // Load this cycle's celebrations (± a year to cover timezone new-year edges).
    const { data: events } = await supabase
      .from("birthday_events")
      .select("user_id, year")
      .eq("guild_id", guild.id)
      .gte("year", guildYear - 1)
      .lte("year", guildYear + 1);
    const done = new Set((events ?? []).map((e) => `${e.user_id}:${e.year}`));

    for (const b of birthdays) {
      const tz = b.timezone && isValidTimeZone(b.timezone) ? b.timezone : cfg.timezone;
      const parts = partsInTimeZone(now, tz);
      if (!birthdayOccursOn(b.birth_month, b.birth_day, parts)) continue;
      const celebrationYear = parts.year;
      if (done.has(`${b.user_id}:${celebrationYear}`)) continue;

      const member = await guild.members.fetch(b.user_id).catch(() => null);
      if (!member || member.user?.bot) continue;
      await celebrate(guild, member, cfg, b, celebrationYear).catch((err) =>
        console.warn(`[Pulse] birthday celebrate failed for ${b.user_id}:`, err.message),
      );
    }
  }

  async function sweep() {
    if (sweeping) return;
    sweeping = true;
    try {
      for (const guild of client.guilds.cache.values()) {
        await sweepGuild(guild).catch((err) =>
          console.warn(`[Pulse] birthday sweep failed for ${guild.id}:`, err.message),
        );
      }
    } finally {
      sweeping = false;
    }
  }

  // ── Slash command (/birthday set|view|upcoming|remove) ────────────────────────

  async function replyEphemeral(interaction, guild, title, lines) {
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("birthday", colorHex);
    const container = buildPulseContainer({
      iconUrl: icon ? `attachment://${icon.name}` : guild.iconURL?.({ size: 128 }),
      colorHex,
      title,
      body: lines.map((l) => text(l)),
      footer: "Pulse — Birthday",
    });
    const components = [container];
    const files = icon ? [icon] : [];
    if (interaction.deferred || interaction.replied) {
      // After a (non-V2) deferReply, editReply must carry the V2 flag; the
      // ephemeral state is inherited from the defer.
      await interaction.editReply({ components, files, flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    } else {
      await interaction
        .reply({ components, files, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral })
        .catch(() => {});
    }
  }

  async function handleSet(interaction, guild) {
    const month = interaction.options.getInteger("month", true);
    const day = interaction.options.getInteger("day", true);
    const yearRaw = interaction.options.getInteger("year");
    const year = yearRaw && yearRaw > 0 ? yearRaw : null;
    const tzRaw = interaction.options.getString("timezone");
    const timezone = tzRaw && isValidTimeZone(tzRaw) ? tzRaw : null;
    const hideYear = interaction.options.getBoolean("hide_year");
    const announceOpt = interaction.options.getBoolean("announce");

    const err = validateBirthday(month, day, year);
    if (err) {
      await replyEphemeral(interaction, guild, "Birthday not saved", [err]);
      return;
    }

    const showYear = hideYear == null ? true : !hideYear;
    const announce = announceOpt == null ? true : announceOpt;

    const { error } = await supabase.from("member_birthdays").upsert(
      {
        guild_id: guild.id,
        user_id: interaction.user.id,
        user_name: interaction.member?.displayName ?? interaction.user.username,
        birth_month: month,
        birth_day: day,
        birth_year: year,
        timezone,
        show_year: showYear,
        announce,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "guild_id,user_id" },
    );
    if (error) {
      await replyEphemeral(interaction, guild, "Birthday not saved", ["Something went wrong — please try again."]);
      return;
    }

    const dateStr = formatBirthday(month, day, year, showYear);
    const lines = [`Your birthday is set to **${dateStr}**.`];
    if (timezone) lines.push(`-# Timezone — ${timezone}`);
    if (!announce) lines.push("-# Announcements are off — you won't get a public shout-out.");
    else lines.push("Pulse will celebrate you on the day.");
    await replyEphemeral(interaction, guild, "Birthday saved", lines);
  }

  async function handleView(interaction, guild) {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const { data: row } = await supabase
      .from("member_birthdays")
      .select("*")
      .eq("guild_id", guild.id)
      .eq("user_id", target.id)
      .maybeSingle();
    if (!row) {
      const who = target.id === interaction.user.id ? "You haven't" : `${target.username} hasn't`;
      await replyEphemeral(interaction, guild, "No birthday set", [
        `${who} set a birthday yet.`,
        target.id === interaction.user.id ? "-# Use /birthday set to add yours." : "",
      ].filter(Boolean));
      return;
    }
    const cfg = getConfig(guild.id);
    const tz = row.timezone && isValidTimeZone(row.timezone) ? row.timezone : cfg.timezone;
    const now = new Date();
    const days = daysUntilBirthday(row.birth_month, row.birth_day, now, tz);
    const dateStr = formatBirthday(row.birth_month, row.birth_day, row.birth_year, row.show_year);
    const lines = [`**${dateStr}** — ${countdownLabel(days)}`];
    if (row.birth_year && row.show_year) {
      const p = partsInTimeZone(now, tz);
      const nextYear = new Date(Date.UTC(p.year, p.month - 1, p.day) + days * 86_400_000).getUTCFullYear();
      const turning = ageInYear(row.birth_year, nextYear);
      if (turning != null) lines.push(days === 0 ? `-# Turning ${turning} today` : `-# Turning ${turning} on their next birthday`);
    }
    const name = target.id === interaction.user.id ? "Your birthday" : `${row.user_name ?? target.username}'s birthday`;
    await replyEphemeral(interaction, guild, name, lines);
  }

  async function handleUpcoming(interaction, guild) {
    const cfg = getConfig(guild.id);
    const { data: rows } = await supabase.from("member_birthdays").select("*").eq("guild_id", guild.id);
    if (!rows || rows.length === 0) {
      await replyEphemeral(interaction, guild, "Upcoming birthdays", ["No birthdays have been set in this server yet."]);
      return;
    }
    const now = new Date();
    const decorated = rows
      .map((b) => {
        const tz = b.timezone && isValidTimeZone(b.timezone) ? b.timezone : cfg.timezone;
        return { b, days: daysUntilBirthday(b.birth_month, b.birth_day, now, tz) };
      })
      .sort((a, z) => a.days - z.days)
      .slice(0, 10);
    const lines = decorated.map(({ b, days }) => {
      const dateStr = formatBirthday(b.birth_month, b.birth_day, b.birth_year, b.show_year);
      return `<@${b.user_id}> — **${dateStr}** (${countdownLabel(days)})`;
    });
    await replyEphemeral(interaction, guild, "Upcoming birthdays", lines);
  }

  async function handleRemove(interaction, guild) {
    await supabase
      .from("member_birthdays")
      .delete()
      .eq("guild_id", guild.id)
      .eq("user_id", interaction.user.id);
    await replyEphemeral(interaction, guild, "Birthday removed", ["Your birthday has been removed from this server."]);
  }

  async function handleBirthdayCommand({ interaction, guild }) {
    // Defer up front (ephemeral): the reply builds a tinted badge + hits the DB,
    // which can brush against Discord's 3s window. replyEphemeral then edits.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const sub = interaction.options.getSubcommand();
    if (sub === "set") return handleSet(interaction, guild);
    if (sub === "view") return handleView(interaction, guild);
    if (sub === "upcoming") return handleUpcoming(interaction, guild);
    if (sub === "remove") return handleRemove(interaction, guild);
  }

  async function start() {
    await reload();
    subscribe();
    setTimeout(() => {
      void sweep();
      sweepTimer = setInterval(() => void sweep(), SWEEP_MS);
      if (sweepTimer.unref) sweepTimer.unref();
    }, 25_000);
    console.log("[Pulse] Birthday system started.");
  }

  return { start, reload, sweep, handleBirthdayCommand };
}

module.exports = {
  createBirthdays,
  // Pure helpers exported for reuse + tests.
  MONTHS,
  DEFAULT_BIRTHDAY_MESSAGE,
  monthName,
  daysInMonth,
  isLeapYear,
  isValidTimeZone,
  partsInTimeZone,
  birthdayOccursOn,
  daysUntilBirthday,
  ageInYear,
  formatBirthday,
  countdownLabel,
  validateBirthday,
  normaliseBirthdaySettings,
  renderBirthdayMessage,
};
