// Member-facing Onboarding & Welcome (PULSIFY-37).
//
// Two-writer pattern, like giveaways/milestones:
//   • DASHBOARD owns the config (guild_settings.settings.member_onboarding) and
//     reads analytics off onboarding_member_progress.
//   • BOT (this module) delivers the experience: on join it posts the Pulse v2
//     welcome embed plus an interactive panel (self-role select menus by
//     category, a verify button, event + community highlights and a finish
//     button). It owns completion — granting XP / starter roles / a reputation
//     bonus exactly once — and records per-member progress for analytics.
//
// All onboarding component custom ids embed the guild id
// (`ob:<action>:<guildId>[:<arg>]`) so interactions resolve correctly whether
// the panel was posted to a channel or to the member's DMs.

const { Events, MessageFlags } = require("discord.js");
const {
  replyNotice,
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  text,
  divider,
} = require("./commands");
const { getGuildAccentHex } = require("./guild-accent");
const { isModerator } = require("./permissions");
const { getDashboardUrl } = require("./version");

const OB = "ob";
const BRAND = 0x6366f1;
// Braille-blank width pin — keeps a consistent embed width (see embed-style).
// It rides on the footer line rather than a spacer of its own: a TextDisplay is
// a block, so a standalone spacer costs a full empty line right under the title.
const WIDTH_TARGET = 44;
const padToWidth = (s) => s + "⠀".repeat(Math.max(0, WIDTH_TARGET - [...s].length));
// Keep within Discord's component limits: cap interactive role menus.
const MAX_ROLE_MENUS = 4;

const COMMUNITY_META = {
  general: { label: "General Chat" },
  introductions: { label: "Introductions" },
  music: { label: "Music" },
  commands: { label: "Bot Commands" },
  support: { label: "Support" },
  announcements: { label: "Announcements" },
};
const COMMUNITY_ORDER = [
  "general",
  "introductions",
  "music",
  "commands",
  "support",
  "announcements",
];

function colorInt(hex) {
  const n = parseInt(String(hex ?? "").replace("#", ""), 16);
  return Number.isNaN(n) ? BRAND : n;
}

/** A usable custom banner URL (http/https) or null — fall back to the
 *  auto-generated banner. */
function bannerUrl(w) {
  const u = String(w?.banner_url ?? "").trim();
  return /^https?:\/\//i.test(u) ? u : null;
}

/** Discord component emoji object from a stored string (unicode or <:name:id>). */
function toEmoji(raw) {
  if (!raw) return undefined;
  const custom = /^<a?:(\w+):(\d+)>$/.exec(raw.trim());
  if (custom)
    return { name: custom[1], id: custom[2], animated: raw.startsWith("<a:") };
  return { name: raw.trim() };
}

function createOnboarding(client, supabase, leveling = null, economyRewards = null) {
  // ── Config + progress helpers ───────────────────────────────────────────────

  async function getConfig(guildId) {
    const { data } = await supabase
      .from("guild_settings")
      .select("settings")
      .eq("guild_id", guildId)
      .maybeSingle();
    const mo = data?.settings?.member_onboarding;
    return mo && mo.enabled ? mo : null;
  }

  async function readProgress(guildId, userId) {
    const { data } = await supabase
      .from("onboarding_member_progress")
      .select("*")
      .eq("guild_id", guildId)
      .eq("user_id", userId)
      .maybeSingle();
    return data ?? null;
  }

  // ── Panel construction ──────────────────────────────────────────────────────

  function welcomeHeader(cfg, member, resolve) {
    const w = cfg.welcome;
    const lines = [{ type: 10, content: "**Pulse**" }];
    const title = resolve(w.title ?? "");
    if (title) lines.push({ type: 10, content: `# ${title}` });
    const desc = resolve(w.description ?? "");
    if (desc) lines.push({ type: 10, content: desc });

    // Thumbnail (member avatar / server icon) via a Section accessory.
    let thumbUrl = null;
    if (w.thumbnail === "member_avatar")
      thumbUrl = member.displayAvatarURL({ extension: "png", size: 128 });
    else if (w.thumbnail === "guild_icon")
      thumbUrl = member.guild.iconURL({ extension: "png", size: 128 });

    if (thumbUrl) {
      return [
        {
          type: 9,
          components: lines,
          accessory: { type: 11, media: { url: thumbUrl } },
        },
      ];
    }
    // No thumbnail and no banner — the footer carries the width pin instead
    // (see the footer block in buildPanel).
    return lines;
  }

  /** Build the full panel container + any attachments. `accent` is the guild's
   *  global embed colour (Server Settings › Embed Appearance) — the single
   *  source of truth for every Pulse embed, applied here too. */
  function buildPanel(cfg, member, events, accent) {
    const w = cfg.welcome;
    const resolve = (t) =>
      String(t ?? "")
        .replace(/\{user\}/g, member.toString())
        .replace(/\{server\}/g, member.guild.name);

    const guildId = member.guild.id;
    const components = [...welcomeHeader(cfg, member, resolve)];

    // Quick links (channel shortcuts) as a tidy list.
    const quickLinks = (w.quick_links ?? []).filter(
      (q) => q.label && q.channel_id,
    );
    if (quickLinks.length > 0) {
      components.push({
        type: 10,
        content: quickLinks
          .map((q) => `→ <#${q.channel_id}> — ${q.label}`)
          .join("\n"),
      });
    }

    // Banner image (full width). A custom URL is used directly; otherwise the
    // generated banner.png attachment is referenced.
    if (w.banner) {
      components.push({
        type: 12,
        items: [{ media: { url: bannerUrl(w) ?? "attachment://banner.png" } }],
      });
    }

    const enabledSteps = (cfg.steps ?? [])
      .filter((s) => s.enabled)
      .map((s) => s.id);
    let roleMenus = 0;

    for (const step of enabledSteps) {
      if (step === "roles") {
        for (const cat of cfg.roleCategories ?? []) {
          const roles = (cat.roles ?? []).filter((r) => r.role_id);
          if (roles.length === 0) continue;
          if (roleMenus >= MAX_ROLE_MENUS) break;
          roleMenus += 1;
          const options = roles.slice(0, 25).map((r) => {
            const o = {
              label: (r.label || r.role_id).slice(0, 100),
              value: r.role_id,
            };
            if (r.description) o.description = r.description.slice(0, 100);
            const e = toEmoji(r.emoji);
            if (e) o.emoji = e;
            return o;
          });
          const max =
            cat.max_select > 0
              ? Math.min(cat.max_select, options.length)
              : options.length;
          components.push({ type: 14, divider: true, spacing: 1 });
          components.push({
            type: 10,
            content: `## ${cat.label}${cat.description ? `\n-# ${cat.description}` : ""}`,
          });
          components.push({
            type: 1,
            components: [
              {
                type: 3,
                custom_id: `${OB}:role:${guildId}:${cat.id}`,
                placeholder: "Choose your roles…",
                min_values: Math.max(
                  0,
                  Math.min(cat.min_select ?? 0, options.length),
                ),
                max_values: Math.max(1, max),
                options,
              },
            ],
          });
        }
      } else if (step === "events" && cfg.events?.enabled) {
        const list = (events ?? []).slice(0, Math.max(1, cfg.events.max ?? 3));
        if (list.length > 0) {
          components.push({ type: 14, divider: true, spacing: 1 });
          const body = list
            .map((e) => {
              const ts = Math.floor(
                new Date(
                  e.scheduledStartAt ?? e.scheduledStartTimestamp ?? Date.now(),
                ).getTime() / 1000,
              );
              return `> **${e.name}**　—　<t:${ts}:R>`;
            })
            .join("\n");
          components.push({
            type: 10,
            content: `## Upcoming events\n${body}`,
          });
        }
      } else if (step === "community") {
        const links = COMMUNITY_ORDER.filter((k) => cfg.community?.[k]).map(
          (k) => `> <#${cfg.community[k]}>　**${COMMUNITY_META[k].label}**`,
        );
        if (links.length > 0) {
          components.push({ type: 14, divider: true, spacing: 1 });
          components.push({
            type: 10,
            content:
              `## Explore ${member.guild.name}\n` +
              `-# The channels worth knowing before you dive in.\n` +
              links.join("\n"),
          });
        }
      } else if (step === "rewards" && cfg.rewards?.enabled) {
        const parts = [];
        if (cfg.rewards.xp) parts.push(`**${cfg.rewards.xp} XP**`);
        if (cfg.rewards.reputation)
          parts.push(`**${cfg.rewards.reputation} reputation**`);
        if ((cfg.rewards.role_ids ?? []).length)
          parts.push(
            `**${cfg.rewards.role_ids.length} starter role${cfg.rewards.role_ids.length === 1 ? "" : "s"}**`,
          );
        if (parts.length) {
          components.push({ type: 14, divider: true, spacing: 1 });
          components.push({
            type: 10,
            content: `Finish onboarding to earn ${parts.join(" & ")}.`,
          });
        }
      }
    }

    // Action buttons — verify and finish (primary calls to action) followed by
    // any external link buttons, kept in a single continuous sequence so they
    // sit on one row (Discord wraps automatically past 5 buttons).
    const actions = [];
    if (
      enabledSteps.includes("verification") &&
      cfg.verification?.enabled &&
      cfg.verification.role_id
    ) {
      actions.push({
        type: 2,
        style: 3,
        custom_id: `${OB}:verify:${guildId}`,
        label: (cfg.verification.button_label || "Verify me").slice(0, 80),
      });
    }
    const showFinish = cfg.completion_required || cfg.rewards?.enabled;
    if (showFinish) {
      actions.push({
        type: 2,
        style: 1,
        custom_id: `${OB}:done:${guildId}`,
        label: "Finish onboarding",
      });
    }
    for (const b of (w.buttons ?? []).filter((b) => b.label && b.url)) {
      const btn = { type: 2, style: 5, label: b.label.slice(0, 80), url: b.url };
      const e = toEmoji(b.emoji);
      if (e) btn.emoji = e;
      actions.push(btn);
    }
    if (actions.length > 0) {
      components.push({ type: 14, divider: true, spacing: 1 });
      // Up to 5 buttons per action row; one row in the common case.
      for (let i = 0; i < actions.length; i += 5) {
        components.push({ type: 1, components: actions.slice(i, i + 5) });
      }
    }

    // Footer — carries the width pin unless a banner already sets the width.
    const panelFooter = w.footer_text ? resolve(w.footer_text) : "Pulse — Welcome";
    components.push({ type: 14, divider: true, spacing: 1 });
    components.push({
      type: 10,
      content: `-# ${w.banner ? panelFooter : padToWidth(panelFooter)}`,
    });

    const container = { type: 17, accent_color: colorInt(accent), components };

    const payload = {
      flags: MessageFlags.IsComponentsV2,
      components: [container],
    };
    // Only attach the generated banner when no custom URL is supplied.
    if (w.banner && !bannerUrl(w)) {
      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      const bannerColor = String(accent ?? "#6366f1").replace("#", "");
      payload.files = [
        {
          attachment: `${appUrl}/api/banner?name=${encodeURIComponent(member.guild.name)}&color=${bannerColor}`,
          name: "banner.png",
        },
      ];
    }
    return payload;
  }

  // ── Deliver on join ─────────────────────────────────────────────────────────

  /** Post the onboarding panel to a new member. `settings` may be passed to
   *  avoid a re-read; otherwise it's fetched. */
  async function postForMember(member, settings) {
    try {
      const cfg = settings?.member_onboarding?.enabled
        ? settings.member_onboarding
        : await getConfig(member.guild.id);
      if (!cfg) return;

      // Fetch upcoming events only when the events step is on.
      let events = [];
      const eventsOn =
        (cfg.steps ?? []).some((s) => s.id === "events" && s.enabled) &&
        cfg.events?.enabled;
      if (eventsOn) {
        try {
          const all = await member.guild.scheduledEvents.fetch();
          const featured = new Set(cfg.events.featured ?? []);
          events = [...all.values()]
            .filter((e) => e.status === 1 || e.status === 2)
            .sort((a, b) => {
              const fa = featured.has(a.id) ? 0 : 1;
              const fb = featured.has(b.id) ? 0 : 1;
              if (fa !== fb) return fa - fb;
              return (
                (a.scheduledStartTimestamp ?? 0) -
                (b.scheduledStartTimestamp ?? 0)
              );
            });
        } catch {
          events = [];
        }
      }

      const accent = await getGuildAccentHex(supabase, member.guild.id);
      const payload = buildPanel(cfg, member, events, accent);

      if (cfg.delivery === "dm") {
        await member.send(payload).catch(() => {});
      } else {
        const channel = await member.guild.channels
          .fetch(cfg.channel_id)
          .catch(() => null);
        if (channel?.isTextBased()) await channel.send(payload);
      }

      // Record the start (insert-only so re-joins don't reset / double-count).
      await supabase.from("onboarding_member_progress").upsert(
        {
          guild_id: member.guild.id,
          user_id: member.id,
          user_name: member.user.username,
          status: "started",
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "guild_id,user_id", ignoreDuplicates: true },
      );
    } catch (err) {
      console.error(
        `[Pulse] Onboarding post failed in guild ${member.guild.id}:`,
        err.message,
      );
    }
  }

  // ── Interaction handling ────────────────────────────────────────────────────

  async function resolveContext(interaction, guildId) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return null;
    const member = await guild.members
      .fetch(interaction.user.id)
      .catch(() => null);
    if (!member) return null;
    const cfg = await getConfig(guildId);
    if (!cfg) return null;
    return { guild, member, cfg };
  }

  async function handleRole(interaction, guildId, catId) {
    const ctx = await resolveContext(interaction, guildId);
    if (!ctx)
      return replyNotice(interaction, "Onboarding is no longer available.");
    const cat = (ctx.cfg.roleCategories ?? []).find((c) => c.id === catId);
    if (!cat)
      return replyNotice(interaction, "That role group no longer exists.");

    const categoryRoleIds = (cat.roles ?? [])
      .map((r) => r.role_id)
      .filter(Boolean);
    const selected = new Set(interaction.values);
    const toAdd = [...selected].filter((id) => !ctx.member.roles.cache.has(id));
    const toRemove = categoryRoleIds.filter(
      (id) => !selected.has(id) && ctx.member.roles.cache.has(id),
    );

    try {
      if (toAdd.length)
        await ctx.member.roles
          .add(toAdd, "Pulse onboarding self-roles")
          .catch(() => {});
      if (toRemove.length)
        await ctx.member.roles
          .remove(toRemove, "Pulse onboarding self-roles")
          .catch(() => {});
    } catch {
      /* role above the bot / perms — best effort */
    }

    // Persist the union of selected onboarding roles (drop this category's
    // unselected ones, add the new selection).
    const prev = await readProgress(guildId, interaction.user.id);
    const prevSelected = new Set(
      Array.isArray(prev?.selected_roles) ? prev.selected_roles : [],
    );
    const hadRolesBefore = (prev?.selected_roles?.length ?? 0) > 0;
    for (const id of categoryRoleIds) prevSelected.delete(id);
    for (const id of selected) prevSelected.add(id);
    const prevSkipped = (
      Array.isArray(prev?.skipped_steps) ? prev.skipped_steps : []
    ).filter((s) => s !== "roles");

    await supabase.from("onboarding_member_progress").upsert(
      {
        guild_id: guildId,
        user_id: interaction.user.id,
        user_name: ctx.member.user.username,
        selected_roles: [...prevSelected],
        skipped_steps: prevSkipped,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "guild_id,user_id" },
    );

    // First time the member picks any self-role → the "role selection" reward
    // (PULSIFY-47). Fire-and-forget; own anti-abuse inside the rewards engine.
    if (economyRewards?.awardOnboarding && !hadRolesBefore && prevSelected.size > 0) {
      void economyRewards.awardOnboarding(ctx.member.guild, ctx.member, "roleSelection");
    }

    await replyNotice(
      interaction,
      selected.size
        ? `Updated your **${cat.label}** roles.`
        : `Cleared your **${cat.label}** roles.`,
    );
  }

  /**
   * Grant the configured verified role to `member` and record it, exactly once.
   * Shared by the panel's Verify button (handleVerify) and the /verify command
   * (handleVerifyCommand) so a manual verification pays the same reward and logs
   * the same progress as clicking the button. Returns a result rather than
   * replying, so each caller can phrase its own message.
   */
  async function applyVerification(guild, member, cfg) {
    const roleId = cfg.verification?.role_id;
    if (!cfg.verification?.enabled || !roleId) return { ok: false, reason: "disabled" };

    try {
      await member.roles.add(roleId, "Pulse onboarding verification");
    } catch {
      return { ok: false, reason: "perms" };
    }

    const prev = await readProgress(guild.id, member.id);
    const wasVerified = !!prev?.verified;
    const prevSkipped = (
      Array.isArray(prev?.skipped_steps) ? prev.skipped_steps : []
    ).filter((s) => s !== "verification");
    await supabase.from("onboarding_member_progress").upsert(
      {
        guild_id: guild.id,
        user_id: member.id,
        user_name: member.user.username,
        verified: true,
        skipped_steps: prevSkipped,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "guild_id,user_id" },
    );

    // First successful verification → the "verification" reward (PULSIFY-47).
    if (economyRewards?.awardOnboarding && !wasVerified) {
      void economyRewards.awardOnboarding(guild, member, "verification");
    }

    return { ok: true, wasVerified };
  }

  async function handleVerify(interaction, guildId) {
    const ctx = await resolveContext(interaction, guildId);
    if (!ctx)
      return replyNotice(interaction, "Onboarding is no longer available.");
    const res = await applyVerification(ctx.guild, ctx.member, ctx.cfg);
    if (!res.ok) {
      return replyNotice(
        interaction,
        res.reason === "disabled"
          ? "Verification isn't enabled here."
          : "I couldn't assign the verified role — please ping a moderator.",
      );
    }
    await replyNotice(
      interaction,
      ctx.cfg.verification.success_message ||
        "You're **verified** — welcome aboard!",
    );
  }

  async function handleDone(interaction, guildId) {
    const ctx = await resolveContext(interaction, guildId);
    if (!ctx)
      return replyNotice(interaction, "Onboarding is no longer available.");

    const prev = await readProgress(guildId, interaction.user.id);
    if (prev?.rewarded)
      return replyNotice(interaction, "You've already completed onboarding — welcome back!");

    const enabled = (ctx.cfg.steps ?? [])
      .filter((s) => s.enabled)
      .map((s) => s.id);
    const selectedRoles = Array.isArray(prev?.selected_roles)
      ? prev.selected_roles
      : [];
    const verified = !!prev?.verified;

    // A step the member never engaged counts as skipped (roles / verification).
    const skipped = [];
    if (enabled.includes("roles") && selectedRoles.length === 0)
      skipped.push("roles");
    if (
      enabled.includes("verification") &&
      ctx.cfg.verification?.enabled &&
      !verified
    )
      skipped.push("verification");

    // Grant rewards exactly once.
    const rewards = ctx.cfg.rewards ?? {};
    let xpAwarded = 0;
    const rewardLines = [];
    if (rewards.enabled) {
      if (rewards.xp > 0) {
        try {
          const { error } = await supabase.rpc("add_member_xp", {
            p_guild_id: guildId,
            p_user_id: interaction.user.id,
            p_user_name: ctx.member.displayName,
            p_amount: Math.floor(rewards.xp),
          });
          if (!error) {
            xpAwarded = Math.floor(rewards.xp);
            rewardLines.push(`**${xpAwarded} XP**`);
          }
        } catch {
          /* leveling table missing — skip */
        }
      }
      for (const roleId of rewards.role_ids ?? []) {
        await ctx.member.roles
          .add(roleId, "Pulse onboarding completion reward")
          .catch(() => {});
      }
      if ((rewards.role_ids ?? []).length)
        rewardLines.push(
          `**${rewards.role_ids.length} starter role${rewards.role_ids.length === 1 ? "" : "s"}**`,
        );
      if (rewards.reputation > 0)
        rewardLines.push(`**${rewards.reputation} reputation**`);
      // Completion also pays into the GLOBAL coin economy: configurable
      // onboarding-completion coins (PULSIFY-47). Reputation is the computed
      // global trust score, not a grantable value, so it's not awarded here.
      // Fire-and-forget.
      if (economyRewards?.awardOnboarding) {
        void economyRewards.awardOnboarding(ctx.member.guild, ctx.member, "completion");
      }
    }

    await supabase.from("onboarding_member_progress").upsert(
      {
        guild_id: guildId,
        user_id: interaction.user.id,
        user_name: ctx.member.user.username,
        status: "completed",
        verified,
        selected_roles: selectedRoles,
        skipped_steps: skipped,
        rewarded: rewards.enabled === true,
        xp_awarded: xpAwarded,
        reputation_bonus: rewards.enabled
          ? Math.floor(rewards.reputation || 0)
          : 0,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "guild_id,user_id" },
    );

    const msg = rewardLines.length
      ? `Onboarding complete! You earned ${rewardLines.join(" & ")}. Welcome to **${ctx.guild.name}**!`
      : `You're all set — welcome to **${ctx.guild.name}**!`;
    await replyNotice(interaction, msg);
  }

  async function onInteraction(interaction) {
    try {
      const isSelect = interaction.isStringSelectMenu?.();
      const isButton = interaction.isButton?.();
      if (!isSelect && !isButton) return;
      const id = interaction.customId;
      if (!id || !id.startsWith(`${OB}:`)) return;
      const [, action, guildId, arg] = id.split(":");
      if (!guildId) return;
      if (action === "role" && isSelect)
        return handleRole(interaction, guildId, arg);
      if (action === "verify" && isButton)
        return handleVerify(interaction, guildId);
      if (action === "done" && isButton)
        return handleDone(interaction, guildId);
    } catch (err) {
      console.error("[Pulse] Onboarding interaction failed:", err.message);
      if (interaction && !interaction.replied && !interaction.deferred) {
        await replyNotice(interaction, "Something went wrong — try again in a moment.")
          .catch(() => {});
      }
    }
  }

  // ── Slash commands (PULSIFY-61) ─────────────────────────────────────────────

  async function renderEmbed(interaction, guild, iconKey, { title, body, footer, actions, ephemeral }) {
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = iconKey ? await loadPulseIcon(iconKey, colorHex) : null;
    const payload = {
      flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
      components: [
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title,
          subtitle: `Pulse — ${guild.name}`,
          body,
          footer,
          actions: actions ?? [],
        }),
      ],
      files: icon ? [icon] : [],
    };
    if (interaction.replied || interaction.deferred) await interaction.editReply(payload);
    else await interaction.reply(payload);
  }

  /**
   * /verify [user] — grant the configured verified role. On its own it verifies
   * the invoker (same as the panel's Verify button); with a `user` it verifies
   * that member, which is a MODERATOR action (the in-handler check — the command
   * itself is everyone-tier so members can self-verify). `module: null`: the
   * handler gives a precise "not set up" message rather than the generic
   * module-off one, and self-verification is a core member action.
   */
  async function handleVerifyCommand({ interaction, guild, ephemeral }) {
    const cfg = await getConfig(guild.id);
    if (!cfg || !cfg.verification?.enabled || !cfg.verification.role_id) {
      return replyNotice(interaction, "Verification isn't set up in this server.", ephemeral);
    }

    const target = interaction.options.getUser("user");
    const verifyingOther = target && target.id !== interaction.user.id;

    let member;
    if (verifyingOther) {
      if (!isModerator(interaction.member)) {
        return replyNotice(
          interaction,
          "Only moderators can verify other members. Run `/verify` on its own to verify yourself.",
          ephemeral,
        );
      }
      member = await guild.members.fetch(target.id).catch(() => null);
      if (!member) return replyNotice(interaction, "I couldn't find that member.", ephemeral);
    } else {
      member = interaction.member;
    }

    if (member.roles.cache.has(cfg.verification.role_id)) {
      return replyNotice(
        interaction,
        verifyingOther ? `<@${member.id}> is already verified.` : "You're already verified.",
        ephemeral,
      );
    }

    const res = await applyVerification(guild, member, cfg);
    if (!res.ok) {
      return replyNotice(
        interaction,
        res.reason === "disabled"
          ? "Verification isn't set up in this server."
          : "I couldn't assign the verified role — check my role is above it and I have Manage Roles.",
        ephemeral,
      );
    }

    await replyNotice(
      interaction,
      verifyingOther
        ? `Verified <@${member.id}>.`
        : cfg.verification.success_message || "You're **verified** — welcome aboard!",
      ephemeral,
    );
  }

  /**
   * /verification status — whether verification is set up here and whether the
   * invoker is verified. Everyone-tier, module null. The verified role is the
   * source of truth (it can be granted outside onboarding too).
   */
  async function handleVerificationStatus({ interaction, guild, ephemeral }) {
    const cfg = await getConfig(guild.id);
    const roleId = cfg?.verification?.enabled ? cfg.verification.role_id : null;
    if (!roleId) {
      return replyNotice(interaction, "Verification isn't set up in this server.", ephemeral);
    }

    const verified = interaction.member.roles.cache.has(roleId);
    const body = [];
    if (verified) {
      body.push(text(`You're **verified** in ${guild.name}.`));
      body.push(text(`-# Verified role — <@&${roleId}>`));
    } else {
      body.push(text(`You're **not verified** yet.`));
      body.push(
        text(
          "-# Click **Verify** on the welcome panel, or run `/verify`, to get the verified role.",
        ),
      );
    }
    await renderEmbed(interaction, guild, "safety", {
      title: "Verification",
      body,
      footer: "Pulse — Verification",
      ephemeral,
    });
  }

  /**
   * /onboarding resend [user] — re-post the onboarding panel. Moderator-tier,
   * module `onboarding` — so the whole group sits at one tier (a subcommand
   * can't carry its own), and `stats` below is a staff analytics read. Delivered
   * exactly as on join (the configured channel or DM); progress is not reset
   * (postForMember inserts only).
   */
  async function handleResend({ interaction, guild, ephemeral }) {
    const cfg = await getConfig(guild.id);
    if (!cfg) return replyNotice(interaction, "Onboarding isn't set up in this server.", ephemeral);

    const target = interaction.options.getUser("user");
    const member = target
      ? await guild.members.fetch(target.id).catch(() => null)
      : interaction.member;
    if (!member) return replyNotice(interaction, "I couldn't find that member.", ephemeral);

    await postForMember(member, { member_onboarding: cfg });
    const where = cfg.delivery === "dm" ? "by DM" : "in the welcome channel";
    await replyNotice(
      interaction,
      target ? `Re-sent the onboarding panel to <@${member.id}> (${where}).` : `Re-sent your onboarding panel (${where}).`,
      ephemeral,
    );
  }

  /**
   * /onboarding stats — the completion funnel for the whole server. Moderator-
   * tier analytics read (module `onboarding`). Uses head-only count queries so
   * it stays cheap on servers with a lot of history.
   */
  async function handleOnboardingStats({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });

    const base = () => supabase.from("onboarding_member_progress").select("*", { count: "exact", head: true }).eq("guild_id", guild.id);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [startedRes, completedRes, verifiedRes, rewardedRes, recentRes] = await Promise.all([
      base(),
      base().eq("status", "completed"),
      base().eq("verified", true),
      base().eq("rewarded", true),
      base().gte("started_at", weekAgo),
    ]);

    if (startedRes.error) {
      console.error(`[Pulse] /onboarding stats failed in ${guild.id}:`, startedRes.error.message);
      return renderEmbed(interaction, guild, "info", {
        title: "Onboarding",
        body: [text("I couldn't load onboarding stats right now. Try again shortly.")],
        footer: "Pulse — Onboarding",
      });
    }

    const started = startedRes.count ?? 0;
    const completed = completedRes.count ?? 0;
    const verified = verifiedRes.count ?? 0;
    const rewarded = rewardedRes.count ?? 0;
    const recent = recentRes.count ?? 0;
    const rate = started > 0 ? Math.round((completed / started) * 100) : 0;

    const body = [];
    if (started === 0) {
      body.push(text("No members have started onboarding yet."));
      body.push(text("-# Members enter onboarding when they join while it's enabled."));
    } else {
      body.push(text(`Onboarding funnel for ${guild.name}.`));
      body.push(divider());
      body.push(
        text(
          [
            `**Members onboarded** — ${started.toLocaleString()}`,
            `**Completed** — ${completed.toLocaleString()} (${rate}%)`,
            `**Verified** — ${verified.toLocaleString()}`,
            `**Rewards granted** — ${rewarded.toLocaleString()}`,
          ].join("\n"),
        ),
      );
      body.push(text(`-# ${recent.toLocaleString()} new in the last 7 days`));
    }

    await renderEmbed(interaction, guild, "info", {
      title: "Onboarding",
      body,
      footer: "Pulse — Onboarding",
      actions: [
        {
          type: 1,
          components: [{ type: 2, style: 5, label: "Open Onboarding", url: `${getDashboardUrl(guild.id)}/onboarding` }],
        },
      ],
    });
  }

  function start() {
    client.on(Events.InteractionCreate, onInteraction);
    console.log("[Pulse] Onboarding system started.");
  }

  return {
    start,
    postForMember,
    handleVerifyCommand,
    handleVerificationStatus,
    handleResend,
    handleOnboardingStats,
  };
}

module.exports = { createOnboarding };
