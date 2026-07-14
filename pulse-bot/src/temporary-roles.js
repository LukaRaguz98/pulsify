// Temporary Roles — automatic expiry (bot side) — PULSIFY-54.
//
// The DASHBOARD owns assignment/extension/shortening/removal (the API routes
// under /api/discord/guild/[guildId]/temporary-roles). This module owns EXPIRY:
// a 60s sweep finds active `temporary_roles` rows past `expires_at`, removes the
// Discord role, marks the row `expired`, writes a `temporary_role_events` audit
// row, and (optionally) DMs the member + records a dashboard notification. It
// also sends one "expiring soon" warning per grant inside the final 24h.
//
// Expiry math mirrors pulsify-web-app/lib/temporary-roles.ts — keep in sync.

const { MessageFlags } = require("discord.js");
const { recordNotification } = require("./notifications");
const { buildPulseContainer, getPulseColor, text } = require("./commands");

const SWEEP_MS = 60 * 1000;
const EXPIRING_SOON_MS = 24 * 60 * 60 * 1000;

function createTemporaryRoles(client, supabase) {
  let timer = null;
  let sweeping = false;

  async function recordEvent(row, action, detail) {
    try {
      await supabase.from("temporary_role_events").insert({
        guild_id: row.guild_id,
        temporary_role_id: row.id,
        user_id: row.user_id,
        user_name: row.user_name,
        role_id: row.role_id,
        role_name: row.role_name,
        action,
        source: row.source ?? "manual",
        actor_id: null,
        actor_name: "Pulse",
        detail: detail ?? {},
      });
    } catch (err) {
      console.warn("[Pulse] temp-role event insert failed:", err.message);
    }
  }

  // DM the member a Pulse v2 notice (best-effort). `kind` is 'expired' | 'expiring'.
  async function notifyMember(guild, row, kind) {
    if (!row.notify_user) return;
    try {
      const member = await guild.members.fetch(row.user_id).catch(() => null);
      if (!member) return;
      const colorHex = await getPulseColor(supabase, guild.id);
      const roleLabel = row.role_name ? `**${row.role_name}**` : "a temporary role";
      const body =
        kind === "expired"
          ? [text(`Your temporary ${roleLabel} role in **${guild.name}** has expired and been removed.`)]
          : [
              text(`Your temporary ${roleLabel} role in **${guild.name}** expires soon.`),
              text(`-# Expires <t:${Math.floor(new Date(row.expires_at).getTime() / 1000)}:R>`),
            ];
      // No header thumbnail: this DM is one or two lines (see the embed
      // conventions on buildPulseContainer).
      const container = buildPulseContainer({
        colorHex,
        title: kind === "expired" ? "Temporary role expired" : "Temporary role expiring",
        subtitle: guild.name,
        body,
        footer: "Pulse — Temporary Roles",
      });
      await member
        .send({ flags: MessageFlags.IsComponentsV2, components: [container] })
        .catch(() => {});
    } catch {
      /* DMs disabled / member gone — never let this break the sweep */
    }
  }

  async function expire(guild, row) {
    // Remove the Discord role. Missing role (deleted), missing member (left), or
    // a hierarchy/permission failure all degrade to "mark expired" so we don't
    // retry forever — the grant's time is up regardless.
    try {
      const member = await guild.members.fetch(row.user_id).catch(() => null);
      if (member && guild.roles.cache.has(row.role_id) && member.roles.cache.has(row.role_id)) {
        await member.roles.remove(row.role_id, "Temporary role expired").catch(() => {});
      }
    } catch {
      /* fall through to mark expired */
    }

    // Claim the row: only transition active → expired. If 0 rows come back, the
    // dashboard (or a racing sweep) already handled it — skip the side effects.
    const { data, error } = await supabase
      .from("temporary_roles")
      .update({ status: "expired", ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "active")
      .select("id");
    if (error || !data || data.length === 0) return;

    await recordEvent(row, "expired", { auto: true });
    await notifyMember(guild, row, "expired");
    if (row.notify_admin) {
      await recordNotification(supabase, {
        guildId: guild.id,
        type: "temp_role_expired",
        title: `@${row.role_name ?? "role"} expired for ${row.user_name ?? row.user_id}`,
        link: `/dashboard/${guild.id}/roles?tab=temporary`,
        targetId: row.user_id,
        targetName: row.user_name,
        metadata: { role_id: row.role_id, source: row.source },
      });
    }
  }

  async function warnExpiring(guild, row) {
    // Claim the warning so we only ever send one per grant.
    const { data } = await supabase
      .from("temporary_roles")
      .update({ expiry_warned_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("expiry_warned_at", null)
      .eq("status", "active")
      .select("id");
    if (!data || data.length === 0) return;

    await notifyMember(guild, row, "expiring");
    if (row.notify_admin) {
      await recordNotification(supabase, {
        guildId: guild.id,
        type: "temp_role_expiring",
        title: `@${row.role_name ?? "role"} expiring soon for ${row.user_name ?? row.user_id}`,
        body: `Expires ${new Date(row.expires_at).toLocaleString()}`,
        link: `/dashboard/${guild.id}/roles?tab=temporary`,
        targetId: row.user_id,
        targetName: row.user_name,
        metadata: { role_id: row.role_id },
      });
    }
  }

  async function sweepGuild(guild) {
    const nowIso = new Date().toISOString();
    const soonIso = new Date(Date.now() + EXPIRING_SOON_MS).toISOString();

    // Due → expire.
    const { data: due } = await supabase
      .from("temporary_roles")
      .select("*")
      .eq("guild_id", guild.id)
      .eq("status", "active")
      .lte("expires_at", nowIso);
    for (const row of due ?? []) await expire(guild, row);

    // Within the next 24h and not yet warned → warn.
    const { data: soon } = await supabase
      .from("temporary_roles")
      .select("*")
      .eq("guild_id", guild.id)
      .eq("status", "active")
      .is("expiry_warned_at", null)
      .gt("expires_at", nowIso)
      .lte("expires_at", soonIso);
    for (const row of soon ?? []) await warnExpiring(guild, row);
  }

  async function sweep() {
    if (sweeping) return;
    sweeping = true;
    try {
      for (const guild of client.guilds.cache.values()) {
        await sweepGuild(guild).catch((err) =>
          console.warn(`[Pulse] temp-role sweep failed for ${guild.id}:`, err.message),
        );
      }
    } finally {
      sweeping = false;
    }
  }

  async function start() {
    // Delay the first sweep so the member cache is warm (mirrors milestones).
    setTimeout(() => {
      void sweep();
      timer = setInterval(() => void sweep(), SWEEP_MS);
      if (timer.unref) timer.unref();
    }, 20_000);
    console.log("[Pulse] Temporary Roles system started.");
  }

  return { start, sweep };
}

module.exports = { createTemporaryRoles };
