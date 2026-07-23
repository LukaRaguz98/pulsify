// Server Templates — apply (bot side, PULSIFY-61).
//
// /template apply template:<preset-or-saved> — flip each of the template's
// decided feature switches. A template is a FEATURE PROFILE (which of the nine
// features are on/off); applying it does NOT create roles or channels.
//
// This mirrors pulsify-web-app/lib/templates.ts (feature keys, per-feature plan,
// the six built-in presets) and the apply write-path in the dashboard's
// templates/actions.ts (applyFeatures) — keep them in sync, the tests pin the
// preset profiles + the plan gate. The write targets are the exact same tables /
// guild_settings sub-keys the dashboard writes, so applying from Discord and
// from the dashboard are identical.
//
// Plan gating follows the BOT convention (feature-gate.js): a paid-only feature
// can only be TURNED ON when the GUILD OWNER's plan covers it (the dashboard
// gates on the acting user, but slash commands gate on the owner — see
// feature-gate.js). Disabling is always allowed. Moot under EARLY_ACCESS.

const { MessageFlags } = require("discord.js");
const {
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  editNotice,
  text,
  divider,
} = require("./commands");
const { getDashboardUrl } = require("./version");
const { getGuildPlan, hasPlan, invalidateModules } = require("./feature-gate");
const { recordNotification } = require("./notifications");

// ── Feature catalogue (mirror of lib/templates.ts) ───────────────────────────

const FEATURE_KEYS = [
  "automations",
  "onboarding",
  "moderation_alerts",
  "pulse_guard",
  "ddos_protection",
  "tickets",
  "private_channels",
  "leveling",
  "economy",
];

// label + minimum plan only — the rest of FEATURE_META (icons/colours/copy) is
// UI-side and not needed to apply.
const FEATURE_META = {
  automations: { label: "Welcome & Automations", plan: "free" },
  onboarding: { label: "Onboarding", plan: "free" },
  moderation_alerts: { label: "Moderation Alerts", plan: "free" },
  pulse_guard: { label: "Pulse Guard", plan: "pro" },
  ddos_protection: { label: "DDoS Protection", plan: "pro" },
  tickets: { label: "Tickets", plan: "free" },
  private_channels: { label: "Private Channels", plan: "free" },
  leveling: { label: "Levels & XP", plan: "free" },
  economy: { label: "Economy", plan: "free" },
};

function normaliseFeatureMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of FEATURE_KEYS) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  return out;
}

function featureKeysDecided(map) {
  return FEATURE_KEYS.filter((k) => typeof map[k] === "boolean");
}

/** Build a full feature map from the list of features to ENABLE (rest off). */
function profile(on) {
  const map = {};
  for (const k of FEATURE_KEYS) map[k] = on.includes(k);
  return map;
}

// The six official presets — mirror of PRESETS in lib/templates.ts.
const BUILTIN_TEMPLATES = [
  { id: "builtin-essentials", name: "Essentials", builtin: true, features: profile(["automations", "onboarding", "moderation_alerts", "pulse_guard"]) },
  { id: "builtin-community", name: "Full Community", builtin: true, features: profile([...FEATURE_KEYS]) },
  { id: "builtin-gaming", name: "Gaming Community", builtin: true, features: profile(["automations", "onboarding", "leveling", "economy", "private_channels", "pulse_guard", "moderation_alerts"]) },
  { id: "builtin-creator", name: "Creator Community", builtin: true, features: profile(["automations", "onboarding", "leveling", "economy", "pulse_guard", "moderation_alerts"]) },
  { id: "builtin-support", name: "Support Server", builtin: true, features: profile(["automations", "onboarding", "tickets", "moderation_alerts", "pulse_guard"]) },
  { id: "builtin-public", name: "Public / High-traffic", builtin: true, features: profile(["automations", "onboarding", "moderation_alerts", "pulse_guard", "ddos_protection", "tickets"]) },
];

function findBuiltin(id) {
  return BUILTIN_TEMPLATES.find((t) => t.id === id) ?? null;
}

// ── Apply (mirror of applyFeatures in templates/actions.ts) ──────────────────

const SETTINGS_FEATURES = ["automations", "onboarding", "moderation_alerts"];
const TABLE_FOR = {
  pulse_guard: { table: "ai_moderation_settings", withUpdatedBy: true },
  ddos_protection: { table: "security_configs", withUpdatedBy: true },
  tickets: { table: "ticket_configs", withUpdatedBy: true },
  private_channels: { table: "private_channel_configs" },
  leveling: { table: "leveling_settings" },
  economy: { table: "economy_reward_settings" },
};

async function applyFeatures(supabase, guildId, features, updatedBy, keys) {
  const applied = [];
  const warnings = [];
  const nowIso = new Date().toISOString();

  // guild_settings-backed toggles — read once, mutate, single upsert.
  const settingsKeys = keys.filter((k) => SETTINGS_FEATURES.includes(k));
  if (settingsKeys.length) {
    const { data: existing } = await supabase
      .from("guild_settings")
      .select("settings")
      .eq("guild_id", guildId)
      .maybeSingle();
    const settings = { ...(existing?.settings ?? {}) };
    const setSub = (subKey, enabled) => {
      const cur = settings[subKey] ?? {};
      settings[subKey] = { ...cur, enabled };
    };
    for (const key of settingsKeys) {
      const enabled = features[key] === true;
      if (key === "automations") {
        setSub("welcome", enabled);
        setSub("goodbye", enabled);
      } else if (key === "onboarding") {
        setSub("member_onboarding", enabled);
      } else if (key === "moderation_alerts") {
        setSub("moderation_alerts", enabled);
      }
      applied.push({ key, label: FEATURE_META[key].label, enabled });
    }
    const { error } = await supabase
      .from("guild_settings")
      .upsert({ guild_id: guildId, settings, updated_at: nowIso }, { onConflict: "guild_id" });
    if (error) return { applied: [], warnings: [`Failed to update settings: ${error.message}`] };
  }

  // Single-table toggles — minimal upsert; other columns are DB-defaulted.
  for (const key of keys) {
    const target = TABLE_FOR[key];
    if (!target) continue;
    const enabled = features[key] === true;
    const payload = { guild_id: guildId, enabled, updated_at: nowIso };
    if (target.withUpdatedBy) payload.updated_by = updatedBy;
    const { error } = await supabase.from(target.table).upsert(payload, { onConflict: "guild_id" });
    if (error) {
      warnings.push(`Couldn't update ${FEATURE_META[key].label}: ${error.message}`);
      continue;
    }
    applied.push({ key, label: FEATURE_META[key].label, enabled });
  }

  return { applied, warnings };
}

// ── Command ──────────────────────────────────────────────────────────────────

function createTemplates({ client, supabase }) {
  async function loadTemplate(guildId, id) {
    const builtin = findBuiltin(id);
    if (builtin) return builtin;
    const { data } = await supabase
      .from("server_templates")
      .select("id, name, features, usage_count")
      .eq("id", id)
      .eq("guild_id", guildId)
      .maybeSingle();
    if (!data) return null;
    return {
      id: String(data.id),
      name: String(data.name ?? "Template"),
      features: normaliseFeatureMap(data.features),
      usageCount: Number(data.usage_count ?? 0),
      builtin: false,
    };
  }

  async function handleApply({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });
    const id = interaction.options.getString("template", true);

    const template = await loadTemplate(guild.id, id);
    if (!template) return editNotice(interaction, "I couldn't find that template.");

    const decided = featureKeysDecided(template.features);
    if (decided.length === 0) return editNotice(interaction, "That template doesn't change any features.");

    // Plan gate on the GUILD OWNER (bot convention). A paid feature can only be
    // turned ON when the owner's plan covers it; disabling is always fine.
    const plan = await getGuildPlan(supabase, guild);
    const lockedSkipped = [];
    const effectiveKeys = decided.filter((k) => {
      const wantOn = template.features[k] === true;
      const required = FEATURE_META[k].plan;
      if (wantOn && required !== "free" && !hasPlan(plan, required)) {
        lockedSkipped.push(FEATURE_META[k].label);
        return false;
      }
      return true;
    });
    if (effectiveKeys.length === 0) {
      return editNotice(
        interaction,
        lockedSkipped.length
          ? `This server's plan doesn't include: ${lockedSkipped.join(", ")}. The owner can upgrade to enable them.`
          : "There's nothing to apply from that template.",
      );
    }

    const summary = await applyFeatures(supabase, guild.id, template.features, interaction.user.id, effectiveKeys);
    if (lockedSkipped.length) {
      summary.warnings.push(`Skipped — plan doesn't include: ${lockedSkipped.join(", ")}.`);
    }
    if (summary.applied.length === 0) {
      return editNotice(interaction, summary.warnings[0] ?? "Nothing was applied.");
    }

    // The bot's module-enablement cache must not serve stale on/off states now.
    invalidateModules(guild.id);

    // Bump usage on saved (non-builtin) templates, best-effort.
    if (!template.builtin) {
      await supabase
        .from("server_templates")
        .update({ usage_count: (template.usageCount ?? 0) + 1 })
        .eq("id", template.id)
        .then(() => {}, () => {});
    }

    const on = summary.applied.filter((a) => a.enabled).map((a) => `\`${a.label}\``);
    const off = summary.applied.filter((a) => !a.enabled).map((a) => `\`${a.label}\``);

    // Activity-feed notification, mirroring the dashboard apply.
    await recordNotification(supabase, {
      guildId: guild.id,
      type: "server_settings_changed",
      title: `Applied template "${template.name}"`,
      body: `${on.length} feature${on.length === 1 ? "" : "s"} on, ${off.length} off.`,
      link: `/dashboard/${guild.id}/templates`,
      actorId: interaction.user.id,
      actorName: interaction.member?.displayName ?? interaction.user.username,
      actorUsername: interaction.user.username,
    }).catch(() => {});

    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("info", colorHex);
    const body = [text(`Applied **${template.name}**.`), divider()];
    if (on.length) body.push(text(`**Turned on** — ${on.join(" ")}`));
    if (off.length) body.push(text(`**Turned off** — ${off.join(" ")}`));
    if (summary.warnings.length) body.push(text(`-# ${summary.warnings.join(" ")}`));

    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title: "Template applied",
          subtitle: `Pulse — ${guild.name}`,
          body,
          footer: "Pulse — Templates",
          actions: [
            { type: 1, components: [{ type: 2, style: 5, label: "Open Templates", url: `${getDashboardUrl(guild.id)}/templates` }] },
          ],
        }),
      ],
      files: icon ? [icon] : [],
    });
  }

  async function autocompleteTemplate({ interaction, guild }) {
    const focused = String(interaction.options.getFocused() ?? "").toLowerCase();
    const builtin = BUILTIN_TEMPLATES.map((t) => ({ name: `${t.name} (preset)`, value: t.id }));
    let custom = [];
    try {
      const { data } = await supabase
        .from("server_templates")
        .select("id, name")
        .eq("guild_id", guild.id)
        .order("updated_at", { ascending: false })
        .limit(20);
      custom = (data ?? []).map((t) => ({ name: String(t.name).slice(0, 100), value: String(t.id) }));
    } catch {
      /* presets are always offered */
    }
    const all = [...builtin, ...custom]
      .filter((c) => !focused || c.name.toLowerCase().includes(focused))
      .slice(0, 25);
    await interaction.respond(all);
  }

  return { handleApply, autocompleteTemplate };
}

module.exports = {
  createTemplates,
  // exported for the parity test
  FEATURE_KEYS,
  FEATURE_META,
  BUILTIN_TEMPLATES,
  findBuiltin,
  featureKeysDecided,
  normaliseFeatureMap,
  applyFeatures,
};
