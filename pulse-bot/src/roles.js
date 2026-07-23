// Role commands — bot side (PULSIFY-61).
//
// /role add · /role remove · /role temp · /role info · /role hierarchy
//
// ── Naming ───────────────────────────────────────────────────────────────────
// One `role` group, not `/role add` + a separate `/temprole` (which is how the
// spec lists it). Discord forbids spaces in a command name, so a group is the
// only way to read as two words anyway — and every admin action on roles living
// under one name means one tier, one config row, one place to look.
//
// The member-facing self-assign menu is deliberately a SEPARATE command
// (`/selfrole`, see src/self-roles-command.js): `command_configs` keys on
// command_name and Discord's default_member_permissions sits on the top-level
// command, so a subcommand cannot carry its own tier. `/role menu` at member
// tier would either expose the admin subcommands in everyone's picker or let an
// admin's "admins only" override silently kill the member menu.
//
// ── What this owns vs what already existed ───────────────────────────────────
//   • add/remove — Discord role changes, logged as `add_role` / `remove_role`
//     (slugs the dashboard already writes, so both surfaces read alike).
//   • temp — writes a `temporary_roles` row and assigns the role. It does NOT
//     schedule anything: temporary-roles.js already runs a 60s sweep that
//     expires grants, DMs the member and writes the audit row. Mirrors the
//     dashboard's POST /api/discord/guild/[guildId]/temporary-roles, including
//     the "re-granting an active grant EXTENDS it" behaviour that the partial
//     unique index requires.
//   • info/hierarchy — reads. `hierarchy` mirrors the categorisation in
//     pulsify-web-app/lib/role-hierarchy.ts; keep the two in sync or Discord and
//     the dashboard will group the same role differently.

const { MessageFlags, PermissionFlagsBits } = require("discord.js");
const {
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  editNotice,
  text,
  divider,
} = require("./commands");
const { recordModerationAction, actorFrom } = require("./moderation-log");
const { parseDuration, humaniseMinutes } = require("./moderation");

// Mirrors MAX_DURATION_MS in lib/temporary-roles.ts (4 years) and its floor.
const TEMP_MAX_MINUTES = 4 * 365 * 24 * 60;
const TEMP_MIN_MINUTES = 1;

// Preset durations for /role temp's autocomplete. Longer than /timeout's list —
// a temporary role is usually days or months, not minutes.
const TEMP_PRESETS = [
  { name: "1 hour", value: "1h" },
  { name: "6 hours", value: "6h" },
  { name: "12 hours", value: "12h" },
  { name: "1 day", value: "1d" },
  { name: "3 days", value: "3d" },
  { name: "1 week", value: "7d" },
  { name: "2 weeks", value: "14d" },
  { name: "30 days", value: "30d" },
  { name: "90 days", value: "90d" },
  { name: "1 year", value: "365d" },
];

const relTime = (date) => `<t:${Math.floor(date.getTime() / 1000)}:R>`;
const absTime = (date) => `<t:${Math.floor(date.getTime() / 1000)}:f>`;

// ── Role categorisation ──────────────────────────────────────────────────────
//
// MIRRORS `categorizeRole` in pulsify-web-app/lib/role-hierarchy.ts — same
// keyword lists, same permission set, same priority order, same reason strings.
// Deterministic: no AI, no DB. If these drift, /role hierarchy and the
// dashboard's Role Hierarchy tab will put the same role in different buckets,
// which is worse than either being slightly wrong. The tests pin them.
//
// Priority order matters and is NOT obvious:
//   1. managed, or a bot-ish NAME  → Bots
//   2. Administrator > management permissions > a staff-ish NAME → Management
//   3. everything else → Community
// Permissions beat names within step 2 (a role that can ban IS management, no
// matter what it's called), but the bot check in step 1 beats both — a role
// named "Music Bot" is Bots even if someone gave it Manage Messages.

// Mirrors MANAGEMENT_PERMISSION_KEYS. Note VIEW_AUDIT_LOG is in the web set, and
// MANAGE_EMOJIS is NOT — don't "tidy" this list without changing both.
const MANAGEMENT_PERMISSIONS = [
  { flag: PermissionFlagsBits.Administrator, name: "Administrator" },
  { flag: PermissionFlagsBits.KickMembers, name: "Kick Members" },
  { flag: PermissionFlagsBits.BanMembers, name: "Ban Members" },
  { flag: PermissionFlagsBits.ModerateMembers, name: "Timeout Members" },
  { flag: PermissionFlagsBits.ManageRoles, name: "Manage Roles" },
  { flag: PermissionFlagsBits.ManageGuild, name: "Manage Server" },
  { flag: PermissionFlagsBits.ManageChannels, name: "Manage Channels" },
  { flag: PermissionFlagsBits.ManageMessages, name: "Manage Messages" },
  { flag: PermissionFlagsBits.ManageNicknames, name: "Manage Nicknames" },
  { flag: PermissionFlagsBits.ManageWebhooks, name: "Manage Webhooks" },
  { flag: PermissionFlagsBits.ViewAuditLog, name: "View Audit Log" },
];

const BOT_NAME_KEYWORDS = ["bot", "disboard", "music", "radio", "pulse", "webhook", "integration"];

const MANAGEMENT_NAME_KEYWORDS = [
  "owner",
  "admin",
  "administrator",
  "moderator",
  "mod",
  "support",
  "staff",
  "helper",
  "manager",
];

// These default to Community anyway — the list only exists to produce a
// friendlier reason.
const COMMUNITY_NAME_KEYWORDS = [
  "member",
  "booster",
  "streamer",
  "vip",
  "verified",
  "subscriber",
  "community",
];

function matchKeyword(name, keywords) {
  for (const k of keywords) if (name.includes(k)) return k;
  return null;
}

function categorizeRole(role) {
  const name = role.name.toLowerCase();

  // 1 — Bots.
  if (role.managed) return { category: "bots", reason: "Managed integration role" };
  const botKeyword = matchKeyword(name, BOT_NAME_KEYWORDS);
  if (botKeyword) return { category: "bots", reason: `Name contains "${botKeyword}"` };

  // 2 — Management. Permissions win over names.
  if (role.permissions.has(PermissionFlagsBits.Administrator)) {
    return { category: "management", reason: "Has the Administrator permission" };
  }
  if (MANAGEMENT_PERMISSIONS.some((p) => role.permissions.has(p.flag))) {
    return { category: "management", reason: "Has moderation permissions" };
  }
  const mgmtKeyword = matchKeyword(name, MANAGEMENT_NAME_KEYWORDS);
  if (mgmtKeyword) return { category: "management", reason: `Name contains "${mgmtKeyword}"` };

  // 3 — Community (default).
  const communityKeyword = matchKeyword(name, COMMUNITY_NAME_KEYWORDS);
  if (communityKeyword) {
    return { category: "community", reason: `Name contains "${communityKeyword}"` };
  }
  return { category: "community", reason: "General member role" };
}

// Self-assign menu categories — mirrors CATEGORY_META in lib/self-roles.ts
// (labels only; the icons and colours are dashboard-side). Used by /selfrole to
// name a menu's category the way the dashboard does. Distinct from the role
// HIERARCHY categories below — same word, different taxonomy.
const SELF_ROLE_CATEGORY_LABELS = {
  game: "Game roles",
  notification: "Notification roles",
  platform: "Platform roles",
  language: "Language roles",
  region: "Region roles",
  interest: "Interest roles",
  color: "Color roles",
  custom: "Custom",
};

// Mirrors CATEGORY_META in lib/role-hierarchy.ts.
const CATEGORY_META = {
  management: { label: "Management", blurb: "Roles that can manage the server." },
  bots: { label: "Bots", blurb: "Managed integration roles and roles that belong to bots." },
  community: { label: "Community", blurb: "Members, boosters, streamers and everything else." },
};
const CATEGORY_ORDER = ["management", "bots", "community"];

function createRoles({ client, supabase }) {
  // ── Guards ─────────────────────────────────────────────────────────────────

  function botHighestPosition(guild) {
    return guild.members.me?.roles?.highest?.position ?? -1;
  }

  function topRolePosition(member) {
    if (!member) return -1;
    if (member.id === member.guild?.ownerId) return Number.MAX_SAFE_INTEGER;
    return member.roles?.highest?.position ?? 0;
  }

  /**
   * Whether `role` may be handed out here. Returns an error string or null.
   *
   * Two checks, mirroring the dashboard's route AND the moderation stance:
   *   1. The BOT must sit above the role, or Discord refuses the add.
   *   2. The INVOKER must sit above it too — otherwise a junior admin could use
   *      Pulse to grant themselves a role above their own, which is a
   *      privilege-escalation route Discord's own UI closes.
   * Managed roles are never assignable by anyone.
   */
  function checkRoleAssignable(guild, invoker, role, verb) {
    if (role.id === guild.id) return "That's the @everyone role — it can't be assigned.";
    if (role.managed) {
      // Phrased without `verb`: it arrives as an infinitive ("add"/"remove"),
      // which reads wrong in this sentence ("can't be add manually").
      return `\`${role.name}\` is managed by an integration and can't be assigned or removed manually.`;
    }
    if (role.position >= botHighestPosition(guild)) {
      return `\`${role.name}\` sits above my highest role — move my role above it first.`;
    }
    if (invoker.id !== guild.ownerId && role.position >= topRolePosition(invoker)) {
      return `\`${role.name}\` is not below your highest role, so you can't ${verb} it.`;
    }
    return null;
  }

  function botCanManageRoles(guild) {
    return guild.members.me?.permissions?.has(PermissionFlagsBits.ManageRoles) ?? false;
  }

  async function replyAction(interaction, guild, { title, lines, footer }) {
    const colorHex = await getPulseColor(supabase, guild.id);
    await interaction
      .editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [
          buildPulseContainer({ colorHex, title, body: [text(lines.join("\n"))], footer }),
        ],
      })
      .catch(() => {});
  }

  const auditReason = (interaction, extra) =>
    `${interaction.user.username}${extra ? `: ${extra}` : ""}`.slice(0, 500);

  // ── /role add ──────────────────────────────────────────────────────────────

  async function handleAdd({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const user = interaction.options.getUser("user", true);
    const role = interaction.options.getRole("role", true);
    const reason = interaction.options.getString("reason")?.trim() || null;

    if (!botCanManageRoles(guild)) {
      return editNotice(interaction, "I need the Manage Roles permission to do that.");
    }
    const target = await guild.members.fetch(user.id).catch(() => null);
    if (!target) return editNotice(interaction, "That member isn't in this server.");

    const problem = checkRoleAssignable(guild, interaction.member, role, "add");
    if (problem) return editNotice(interaction, problem);

    if (target.roles.cache.has(role.id)) {
      return editNotice(interaction, `${target.displayName} already has \`${role.name}\`.`);
    }

    try {
      await target.roles.add(role.id, auditReason(interaction, reason));
    } catch (err) {
      console.error(`[Pulse] /role add failed in ${guild.id}:`, err.message);
      return editNotice(interaction, "Discord refused that. Check my permissions and role position.");
    }

    await recordModerationAction(supabase, {
      guildId: guild.id,
      action: "add_role",
      moderator: actorFrom(interaction.member ?? interaction.user),
      target: actorFrom(target),
      reason,
      metadata: { role_id: role.id, role_name: role.name },
    });

    await replyAction(interaction, guild, {
      title: "Role added",
      lines: [
        `**Member** — ${target.displayName} (<@${user.id}>)`,
        `**Role** — <@&${role.id}>`,
        reason ? `**Reason** — ${reason}` : "",
      ].filter(Boolean),
      footer: "Pulse — Roles",
    });
  }

  // ── /role remove ───────────────────────────────────────────────────────────

  async function handleRemove({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const user = interaction.options.getUser("user", true);
    const role = interaction.options.getRole("role", true);
    const reason = interaction.options.getString("reason")?.trim() || null;

    if (!botCanManageRoles(guild)) {
      return editNotice(interaction, "I need the Manage Roles permission to do that.");
    }
    const target = await guild.members.fetch(user.id).catch(() => null);
    if (!target) return editNotice(interaction, "That member isn't in this server.");

    const problem = checkRoleAssignable(guild, interaction.member, role, "remove");
    if (problem) return editNotice(interaction, problem);

    if (!target.roles.cache.has(role.id)) {
      return editNotice(interaction, `${target.displayName} doesn't have \`${role.name}\`.`);
    }

    try {
      await target.roles.remove(role.id, auditReason(interaction, reason));
    } catch (err) {
      console.error(`[Pulse] /role remove failed in ${guild.id}:`, err.message);
      return editNotice(interaction, "Discord refused that. Check my permissions and role position.");
    }

    await recordModerationAction(supabase, {
      guildId: guild.id,
      action: "remove_role",
      moderator: actorFrom(interaction.member ?? interaction.user),
      target: actorFrom(target),
      reason,
      metadata: { role_id: role.id, role_name: role.name },
    });

    await replyAction(interaction, guild, {
      title: "Role removed",
      lines: [
        `**Member** — ${target.displayName} (<@${user.id}>)`,
        `**Role** — <@&${role.id}>`,
        reason ? `**Reason** — ${reason}` : "",
      ].filter(Boolean),
      footer: "Pulse — Roles",
    });
  }

  // ── /role temp ─────────────────────────────────────────────────────────────

  async function handleTemp({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const user = interaction.options.getUser("user", true);
    const role = interaction.options.getRole("role", true);
    const rawDuration = interaction.options.getString("duration", true);
    const reason = interaction.options.getString("reason")?.trim() || null;

    // Same parser /timeout uses — one duration grammar across every command.
    const minutes = parseDuration(rawDuration);
    if (minutes === null) {
      return editNotice(
        interaction,
        `I couldn't read \`${rawDuration}\` as a duration. Try \`7d\`, \`12h\`, \`30d\`, or \`1h30m\`.`,
      );
    }
    if (minutes < TEMP_MIN_MINUTES) {
      return editNotice(interaction, "A temporary role must last at least a minute.");
    }
    if (minutes > TEMP_MAX_MINUTES) {
      // Mirrors validateExpiry in lib/temporary-roles.ts.
      return editNotice(interaction, "A temporary role can last at most 4 years.");
    }

    if (!botCanManageRoles(guild)) {
      return editNotice(interaction, "I need the Manage Roles permission to do that.");
    }
    const target = await guild.members.fetch(user.id).catch(() => null);
    if (!target) return editNotice(interaction, "That member isn't in this server.");

    const problem = checkRoleAssignable(guild, interaction.member, role, "add");
    if (problem) return editNotice(interaction, problem);

    const expiresAt = new Date(Date.now() + minutes * 60_000);
    const now = new Date().toISOString();

    try {
      await target.roles.add(role.id, auditReason(interaction, `Temporary role: ${reason ?? "no reason given"}`));
    } catch (err) {
      console.error(`[Pulse] /role temp failed in ${guild.id}:`, err.message);
      return editNotice(interaction, "Discord refused that. Check my permissions and role position.");
    }

    // Re-granting an already-active grant EXTENDS it rather than inserting a
    // second row — `temporary_roles` has a partial unique index on
    // (guild, user, role) where status = 'active', so an insert would fail.
    // Mirrors the dashboard's POST route.
    const shared = {
      user_name: target.displayName,
      role_name: role.name,
      source: "manual",
      reason: reason ?? "Temporary role via Discord command",
      expires_at: expiresAt.toISOString(),
      notify_user: true,
      notify_admin: false,
      // Reset the "expiring soon" guard so an extended grant warns again.
      expiry_warned_at: null,
      updated_at: now,
    };

    let extended = false;
    try {
      const { data: existing } = await supabase
        .from("temporary_roles")
        .select("id")
        .eq("guild_id", guild.id)
        .eq("user_id", user.id)
        .eq("role_id", role.id)
        .eq("status", "active")
        .maybeSingle();

      if (existing) {
        extended = true;
        const { error } = await supabase
          .from("temporary_roles")
          .update(shared)
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("temporary_roles").insert({
          guild_id: guild.id,
          user_id: user.id,
          role_id: role.id,
          assigned_by: interaction.user.id,
          assigned_by_name: interaction.user.username,
          assigned_at: now,
          status: "active",
          ...shared,
        });
        if (error) throw new Error(error.message);
      }
    } catch (err) {
      console.error(`[Pulse] /role temp row write failed in ${guild.id}:`, err.message);
      // The Discord role IS on them now. Without a row nothing will ever take it
      // back off, so say so plainly rather than reporting a clean success.
      return editNotice(
        interaction,
        `I gave <@${user.id}> \`${role.name}\`, but couldn't record the expiry — it will NOT be removed automatically. Remove it by hand, or try again.`,
      );
    }

    await recordModerationAction(supabase, {
      guildId: guild.id,
      action: "add_role",
      moderator: actorFrom(interaction.member ?? interaction.user),
      target: actorFrom(target),
      reason,
      metadata: {
        role_id: role.id,
        role_name: role.name,
        temporary: true,
        expires_at: expiresAt.toISOString(),
      },
    });

    await replyAction(interaction, guild, {
      title: extended ? "Temporary role extended" : "Temporary role added",
      lines: [
        `**Member** — ${target.displayName} (<@${user.id}>)`,
        `**Role** — <@&${role.id}>`,
        `**Lasts** — ${humaniseMinutes(minutes)}`,
        `**Expires** — ${relTime(expiresAt)} (${absTime(expiresAt)})`,
        reason ? `**Reason** — ${reason}` : "",
        "-# Pulse removes it automatically when it expires.",
      ].filter(Boolean),
      footer: "Pulse — Roles",
    });
  }

  async function autocompleteTempDuration({ interaction }) {
    const focused = String(interaction.options.getFocused() ?? "").toLowerCase();
    const matches = TEMP_PRESETS.filter(
      (p) => p.name.toLowerCase().includes(focused) || p.value.startsWith(focused),
    );
    const choices = [];
    const custom = focused && parseDuration(focused);
    if (custom && custom <= TEMP_MAX_MINUTES && !matches.some((m) => m.value === focused)) {
      choices.push({ name: `${humaniseMinutes(custom)} (${focused})`, value: focused });
    }
    choices.push(...matches);
    await interaction.respond(choices.slice(0, 25));
  }

  // ── /role info ─────────────────────────────────────────────────────────────

  async function handleInfo({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const role = interaction.options.getRole("role", true);
    // A role fetched from options is a partial in some cases; resolve the live
    // one so member counts and permissions are accurate.
    const live = guild.roles.cache.get(role.id) ?? (await guild.roles.fetch(role.id).catch(() => null));
    if (!live) return editNotice(interaction, "That role no longer exists.");

    const { category, reason } = categorizeRole(live);
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("roles", colorHex);

    const keyPerms = MANAGEMENT_PERMISSIONS.filter((p) => live.permissions.has(p.flag));
    const created = new Date(live.createdTimestamp);

    const body = [];
    body.push(
      text(
        [
          `**Category** — ${CATEGORY_META[category].label}`,
          `**Members** — ${live.members.size.toLocaleString()}`,
          `**Position** — ${live.position} of ${guild.roles.cache.size - 1}`,
          `**Colour** — ${live.hexColor === "#000000" ? "None" : live.hexColor}`,
          `**Created** — ${absTime(created)}`,
          `**Mentionable** — ${live.mentionable ? "Yes" : "No"}`,
          `**Hoisted** — ${live.hoist ? "Yes" : "No"}`,
          `**Managed** — ${live.managed ? "Yes, by an integration" : "No"}`,
        ].join("\n"),
      ),
    );
    body.push(divider());
    body.push(text(`-# ${reason}`));
    if (keyPerms.length > 0) {
      body.push(
        text(`**Privileged permissions**\n${keyPerms.map((p) => `\`${p.name}\``).join(" ")}`),
      );
    }

    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title: live.name,
          subtitle: `Pulse — ${guild.name}`,
          body,
          footer: "Pulse — Roles",
        }),
      ],
      files: icon ? [icon] : [],
    });
  }

  // ── /role hierarchy ────────────────────────────────────────────────────────

  async function handleHierarchy({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    await guild.roles.fetch().catch(() => null);
    const roles = [...guild.roles.cache.values()]
      .filter((r) => r.id !== guild.id) // drop @everyone
      .sort((a, b) => b.position - a.position);

    if (roles.length === 0) {
      return editNotice(interaction, "This server has no roles yet.");
    }

    const grouped = { management: [], bots: [], community: [] };
    for (const r of roles) grouped[categorizeRole(r).category].push(r);

    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("roles", colorHex);
    const botTop = botHighestPosition(guild);

    const body = [];
    body.push(
      text(
        `**Roles** — ${roles.length}\n**Management** — ${grouped.management.length}\n**Bots** — ${grouped.bots.length}\n**Community** — ${grouped.community.length}`,
      ),
    );

    for (const cat of CATEGORY_ORDER) {
      const list = grouped[cat];
      if (list.length === 0) continue;
      body.push(divider());
      body.push(text(`**${CATEGORY_META[cat].label}**\n-# ${CATEGORY_META[cat].blurb}`));
      // Highest first, mentions space-separated (they render as pills).
      const shown = list.slice(0, 20);
      body.push(text(shown.map((r) => `<@&${r.id}>`).join(" ")));
      if (list.length > shown.length) {
        body.push(text(`-# and ${list.length - shown.length} more`));
      }
    }

    // Pulse's own position decides what it can hand out, so it's the one fact an
    // admin actually needs from this view.
    body.push(divider());
    const above = roles.filter((r) => r.position >= botTop).length;
    body.push(
      text(
        above === 0
          ? "-# Pulse's role is above every other role — it can manage them all."
          : `-# Pulse sits below ${above} role${above === 1 ? "" : "s"} and can't assign ${above === 1 ? "it" : "them"}. Move Pulse's role higher to change that.`,
      ),
    );

    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title: "Role hierarchy",
          subtitle: `Pulse — ${guild.name}`,
          body,
          footer: "Pulse — Roles",
        }),
      ],
      files: icon ? [icon] : [],
    });
  }

  // ── /selfrole ──────────────────────────────────────────────────────────────
  //
  // A SEPARATE top-level command, not `/role menu` — see the note at the top of
  // this file for why the tier can't vary per subcommand.
  //
  // It points members AT the posted menus rather than re-posting a copy. The
  // menu message already exists in its channel with working `sr:` custom_ids
  // (self-roles.js handles them by menuId regardless of which message they're
  // on), so an ephemeral copy WOULD work — but building one means mirroring
  // `buildMenuContainer` + `menuControls` from lib/self-roles.ts, ~100 lines of
  // pure presentation. That duplicate would drift, and drift on a branded embed
  // is exactly the class of bug this epic has been removing. A jump link costs
  // one click and stays correct for free.

  async function handleSelfRole({ interaction, guild, ephemeral }) {
    // Always invoker-only regardless of the Command Center's setting: this is a
    // personal "where do I pick my roles" answer, and posting a list of links
    // publicly every time someone asks is noise.
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const category = interaction.options.getString("category");
    let query = supabase
      .from("self_role_menus")
      .select("id, title, description, category, channel_id, message_id")
      .eq("guild_id", guild.id)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    if (category) query = query.eq("category", category);

    const { data, error } = await query;
    if (error) {
      console.error(`[Pulse] /selfrole read failed in ${guild.id}:`, error.message);
      return editNotice(interaction, "I couldn't load the role menus. Try again shortly.");
    }

    // A menu with no message_id was never posted (still a draft in practice), so
    // there's nothing to link to — filter rather than offer a dead button.
    const menus = (data ?? []).filter((m) => m.message_id && m.channel_id);
    if (menus.length === 0) {
      return editNotice(
        interaction,
        category
          ? `This server has no active \`${category}\` role menus.`
          : "This server has no self-assign role menus yet. An admin can create one under Server › Roles.",
      );
    }

    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("roles", colorHex);
    const body = [];
    body.push(
      text(
        menus.length === 1
          ? "Here's the role menu you can use."
          : `Here are the ${menus.length} role menus you can use.`,
      ),
    );
    body.push(divider());
    body.push(
      text(
        menus
          .map((m) => {
            const cat = SELF_ROLE_CATEGORY_LABELS[m.category] ?? m.category;
            const desc = m.description ? `\n-# ${m.description}` : "";
            return `**${m.title}** — \`${cat}\` in <#${m.channel_id}>${desc}`;
          })
          .join("\n\n"),
      ),
    );

    // Discord caps an action row at 5 buttons and a message at 5 rows; 25 link
    // buttons is far more than any real server has, and the list above still
    // names every menu regardless.
    const links = menus.slice(0, 25).map((m) => ({
      type: 2,
      style: 5,
      label: m.title.slice(0, 80),
      url: `https://discord.com/channels/${guild.id}/${m.channel_id}/${m.message_id}`,
    }));
    const rows = [];
    for (let i = 0; i < links.length; i += 5) {
      rows.push({ type: 1, components: links.slice(i, i + 5) });
    }
    for (const row of rows) body.push(row);

    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title: "Self-assign roles",
          body,
          footer: "Pulse — Self Roles",
        }),
      ],
      files: icon ? [icon] : [],
    });
  }

  async function autocompleteSelfRoleCategory({ interaction, guild }) {
    const focused = String(interaction.options.getFocused() ?? "").toLowerCase();
    // Only offer categories this server actually has active menus for — a picker
    // full of empty categories is worse than no picker.
    const { data } = await supabase
      .from("self_role_menus")
      .select("category")
      .eq("guild_id", guild.id)
      .eq("status", "active");
    const seen = [...new Set((data ?? []).map((m) => m.category).filter(Boolean))];
    const choices = seen
      .map((c) => ({ name: SELF_ROLE_CATEGORY_LABELS[c] ?? c, value: c }))
      .filter((c) => !focused || c.name.toLowerCase().includes(focused))
      .slice(0, 25);
    await interaction.respond(choices);
  }

  return {
    handleAdd,
    handleRemove,
    handleTemp,
    handleInfo,
    handleHierarchy,
    handleSelfRole,
    autocompleteTempDuration,
    autocompleteSelfRoleCategory,
  };
}

module.exports = {
  createRoles,
  // Exported for tests — the categorisation mirrors lib/role-hierarchy.ts and is
  // the only real logic here.
  categorizeRole,
  CATEGORY_META,
  MANAGEMENT_PERMISSIONS,
  BOT_NAME_KEYWORDS,
  MANAGEMENT_NAME_KEYWORDS,
  TEMP_MAX_MINUTES,
  TEMP_PRESETS,
};
