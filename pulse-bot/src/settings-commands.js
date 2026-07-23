// Server Settings & Assets commands — bot side (PULSIFY-61).
//
// /serversettings view                         (admin)
// /emoji list|info · /sticker list|info · /soundboard list|info   (everyone)
// /statchannel refresh                         (moderator)
//
// All `module: null`. These are read-only windows onto the server's Pulse
// configuration and its Discord expressions, plus one operational nudge
// (statchannel refresh). Assets are read straight off the gateway cache
// (guild.emojis / guild.stickers / guild.soundboardSounds) — no DB, mirroring
// the dashboard's Assets page which reads them over Discord REST.
//
// NOTE — /presence is deliberately NOT here. The plan pencilled in
// /presence set|reset, but the whole presence feature is OPERATOR-only on the
// dashboard (savePresenceConfig + setActivePresence both go through
// requireOperator → PULSIFY_OPERATOR_IDS), because the bot has ONE global
// presence and per-guild admins mustn't fight over it. A guild-admin slash
// command would be a privilege escalation; an operator-only one belongs on the
// dashboard (there's no operator tier in the command ladder). See §4 / §5 of
// resources/PULSIFY-61.md. Likewise /soundboard is list|info, not list|play:
// playing a sound needs a live voice connection (@discordjs/voice, not a
// dependency) — deferred until there's a voice-playback need.

const { MessageFlags, StickerFormatType } = require("discord.js");
const {
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  editNotice,
  replyNotice,
  text,
  divider,
} = require("./commands");
const { getDashboardUrl } = require("./version");
const {
  MODULE_KEYS,
  isModuleEnabled,
  moduleLabel,
  getGuildPlan,
} = require("./feature-gate");
const { PLAN_LABELS } = require("./billing");

// Cap how many names a list embed prints so a server with hundreds of emojis
// doesn't blow past Discord's message limits; the count line always shows the
// true total.
const LIST_CAP = 60;

const STICKER_FORMAT_LABELS = {
  [StickerFormatType.PNG]: "PNG",
  [StickerFormatType.APNG]: "Animated PNG",
  [StickerFormatType.Lottie]: "Lottie",
  [StickerFormatType.GIF]: "GIF",
};

/** Join names into a space-separated, backtick-wrapped inline list (rule 2b),
 *  capped, with a "+N more" tail. */
function inlineNames(names) {
  if (names.length === 0) return "None";
  const shown = names.slice(0, LIST_CAP).map((n) => `\`${n}\``);
  const extra = names.length - shown.length;
  return shown.join(" ") + (extra > 0 ? ` +${extra} more` : "");
}

function createSettingsCommands({ client, supabase, statisticsChannels }) {
  async function render(interaction, guild, iconKey, { title, body, footer, actions }) {
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = iconKey ? await loadPulseIcon(iconKey, colorHex) : null;
    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
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
    });
  }

  function dashboardButton(guildId, path, label) {
    return { type: 1, components: [{ type: 2, style: 5, label, url: `${getDashboardUrl(guildId)}${path}` }] };
  }

  // ── /serversettings view ─────────────────────────────────────────────────

  async function handleServerSettings({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });

    const [colorHex, plan, moduleStates] = await Promise.all([
      getPulseColor(supabase, guild.id),
      getGuildPlan(supabase, guild),
      Promise.all(
        MODULE_KEYS.map(async (key) => ({
          label: moduleLabel(key),
          on: await isModuleEnabled(supabase, guild.id, key),
        })),
      ),
    ]);

    const on = moduleStates.filter((m) => m.on).map((m) => m.label).sort();
    const off = moduleStates.filter((m) => !m.on).map((m) => m.label).sort();

    const body = [
      text(
        [
          `**Plan** — ${PLAN_LABELS[plan] ?? plan}`,
          `**Embed colour** — \`${colorHex}\``,
        ].join("\n"),
      ),
      divider(),
      text(`**Features on** — ${inlineNames(on)}`),
      text(`**Features off** — ${inlineNames(off)}`),
      text("-# Configure any of these from the dashboard."),
    ];

    await render(interaction, guild, "info", {
      title: "Server Settings",
      body,
      footer: "Pulse — Settings",
      actions: [dashboardButton(guild.id, "", "Open Dashboard")],
    });
  }

  // ── /statchannel refresh ──────────────────────────────────────────────────

  async function handleStatChannel({ interaction, guild, ephemeral }) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });
    if (sub !== "refresh") return editNotice(interaction, "Unknown statistics-channel view.");

    if (!statisticsChannels?.refreshGuild) {
      return editNotice(interaction, "Statistics channels aren't available right now.");
    }
    let summary;
    try {
      summary = await statisticsChannels.refreshGuild(guild);
    } catch (err) {
      console.error(`[Pulse] /statchannel refresh failed in ${guild.id}:`, err.message);
      return editNotice(interaction, "I couldn't refresh the statistics channels. Try again shortly.");
    }

    if (summary.total === 0) {
      return editNotice(
        interaction,
        "No statistics channels are set up in this server. Add them from the dashboard under Server › Channels.",
      );
    }
    if (summary.enabled === 0) {
      return editNotice(interaction, "All statistics channels here are disabled — nothing to refresh.");
    }
    await editNotice(
      interaction,
      `Refreshed ${summary.enabled} statistics channel${summary.enabled === 1 ? "" : "s"}. Names update as Discord's rate limit allows.`,
    );
  }

  // ── Assets: /emoji /sticker /soundboard ───────────────────────────────────

  async function handleEmoji({ interaction, guild, ephemeral }) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });
    const emojis = [...guild.emojis.cache.values()];

    if (sub === "list") {
      const animated = emojis.filter((e) => e.animated);
      const stat = emojis.filter((e) => !e.animated);
      const body = [];
      if (emojis.length === 0) {
        body.push(text("This server has no custom emojis."));
      } else {
        body.push(
          text(`**${emojis.length}** custom emoji${emojis.length === 1 ? "" : "s"} — ${stat.length} static, ${animated.length} animated.`),
        );
        body.push(divider());
        body.push(text(inlineNames(emojis.map((e) => e.name))));
      }
      return render(interaction, guild, "info", {
        title: "Server Emojis",
        body,
        footer: "Pulse — Assets",
        actions: [dashboardButton(guild.id, "/assets", "Open Assets")],
      });
    }

    // info
    const query = interaction.options.getString("emoji", true);
    const emoji =
      guild.emojis.cache.get(query) ??
      emojis.find((e) => e.name?.toLowerCase() === query.toLowerCase());
    if (!emoji) return editNotice(interaction, "I couldn't find that emoji in this server.");

    const created = emoji.createdTimestamp ? `<t:${Math.floor(emoji.createdTimestamp / 1000)}:D>` : "—";
    const body = [
      text(`${emoji.toString()} **${emoji.name}**`),
      divider(),
      text(
        [
          `**Type** — ${emoji.animated ? "Animated" : "Static"}`,
          `**ID** — \`${emoji.id}\``,
          `**Usable as** — \`${emoji.toString()}\``,
          `**Created** — ${created}`,
        ].join("\n"),
      ),
    ];
    return render(interaction, guild, "info", {
      title: `:${emoji.name}:`,
      body,
      footer: "Pulse — Assets",
      actions: [{ type: 1, components: [{ type: 2, style: 5, label: "Open image", url: emoji.imageURL({ size: 256 }) }] }],
    });
  }

  async function handleSticker({ interaction, guild, ephemeral }) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });

    // Stickers aren't always in the gateway cache — fetch to be sure.
    let stickers = [...guild.stickers.cache.values()];
    if (stickers.length === 0) {
      const fetched = await guild.stickers.fetch().catch(() => null);
      if (fetched) stickers = [...fetched.values()];
    }

    if (sub === "list") {
      const body = [];
      if (stickers.length === 0) {
        body.push(text("This server has no custom stickers."));
      } else {
        body.push(text(`**${stickers.length}** custom sticker${stickers.length === 1 ? "" : "s"}.`));
        body.push(divider());
        body.push(text(inlineNames(stickers.map((s) => s.name))));
      }
      return render(interaction, guild, "info", {
        title: "Server Stickers",
        body,
        footer: "Pulse — Assets",
        actions: [dashboardButton(guild.id, "/assets", "Open Assets")],
      });
    }

    const query = interaction.options.getString("sticker", true);
    const sticker =
      stickers.find((s) => s.id === query) ??
      stickers.find((s) => s.name?.toLowerCase() === query.toLowerCase());
    if (!sticker) return editNotice(interaction, "I couldn't find that sticker in this server.");

    const body = [
      text(`**${sticker.name}**${sticker.description ? `\n-# ${sticker.description}` : ""}`),
      divider(),
      text(
        [
          `**Format** — ${STICKER_FORMAT_LABELS[sticker.format] ?? "Unknown"}`,
          sticker.tags ? `**Related emoji** — ${sticker.tags}` : "",
          `**ID** — \`${sticker.id}\``,
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    ];
    const url = sticker.url;
    return render(interaction, guild, "info", {
      title: sticker.name,
      body,
      footer: "Pulse — Assets",
      actions: url ? [{ type: 1, components: [{ type: 2, style: 5, label: "Open sticker", url }] }] : [],
    });
  }

  async function handleSoundboard({ interaction, guild, ephemeral }) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });

    const sounds = await fetchSounds(guild);
    if (sounds === null) {
      return editNotice(interaction, "I couldn't read this server's soundboard right now.");
    }

    if (sub === "list") {
      const body = [];
      if (sounds.length === 0) {
        body.push(text("This server has no custom soundboard sounds."));
      } else {
        body.push(text(`**${sounds.length}** custom soundboard sound${sounds.length === 1 ? "" : "s"}.`));
        body.push(divider());
        body.push(text(inlineNames(sounds.map((s) => s.name))));
      }
      return render(interaction, guild, "info", {
        title: "Server Soundboard",
        body,
        footer: "Pulse — Assets",
        actions: [dashboardButton(guild.id, "/assets", "Open Assets")],
      });
    }

    const query = interaction.options.getString("sound", true);
    const sound =
      sounds.find((s) => String(s.soundId ?? s.id) === query) ??
      sounds.find((s) => s.name?.toLowerCase() === query.toLowerCase());
    if (!sound) return editNotice(interaction, "I couldn't find that sound in this server.");

    const emoji = sound.emojiName || (sound.emojiId ? `<:_:${sound.emojiId}>` : null);
    const volumePct = Math.round((sound.volume ?? 1) * 100);
    const body = [
      text(`**${sound.name}**`),
      divider(),
      text(
        [
          `**Volume** — ${volumePct}%`,
          emoji ? `**Emoji** — ${emoji}` : "",
          `**ID** — \`${sound.soundId ?? sound.id}\``,
        ]
          .filter(Boolean)
          .join("\n"),
      ),
      text("-# Play soundboard sounds from Discord's own soundboard picker in a voice channel."),
    ];
    return render(interaction, guild, "info", {
      title: sound.name,
      body,
      footer: "Pulse — Assets",
      actions: [dashboardButton(guild.id, "/assets", "Open Assets")],
    });
  }

  /** Soundboard sounds as an array, or null if the manager/read is unavailable. */
  async function fetchSounds(guild) {
    try {
      const mgr = guild.soundboardSounds;
      if (!mgr) return null;
      let coll = mgr.cache;
      if (!coll || coll.size === 0) {
        coll = await mgr.fetch().catch(() => coll);
      }
      return coll ? [...coll.values()] : [];
    } catch {
      return null;
    }
  }

  // ── Autocomplete for the info subcommands ──────────────────────────────────

  function respondNames(interaction, entries) {
    const focused = String(interaction.options.getFocused() ?? "").toLowerCase();
    const choices = entries
      .filter((e) => !focused || e.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((e) => ({ name: e.name.slice(0, 100), value: e.value }));
    return interaction.respond(choices);
  }

  async function autocompleteEmoji({ interaction, guild }) {
    const entries = [...guild.emojis.cache.values()].map((e) => ({ name: e.name ?? e.id, value: e.id }));
    await respondNames(interaction, entries);
  }

  async function autocompleteSticker({ interaction, guild }) {
    let stickers = [...guild.stickers.cache.values()];
    if (stickers.length === 0) {
      const fetched = await guild.stickers.fetch().catch(() => null);
      if (fetched) stickers = [...fetched.values()];
    }
    await respondNames(
      interaction,
      stickers.map((s) => ({ name: s.name ?? s.id, value: s.id })),
    );
  }

  async function autocompleteSoundboard({ interaction, guild }) {
    const sounds = (await fetchSounds(guild)) ?? [];
    await respondNames(
      interaction,
      sounds.map((s) => ({ name: s.name ?? String(s.soundId ?? s.id), value: String(s.soundId ?? s.id) })),
    );
  }

  return {
    handleServerSettings,
    handleStatChannel,
    handleEmoji,
    handleSticker,
    handleSoundboard,
    autocompleteEmoji,
    autocompleteSticker,
    autocompleteSoundboard,
  };
}

module.exports = { createSettingsCommands, inlineNames, LIST_CAP };
