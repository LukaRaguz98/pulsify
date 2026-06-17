// Private Channels — "join-to-create" temporary voice channels (PULSIFY-50).
//
// When an admin enables Private Channels (Automations > Private Channels), Pulse
// provisions a category + a trigger voice channel (e.g. "Private Channel +").
// When a member joins the trigger, Pulse creates a private voice channel for
// them, moves them in, and (optionally) posts an owner control panel. Empty
// private channels auto-delete after a configurable delay.
//
// Config + active-channel state live in `private_channel_configs` /
// `private_channels`; the dashboard manages the same tables. Defaults, name
// formatting and the `pc:` custom_id scheme MIRROR pulsify-web-app/lib/
// private-channels.ts — keep the two in sync (same discipline as
// commands.js ↔ lib/commands.ts and tickets.js ↔ lib/tickets.ts).

const {
  Events,
  MessageFlags,
  PermissionFlagsBits,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");
const { recordNotification } = require("./notifications");
const {
  buildPulseContainer,
  getPulseColor,
  replyNotice,
  text,
  divider,
} = require("./commands");

// ── Shared constants (mirror lib/private-channels.ts) ───────────────────────
const PC = "pc";
const SWEEP_MS = 30 * 1000; // empty-channel + reconcile sweep cadence
const DEFAULTS = {
  category_name: "Private Channels",
  trigger_name: "Create Channel",
  name_format: "{display}'s Channel",
  channel_type: "voice",
  user_limit: 0,
  default_locked: false,
  auto_delete: true,
  auto_delete_delay: 60,
  per_user_limit: 1,
  allow_owner_management: true,
};
const NAME_MAX = 100;

const num = (v, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : fallback;
};

/** Mirror of lib/private-channels.ts formatPrivateChannelName. */
function formatPrivateChannelName(format, ctx) {
  const display = ctx.display || ctx.username || "Member";
  const raw = String(format || DEFAULTS.name_format)
    .replace(/\{username\}/g, ctx.username || "member")
    .replace(/\{display\}/g, display)
    .trim();
  return (raw || `${display}'s Channel`).slice(0, NAME_MAX);
}

/** Apply defaults to a raw private_channel_configs row. */
function normaliseConfig(row) {
  return {
    guild_id: row.guild_id,
    enabled: Boolean(row.enabled),
    category_name: (row.category_name || DEFAULTS.category_name).slice(0, NAME_MAX),
    trigger_name: (row.trigger_name || DEFAULTS.trigger_name).slice(0, NAME_MAX),
    name_format: (row.name_format || DEFAULTS.name_format).slice(0, NAME_MAX),
    channel_type: "voice",
    user_limit: Math.min(99, Math.max(0, num(row.user_limit, DEFAULTS.user_limit))),
    default_locked: Boolean(row.default_locked ?? DEFAULTS.default_locked),
    auto_delete: Boolean(row.auto_delete ?? DEFAULTS.auto_delete),
    auto_delete_delay: Math.min(3600, Math.max(10, num(row.auto_delete_delay, DEFAULTS.auto_delete_delay))),
    allowed_role_ids: Array.isArray(row.allowed_role_ids) ? row.allowed_role_ids.map(String) : [],
    ignored_role_ids: Array.isArray(row.ignored_role_ids) ? row.ignored_role_ids.map(String) : [],
    per_user_limit: Math.min(25, Math.max(0, num(row.per_user_limit, DEFAULTS.per_user_limit))),
    allow_owner_management: Boolean(row.allow_owner_management ?? DEFAULTS.allow_owner_management),
    category_id: row.category_id ?? null,
    trigger_channel_id: row.trigger_channel_id ?? null,
  };
}

function createPrivateChannels(client, supabase) {
  // guild_id -> normalised config
  const configCache = new Map();
  // channel_id -> { rowId, guildId, ownerId } for LIVE private channels
  const tracked = new Map();
  // guild_id -> Promise, so concurrent provisioning calls don't race-create
  const provisioning = new Map();
  let sweepTimer = null;

  // ── V2 helpers ─────────────────────────────────────────────────────────────

  async function accentFor(guildId) {
    return getPulseColor(supabase, guildId);
  }

  // ── Persistence / cache ──────────────────────────────────────────────────--

  async function reload() {
    const { data: configs, error } = await supabase.from("private_channel_configs").select("*");
    if (error) {
      console.warn("[Pulse] private_channel_configs load failed:", error.message);
    } else {
      configCache.clear();
      for (const row of configs ?? []) configCache.set(row.guild_id, normaliseConfig(row));
    }

    const { data: live } = await supabase
      .from("private_channels")
      .select("id, guild_id, channel_id, owner_id");
    tracked.clear();
    for (const r of live ?? []) {
      if (r.channel_id) tracked.set(r.channel_id, { rowId: r.id, guildId: r.guild_id, ownerId: r.owner_id });
    }
    console.log(`[Pulse] Loaded private-channel config for ${configCache.size} guild(s), ${tracked.size} active channel(s).`);
  }

  function subscribe() {
    supabase
      .channel("private-channel-configs")
      .on("postgres_changes", { event: "*", schema: "public", table: "private_channel_configs" }, (payload) => {
        if (payload.eventType === "DELETE") {
          if (payload.old?.guild_id) configCache.delete(payload.old.guild_id);
          return;
        }
        if (!payload.new) return;
        const config = normaliseConfig(payload.new);
        configCache.set(config.guild_id, config);
        // A save that enables (or re-saves an enabled) feature provisions live.
        if (config.enabled) {
          const guild = client.guilds.cache.get(config.guild_id);
          if (guild) void ensureProvisioned(guild, config);
        }
      })
      .subscribe();

    // Keep the live-channel map in step with dashboard-side deletes.
    supabase
      .channel("private-channels-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "private_channels" }, (payload) => {
        if (payload.eventType === "DELETE") {
          const ch = payload.old?.channel_id;
          if (ch) tracked.delete(ch);
          return;
        }
        const row = payload.new;
        if (row?.channel_id) tracked.set(row.channel_id, { rowId: row.id, guildId: row.guild_id, ownerId: row.owner_id });
      })
      .subscribe();
  }

  // ── Provisioning (category + trigger channel) ────────────────────────────--

  /**
   * Resolve a stored channel id to a LIVE channel of the expected type, forcing
   * an API fetch so we never trust a stale gateway cache. Returns null when the
   * channel is gone. This matters because the dashboard now provisions the
   * category/trigger directly over REST: when we then react to the config
   * update, a force-fetch confirms the just-created channel exists (cache may
   * not have it yet) so we don't create a duplicate, and it also lets us detect
   * a channel that was deleted while we missed the gateway event.
   */
  async function resolveExisting(guild, id, type) {
    if (!id) return null;
    const ch = await guild.channels.fetch(id, { force: true }).catch(() => null);
    return ch && ch.type === type ? ch : null;
  }

  /**
   * Make sure the configured category + trigger voice channel exist for a guild,
   * creating whichever is missing and persisting the resulting IDs. Serialised
   * per-guild so a burst of saves/sweeps can't create duplicates.
   */
  function ensureProvisioned(guild, config) {
    if (provisioning.has(guild.id)) return provisioning.get(guild.id);
    const job = (async () => {
      try {
        const me = guild.members.me;
        if (!me?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
          await notifyPermissionGap(guild, "Manage Channels");
          return;
        }

        let categoryId = config.category_id;
        let category = await resolveExisting(guild, categoryId, ChannelType.GuildCategory);
        if (!category) {
          category = await guild.channels.create({
            name: config.category_name.slice(0, NAME_MAX),
            type: ChannelType.GuildCategory,
          });
          categoryId = category.id;
        }

        let triggerId = config.trigger_channel_id;
        let trigger = await resolveExisting(guild, triggerId, ChannelType.GuildVoice);
        if (!trigger) {
          trigger = await guild.channels.create({
            name: config.trigger_name.slice(0, NAME_MAX),
            type: ChannelType.GuildVoice,
            parent: categoryId,
          });
          triggerId = trigger.id;
        }

        if (categoryId !== config.category_id || triggerId !== config.trigger_channel_id) {
          config.category_id = categoryId;
          config.trigger_channel_id = triggerId;
          configCache.set(guild.id, config);
          await supabase
            .from("private_channel_configs")
            .update({ category_id: categoryId, trigger_channel_id: triggerId, updated_at: new Date().toISOString() })
            .eq("guild_id", guild.id);
        }
      } catch (err) {
        console.warn(`[Pulse] private-channel provisioning failed in ${guild.id}:`, err.message);
        await notifyPermissionGap(guild, "Manage Channels").catch(() => {});
      } finally {
        provisioning.delete(guild.id);
      }
    })();
    provisioning.set(guild.id, job);
    return job;
  }

  async function notifyPermissionGap(guild, permName) {
    await recordNotification(supabase, {
      guildId: guild.id,
      type: "bot_error",
      title: "Private Channels needs a permission",
      body: `Pulse is missing the “${permName}” permission and couldn't set up Private Channels.`,
      link: `/dashboard/${guild.id}/automations`,
    }).catch(() => {});
  }

  // ── Private channel creation ───────────────────────────────────────────────

  function buildOverwrites(guild, config, ownerId, locked) {
    const overwrites = [
      {
        id: ownerId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
          PermissionFlagsBits.Stream,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.MoveMembers,
        ],
      },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.MoveMembers,
        ],
      },
    ];
    if (locked) {
      overwrites.push({ id: guild.id, deny: [PermissionFlagsBits.Connect] });
    }
    for (const rid of config.allowed_role_ids) {
      if (guild.roles.cache.has(rid)) {
        overwrites.push({ id: rid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] });
      }
    }
    return overwrites;
  }

  /** How many live private channels a member currently owns in this guild. */
  function ownedCount(guildId, ownerId) {
    let count = 0;
    for (const entry of tracked.values()) {
      if (entry.guildId === guildId && entry.ownerId === ownerId) count++;
    }
    return count;
  }

  async function createPrivateChannel(guild, config, member) {
    const locked = config.default_locked;
    const name = formatPrivateChannelName(config.name_format, {
      username: member.user.username,
      display: member.displayName,
    });

    let channel;
    try {
      channel = await guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        parent: config.category_id && guild.channels.cache.get(config.category_id)?.type === ChannelType.GuildCategory
          ? config.category_id
          : undefined,
        userLimit: config.user_limit || 0,
        permissionOverwrites: buildOverwrites(guild, config, member.id, locked),
      });
    } catch (err) {
      console.warn(`[Pulse] private channel create failed in ${guild.id}:`, err.message);
      await notifyPermissionGap(guild, "Manage Channels");
      return;
    }

    // Move the member into their new channel (best-effort — needs Move Members).
    await member.voice.setChannel(channel).catch((e) => {
      console.warn("[Pulse] move into private channel failed:", e.message);
    });

    const { data: inserted, error } = await supabase
      .from("private_channels")
      .insert({
        guild_id: guild.id,
        channel_id: channel.id,
        owner_id: member.id,
        owner_name: member.displayName ?? member.user.username,
        name,
        channel_type: "voice",
        locked,
        user_limit: config.user_limit || 0,
      })
      .select("id")
      .single();
    if (error) {
      console.warn("[Pulse] private_channels insert failed:", error.message);
    } else {
      tracked.set(channel.id, { rowId: inserted.id, guildId: guild.id, ownerId: member.id });
    }

    if (config.allow_owner_management) {
      const colorHex = await accentFor(guild.id);
      await channel
        .send({
          flags: MessageFlags.IsComponentsV2,
          components: [await controlPanel(guild.id, channel, { owner_id: member.id, locked, user_limit: config.user_limit || 0, name }, colorHex)],
          allowedMentions: { parse: [] },
        })
        .catch((e) => console.warn("[Pulse] control panel send failed:", e.message));
    }
  }

  // ── Owner control panel ──────────────────────────────────────────────────--

  function panelButton(action, label, channelId, style = 2) {
    return { type: 2, style, label, custom_id: `${PC}:${action}:${channelId}` };
  }

  async function controlPanel(guildId, channel, row, colorHex) {
    const cHex = colorHex ?? (await accentFor(guildId));
    const body = [
      text(`Owner — <@${row.owner_id}>`),
      text(
        `-# Status — ${row.locked ? "Locked (others can't join)" : "Unlocked (open to join)"}` +
          ` — Limit — ${row.user_limit ? `${row.user_limit}` : "unlimited"}`,
      ),
      divider(),
      text("-# Use the buttons below to manage your channel. Only you (and server staff) can use them."),
    ];
    const rowA = {
      type: 1,
      components: [
        panelButton("rename", "Rename", channel.id),
        panelButton(row.locked ? "unlock" : "lock", row.locked ? "Unlock" : "Lock", channel.id),
        panelButton("limit", "Set Limit", channel.id),
        panelButton("delete", "Delete", channel.id, 4),
      ],
    };
    const rowB = {
      type: 1,
      components: [
        panelButton("invite", "Invite", channel.id),
        panelButton("remove", "Remove", channel.id),
        panelButton("transfer", "Transfer", channel.id),
      ],
    };
    return buildPulseContainer({
      colorHex: cHex,
      title: "Private Channel",
      subtitle: row.name || channel.name,
      body,
      footer: "Pulse — Private Channels",
      actions: [rowA, rowB],
    });
  }

  // ── Voice + channel event hooks (called from index.js) ──────────────────────

  async function onVoiceStateUpdate(oldState, newState) {
    try {
      const guild = newState.guild ?? oldState.guild;
      if (!guild) return;
      const member = newState.member ?? oldState.member;
      if (member?.user?.bot) return;

      // Cleanup: if they left a tracked channel, refresh its empty-state.
      if (oldState.channelId && oldState.channelId !== newState.channelId && tracked.has(oldState.channelId)) {
        await refreshEmptiness(guild, oldState.channelId);
      }

      // Create: joining the trigger channel.
      const config = configCache.get(guild.id);
      if (!config?.enabled || !config.trigger_channel_id) return;
      if (newState.channelId !== config.trigger_channel_id) return;

      // Role gates.
      const roleIds = new Set(member.roles.cache.keys());
      if (config.ignored_role_ids.some((r) => roleIds.has(r))) return;
      if (config.allowed_role_ids.length > 0 && !config.allowed_role_ids.some((r) => roleIds.has(r))) return;

      // Per-user cap (0 = unlimited).
      if (config.per_user_limit > 0 && ownedCount(guild.id, member.id) >= config.per_user_limit) return;

      await createPrivateChannel(guild, config, member);
    } catch (err) {
      console.warn("[Pulse] onVoiceStateUpdate (private channels) failed:", err.message);
    }
  }

  /** Stamp empty_since when a tracked channel has no human members, clear it otherwise. */
  async function refreshEmptiness(guild, channelId) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) return;
    const humans = channel.members?.filter((m) => !m.user.bot).size ?? 0;
    await supabase
      .from("private_channels")
      .update({ empty_since: humans === 0 ? new Date().toISOString() : null })
      .eq("channel_id", channelId)
      .then(() => {});
  }

  async function onChannelDelete(channel) {
    try {
      if (!channel?.guild) return;
      // A tracked private channel was deleted (Discord-side or dashboard) — drop it.
      if (tracked.has(channel.id)) {
        tracked.delete(channel.id);
        await supabase.from("private_channels").delete().eq("channel_id", channel.id);
        return;
      }
      // The category or trigger was deleted — clear the stored id so the sweep recreates it.
      const config = configCache.get(channel.guild.id);
      if (!config) return;
      if (channel.id === config.trigger_channel_id) {
        config.trigger_channel_id = null;
        await supabase.from("private_channel_configs").update({ trigger_channel_id: null }).eq("guild_id", channel.guild.id);
      } else if (channel.id === config.category_id) {
        config.category_id = null;
        await supabase.from("private_channel_configs").update({ category_id: null }).eq("guild_id", channel.guild.id);
      }
    } catch (err) {
      console.warn("[Pulse] onChannelDelete (private channels) failed:", err.message);
    }
  }

  // ── Sweep: delete empty channels, reconcile, recreate trigger ────────────────

  async function sweep() {
    // Recreate missing category/trigger for every enabled guild.
    for (const config of configCache.values()) {
      if (!config.enabled) continue;
      const guild = client.guilds.cache.get(config.guild_id);
      if (!guild) continue;
      const category = config.category_id ? guild.channels.cache.get(config.category_id) : null;
      const trigger = config.trigger_channel_id ? guild.channels.cache.get(config.trigger_channel_id) : null;
      if (!category || !trigger) void ensureProvisioned(guild, config);
    }

    // Walk live private channels: reconcile vanished ones + delete due-empty ones.
    const { data: rows } = await supabase
      .from("private_channels")
      .select("id, guild_id, channel_id, empty_since");
    const now = Date.now();
    for (const row of rows ?? []) {
      const guild = client.guilds.cache.get(row.guild_id);
      const channel = guild?.channels.cache.get(row.channel_id);
      if (!guild || !channel) {
        tracked.delete(row.channel_id);
        await supabase.from("private_channels").delete().eq("id", row.id);
        continue;
      }
      const config = configCache.get(row.guild_id);
      const humans = channel.members?.filter((m) => !m.user.bot).size ?? 0;
      if (humans > 0) {
        if (row.empty_since) await supabase.from("private_channels").update({ empty_since: null }).eq("id", row.id);
        continue;
      }
      // Empty: stamp the moment it became empty, then delete once past the delay.
      if (!config?.auto_delete) continue;
      const since = row.empty_since ? new Date(row.empty_since).getTime() : null;
      if (since === null) {
        await supabase.from("private_channels").update({ empty_since: new Date().toISOString() }).eq("id", row.id);
        continue;
      }
      if (now - since >= config.auto_delete_delay * 1000) {
        tracked.delete(row.channel_id);
        await channel.delete("Private channel empty — auto-cleanup").catch(() => {});
        await supabase.from("private_channels").delete().eq("id", row.id);
      }
    }
  }

  // ── Interaction routing (our own listener; index.js handles chat-input) ──────

  function ownedEntry(interaction, channelId) {
    const entry = tracked.get(channelId);
    if (!entry) return null;
    const config = configCache.get(entry.guildId);
    if (!config?.allow_owner_management) return null;
    const isOwner = interaction.user.id === entry.ownerId;
    const isStaff = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
    if (!isOwner && !isStaff) return { denied: true };
    return { entry, config };
  }

  function userSelectReply(interaction, action, channelId, placeholder) {
    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: placeholder,
      components: [
        {
          type: 1,
          components: [
            { type: 5, custom_id: `${PC}:${action}:${channelId}`, placeholder, min_values: 1, max_values: 10 },
          ],
        },
      ],
    });
  }

  async function refreshPanelMessage(interaction, channelId) {
    const entry = tracked.get(channelId);
    if (!entry) return;
    const { data: row } = await supabase
      .from("private_channels")
      .select("owner_id, name, locked, user_limit")
      .eq("channel_id", channelId)
      .maybeSingle();
    if (!row) return;
    const panel = await controlPanel(entry.guildId, interaction.channel, row);
    await interaction.message.edit({ flags: MessageFlags.IsComponentsV2, components: [panel] }).catch(() => {});
  }

  async function onInteraction(interaction) {
    try {
      const id = interaction.customId ?? "";
      if (!id.startsWith(`${PC}:`)) return;
      const [, action, channelId] = id.split(":");

      // Modals first (they carry their own values).
      if (interaction.isModalSubmit?.()) {
        const owned = ownedEntry(interaction, channelId);
        if (!owned || owned.denied) return replyNotice(interaction, "Only the channel owner can do that.");
        const channel = interaction.guild?.channels.cache.get(channelId);
        if (!channel) return replyNotice(interaction, "That channel no longer exists.");
        if (action === "rename_modal") {
          const value = (interaction.fields.getTextInputValue("name") || "").trim().slice(0, NAME_MAX);
          if (!value) return replyNotice(interaction, "Enter a channel name.");
          await channel.setName(value).catch(() => {});
          await supabase.from("private_channels").update({ name: value }).eq("channel_id", channelId);
          return replyNotice(interaction, `Renamed to **${value}**.`);
        }
        if (action === "limit_modal") {
          const raw = (interaction.fields.getTextInputValue("limit") || "").trim();
          const limit = Math.min(99, Math.max(0, num(raw, 0)));
          await channel.setUserLimit(limit).catch(() => {});
          await supabase.from("private_channels").update({ user_limit: limit }).eq("channel_id", channelId);
          return replyNotice(interaction, limit === 0 ? "User limit removed." : `User limit set to **${limit}**.`);
        }
        return;
      }

      // User selects (invite / remove / transfer).
      if (interaction.isUserSelectMenu?.()) {
        const owned = ownedEntry(interaction, channelId);
        if (!owned || owned.denied) return replyNotice(interaction, "Only the channel owner can do that.");
        const channel = interaction.guild?.channels.cache.get(channelId);
        if (!channel) return replyNotice(interaction, "That channel no longer exists.");
        const ids = interaction.values ?? [];
        if (action === "invite_sel") {
          for (const uid of ids) {
            await channel.permissionOverwrites
              .edit(uid, { ViewChannel: true, Connect: true })
              .catch(() => {});
          }
          return interaction.update({ content: `Invited ${ids.map((u) => `<@${u}>`).join(", ")}.`, components: [] });
        }
        if (action === "remove_sel") {
          for (const uid of ids) {
            if (uid === owned.entry.ownerId) continue;
            await channel.permissionOverwrites.delete(uid).catch(() => {});
            const m = interaction.guild.members.cache.get(uid);
            if (m?.voice?.channelId === channelId) await m.voice.disconnect().catch(() => {});
          }
          return interaction.update({ content: `Removed ${ids.map((u) => `<@${u}>`).join(", ")}.`, components: [] });
        }
        if (action === "transfer_sel") {
          const newOwner = ids[0];
          if (!newOwner) return interaction.update({ content: "No member selected.", components: [] });
          await channel.permissionOverwrites
            .edit(newOwner, {
              ViewChannel: true,
              Connect: true,
              ManageChannels: true,
              MoveMembers: true,
            })
            .catch(() => {});
          await supabase
            .from("private_channels")
            .update({ owner_id: newOwner, owner_name: interaction.guild.members.cache.get(newOwner)?.displayName ?? null })
            .eq("channel_id", channelId);
          const entry = tracked.get(channelId);
          if (entry) entry.ownerId = newOwner;
          return interaction.update({ content: `Ownership transferred to <@${newOwner}>.`, components: [] });
        }
        return;
      }

      // Buttons.
      if (interaction.isButton?.()) {
        const owned = ownedEntry(interaction, channelId);
        if (!owned) return replyNotice(interaction, "This isn't a managed private channel.");
        if (owned.denied) return replyNotice(interaction, "Only the channel owner (or server staff) can manage this channel.");
        const channel = interaction.guild?.channels.cache.get(channelId);
        if (!channel) return replyNotice(interaction, "That channel no longer exists.");

        if (action === "rename") {
          const modal = new ModalBuilder().setCustomId(`${PC}:rename_modal:${channelId}`).setTitle("Rename channel");
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("name")
                .setLabel("New channel name")
                .setStyle(TextInputStyle.Short)
                .setMaxLength(NAME_MAX)
                .setRequired(true),
            ),
          );
          return interaction.showModal(modal);
        }
        if (action === "limit") {
          const modal = new ModalBuilder().setCustomId(`${PC}:limit_modal:${channelId}`).setTitle("Set user limit");
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("limit")
                .setLabel("User limit (0 = unlimited, max 99)")
                .setStyle(TextInputStyle.Short)
                .setMaxLength(2)
                .setRequired(true),
            ),
          );
          return interaction.showModal(modal);
        }
        if (action === "lock" || action === "unlock") {
          const locked = action === "lock";
          await channel.permissionOverwrites
            .edit(interaction.guild.id, { Connect: locked ? false : null })
            .catch(() => {});
          await supabase.from("private_channels").update({ locked }).eq("channel_id", channelId);
          await refreshPanelMessage(interaction, channelId);
          return replyNotice(interaction, locked ? "Channel locked — others can't join." : "Channel unlocked — open to join.");
        }
        if (action === "delete") {
          tracked.delete(channelId);
          await supabase.from("private_channels").delete().eq("channel_id", channelId);
          await channel.delete("Private channel deleted by owner").catch(() => {});
          return; // channel (and this message) are gone
        }
        if (action === "invite") return userSelectReply(interaction, "invite_sel", channelId, "Select members to invite");
        if (action === "remove") return userSelectReply(interaction, "remove_sel", channelId, "Select members to remove");
        if (action === "transfer") return userSelectReply(interaction, "transfer_sel", channelId, "Select the new owner");
      }
    } catch (err) {
      console.error("[Pulse] Private-channel interaction failed:", err.message);
      if (interaction && !interaction.replied && !interaction.deferred) {
        await replyNotice(interaction, "Something went wrong handling that.").catch(() => {});
      }
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────--

  async function start() {
    await reload();
    subscribe();
    client.on(Events.InteractionCreate, onInteraction);
    // Provision any guild that already has the feature enabled.
    for (const config of configCache.values()) {
      if (!config.enabled) continue;
      const guild = client.guilds.cache.get(config.guild_id);
      if (guild) void ensureProvisioned(guild, config);
    }
    sweepTimer = setInterval(() => void sweep().catch(() => {}), SWEEP_MS);
    console.log("[Pulse] Private Channels started.");
  }

  function stop() {
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
  }

  return { start, stop, onVoiceStateUpdate, onChannelDelete };
}

module.exports = { createPrivateChannels, formatPrivateChannelName, normaliseConfig };
