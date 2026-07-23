// Pulse Guard commands — bot side (PULSIFY-61).
//
// /guard status · /guard whitelist add|remove · /guard review
//
// Pulse Guard's POLICY lives web-side: the detection engine, the LLM pass and
// the auto-actions all run in the /api/bot/ai-moderation/analyze endpoint, and
// src/ai-moderation.js just forwards every message to it. These commands keep
// the bot a thin pipe — they READ the config + the flagged-event queue and let a
// moderator toggle the analysis whitelist, all against the same `ai_moderation_*`
// tables the dashboard uses. They do NOT re-implement any detection.
//
// The label/id constants below MIRROR pulsify-web-app/lib/ai-moderation.ts (the
// bot is CommonJS, the web app is TypeScript in a separate package — same reason
// src/reputation.js mirrors lib/reputation.ts). Keep them in sync.
//
// `module: pulse_guard` gates the command on ai_moderation_settings.enabled, and
// `minPlan: "pro"` (set in the catalog) gates it on the guild owner's plan — the
// first plan-gated command. Moderator tier matches the dashboard's authorize.

const { MessageFlags } = require("discord.js");
const {
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  replyNotice,
  editNotice,
  text,
  divider,
} = require("./commands");
const { getDashboardUrl } = require("./version");

// ── Mirror of lib/ai-moderation.ts ───────────────────────────────────────────

const CATEGORY_IDS = [
  "spam",
  "scam",
  "phishing",
  "toxicity",
  "harassment",
  "mention_flood",
  "suspicious_invite",
  "suspicious_link",
  "impersonation",
  "nsfw",
];

const CATEGORY_LABELS = {
  spam: "Spam",
  scam: "Scam",
  phishing: "Phishing",
  toxicity: "Toxicity",
  harassment: "Harassment",
  mention_flood: "Mass mention abuse",
  suspicious_invite: "Suspicious invite",
  suspicious_link: "Suspicious link",
  impersonation: "Impersonation",
  nsfw: "NSFW / inappropriate",
};

const SENSITIVITY_LABELS = {
  low: "Low — only the clearest violations",
  medium: "Medium — balanced",
  aggressive: "Aggressive — catches more, more false positives",
};

const AUTO_ACTION_LABELS = {
  none: "No action",
  flag: "Flagged for review",
  delete: "Message deleted",
  warn: "Member warned",
  timeout: "Member timed out",
};

const STATUS_LABELS = {
  pending: "Pending review",
  auto_actioned: "Auto-actioned",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

/** Truncate to `max` chars on a word boundary, adding an ellipsis when cut. */
function truncate(str, max) {
  const s = String(str ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

function createGuard({ client, supabase }) {
  /** Full settings for a guild: { enabled, sensitivity, settings }. */
  async function loadRow(guildId) {
    const { data } = await supabase
      .from("ai_moderation_settings")
      .select("enabled, sensitivity, settings")
      .eq("guild_id", guildId)
      .maybeSingle();
    return data ?? null;
  }

  // ── /guard status ──────────────────────────────────────────────────────────
  async function handleStatus({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("safety", colorHex);

    const row = await loadRow(guild.id);
    const s = row?.settings ?? {};
    const sensitivity = row?.sensitivity ?? s.sensitivity ?? "medium";
    const categories = s.categories ?? {};
    const activeDetectors = CATEGORY_IDS.filter((id) => categories[id]?.enabled).length;
    const whitelistUsers = Array.isArray(s.whitelisted_user_ids) ? s.whitelisted_user_ids.length : 0;
    const whitelistRoles = Array.isArray(s.whitelisted_role_ids) ? s.whitelisted_role_ids.length : 0;
    const ignoredChannels = Array.isArray(s.ignored_channel_ids) ? s.ignored_channel_ids.length : 0;

    // Recent activity — counts over the last 7 days + the standing review queue.
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [flagged7d, pending, autoActioned7d] = await Promise.all([
      supabase.from("ai_moderation_events").select("id", { count: "exact", head: true }).eq("guild_id", guild.id).gte("created_at", since),
      supabase.from("ai_moderation_events").select("id", { count: "exact", head: true }).eq("guild_id", guild.id).eq("status", "pending"),
      supabase.from("ai_moderation_events").select("id", { count: "exact", head: true }).eq("guild_id", guild.id).eq("status", "auto_actioned").gte("created_at", since),
    ]);

    const body = [
      text(
        row?.enabled
          ? "Pulse Guard is **active** — new messages are analysed and acted on automatically."
          : "Pulse Guard is **switched off** — messages aren't being analysed.",
      ),
      divider(),
      text(
        [
          `**Sensitivity** — ${SENSITIVITY_LABELS[sensitivity] ?? sensitivity}`,
          `**Detectors** — ${activeDetectors} of ${CATEGORY_IDS.length} active`,
          `**Alert channel** — ${s.alert_channel_id ? `<#${s.alert_channel_id}>` : "none set"}`,
          `**Timeout length** — ${Number(s.timeout_minutes ?? 10)} min (for timeout actions)`,
        ].join("\n"),
      ),
      divider(),
      text(
        [
          `**Whitelisted** — ${whitelistUsers} member${whitelistUsers === 1 ? "" : "s"} — ${whitelistRoles} role${whitelistRoles === 1 ? "" : "s"}`,
          `**Ignored channels** — ${ignoredChannels}`,
        ].join("\n"),
      ),
      divider(),
      text(
        [
          "**Last 7 days**",
          `Flagged — ${flagged7d.count ?? 0} — Auto-actioned — ${autoActioned7d.count ?? 0}`,
          `**Pending review** — ${pending.count ?? 0}`,
        ].join("\n"),
      ),
    ];

    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title: "Pulse Guard",
          subtitle: guild.name,
          body,
          footer: "Pulse — AI moderation",
          actions: [
            {
              type: 1,
              components: [
                { type: 2, style: 5, label: "Open in Dashboard", url: `${getDashboardUrl(guild.id)}/ai-moderation` },
              ],
            },
          ],
        }),
      ],
      files: icon ? [icon] : [],
    });
  }

  // ── /guard whitelist add|remove ──────────────────────────────────────────────
  async function handleWhitelist({ interaction, guild, action, ephemeral }) {
    const user = interaction.options.getUser("user");
    const role = interaction.options.getRole("role");

    // Exactly one target — a user OR a role, never both, never neither.
    if ((user && role) || (!user && !role)) {
      await replyNotice(interaction, "Pick exactly one target — either a `user` or a `role`.");
      return;
    }

    const row = await loadRow(guild.id);
    if (!row) {
      await replyNotice(interaction, "Pulse Guard isn't configured yet — set it up in the dashboard first.");
      return;
    }
    const settings = row.settings ?? {};
    const key = user ? "whitelisted_user_ids" : "whitelisted_role_ids";
    const id = user ? user.id : role.id;
    const mention = user ? `<@${user.id}>` : `<@&${role.id}>`;
    const current = Array.isArray(settings[key]) ? settings[key] : [];
    const has = current.includes(id);

    if (action === "add" && has) {
      await replyNotice(interaction, `${mention} is already on the Pulse Guard whitelist.`, ephemeral);
      return;
    }
    if (action === "remove" && !has) {
      await replyNotice(interaction, `${mention} isn't on the Pulse Guard whitelist.`, ephemeral);
      return;
    }

    const next = action === "add" ? [...current, id] : current.filter((x) => x !== id);
    // Write the whole settings object back (the same shape the dashboard stores);
    // the analyze endpoint reads it fresh, so the change takes effect at once.
    const { error } = await supabase
      .from("ai_moderation_settings")
      .upsert(
        {
          guild_id: guild.id,
          enabled: row.enabled,
          sensitivity: row.sensitivity,
          settings: { ...settings, [key]: next },
          updated_by: interaction.user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "guild_id" },
      );
    if (error) {
      console.warn(`[Pulse] /guard whitelist failed in ${guild.id}:`, error.message);
      await replyNotice(interaction, "Sorry — I couldn't update the whitelist. Try again in a moment.");
      return;
    }

    const what = user ? "member" : "role";
    await replyNotice(
      interaction,
      action === "add"
        ? `Added ${mention} to the Pulse Guard whitelist — ${user ? "their messages" : `this ${what}'s members`} won't be analysed.`
        : `Removed ${mention} from the Pulse Guard whitelist — ${user ? "their messages are" : `this ${what}'s members are`} analysed again.`,
      ephemeral,
    );
  }

  // ── /guard review ────────────────────────────────────────────────────────────
  async function handleReview({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("safety", colorHex);

    // The queue that needs a human: still-pending detections + things Pulse Guard
    // auto-actioned (which a moderator may want to reverse). Newest first.
    const { data: events } = await supabase
      .from("ai_moderation_events")
      .select("id, channel_id, message_id, author_id, author_name, content, top_category, severity, confidence, action_taken, status, created_at")
      .eq("guild_id", guild.id)
      .in("status", ["pending", "auto_actioned"])
      .order("created_at", { ascending: false })
      .limit(8);

    const list = events ?? [];
    const body = [];
    if (list.length === 0) {
      body.push(text("Nothing is waiting for review — Pulse Guard hasn't flagged anything that needs a look."));
    } else {
      body.push(text(`The ${list.length} most recent detection${list.length === 1 ? "" : "s"} that may need attention.`));
      body.push(divider());
      const blocks = list.map((e) => {
        const who = e.author_id ? `<@${e.author_id}>` : e.author_name || "Unknown";
        const cat = CATEGORY_LABELS[e.top_category] ?? e.top_category ?? "Flagged";
        const conf = Number.isFinite(e.confidence) ? ` — ${Math.round(e.confidence * 100)}% confidence` : "";
        const when = e.created_at ? ` — <t:${Math.floor(new Date(e.created_at).getTime() / 1000)}:R>` : "";
        const jump =
          e.message_id && e.channel_id
            ? ` — [jump](https://discord.com/channels/${guild.id}/${e.channel_id}/${e.message_id})`
            : "";
        const head = `**${cat}** — ${e.severity ?? "?"} severity${conf}`;
        const meta = `-# ${who} in ${e.channel_id ? `<#${e.channel_id}>` : "a channel"} — ${STATUS_LABELS[e.status] ?? e.status} — ${AUTO_ACTION_LABELS[e.action_taken] ?? e.action_taken}${when}${jump}`;
        const quote = e.content ? `> ${truncate(e.content, 180)}` : null;
        return [head, meta, quote].filter(Boolean).join("\n");
      });
      body.push(text(blocks.join("\n\n")));
    }

    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title: "Pulse Guard — Review queue",
          subtitle: guild.name,
          body,
          footer: "Pulse — AI moderation",
          actions: [
            {
              type: 1,
              components: [
                { type: 2, style: 5, label: "Review in Dashboard", url: `${getDashboardUrl(guild.id)}/ai-moderation` },
              ],
            },
          ],
        }),
      ],
      files: icon ? [icon] : [],
    });
  }

  return { handleStatus, handleWhitelist, handleReview };
}

module.exports = {
  createGuard,
  // Exported for tests / reuse.
  CATEGORY_IDS,
  CATEGORY_LABELS,
  SENSITIVITY_LABELS,
  AUTO_ACTION_LABELS,
};
