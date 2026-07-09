// Self-Assign Roles (bot side) — PULSIFY-56.
//
// The DASHBOARD owns the menu lifecycle (the API routes under
// /api/discord/guild/[guildId]/self-roles): it creates/edits/duplicates menus
// and POSTS / edits the Discord message (a Components V2 container of role
// buttons or a select menu). This module owns the INTERACTIONS:
//   • handles the `sr:btn:<menuId>:<roleId>` buttons + `sr:sel:<menuId>` select,
//   • toggles the member's roles, honouring the menu's selection mode
//     ('multiple' = toggle any; 'single' = mutually exclusive, switching) and an
//     optional required-role gate,
//   • appends a `self_role_assignments` row per change so the dashboard can
//     report usage analytics.
// It keeps a realtime-synced cache of active menus so a click never waits on a
// DB round-trip, and reloads everything on startup so menus posted while the bot
// was offline keep working (the custom_ids are persistent).
//
// The selection-mode rules + the `sr:` custom_id scheme MIRROR
// pulsify-web-app/lib/self-roles.ts — keep the two in sync (same as
// giveaways.js ↔ lib/giveaways.ts).

const { Events } = require("discord.js");
const { replyNotice } = require("./commands");

const SR = "sr";

function createSelfRoles(client, supabase) {
  // menuId -> menu row (active menus only; others drop out of cache)
  const cache = new Map();

  // ── Persistence / cache ──────────────────────────────────────────────────

  async function reload() {
    const { data, error } = await supabase
      .from("self_role_menus")
      .select("*")
      .eq("status", "active");
    if (error) {
      console.warn("[Pulse] self-role menus load failed:", error.message);
      return;
    }
    cache.clear();
    for (const row of data ?? []) cache.set(row.id, row);
    console.log(`[Pulse] Loaded ${cache.size} active self-role menu(s).`);
  }

  function subscribe() {
    supabase
      .channel("self-roles-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "self_role_menus" }, (payload) => {
        if (payload.eventType === "DELETE") {
          if (payload.old?.id) cache.delete(payload.old.id);
          return;
        }
        const row = payload.new;
        if (!row) return;
        if (row.status === "active") cache.set(row.id, row);
        else cache.delete(row.id);
      })
      .subscribe();
  }

  async function loadMenu(id) {
    const cached = cache.get(id);
    if (cached) return cached;
    const { data } = await supabase.from("self_role_menus").select("*").eq("id", id).maybeSingle();
    return data ?? null;
  }

  // ── Helpers mirrored from lib/self-roles.ts ──────────────────────────────

  function menuRoleIds(menu) {
    const roles = Array.isArray(menu.roles) ? menu.roles : [];
    return roles.map((r) => (r && typeof r.role_id === "string" ? r.role_id : null)).filter(Boolean);
  }

  function requiredRoleIds(menu) {
    return Array.isArray(menu.required_role_ids)
      ? menu.required_role_ids.filter((x) => typeof x === "string")
      : [];
  }

  // Does the member satisfy the menu's required-role gate?
  function passesGate(menu, member) {
    const required = requiredRoleIds(menu);
    if (required.length === 0) return true;
    const held = required.filter((id) => member.roles.cache.has(id));
    return menu.required_role_mode === "all" ? held.length === required.length : held.length > 0;
  }

  // Can the bot manage this role (exists, not managed, below the bot's top role)?
  function canAssign(guild, roleId) {
    const role = guild.roles.cache.get(roleId);
    if (!role || role.managed) return false;
    const botTop = guild.members.me?.roles?.highest?.position ?? 0;
    return role.position < botTop;
  }

  function roleName(menu, roleId, guild) {
    const entry = (Array.isArray(menu.roles) ? menu.roles : []).find((r) => r.role_id === roleId);
    return guild.roles.cache.get(roleId)?.name ?? entry?.label ?? roleId;
  }

  async function logChanges(menu, member, changes, guild) {
    if (changes.length === 0) return;
    try {
      const displayName = member.displayName ?? member.user?.globalName ?? member.user?.username ?? null;
      await supabase.from("self_role_assignments").insert(
        changes.map((c) => ({
          guild_id: guild.id,
          menu_id: menu.id,
          user_id: member.id,
          user_name: displayName,
          role_id: c.roleId,
          role_name: roleName(menu, c.roleId, guild),
          action: c.action,
        })),
      );
    } catch (err) {
      console.warn("[Pulse] self-role assignment log failed:", err.message);
    }
  }

  // ── Core: apply a desired set of role changes for one member ──────────────
  //
  // `desired` is the full set of THIS MENU's roles the member should end up
  // holding. We diff it against what they hold now (within the menu) and apply
  // the adds/removes — never touching roles outside the menu. Returns a summary
  // for the ephemeral reply.
  async function applyDesired(menu, member, guild, desired) {
    const offered = new Set(menuRoleIds(menu));
    const desiredSet = new Set([...desired].filter((id) => offered.has(id)));
    const heldInMenu = new Set([...offered].filter((id) => member.roles.cache.has(id)));

    const toAdd = [...desiredSet].filter((id) => !heldInMenu.has(id));
    const toRemove = [...heldInMenu].filter((id) => !desiredSet.has(id));

    const added = [];
    const removed = [];
    const failed = [];
    const changes = [];

    for (const id of toRemove) {
      try {
        await member.roles.remove(id, "Self-role menu");
        removed.push(roleName(menu, id, guild));
        changes.push({ roleId: id, action: "removed" });
      } catch {
        failed.push(roleName(menu, id, guild));
      }
    }
    for (const id of toAdd) {
      if (!canAssign(guild, id)) {
        failed.push(roleName(menu, id, guild));
        continue;
      }
      try {
        await member.roles.add(id, "Self-role menu");
        added.push(roleName(menu, id, guild));
        changes.push({ roleId: id, action: "added" });
      } catch {
        failed.push(roleName(menu, id, guild));
      }
    }

    await logChanges(menu, member, changes, guild);
    return { added, removed, failed };
  }

  function summarise({ added, removed, failed }) {
    const parts = [];
    if (added.length) parts.push(`Added ${added.map((n) => `**${n}**`).join(", ")}`);
    if (removed.length) parts.push(`Removed ${removed.map((n) => `**${n}**`).join(", ")}`);
    if (parts.length === 0 && failed.length === 0) return "No changes — your roles are already up to date.";
    let msg = parts.join(". ");
    if (failed.length) {
      const note = `I couldn't update ${failed.map((n) => `**${n}**`).join(", ")} — it may sit above my highest role.`;
      msg = msg ? `${msg}. ${note}` : note;
    }
    return msg ? `${msg}.` : "Done.";
  }

  // ── Interaction flow ─────────────────────────────────────────────────────

  async function handle(interaction, menuId, kind, buttonRoleId) {
    const menu = await loadMenu(menuId);
    if (!menu || menu.status !== "active") {
      return replyNotice(interaction, "This role menu is no longer available.");
    }
    const guild = interaction.guild;
    const member = interaction.member;
    if (!guild || !member) return replyNotice(interaction, "I couldn't find your membership in this server.");

    if (!passesGate(menu, member)) {
      return replyNotice(
        interaction,
        menu.required_role_mode === "all"
          ? "You don't have the roles required to use this menu."
          : "You don't have a role required to use this menu.",
      );
    }

    const offered = new Set(menuRoleIds(menu));
    const single = menu.selection_mode === "single";

    let desired;
    if (kind === "button") {
      if (!offered.has(buttonRoleId)) return replyNotice(interaction, "That role is no longer part of this menu.");
      const has = member.roles.cache.has(buttonRoleId);
      if (has) {
        // Toggle off — keep every other held menu role.
        desired = [...offered].filter((id) => id !== buttonRoleId && member.roles.cache.has(id));
      } else if (single) {
        // Switch — this role only.
        desired = [buttonRoleId];
      } else {
        // Toggle on — add to the held set.
        desired = [...new Set([...[...offered].filter((id) => member.roles.cache.has(id)), buttonRoleId])];
      }
    } else {
      // Select menu — the chosen values ARE the desired set within the menu.
      const chosen = (interaction.values ?? []).filter((id) => offered.has(id));
      desired = single ? chosen.slice(0, 1) : chosen;
    }

    const result = await applyDesired(menu, member, guild, desired);
    return replyNotice(interaction, summarise(result));
  }

  async function onInteraction(interaction) {
    try {
      const id = interaction.customId ?? "";
      if (!id.startsWith(`${SR}:`)) return;
      const parts = id.split(":");
      const action = parts[1];
      const menuId = parts[2];
      if (action === "btn" && interaction.isButton?.()) {
        return handle(interaction, menuId, "button", parts[3]);
      }
      if (action === "sel" && interaction.isStringSelectMenu?.()) {
        return handle(interaction, menuId, "select");
      }
    } catch (err) {
      console.error("[Pulse] Self-role interaction failed:", err.message);
      if (interaction && !interaction.replied && !interaction.deferred) {
        await replyNotice(interaction, "Something went wrong updating your roles.").catch(() => {});
      }
    }
  }

  async function start() {
    await reload();
    subscribe();
    client.on(Events.InteractionCreate, onInteraction);
    console.log("[Pulse] Self-Assign Roles system started.");
  }

  return { start, reload };
}

module.exports = { createSelfRoles };
