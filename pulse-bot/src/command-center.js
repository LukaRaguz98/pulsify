// Command Center enforcement (bot side).
//
// Reads per-guild overrides from `command_configs` and enforces them at
// registration (which commands exist + their Discord default permissions) and
// at execution (enable/maintenance, channel + role allow/deny, baseline access
// level, per-user cooldown, daily usage cap). Every attempt — allowed or
// blocked — is written to `command_logs` for the dashboard analytics + log.

const { PermissionFlagsBits } = require("discord.js");
const { COMMANDS, COMMANDS_BY_NAME, defaultMemberPermissionsFor } = require("./commands");

const CACHE_TTL_MS = 60_000;
// guildId -> { configs: Map<commandName, row>, fetchedAt }
const configCache = new Map();
// `${guildId}:${command}:${userId}` -> cooldown expiry (epoch ms)
const cooldowns = new Map();

function defaultConfig() {
  return {
    enabled: true,
    hidden: false,
    category: null,
    permission_level: "inherit",
    allowed_role_ids: [],
    denied_role_ids: [],
    allowed_channel_ids: [],
    denied_channel_ids: [],
    cooldown_seconds: 0,
    usage_limit_per_day: 0,
    maintenance: false,
    ephemeral: true,
  };
}

async function loadConfigs(supabase, guildId, { force = false } = {}) {
  const cached = configCache.get(guildId);
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.configs;
  }
  const { data, error } = await supabase
    .from("command_configs")
    .select("*")
    .eq("guild_id", guildId);
  if (error) {
    console.warn(`[Pulse] command_configs load failed for ${guildId}:`, error.message);
    // Serve stale cache if we have it; otherwise an empty map → all defaults.
    return cached?.configs ?? new Map();
  }
  const map = new Map();
  for (const row of data ?? []) map.set(row.command_name, row);
  configCache.set(guildId, { configs: map, fetchedAt: Date.now() });
  return map;
}

function invalidateConfigs(guildId) {
  configCache.delete(guildId);
}

function resolveConfig(configMap, name) {
  return { ...defaultConfig(), ...(configMap.get(name) ?? {}) };
}

function effectivePermission(def, config) {
  return config.permission_level === "inherit" ? def.defaultPermission : config.permission_level;
}

/** Whether a member satisfies a baseline access level. Admins always pass. */
function memberMeetsLevel(member, level) {
  const perms = member?.permissions;
  if (!perms) return level === "everyone";
  if (perms.has(PermissionFlagsBits.Administrator)) return true;
  if (level === "everyone") return true;
  if (level === "admin") return perms.has(PermissionFlagsBits.ManageGuild);
  // moderator
  return (
    perms.has(PermissionFlagsBits.ManageGuild) ||
    perms.has(PermissionFlagsBits.ManageMessages) ||
    perms.has(PermissionFlagsBits.KickMembers) ||
    perms.has(PermissionFlagsBits.BanMembers) ||
    perms.has(PermissionFlagsBits.ModerateMembers)
  );
}

function memberRoleIds(member) {
  return member?.roles?.cache ? [...member.roles.cache.keys()] : [];
}

/**
 * Resolve whether a member may run a command in a given channel. Precedence:
 *   1. Channel deny  → blocked
 *   2. Channel allow-list non-empty → must be in it
 *   3. Role deny     → blocked
 *   4. Role allow-list non-empty → must have one (overrides the access level)
 *   5. Baseline access level (everyone/moderator/admin)
 */
function checkAccess(def, config, member, channelId) {
  if (config.denied_channel_ids?.includes(channelId)) {
    return { allowed: false, status: "denied", reason: "This command is blocked in this channel." };
  }
  if (config.allowed_channel_ids?.length && !config.allowed_channel_ids.includes(channelId)) {
    return { allowed: false, status: "denied", reason: "This command can only be used in specific channels." };
  }
  const roleIds = memberRoleIds(member);
  if (config.denied_role_ids?.length && roleIds.some((r) => config.denied_role_ids.includes(r))) {
    return { allowed: false, status: "denied", reason: "Your role is not allowed to use this command." };
  }
  if (config.allowed_role_ids?.length) {
    if (!roleIds.some((r) => config.allowed_role_ids.includes(r))) {
      return { allowed: false, status: "denied", reason: "You need a specific role to use this command." };
    }
    return { allowed: true };
  }
  const level = effectivePermission(def, config);
  if (!memberMeetsLevel(member, level)) {
    return { allowed: false, status: "denied", reason: `This command requires ${level} permissions.` };
  }
  return { allowed: true };
}

/** Remaining cooldown in seconds for this member, or 0 if ready. */
function cooldownRemaining(guildId, name, userId, cooldownSeconds) {
  if (!cooldownSeconds) return 0;
  const key = `${guildId}:${name}:${userId}`;
  const expiry = cooldowns.get(key);
  if (!expiry) return 0;
  const remaining = Math.ceil((expiry - Date.now()) / 1000);
  return remaining > 0 ? remaining : 0;
}

function markCooldown(guildId, name, userId, cooldownSeconds) {
  if (!cooldownSeconds) return;
  cooldowns.set(`${guildId}:${name}:${userId}`, Date.now() + cooldownSeconds * 1000);
}

/** True when the guild has hit the command's daily success cap. */
async function dailyLimitReached(supabase, guildId, name, limit) {
  if (!limit) return false;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("command_logs")
    .select("id", { count: "exact", head: true })
    .eq("guild_id", guildId)
    .eq("command_name", name)
    .eq("status", "success")
    .gte("created_at", since);
  return (count ?? 0) >= limit;
}

/** Best-effort write to command_logs — never throws into the command flow. */
async function logCommand(supabase, entry) {
  try {
    const { error } = await supabase.from("command_logs").insert({
      guild_id: entry.guildId,
      command_name: entry.commandName,
      user_id: entry.userId ?? null,
      user_name: entry.userName ?? null,
      channel_id: entry.channelId ?? null,
      channel_name: entry.channelName ?? null,
      status: entry.status,
      detail: entry.detail ? String(entry.detail).slice(0, 500) : null,
      duration_ms: typeof entry.durationMs === "number" ? entry.durationMs : null,
    });
    if (error) console.warn("[Pulse] command_logs insert failed:", error.message);
  } catch (err) {
    console.warn("[Pulse] command_logs insert threw:", err.message);
  }
}

/**
 * Build the slash-command registration body for a guild from its config:
 * only enabled, non-maintenance commands, each carrying the Discord
 * default-member-permissions matching its effective access level.
 */
function buildGuildCommandBody(configMap) {
  const body = [];
  for (const cmd of COMMANDS) {
    const config = resolveConfig(configMap, cmd.name);
    if (!config.enabled || config.maintenance) continue;
    const json = cmd.data.toJSON();
    const perm = defaultMemberPermissionsFor(effectivePermission(cmd, config));
    json.default_member_permissions = perm === null ? null : String(perm);
    body.push(json);
  }
  return body;
}

/** Commands a member is permitted to run (permission/role only) — drives /help. */
async function getAllowedCommands(supabase, guild, member) {
  const configMap = await loadConfigs(supabase, guild.id);
  const out = [];
  for (const def of COMMANDS) {
    const config = resolveConfig(configMap, def.name);
    if (!config.enabled || config.maintenance || config.hidden) continue;
    // Channel-agnostic check: deny lists + allow-list membership + level.
    const roleIds = memberRoleIds(member);
    if (config.denied_role_ids?.length && roleIds.some((r) => config.denied_role_ids.includes(r))) continue;
    if (config.allowed_role_ids?.length) {
      if (!roleIds.some((r) => config.allowed_role_ids.includes(r))) continue;
    } else if (!memberMeetsLevel(member, effectivePermission(def, config))) {
      continue;
    }
    out.push({ def, config });
  }
  return out;
}

/**
 * Resolve a command attempt against config and either allow it (returning the
 * matched command + a `commit()` to call after a successful run) or block it
 * (returning the blocked status + reason). The caller is responsible for
 * logging — this returns everything needed for the log row.
 */
async function evaluate(supabase, interaction) {
  const name = interaction.commandName;
  const def = COMMANDS_BY_NAME.get(name);
  if (!def) return { kind: "unknown" };

  const guildId = interaction.guildId;
  const configMap = await loadConfigs(supabase, guildId);
  const config = resolveConfig(configMap, name);

  if (!config.enabled) {
    return { kind: "blocked", def, status: "disabled", reason: "This command is disabled in this server." };
  }
  if (config.maintenance) {
    return { kind: "blocked", def, status: "maintenance", reason: "This command is under maintenance. Try again later." };
  }

  const access = checkAccess(def, config, interaction.member, interaction.channelId);
  if (!access.allowed) {
    return { kind: "blocked", def, status: access.status, reason: access.reason };
  }

  const remaining = cooldownRemaining(guildId, name, interaction.user.id, config.cooldown_seconds);
  if (remaining > 0) {
    return { kind: "blocked", def, status: "cooldown", reason: `On cooldown — try again in ${remaining}s.` };
  }

  if (await dailyLimitReached(supabase, guildId, name, config.usage_limit_per_day)) {
    return { kind: "blocked", def, status: "rate_limited", reason: "This command has hit its daily usage limit for the server." };
  }

  return {
    kind: "allowed",
    def,
    ephemeral: config.ephemeral !== false,
    commit: () => markCooldown(guildId, name, interaction.user.id, config.cooldown_seconds),
  };
}

module.exports = {
  loadConfigs,
  invalidateConfigs,
  buildGuildCommandBody,
  getAllowedCommands,
  logCommand,
  evaluate,
};
