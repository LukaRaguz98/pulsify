// Levels & XP System (bot side) — PULSIFY-26.
//
// The bot is the writer of `member_levels`. It awards XP for the things members
// do — sending messages, sitting in voice, running commands, entering giveaways,
// marking interest in events — detects when a member crosses into a new level,
// assigns reward roles, and (optionally) announces the level-up. The dashboard
// owns `leveling_settings` (rates, cooldowns, curve, ignored channels/roles,
// reward roles, announcement config) and reads both tables; realtime keeps this
// module's per-guild config cache fresh.
//
// The curve math, settings normalisation, reward resolution and message
// templating MIRROR pulsify-web-app/lib/leveling.ts — keep the two in sync (same
// as giveaways.js ↔ lib/giveaways.ts). XP is the source of truth; the `level`
// column is a denormalised cache the bot keeps current so the dashboard can sort
// without knowing the curve.

const { MessageFlags } = require("discord.js");
const { recordNotification } = require("./notifications");
const {
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  text,
  divider,
} = require("./commands");

// ── Pure helpers (mirror of lib/leveling.ts) ─────────────────────────────────

const DEFAULT_CURVE = { base: 100, factor: 50, quadratic: 5 };
const MAX_LEVEL = 1000;
const DEFAULT_LEVELUP_MESSAGE = "GG {mention}, you just reached **level {level}**!";

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampFloat(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function toStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.length > 0);
}

function normaliseCurve(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    base: clampNum(r.base, 1, 100_000, DEFAULT_CURVE.base),
    factor: clampNum(r.factor, 0, 100_000, DEFAULT_CURVE.factor),
    quadratic: clampNum(r.quadratic, 0, 10_000, DEFAULT_CURVE.quadratic),
  };
}

function xpToAdvance(level, curve = DEFAULT_CURVE) {
  const l = Math.max(0, level);
  return curve.quadratic * l * l + curve.factor * l + curve.base;
}

function xpForLevel(level, curve = DEFAULT_CURVE) {
  let total = 0;
  const target = Math.min(Math.max(0, Math.floor(level)), MAX_LEVEL);
  for (let l = 0; l < target; l++) total += xpToAdvance(l, curve);
  return total;
}

function levelForXp(totalXp, curve = DEFAULT_CURVE) {
  const xp = Math.max(0, totalXp);
  let level = 0;
  let cost = xpForLevel(1, curve);
  while (xp >= cost && level < MAX_LEVEL) {
    level++;
    cost += xpToAdvance(level, curve);
  }
  return level;
}

function progressInLevel(totalXp, curve = DEFAULT_CURVE) {
  const xp = Math.max(0, Math.floor(totalXp));
  const level = levelForXp(xp, curve);
  const levelStartXp = xpForLevel(level, curve);
  const nextLevelXp = xpForLevel(level + 1, curve);
  const span = Math.max(1, nextLevelXp - levelStartXp);
  const intoLevel = xp - levelStartXp;
  return {
    level,
    totalXp: xp,
    levelStartXp,
    nextLevelXp,
    intoLevel,
    span,
    toNext: Math.max(0, nextLevelXp - xp),
    pct: Math.max(0, Math.min(100, Math.round((intoLevel / span) * 100))),
  };
}

const LEVELING_LIMITS = {
  maxXpPerEvent: 100_000,
  maxCooldownSeconds: 86_400,
  maxMultiplier: 100,
  maxRewards: 50,
  maxRewardLevel: MAX_LEVEL,
  maxIgnored: 100,
  maxMessage: 500,
};

function defaultLevelingConfig() {
  return {
    enabled: true,
    xp_per_message_min: 15,
    xp_per_message_max: 25,
    message_cooldown_seconds: 60,
    xp_per_voice_minute: 5,
    xp_per_command: 5,
    command_cooldown_seconds: 60,
    xp_per_giveaway_entry: 25,
    xp_per_event: 50,
    xp_multiplier: 1,
    curve: { ...DEFAULT_CURVE },
    ignored_channel_ids: [],
    ignored_role_ids: [],
    levelup_announce: "off",
    levelup_channel_id: null,
    levelup_message: DEFAULT_LEVELUP_MESSAGE,
    rewards: [],
    stack_rewards: false,
  };
}

function normaliseAnnounce(v) {
  return v === "current" || v === "channel" || v === "dm" || v === "off" ? v : "off";
}

function normaliseRewards(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    // Clamp from 0 (not 1) so a level-0 / negative reward is dropped by the
    // guard below rather than silently promoted to level 1.
    const level = clampNum(r.level, 0, LEVELING_LIMITS.maxRewardLevel, 0);
    const roleId = typeof r.role_id === "string" ? r.role_id : "";
    if (level < 1 || !roleId || seen.has(level)) continue;
    seen.add(level);
    out.push({ level, role_id: roleId });
  }
  return out.sort((a, b) => a.level - b.level).slice(0, LEVELING_LIMITS.maxRewards);
}

function normaliseLevelingSettings(row) {
  const base = defaultLevelingConfig();
  if (!row) return base;
  const enabled = typeof row.enabled === "boolean" ? row.enabled : base.enabled;
  const s = row.settings && typeof row.settings === "object" ? row.settings : {};

  const min = clampNum(s.xp_per_message_min, 0, LEVELING_LIMITS.maxXpPerEvent, base.xp_per_message_min);
  const max = clampNum(s.xp_per_message_max, 0, LEVELING_LIMITS.maxXpPerEvent, base.xp_per_message_max);

  return {
    enabled,
    xp_per_message_min: Math.min(min, max),
    xp_per_message_max: Math.max(min, max),
    message_cooldown_seconds: clampNum(s.message_cooldown_seconds, 0, LEVELING_LIMITS.maxCooldownSeconds, base.message_cooldown_seconds),
    xp_per_voice_minute: clampNum(s.xp_per_voice_minute, 0, LEVELING_LIMITS.maxXpPerEvent, base.xp_per_voice_minute),
    xp_per_command: clampNum(s.xp_per_command, 0, LEVELING_LIMITS.maxXpPerEvent, base.xp_per_command),
    command_cooldown_seconds: clampNum(s.command_cooldown_seconds, 0, LEVELING_LIMITS.maxCooldownSeconds, base.command_cooldown_seconds),
    xp_per_giveaway_entry: clampNum(s.xp_per_giveaway_entry, 0, LEVELING_LIMITS.maxXpPerEvent, base.xp_per_giveaway_entry),
    xp_per_event: clampNum(s.xp_per_event, 0, LEVELING_LIMITS.maxXpPerEvent, base.xp_per_event),
    xp_multiplier: clampFloat(s.xp_multiplier, 0, LEVELING_LIMITS.maxMultiplier, base.xp_multiplier),
    curve: normaliseCurve(s.curve),
    ignored_channel_ids: toStringArray(s.ignored_channel_ids).slice(0, LEVELING_LIMITS.maxIgnored),
    ignored_role_ids: toStringArray(s.ignored_role_ids).slice(0, LEVELING_LIMITS.maxIgnored),
    levelup_announce: normaliseAnnounce(s.levelup_announce),
    levelup_channel_id: typeof s.levelup_channel_id === "string" && s.levelup_channel_id ? s.levelup_channel_id : null,
    levelup_message:
      typeof s.levelup_message === "string" && s.levelup_message.trim()
        ? s.levelup_message.slice(0, LEVELING_LIMITS.maxMessage)
        : base.levelup_message,
    rewards: normaliseRewards(s.rewards),
    stack_rewards: Boolean(s.stack_rewards),
  };
}

function allRewardRoleIds(rewards) {
  return [...new Set(rewards.map((r) => r.role_id))];
}

function earnedRewardRoleIds(level, rewards, stack) {
  const eligible = rewards.filter((r) => r.level <= level);
  if (eligible.length === 0) return [];
  if (stack) return [...new Set(eligible.map((r) => r.role_id))];
  const highest = eligible.reduce((a, b) => (b.level > a.level ? b : a));
  return [highest.role_id];
}

function newlyEarnedRewards(oldLevel, newLevel, rewards) {
  return rewards.filter((r) => r.level > oldLevel && r.level <= newLevel);
}

function renderLevelupMessage(template, ctx) {
  return String(template)
    .replace(/\{user\}/g, ctx.user)
    .replace(/\{mention\}/g, ctx.mention)
    .replace(/\{level\}/g, String(ctx.level))
    .replace(/\{server\}/g, ctx.server);
}

/** A small unicode progress bar for the /rank embed. */
function progressBar(pct, width = 14) {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// ── Module ───────────────────────────────────────────────────────────────────

const VOICE_TICK_MS = 60 * 1000; // award voice XP once a minute

function createLeveling(client, supabase, rewards = null, shop = null) {
  // guildId -> normalised config (seeded on start, kept fresh via realtime)
  const configs = new Map();
  // `${guildId}:${userId}` -> last message-XP timestamp (anti-spam, in-memory)
  const messageCooldowns = new Map();
  const commandCooldowns = new Map();
  let voiceTimer = null;

  async function getConfig(guildId) {
    if (configs.has(guildId)) return configs.get(guildId);
    // Lazy-load a guild we haven't cached yet (e.g. joined after start). A
    // missing row means "enabled with defaults".
    const { data } = await supabase
      .from("leveling_settings")
      .select("enabled, settings")
      .eq("guild_id", guildId)
      .maybeSingle();
    const cfg = normaliseLevelingSettings(data ?? null);
    configs.set(guildId, cfg);
    return cfg;
  }

  // ── Embeds ─────────────────────────────────────────────────────────────────

  async function levelupContainer(guild, member, newLevel, rewards) {
    const colorHex = await getPulseColor(supabase, guild.id);
    const cfg = await getConfig(guild.id);
    const rendered = renderLevelupMessage(cfg.levelup_message, {
      user: member.displayName,
      mention: `<@${member.id}>`,
      level: newLevel,
      server: guild.name,
    });
    const body = [text(rendered)];
    if (rewards.length > 0) {
      body.push(text(`-# Unlocked: ${rewards.map((r) => `<@&${r.role_id}>`).join(", ")}`));
    }
    return buildPulseContainer({
      iconUrl: member.displayAvatarURL({ size: 128 }),
      colorHex,
      title: `Level ${newLevel}`,
      subtitle: member.displayName,
      body,
      footer: "Pulse — Level up",
    });
  }

  async function announceLevelup(guild, member, newLevel, rewards, sourceChannel) {
    const cfg = await getConfig(guild.id);
    if (cfg.levelup_announce === "off") return;

    const container = await levelupContainer(guild, member, newLevel, rewards);
    const payload = { flags: MessageFlags.IsComponentsV2, components: [container], allowedMentions: { users: [member.id] } };

    try {
      if (cfg.levelup_announce === "dm") {
        await member.send(payload).catch(() => {});
        return;
      }
      let channel = null;
      if (cfg.levelup_announce === "current" && sourceChannel?.isTextBased?.()) {
        channel = sourceChannel;
      } else if (cfg.levelup_channel_id) {
        channel = await client.channels.fetch(cfg.levelup_channel_id).catch(() => null);
      } else if (cfg.levelup_announce === "current" && cfg.levelup_channel_id == null) {
        // Voice level-up with no text source and no configured channel — skip.
        return;
      }
      if (channel?.isTextBased?.()) await channel.send(payload).catch(() => {});
    } catch {
      /* best-effort — never let an announcement failure break XP tracking */
    }
  }

  // ── Reward roles ─────────────────────────────────────────────────────────────

  async function applyRewardRoles(member, cfg, newLevel) {
    if (cfg.rewards.length === 0) return;
    const earned = new Set(earnedRewardRoleIds(newLevel, cfg.rewards, cfg.stack_rewards));
    const all = allRewardRoleIds(cfg.rewards);
    for (const roleId of all) {
      try {
        const has = member.roles.cache.has(roleId);
        if (earned.has(roleId) && !has) {
          await member.roles.add(roleId, "Pulse level reward").catch(() => {});
        } else if (!earned.has(roleId) && has) {
          await member.roles.remove(roleId, "Pulse level reward (replaced)").catch(() => {});
        }
      } catch {
        /* role above the bot / missing perms — skip silently */
      }
    }
  }

  // ── Core: award XP, detect level-up ──────────────────────────────────────────

  async function addXp(guild, member, rawAmount, cfg, sourceChannel) {
    // Two distinct multipliers stack: the guild's configured xp_multiplier and
    // the member's personal shop XP booster (a temporary purchase, looked up
    // from the shop's in-memory registry — no DB hit on this hot path). The
    // booster is applied to XP only; coins ride rawAmount below, so a booster
    // never inflates the global economy.
    const boost = shop?.getBoosterMultiplier ? shop.getBoosterMultiplier(guild.id, member.id) : 1;
    const amount = Math.floor(Math.max(0, rawAmount) * (cfg.xp_multiplier || 1) * (boost || 1));
    if (amount <= 0) return;

    let newXp;
    try {
      const { data, error } = await supabase.rpc("add_member_xp", {
        p_guild_id: guild.id,
        p_user_id: member.id,
        p_user_name: member.displayName,
        p_amount: amount,
      });
      if (error) {
        console.warn("[Pulse] add_member_xp failed:", error.message);
        return;
      }
      newXp = Number(data);
    } catch (err) {
      console.warn("[Pulse] add_member_xp threw:", err.message);
      return;
    }
    if (!Number.isFinite(newXp)) return;

    // Activity Pulse Coins are NO LONGER tied to XP (PULSIFY-47): the economy
    // rewards engine owns its own message/voice/command listeners with
    // independent amounts, cooldowns and caps, so earning works even when XP is
    // off. Only the level-up bonus rides this hook (it needs the new level).

    // oldXp is derivable (we know exactly how much we just added), so detecting
    // a level-up costs no extra read — the atomic RPC already serialised the add.
    const oldLevel = levelForXp(newXp - amount, cfg.curve);
    const newLevel = levelForXp(newXp, cfg.curve);
    if (newLevel === oldLevel) return;

    // Persist the new level cache (only changes here, so this write is rare).
    await supabase
      .from("member_levels")
      .update({ level: newLevel, updated_at: new Date().toISOString() })
      .eq("guild_id", guild.id)
      .eq("user_id", member.id);

    if (newLevel <= oldLevel) return; // a curve change lowered it — no celebration

    // Level-up bonus: configurable global coins (server level itself stays
    // local). Routed through the rewards engine so the amount, multipliers and
    // anti-abuse caps all honour the guild's reward config.
    if (rewards?.awardLevelUp) void rewards.awardLevelUp(guild, member, newLevel);

    const earnedNow = newlyEarnedRewards(oldLevel, newLevel, cfg.rewards);
    await applyRewardRoles(member, cfg, newLevel);
    await announceLevelup(guild, member, newLevel, earnedNow, sourceChannel);

    await recordNotification(supabase, {
      guildId: guild.id,
      type: "level_up",
      title: `${member.displayName} reached level ${newLevel}`,
      body: earnedNow.length > 0 ? `Unlocked ${earnedNow.length} reward role${earnedNow.length === 1 ? "" : "s"}.` : null,
      link: `/dashboard/${guild.id}/members`,
      targetId: member.id,
      targetName: member.displayName,
      metadata: { level: newLevel, xp: newXp },
    });
  }

  function ignoredFor(cfg, member, channelId) {
    if (channelId && cfg.ignored_channel_ids.includes(channelId)) return true;
    if (cfg.ignored_role_ids.length > 0 && member?.roles?.cache) {
      for (const roleId of cfg.ignored_role_ids) {
        if (member.roles.cache.has(roleId)) return true;
      }
    }
    return false;
  }

  function onCooldown(map, key, seconds) {
    if (seconds <= 0) return false;
    const last = map.get(key) ?? 0;
    const now = Date.now();
    if (now - last < seconds * 1000) return true;
    map.set(key, now);
    return false;
  }

  // ── Award hooks (called from index.js / giveaways.js) ────────────────────────

  async function awardMessage(message) {
    try {
      if (!message.guild || message.author.bot || !message.member) return;
      const cfg = await getConfig(message.guild.id);
      if (!cfg.enabled || cfg.xp_per_message_max <= 0) return;
      if (ignoredFor(cfg, message.member, message.channelId)) return;
      const key = `${message.guild.id}:${message.author.id}`;
      if (onCooldown(messageCooldowns, key, cfg.message_cooldown_seconds)) return;
      const span = cfg.xp_per_message_max - cfg.xp_per_message_min;
      const amount = cfg.xp_per_message_min + Math.floor(Math.random() * (span + 1));
      await addXp(message.guild, message.member, amount, cfg, message.channel);
    } catch (err) {
      console.warn("[Pulse] awardMessage failed:", err.message);
    }
  }

  async function awardCommand(interaction) {
    try {
      if (!interaction.guild) return;
      const cfg = await getConfig(interaction.guild.id);
      if (!cfg.enabled || cfg.xp_per_command <= 0) return;
      const member = interaction.member && interaction.member.roles?.cache
        ? interaction.member
        : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return;
      if (ignoredFor(cfg, member, interaction.channelId)) return;
      const key = `${interaction.guild.id}:${interaction.user.id}`;
      if (onCooldown(commandCooldowns, key, cfg.command_cooldown_seconds)) return;
      await addXp(interaction.guild, member, cfg.xp_per_command, cfg, interaction.channel);
    } catch (err) {
      console.warn("[Pulse] awardCommand failed:", err.message);
    }
  }

  async function awardGiveawayEntry(guild, member, channel) {
    try {
      if (!guild || !member) return;
      const cfg = await getConfig(guild.id);
      if (!cfg.enabled || cfg.xp_per_giveaway_entry <= 0) return;
      if (ignoredFor(cfg, member, channel?.id)) return;
      await addXp(guild, member, cfg.xp_per_giveaway_entry, cfg, channel);
    } catch (err) {
      console.warn("[Pulse] awardGiveawayEntry failed:", err.message);
    }
  }

  async function awardEventInterest(guild, member) {
    try {
      if (!guild || !member || member.user?.bot) return;
      const cfg = await getConfig(guild.id);
      if (!cfg.enabled || cfg.xp_per_event <= 0) return;
      if (ignoredFor(cfg, member, null)) return;
      await addXp(guild, member, cfg.xp_per_event, cfg, null);
    } catch (err) {
      console.warn("[Pulse] awardEventInterest failed:", err.message);
    }
  }

  // ── Voice XP tick ────────────────────────────────────────────────────────────

  async function voiceTick() {
    for (const guild of client.guilds.cache.values()) {
      let cfg;
      try {
        cfg = await getConfig(guild.id);
      } catch {
        continue;
      }
      if (!cfg.enabled || cfg.xp_per_voice_minute <= 0) continue;

      // Group voice members by channel so we can require company (anti-farm).
      const byChannel = new Map();
      for (const vs of guild.voiceStates.cache.values()) {
        const channelId = vs.channelId;
        if (!channelId || channelId === guild.afkChannelId) continue;
        const member = vs.member;
        if (!member || member.user?.bot) continue;
        if (!byChannel.has(channelId)) byChannel.set(channelId, []);
        byChannel.get(channelId).push(member);
      }

      for (const [channelId, members] of byChannel) {
        if (cfg.ignored_channel_ids.includes(channelId)) continue;
        if (members.length < 2) continue; // alone in a call earns nothing
        for (const member of members) {
          if (ignoredFor(cfg, member, channelId)) continue;
          await addXp(guild, member, cfg.xp_per_voice_minute, cfg, null);
        }
      }
    }
  }

  // ── Slash commands (delegated from commands.js execute) ──────────────────────

  async function rankInfo(guild, userId, userName) {
    const cfg = await getConfig(guild.id);
    const { data: row } = await supabase
      .from("member_levels")
      .select("xp, level")
      .eq("guild_id", guild.id)
      .eq("user_id", userId)
      .maybeSingle();
    const xp = Number(row?.xp ?? 0);
    const prog = progressInLevel(xp, cfg.curve);

    let rank = null;
    if (xp > 0) {
      const { count } = await supabase
        .from("member_levels")
        .select("user_id", { count: "exact", head: true })
        .eq("guild_id", guild.id)
        .gt("xp", xp);
      rank = (count ?? 0) + 1;
    }
    const { count: tracked } = await supabase
      .from("member_levels")
      .select("user_id", { count: "exact", head: true })
      .eq("guild_id", guild.id);

    return { xp, prog, rank, tracked: tracked ?? 0, enabled: cfg.enabled, userName };
  }

  async function handleLeaderboardCommand({ interaction, guild, ephemeral }) {
    const colorHex = await getPulseColor(supabase, guild.id);
    const cfg = await getConfig(guild.id);
    const icon = await loadPulseIcon("stats", colorHex);

    const { data: rows } = await supabase
      .from("member_levels")
      .select("user_id, user_name, xp, level")
      .eq("guild_id", guild.id)
      .order("xp", { ascending: false })
      .limit(10);

    const top = rows ?? [];
    const body = [];
    if (top.length === 0) {
      body.push(text("No one has earned any XP yet. Start chatting to climb the leaderboard!"));
    } else {
      const lines = top.map((r, i) => {
        const rankLabel = `**${i + 1}.**`;
        const level = Number(r.level ?? levelForXp(Number(r.xp ?? 0), cfg.curve));
        const name = r.user_name ? r.user_name : `<@${r.user_id}>`;
        return `${rankLabel} ${name} — **Lvl ${level}** — ${Number(r.xp ?? 0).toLocaleString()} XP`;
      });
      body.push(text(lines.join("\n")));

      // The invoker's own standing, if they're not already in the top 10.
      const me = await rankInfo(guild, interaction.user.id, interaction.user.username);
      if (me.rank && me.rank > top.length) {
        body.push(divider());
        body.push(text(`-# Your rank: #${me.rank} — Lvl ${me.prog.level} — ${me.prog.totalXp.toLocaleString()} XP`));
      }
    }

    await interaction.reply({
      flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
      components: [
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title: "Leaderboard",
          subtitle: guild.name,
          body,
          footer: "Pulse — Top members by XP",
        }),
      ],
      files: icon ? [icon] : [],
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async function reload() {
    const { data, error } = await supabase.from("leveling_settings").select("guild_id, enabled, settings");
    if (error) {
      console.warn("[Pulse] leveling settings load failed:", error.message);
      return;
    }
    configs.clear();
    for (const row of data ?? []) configs.set(row.guild_id, normaliseLevelingSettings(row));
    console.log(`[Pulse] Loaded leveling config for ${configs.size} guild(s).`);
  }

  function subscribe() {
    supabase
      .channel("leveling-settings-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "leveling_settings" }, (payload) => {
        const guildId = payload.new?.guild_id ?? payload.old?.guild_id;
        if (!guildId) return;
        if (payload.eventType === "DELETE") {
          configs.delete(guildId); // back to defaults (enabled) on next read
          return;
        }
        if (payload.new) configs.set(guildId, normaliseLevelingSettings(payload.new));
      })
      .subscribe();
  }

  async function start() {
    await reload();
    subscribe();
    // Start the voice tick a little after ready so the voice-state cache is warm
    // (mirrors the giveaway tick's startup delay).
    setTimeout(() => {
      void voiceTick();
      voiceTimer = setInterval(() => void voiceTick(), VOICE_TICK_MS);
      if (voiceTimer.unref) voiceTimer.unref();
    }, 15_000);
    console.log("[Pulse] Leveling system started.");
  }

  return {
    start,
    reload,
    awardMessage,
    awardCommand,
    awardGiveawayEntry,
    awardEventInterest,
    getLevelInfo: rankInfo,
    handleLeaderboardCommand,
  };
}

module.exports = {
  createLeveling,
  // Pure helpers exported for unit tests + reuse.
  DEFAULT_CURVE,
  MAX_LEVEL,
  xpToAdvance,
  xpForLevel,
  levelForXp,
  progressInLevel,
  defaultLevelingConfig,
  normaliseLevelingSettings,
  normaliseRewards,
  allRewardRoleIds,
  earnedRewardRoleIds,
  newlyEarnedRewards,
  renderLevelupMessage,
  progressBar,
};
