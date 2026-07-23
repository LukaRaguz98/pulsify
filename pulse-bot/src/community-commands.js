// Integrations / Notifications / Feedback commands — bot side (PULSIFY-61).
//
// /integrations status         (admin)     — read the guild's connected integrations
// /notifications preferences   (moderator) — read the guild's activity-feed prefs
// /feedback submit             (everyone)  — leave a Pulsify testimonial (GLOBAL,
//                                            one per user; the landing-page wall)
//
// All `module: null`. The first two are read-only windows onto dashboard config;
// feedback writes one GLOBAL row (feedback.user_id is unique — not per-guild).

const { MessageFlags } = require("discord.js");
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

// Mirror of FEEDBACK_LIMITS in lib/feedback.ts — keep in sync.
const FEEDBACK_LIMITS = { titleMin: 3, titleMax: 80, messageMin: 10, messageMax: 600, ratingMin: 1, ratingMax: 5 };

/** Validate + trim a feedback submission. Mirror of validateFeedback(). */
function validateFeedback({ title, message, rating }) {
  const t = (title ?? "").trim();
  const m = (message ?? "").trim();
  const r = Number(rating);
  if (t.length < FEEDBACK_LIMITS.titleMin) return { ok: false, error: `Title must be at least ${FEEDBACK_LIMITS.titleMin} characters.` };
  if (t.length > FEEDBACK_LIMITS.titleMax) return { ok: false, error: `Title must be ${FEEDBACK_LIMITS.titleMax} characters or fewer.` };
  if (m.length < FEEDBACK_LIMITS.messageMin) return { ok: false, error: `Feedback must be at least ${FEEDBACK_LIMITS.messageMin} characters.` };
  if (m.length > FEEDBACK_LIMITS.messageMax) return { ok: false, error: `Feedback must be ${FEEDBACK_LIMITS.messageMax} characters or fewer.` };
  if (!Number.isInteger(r) || r < FEEDBACK_LIMITS.ratingMin || r > FEEDBACK_LIMITS.ratingMax) {
    return { ok: false, error: "Please choose a rating between 1 and 5 stars." };
  }
  return { ok: true, value: { title: t, message: m, rating: r } };
}

const PROVIDER_LABELS = {
  github: "GitHub",
  youtube: "YouTube",
  twitch: "Twitch",
  rss: "RSS",
  reddit: "Reddit",
  notion: "Notion",
};

const STATUS_LABELS = { connected: "Connected", disconnected: "Disconnected", error: "Error" };

function createCommunityCommands({ client, supabase }) {
  async function renderEmbed(interaction, guild, iconKey, { title, body, footer, actions }) {
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

  function dashButton(guildId, path, label) {
    return { type: 1, components: [{ type: 2, style: 5, label, url: `${getDashboardUrl(guildId)}${path}` }] };
  }

  // ── /integrations status ───────────────────────────────────────────────────

  async function handleIntegrations({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });
    const { data, error } = await supabase
      .from("integrations")
      .select("provider, label, status, enabled, last_sync_at, last_error")
      .eq("guild_id", guild.id)
      .order("created_at", { ascending: true });
    if (error) {
      console.error(`[Pulse] /integrations status failed in ${guild.id}:`, error.message);
      return editNotice(interaction, "I couldn't load integrations right now. Try again shortly.");
    }

    const rows = data ?? [];
    const body = [];
    if (rows.length === 0) {
      body.push(text("No integrations are connected. Add GitHub, YouTube, RSS and more from the dashboard."));
    } else {
      const connected = rows.filter((r) => r.status === "connected" && r.enabled).length;
      body.push(text(`**${rows.length}** integration${rows.length === 1 ? "" : "s"} — ${connected} active.`));
      body.push(divider());
      const lines = rows.map((r) => {
        const provider = PROVIDER_LABELS[r.provider] ?? r.provider;
        const state = !r.enabled ? "Paused" : STATUS_LABELS[r.status] ?? r.status;
        const synced = r.last_sync_at ? ` — synced <t:${Math.floor(new Date(r.last_sync_at).getTime() / 1000)}:R>` : "";
        const err = r.status === "error" && r.last_error ? `\n-# ${String(r.last_error).slice(0, 120)}` : "";
        return `**${r.label || provider}** — ${provider} — ${state}${synced}${err}`;
      });
      body.push(text(lines.join("\n")));
    }
    await renderEmbed(interaction, guild, "info", {
      title: "Integrations",
      body,
      footer: "Pulse — Integrations",
      actions: [dashButton(guild.id, "/integrations", "Open Integrations")],
    });
  }

  // ── /notifications preferences ─────────────────────────────────────────────

  async function handleNotifications({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });
    const { data, error } = await supabase
      .from("notification_preferences")
      .select("enabled_types, toast_enabled")
      .eq("guild_id", guild.id)
      .maybeSingle();
    if (error) {
      console.error(`[Pulse] /notifications preferences failed in ${guild.id}:`, error.message);
      return editNotice(interaction, "I couldn't load notification preferences right now. Try again shortly.");
    }

    const body = [];
    if (!data) {
      body.push(text("Using the defaults — every activity-feed notification is on and toasts are enabled."));
    } else {
      // enabled_types may be stored as an array of enabled keys or a {type:bool} map.
      let enabledCount = 0;
      const et = data.enabled_types;
      if (Array.isArray(et)) enabledCount = et.length;
      else if (et && typeof et === "object") enabledCount = Object.values(et).filter(Boolean).length;
      const toast = data.toast_enabled !== false;
      body.push(
        text(
          [
            `**Notification types on** — ${enabledCount}`,
            `**In-app toasts** — ${toast ? "On" : "Off"}`,
          ].join("\n"),
        ),
      );
      body.push(text("-# These control the dashboard's activity feed. Configure them from the dashboard."));
    }
    await renderEmbed(interaction, guild, "info", {
      title: "Notification Preferences",
      body,
      footer: "Pulse — Notifications",
      actions: [dashButton(guild.id, "/notifications", "Open Notifications")],
    });
  }

  // ── /feedback submit ───────────────────────────────────────────────────────

  async function handleFeedback({ interaction, ephemeral }) {
    const parsed = validateFeedback({
      title: interaction.options.getString("title", true),
      message: interaction.options.getString("message", true),
      rating: interaction.options.getInteger("rating", true),
    });
    if (!parsed.ok) return replyNotice(interaction, parsed.error, ephemeral);

    const user = interaction.user;
    const { error } = await supabase.from("feedback").upsert(
      {
        user_id: user.id,
        author_name: interaction.member?.displayName ?? user.globalName ?? user.username,
        author_handle: user.username,
        author_avatar: user.displayAvatarURL({ size: 128 }),
        title: parsed.value.title,
        message: parsed.value.message,
        rating: parsed.value.rating,
        status: "visible",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) {
      console.error(`[Pulse] /feedback submit failed for ${user.id}:`, error.message);
      return replyNotice(interaction, "I couldn't submit your feedback right now. Try again shortly.", ephemeral);
    }

    await replyNotice(
      interaction,
      `Thanks for the feedback — your ${parsed.value.rating}-star review is in. You can update it any time by running \`/feedback submit\` again.`,
      ephemeral,
    );
  }

  return { handleIntegrations, handleNotifications, handleFeedback };
}

module.exports = { createCommunityCommands, validateFeedback, FEEDBACK_LIMITS };
