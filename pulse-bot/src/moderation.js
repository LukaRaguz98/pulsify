// Moderation commands — bot side (PULSIFY-61).
//
// The nine moderation actions, runnable from Discord instead of the dashboard:
// /warn /timeout /untimeout /kick /ban /unban /warnings /purge /modlogs.
//
// These MIRROR the dashboard's server actions in
// pulsify-web-app/app/dashboard/[guildId]/(management)/moderation/actions.ts —
// same tables, same columns, same action slugs, same activity-feed notification.
// A /ban here and a ban from the dashboard produce rows that differ only by
// `moderation_logs.source` (see src/moderation-log.js). That's what keeps
// Moderation History, Management Analytics and the feed correct regardless of
// where a moderator happened to be standing.
//
// ── Two hierarchy checks, not one ────────────────────────────────────────────
// The dashboard only checks whether the BOT can act on the target
// (`checkBotCanAct`), because the moderator there is authenticated by a role
// check and has no Discord role position in play. In Discord that isn't enough:
// without checking the INVOKER's position too, a junior moderator could use
// Pulse to ban an admin who outranks them — Discord's own UI would refuse that,
// so the bot must refuse it as well. Every destructive command here checks both:
//
//   1. Does the invoker outrank the target?  (requireInvokerOutranks)
//   2. Can the bot act on the target?        (discord.js member.bannable /
//                                             .kickable / .moderatable)
//
// Guild owners bypass (1) — nobody outranks them.

const { MessageFlags, PermissionFlagsBits } = require("discord.js");
const {
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  replyNotice,
  editNotice,
  text,
  divider,
} = require("./commands");
const { recordModerationAction, actorFrom } = require("./moderation-log");

// Discord's hard cap on a timeout: 28 days.
const MAX_TIMEOUT_MINUTES = 40320;
// Discord's bulk-delete cap per call, and its 14-day age limit.
const PURGE_MAX = 100;
const PURGE_MIN = 1;
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
// Ban message-deletion window, expressed in days by the command option.
const BAN_DELETE_DAYS_MAX = 7;

const WARNINGS_SHOWN = 10;
const MODLOGS_SHOWN = 10;

/**
 * Preset durations offered by /timeout's autocomplete. Free-text still parses
 * (see parseDuration) — these are just the common cases, so nobody has to
 * remember the syntax.
 */
const DURATION_PRESETS = [
  { name: "60 seconds", value: "60s" },
  { name: "5 minutes", value: "5m" },
  { name: "10 minutes", value: "10m" },
  { name: "30 minutes", value: "30m" },
  { name: "1 hour", value: "1h" },
  { name: "6 hours", value: "6h" },
  { name: "12 hours", value: "12h" },
  { name: "1 day", value: "1d" },
  { name: "3 days", value: "3d" },
  { name: "1 week", value: "7d" },
  { name: "28 days (max)", value: "28d" },
];

const UNIT_MINUTES = { s: 1 / 60, m: 1, h: 60, d: 1440, w: 10080 };

/**
 * Parse a duration into whole minutes: "10m", "2h", "1d", "1h30m", or a bare
 * number (read as minutes). Returns null when nothing parses, so the caller can
 * say so rather than silently timing someone out for a surprising length.
 */
function parseDuration(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (s.length === 0) return null;

  // Bare number → minutes.
  if (/^\d+$/.test(s)) {
    const m = Number(s);
    return m > 0 ? m : null;
  }

  // One or more <number><unit> pairs, e.g. "1h30m".
  const matches = [...s.matchAll(/(\d+)\s*([smhdw])/g)];
  if (matches.length === 0) return null;
  // Reject trailing junk ("10m please") so a typo can't be read as a valid
  // duration with the garbage ignored.
  const consumed = matches.reduce((acc, m) => acc + m[0].length, 0);
  if (consumed !== s.replace(/\s/g, "").length) return null;

  let minutes = 0;
  for (const [, num, unit] of matches) minutes += Number(num) * UNIT_MINUTES[unit];
  minutes = Math.round(minutes);
  return minutes > 0 ? minutes : null;
}

/** "1 day 2 hours" / "30 minutes" — spelled out for the confirmation embed. */
function humaniseMinutes(total) {
  const mins = Math.max(0, Math.round(total));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const parts = [];
  if (d) parts.push(`${d} day${d === 1 ? "" : "s"}`);
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (m) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" ") : "0 minutes";
}

/** Discord relative timestamp — renders as a live "in 2 hours". */
const relTime = (date) => `<t:${Math.floor(date.getTime() / 1000)}:R>`;
const absTime = (date) => `<t:${Math.floor(date.getTime() / 1000)}:f>`;

function createModeration({ client, supabase }) {
  // ── Guards ─────────────────────────────────────────────────────────────────

  /**
   * The highest role position a member holds. The guild owner is treated as
   * above everything — they hold every permission regardless of roles.
   */
  function topRolePosition(member) {
    if (!member) return -1;
    if (member.id === member.guild?.ownerId) return Number.MAX_SAFE_INTEGER;
    return member.roles?.highest?.position ?? 0;
  }

  /**
   * Whether the invoking moderator outranks `target`. Returns an error string,
   * or null when the action may proceed.
   *
   * Self-targeting and bot-targeting are rejected here too — they're the same
   * class of "this action doesn't make sense" mistake and every command needs
   * the check.
   */
  function requireInvokerOutranks(invoker, target, verb) {
    if (!target) return null; // target isn't in the guild — no hierarchy to compare
    if (target.id === invoker.id) return `You can't ${verb} yourself.`;
    if (target.id === client.user.id) return `I can't ${verb} myself.`;
    if (target.id === target.guild.ownerId) {
      return `You can't ${verb} the server owner.`;
    }
    if (invoker.id === invoker.guild.ownerId) return null;
    if (topRolePosition(target) >= topRolePosition(invoker)) {
      return `You can't ${verb} ${target.displayName} — their highest role is not below yours.`;
    }
    return null;
  }

  /**
   * Whether the bot itself can perform `capability` on the target. discord.js's
   * `.bannable` / `.kickable` / `.moderatable` already fold in both the bot's
   * permission and its role position, which is exactly the pair we need.
   */
  function requireBotCanAct(target, capability, verb) {
    if (!target) return null;
    if (!target[capability]) {
      return `I can't ${verb} ${target.displayName} — check that my role sits above theirs and that I have the right permission.`;
    }
    return null;
  }

  /** Does the bot hold `flag` in this guild? */
  function botHas(guild, flag) {
    return guild.members.me?.permissions?.has(flag) ?? false;
  }

  // ── Shared reply helpers ───────────────────────────────────────────────────

  /**
   * The confirmation embed every action shares: what happened, to whom, why.
   * Short and thumbnail-less per the embed conventions on buildPulseContainer —
   * these are confirmations, not reports.
   */
  async function actionEmbed(guild, { title, lines, footer }) {
    const colorHex = await getPulseColor(supabase, guild.id);
    return buildPulseContainer({
      colorHex,
      title,
      body: [text(lines.join("\n"))],
      footer,
    });
  }

  async function replyAction(interaction, guild, payload) {
    const container = await actionEmbed(guild, payload);
    await interaction
      .editReply({ flags: MessageFlags.IsComponentsV2, components: [container] })
      .catch(() => {});
  }

  /**
   * Tell the member what happened to them, in a DM, best-effort.
   *
   * The dashboard doesn't do this — but a warning nobody receives isn't a
   * warning, and in Discord the moderator has no other channel to reach them.
   * Never blocks or fails the action: closed DMs are common and are not an error
   * worth surfacing as a failed /ban.
   */
  async function notifyTarget(guild, user, { title, lines }) {
    try {
      const colorHex = await getPulseColor(supabase, guild.id);
      await user.send({
        flags: MessageFlags.IsComponentsV2,
        components: [
          buildPulseContainer({
            colorHex,
            title,
            subtitle: guild.name,
            body: [text(lines.join("\n"))],
            footer: `Pulse — ${guild.name}`,
          }),
        ],
      });
      return true;
    } catch {
      return false;
    }
  }

  /** `Reason — <text>` line, or a plain "No reason given". */
  const reasonLine = (reason) =>
    reason ? `**Reason** — ${reason}` : "**Reason** — No reason given";

  /** Audit-log reason string: who did it, so Discord's own log agrees with ours. */
  const auditReason = (interaction, reason) =>
    `${interaction.user.username}${reason ? `: ${reason}` : ""}`.slice(0, 500);

  // ── /warn ──────────────────────────────────────────────────────────────────

  async function handleWarn({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason", true).trim();
    if (reason.length === 0) {
      return editNotice(interaction, "A reason is required for warnings.");
    }

    const target = await guild.members.fetch(user.id).catch(() => null);
    const rank = requireInvokerOutranks(interaction.member, target, "warn");
    if (rank) return editNotice(interaction, rank);

    // A warning is a record, not a Discord action — so unlike /kick there's no
    // bot-capability check. It works even if the member has already left.
    const label = target?.displayName ?? user.username;
    const { error } = await supabase.from("guild_warnings").insert({
      guild_id: guild.id,
      user_id: user.id,
      // guild_warnings.username holds the display label older views render, so
      // prefer the display name — matching the dashboard's warnMember.
      username: label,
      moderator_id: interaction.user.id,
      moderator_username: interaction.user.username,
      reason,
    });
    if (error) {
      console.error(`[Pulse] /warn insert failed in ${guild.id}:`, error.message);
      return editNotice(interaction, "I couldn't record that warning. Try again shortly.");
    }

    await recordModerationAction(supabase, {
      guildId: guild.id,
      action: "warn",
      moderator: actorFrom(interaction.member ?? interaction.user),
      target: actorFrom(target ?? user),
      reason,
    });

    const { count } = await supabase
      .from("guild_warnings")
      .select("id", { count: "exact", head: true })
      .eq("guild_id", guild.id)
      .eq("user_id", user.id)
      .eq("active", true);
    const total = count ?? 1;

    const delivered = await notifyTarget(guild, user, {
      title: "You've received a warning",
      lines: [reasonLine(reason), `**Active warnings** — ${total}`],
    });

    await replyAction(interaction, guild, {
      title: "Member warned",
      lines: [
        `**Member** — ${label} (<@${user.id}>)`,
        reasonLine(reason),
        `**Active warnings** — ${total}`,
        delivered ? "" : "-# I couldn't DM them — their DMs are closed.",
      ].filter(Boolean),
      footer: "Pulse — Moderation",
    });
  }

  // ── /timeout ───────────────────────────────────────────────────────────────

  async function handleTimeout({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const user = interaction.options.getUser("user", true);
    const rawDuration = interaction.options.getString("duration", true);
    const reason = interaction.options.getString("reason")?.trim() || null;

    const minutes = parseDuration(rawDuration);
    if (minutes === null) {
      return editNotice(
        interaction,
        `I couldn't read \`${rawDuration}\` as a duration. Try \`10m\`, \`2h\`, \`1d\`, or \`1h30m\`.`,
      );
    }
    if (minutes > MAX_TIMEOUT_MINUTES) {
      return editNotice(
        interaction,
        `Discord caps timeouts at 28 days — \`${rawDuration}\` is longer than that.`,
      );
    }

    if (!botHas(guild, PermissionFlagsBits.ModerateMembers)) {
      return editNotice(interaction, "I need the Timeout Members permission to do that.");
    }

    const target = await guild.members.fetch(user.id).catch(() => null);
    if (!target) return editNotice(interaction, "That member isn't in this server.");

    const rank = requireInvokerOutranks(interaction.member, target, "time out");
    if (rank) return editNotice(interaction, rank);
    const botRank = requireBotCanAct(target, "moderatable", "time out");
    if (botRank) return editNotice(interaction, botRank);

    const until = new Date(Date.now() + minutes * 60_000);
    try {
      await target.timeout(minutes * 60_000, auditReason(interaction, reason));
    } catch (err) {
      console.error(`[Pulse] /timeout failed in ${guild.id}:`, err.message);
      return editNotice(interaction, "Discord refused that timeout. Check my permissions and role position.");
    }

    await recordModerationAction(supabase, {
      guildId: guild.id,
      action: "timeout",
      moderator: actorFrom(interaction.member ?? interaction.user),
      target: actorFrom(target),
      reason,
      // Same metadata keys the dashboard writes, so both surfaces read alike.
      metadata: { duration_minutes: minutes, until: until.toISOString() },
    });

    const delivered = await notifyTarget(guild, user, {
      title: "You've been timed out",
      lines: [
        `**Duration** — ${humaniseMinutes(minutes)}`,
        `**Expires** — ${relTime(until)}`,
        reasonLine(reason),
      ],
    });

    await replyAction(interaction, guild, {
      title: "Member timed out",
      lines: [
        `**Member** — ${target.displayName} (<@${user.id}>)`,
        `**Duration** — ${humaniseMinutes(minutes)}`,
        `**Expires** — ${relTime(until)} (${absTime(until)})`,
        reasonLine(reason),
        delivered ? "" : "-# I couldn't DM them — their DMs are closed.",
      ].filter(Boolean),
      footer: "Pulse — Moderation",
    });
  }

  async function autocompleteDuration({ interaction }) {
    const focused = String(interaction.options.getFocused() ?? "").toLowerCase();
    const matches = DURATION_PRESETS.filter(
      (p) => p.name.toLowerCase().includes(focused) || p.value.startsWith(focused),
    );
    // When the member types something we can parse but isn't a preset ("45m"),
    // offer it back as the first choice so they can pick their own value.
    const custom = focused && parseDuration(focused);
    const choices = [];
    if (custom && !matches.some((m) => m.value === focused)) {
      choices.push({ name: `${humaniseMinutes(custom)} (${focused})`, value: focused });
    }
    choices.push(...matches.slice(0, 24));
    await interaction.respond(choices.slice(0, 25));
  }

  // ── /untimeout ─────────────────────────────────────────────────────────────

  async function handleUntimeout({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const user = interaction.options.getUser("user", true);
    if (!botHas(guild, PermissionFlagsBits.ModerateMembers)) {
      return editNotice(interaction, "I need the Timeout Members permission to do that.");
    }

    const target = await guild.members.fetch(user.id).catch(() => null);
    if (!target) return editNotice(interaction, "That member isn't in this server.");

    // `communicationDisabledUntil` in the past means the timeout already lapsed.
    const until = target.communicationDisabledUntilTimestamp;
    if (!until || until <= Date.now()) {
      return editNotice(interaction, `${target.displayName} isn't timed out.`);
    }

    const rank = requireInvokerOutranks(interaction.member, target, "untime out");
    if (rank) return editNotice(interaction, rank);
    const botRank = requireBotCanAct(target, "moderatable", "untime out");
    if (botRank) return editNotice(interaction, botRank);

    try {
      await target.timeout(null, auditReason(interaction, "Timeout removed"));
    } catch (err) {
      console.error(`[Pulse] /untimeout failed in ${guild.id}:`, err.message);
      return editNotice(interaction, "Discord refused that. Check my permissions and role position.");
    }

    await recordModerationAction(supabase, {
      guildId: guild.id,
      // Slug matches the dashboard's removeMemberTimeout.
      action: "remove_timeout",
      moderator: actorFrom(interaction.member ?? interaction.user),
      target: actorFrom(target),
    });

    await notifyTarget(guild, user, {
      title: "Your timeout was lifted",
      lines: ["You can take part in the server again."],
    });

    await replyAction(interaction, guild, {
      title: "Timeout removed",
      lines: [`**Member** — ${target.displayName} (<@${user.id}>)`],
      footer: "Pulse — Moderation",
    });
  }

  // ── /kick ──────────────────────────────────────────────────────────────────

  async function handleKick({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason")?.trim() || null;

    if (!botHas(guild, PermissionFlagsBits.KickMembers)) {
      return editNotice(interaction, "I need the Kick Members permission to do that.");
    }

    const target = await guild.members.fetch(user.id).catch(() => null);
    if (!target) return editNotice(interaction, "That member isn't in this server.");

    const rank = requireInvokerOutranks(interaction.member, target, "kick");
    if (rank) return editNotice(interaction, rank);
    const botRank = requireBotCanAct(target, "kickable", "kick");
    if (botRank) return editNotice(interaction, botRank);

    // DM BEFORE the kick — once they're out of the guild the DM channel may no
    // longer be reachable.
    const delivered = await notifyTarget(guild, user, {
      title: "You've been kicked",
      lines: [reasonLine(reason), "You can rejoin with a new invite."],
    });

    const label = target.displayName;
    try {
      await target.kick(auditReason(interaction, reason));
    } catch (err) {
      console.error(`[Pulse] /kick failed in ${guild.id}:`, err.message);
      return editNotice(interaction, "Discord refused that kick. Check my permissions and role position.");
    }

    await recordModerationAction(supabase, {
      guildId: guild.id,
      action: "kick",
      moderator: actorFrom(interaction.member ?? interaction.user),
      target: actorFrom(target),
      reason,
    });

    await replyAction(interaction, guild, {
      title: "Member kicked",
      lines: [
        `**Member** — ${label} (<@${user.id}>)`,
        reasonLine(reason),
        delivered ? "" : "-# I couldn't DM them — their DMs are closed.",
      ].filter(Boolean),
      footer: "Pulse — Moderation",
    });
  }

  // ── /ban ───────────────────────────────────────────────────────────────────

  async function handleBan({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason")?.trim() || null;
    const deleteDays = interaction.options.getInteger("delete_days") ?? 0;

    if (!botHas(guild, PermissionFlagsBits.BanMembers)) {
      return editNotice(interaction, "I need the Ban Members permission to do that.");
    }

    // A ban can target someone who was never here, so a missing member is fine —
    // the hierarchy checks simply have nothing to compare and pass through.
    const target = await guild.members.fetch(user.id).catch(() => null);
    const rank = requireInvokerOutranks(interaction.member, target, "ban");
    if (rank) return editNotice(interaction, rank);
    const botRank = requireBotCanAct(target, "bannable", "ban");
    if (botRank) return editNotice(interaction, botRank);

    const existing = await guild.bans.fetch(user.id).catch(() => null);
    if (existing) return editNotice(interaction, `${user.username} is already banned.`);

    const delivered = target
      ? await notifyTarget(guild, user, {
          title: "You've been banned",
          lines: [reasonLine(reason)],
        })
      : false;

    const label = target?.displayName ?? user.username;
    const deleteMessageSeconds = Math.max(0, Math.min(BAN_DELETE_DAYS_MAX, deleteDays)) * 86400;
    try {
      await guild.bans.create(user.id, {
        reason: auditReason(interaction, reason),
        deleteMessageSeconds,
      });
    } catch (err) {
      console.error(`[Pulse] /ban failed in ${guild.id}:`, err.message);
      return editNotice(interaction, "Discord refused that ban. Check my permissions and role position.");
    }

    await recordModerationAction(supabase, {
      guildId: guild.id,
      action: "ban",
      moderator: actorFrom(interaction.member ?? interaction.user),
      target: actorFrom(target ?? user),
      reason,
      // The dashboard records delete_message_seconds only when non-zero; match
      // it so the two write identical metadata for identical actions.
      metadata: deleteMessageSeconds ? { delete_message_seconds: deleteMessageSeconds } : {},
    });

    const lines = [`**Member** — ${label} (<@${user.id}>)`, reasonLine(reason)];
    if (deleteMessageSeconds > 0) {
      lines.push(`**Messages deleted** — last ${deleteDays} day${deleteDays === 1 ? "" : "s"}`);
    }
    if (target && !delivered) lines.push("-# I couldn't DM them — their DMs are closed.");

    await replyAction(interaction, guild, {
      title: "Member banned",
      lines,
      footer: "Pulse — Moderation",
    });
  }

  // ── /unban ─────────────────────────────────────────────────────────────────

  async function handleUnban({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const rawId = interaction.options.getString("user_id", true).trim();
    const reason = interaction.options.getString("reason")?.trim() || null;

    if (!/^\d{17,20}$/.test(rawId)) {
      return editNotice(
        interaction,
        `\`${rawId}\` isn't a Discord user ID. Start typing a name and pick from the list, or paste their ID.`,
      );
    }

    if (!botHas(guild, PermissionFlagsBits.BanMembers)) {
      return editNotice(interaction, "I need the Ban Members permission to do that.");
    }

    const ban = await guild.bans.fetch(rawId).catch(() => null);
    if (!ban) return editNotice(interaction, "That user isn't banned from this server.");

    try {
      await guild.bans.remove(rawId, auditReason(interaction, reason));
    } catch (err) {
      console.error(`[Pulse] /unban failed in ${guild.id}:`, err.message);
      return editNotice(interaction, "Discord refused that unban. Check my permissions.");
    }

    await recordModerationAction(supabase, {
      guildId: guild.id,
      action: "unban",
      moderator: actorFrom(interaction.member ?? interaction.user),
      target: actorFrom(ban.user),
      reason,
    });

    await replyAction(interaction, guild, {
      title: "Member unbanned",
      lines: [`**Member** — ${ban.user.username} (<@${rawId}>)`, reasonLine(reason)],
      footer: "Pulse — Moderation",
    });
  }

  /**
   * Suggest currently-banned users for /unban. This is the whole reason the
   * command is usable: nobody remembers a snowflake, and Discord can't offer a
   * user picker for someone who has left the guild.
   */
  async function autocompleteBannedUser({ interaction, guild }) {
    const focused = String(interaction.options.getFocused() ?? "").toLowerCase();
    // A guild can have thousands of bans; fetch a bounded page and filter.
    const bans = await guild.bans.fetch({ limit: 1000 }).catch(() => null);
    if (!bans) return interaction.respond([]);

    const choices = [];
    for (const ban of bans.values()) {
      const name = ban.user.username ?? ban.user.id;
      if (focused && !name.toLowerCase().includes(focused) && !ban.user.id.startsWith(focused)) {
        continue;
      }
      choices.push({ name: `${name} (${ban.user.id})`.slice(0, 100), value: ban.user.id });
      if (choices.length >= 25) break;
    }
    await interaction.respond(choices);
  }

  // ── /warnings ──────────────────────────────────────────────────────────────

  async function handleWarnings({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const user = interaction.options.getUser("user", true);
    const { data, error } = await supabase
      .from("guild_warnings")
      .select("reason, moderator_username, created_at, active")
      .eq("guild_id", guild.id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error(`[Pulse] /warnings read failed in ${guild.id}:`, error.message);
      return editNotice(interaction, "I couldn't load those warnings. Try again shortly.");
    }

    const rows = data ?? [];
    const active = rows.filter((r) => r.active !== false);
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("warn", colorHex);
    const member = await guild.members.fetch(user.id).catch(() => null);
    const label = member?.displayName ?? user.username;

    const body = [];
    if (rows.length === 0) {
      body.push(text(`${label} has no warnings in this server.`));
    } else {
      body.push(
        text(
          `**Active** — ${active.length}\n**Total on record** — ${rows.length}`,
        ),
      );
      body.push(divider());
      const shown = rows.slice(0, WARNINGS_SHOWN);
      body.push(
        text(
          shown
            .map((r) => {
              const when = new Date(r.created_at);
              const by = r.moderator_username ?? "Unknown moderator";
              const lapsed = r.active === false ? " (inactive)" : "";
              return `**${by}** — ${absTime(when)}${lapsed}\n-# ${r.reason ?? "No reason given"}`;
            })
            .join("\n\n"),
        ),
      );
      if (rows.length > shown.length) {
        body.push(text(`-# Showing ${shown.length} of ${rows.length} — the rest are in the dashboard.`));
      }
    }

    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title: `Warnings — ${label}`,
          subtitle: `Pulse — ${guild.name}`,
          body,
          footer: "Pulse — Moderation",
        }),
      ],
      files: icon ? [icon] : [],
    });
  }

  // ── /purge ─────────────────────────────────────────────────────────────────

  async function handlePurge({ interaction, guild, ephemeral }) {
    // Always ephemeral in practice — a public "deleted 40 messages" notice in
    // the channel you just cleaned is noise. The Command Center can still
    // override it.
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const amount = interaction.options.getInteger("amount", true);
    const user = interaction.options.getUser("user");
    const channel = interaction.channel;

    if (!channel?.isTextBased?.()) {
      return editNotice(interaction, "I can only purge messages in a text channel.");
    }
    if (!botHas(guild, PermissionFlagsBits.ManageMessages)) {
      return editNotice(interaction, "I need the Manage Messages permission to do that.");
    }
    const bounded = Math.max(PURGE_MIN, Math.min(PURGE_MAX, amount));

    // When filtering by member we must over-fetch: `amount` means "delete N of
    // THEIR messages", but they may be scattered among other people's.
    const fetchLimit = user ? PURGE_MAX : bounded;
    const fetched = await channel.messages.fetch({ limit: fetchLimit }).catch(() => null);
    if (!fetched) {
      return editNotice(interaction, "I couldn't read this channel's recent messages.");
    }

    const cutoff = Date.now() - BULK_DELETE_MAX_AGE_MS;
    let candidates = [...fetched.values()]
      // Discord's bulk delete silently refuses anything older than 14 days, so
      // filter first and tell the moderator rather than half-failing.
      .filter((m) => m.createdTimestamp > cutoff)
      .filter((m) => !m.pinned);
    if (user) candidates = candidates.filter((m) => m.author.id === user.id);
    const doomed = candidates.slice(0, bounded);

    if (doomed.length === 0) {
      return editNotice(
        interaction,
        user
          ? `I found no messages from ${user.username} in the last 100 here that I can delete. Messages older than 14 days and pinned messages can't be bulk-deleted.`
          : "I found nothing here I can delete. Messages older than 14 days and pinned messages can't be bulk-deleted.",
      );
    }

    let deleted;
    try {
      deleted = await channel.bulkDelete(doomed, true);
    } catch (err) {
      console.error(`[Pulse] /purge failed in ${guild.id}:`, err.message);
      return editNotice(interaction, "Discord refused that purge. Check my permissions in this channel.");
    }

    await recordModerationAction(supabase, {
      guildId: guild.id,
      // Slug matches the dashboard's bulkDeleteMessages.
      action: "bulk_delete_messages",
      moderator: actorFrom(interaction.member ?? interaction.user),
      target: user ? actorFrom(user) : null,
      reason: null,
      metadata: {
        count: deleted.size,
        channel_id: channel.id,
        channel_name: channel.name ?? null,
      },
    });

    const lines = [
      `**Deleted** — ${deleted.size} message${deleted.size === 1 ? "" : "s"}`,
      `**Channel** — <#${channel.id}>`,
    ];
    if (user) lines.push(`**From** — ${user.username} (<@${user.id}>)`);
    if (deleted.size < bounded) {
      lines.push("-# Some messages couldn't be deleted — they were pinned or older than 14 days.");
    }

    await replyAction(interaction, guild, {
      title: "Messages purged",
      lines,
      footer: "Pulse — Moderation",
    });
  }

  // ── /modlogs ───────────────────────────────────────────────────────────────

  async function handleModlogs({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const user = interaction.options.getUser("user");
    let query = supabase
      .from("moderation_logs")
      .select("action, target_username, target_display_name, moderator_username, reason, source, created_at")
      .eq("guild_id", guild.id)
      .order("created_at", { ascending: false })
      .limit(MODLOGS_SHOWN);
    if (user) query = query.eq("target_user_id", user.id);

    const { data, error } = await query;
    if (error) {
      console.error(`[Pulse] /modlogs read failed in ${guild.id}:`, error.message);
      return editNotice(interaction, "I couldn't load the moderation log. Try again shortly.");
    }

    const rows = data ?? [];
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("safety", colorHex);
    const member = user ? await guild.members.fetch(user.id).catch(() => null) : null;
    const label = user ? member?.displayName ?? user.username : null;

    const body = [];
    if (rows.length === 0) {
      body.push(
        text(
          user
            ? `No moderation actions recorded against ${label}.`
            : "No moderation actions recorded in this server yet.",
        ),
      );
    } else {
      body.push(
        text(
          rows
            .map((r) => {
              const when = new Date(r.created_at);
              const who = r.target_display_name ?? r.target_username ?? "Unknown";
              const by = r.moderator_username ?? "Unknown";
              const what = ACTION_TITLES[r.action] ?? r.action.replace(/_/g, " ");
              // Surface where it came from — the whole point of the new
              // `source` column is that these two surfaces are distinguishable.
              const from = r.source === "Discord Command" ? "Discord" : "Dashboard";
              const head = user ? `**${what}** — by ${by}` : `**${what}** — ${who}`;
              return `${head}\n-# ${absTime(when)} — ${from}${r.reason ? ` — ${r.reason}` : ""}`;
            })
            .join("\n\n"),
        ),
      );
    }

    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title: user ? `Moderation history — ${label}` : "Recent moderation",
          subtitle: `Pulse — ${guild.name}`,
          body,
          footer: "Pulse — Moderation",
        }),
      ],
      files: icon ? [icon] : [],
    });
  }

  return {
    handleWarn,
    handleTimeout,
    handleUntimeout,
    handleKick,
    handleBan,
    handleUnban,
    handleWarnings,
    handlePurge,
    handleModlogs,
    autocompleteDuration,
    autocompleteBannedUser,
  };
}

/** Titles for the /modlogs list — the noun form of each action slug. */
const ACTION_TITLES = {
  ban: "Ban",
  unban: "Unban",
  kick: "Kick",
  timeout: "Timeout",
  remove_timeout: "Timeout removed",
  warn: "Warning",
  nickname: "Nickname change",
  add_role: "Role added",
  remove_role: "Role removed",
  delete_message: "Message deleted",
  bulk_delete_messages: "Messages purged",
  channel_lock: "Channel locked",
  channel_unlock: "Channel unlocked",
  channel_slowmode: "Slowmode changed",
};

module.exports = {
  createModeration,
  // Exported for tests — the duration parser is the one piece of real logic
  // here that isn't a Discord call.
  parseDuration,
  humaniseMinutes,
  MAX_TIMEOUT_MINUTES,
  DURATION_PRESETS,
};
