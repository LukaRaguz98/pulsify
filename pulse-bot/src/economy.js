// Global Economy (bot side) — PULSIFY-45.
//
// Pulse Coins are a GLOBAL currency (one balance per user, shared across every
// server) while Levels & XP stay per-guild. The bot is the main writer:
// activity coins ride the leveling hooks (leveling.js calls awardActivity /
// awardLevelUp from its addXp path, so cooldowns, ignored channels/roles and
// the voice anti-farm rule are inherited for free), and fixed bonuses come from
// giveaway wins, milestones and onboarding completion. Every coin mutation goes
// through the atomic economy_* RPCs so concurrent awards can't lose updates and
// the ledger always matches the balance.
//
// Reputation is NOT a coin: it's the existing 0-100 trust score
// (pulse-bot/src/reputation.js), only now GLOBAL — computed on the fly from the
// member's activity aggregated across every guild (get_global_member_reputation
// RPC). It is never stored or granted, so this module only READS it (for
// /wallet + /profile) — it never writes reputation.
//
// Coin rates MIRROR pulsify-web-app/lib/economy.ts — keep in sync.

const { MessageFlags } = require("discord.js");
const { computeReputation, daysSince } = require("./reputation");
const {
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  replyContainer,
  text,
  divider,
} = require("./commands");

// ── Rates (mirror of lib/economy.ts) ─────────────────────────────────────────

const CURRENCY_NAME = "Pulse Coins";

const ECONOMY_RATES = {
  coinsPerXpDivisor: 5,
  levelUpBase: 25,
  levelUpPerLevel: 5,
  giveawayWinCoins: 250,
  milestoneCoins: 100,
  onboardingCoins: 50,
  maxTransfer: 1_000_000,
};

function coinsForXp(xp) {
  if (!Number.isFinite(xp) || xp <= 0) return 0;
  return Math.ceil(xp / ECONOMY_RATES.coinsPerXpDivisor);
}

function levelUpCoins(level) {
  return ECONOMY_RATES.levelUpBase + ECONOMY_RATES.levelUpPerLevel * Math.max(1, level);
}

const fmt = (n) => Math.max(0, Math.round(Number(n) || 0)).toLocaleString();

/** Human label for a ledger row in the /wallet recent-activity list. */
function describeTransaction(t) {
  const reasonLabels = {
    activity: "Server activity",
    level_up: "Level up",
    giveaway_win: "Giveaway win",
    milestone: "Milestone",
    onboarding: "Onboarding complete",
    admin: "Administrative",
  };
  if (t.kind === "transfer_in") return `Transfer from ${t.counterparty_name ?? "a member"}`;
  if (t.kind === "transfer_out") return `Transfer to ${t.counterparty_name ?? "a member"}`;
  const base = reasonLabels[t.reason] ?? "Balance change";
  return t.guild_name ? `${base} · ${t.guild_name}` : base;
}

// ── Module ───────────────────────────────────────────────────────────────────

function createEconomy(client, supabase) {
  // ── Coin mutation (atomic RPC) ─────────────────────────────────────────────

  async function adjust(userId, userName, amount, kind, reason, opts = {}) {
    if (!Number.isFinite(amount) || amount === 0) return null;
    try {
      const { data, error } = await supabase.rpc("economy_adjust", {
        p_user_id: userId,
        p_user_name: userName ?? null,
        p_amount: Math.round(amount),
        p_kind: kind,
        p_reason: reason,
        p_note: opts.note ?? null,
        p_guild_id: opts.guildId ?? null,
        p_guild_name: opts.guildName ?? null,
        p_actor_id: opts.actorId ?? null,
        p_actor_name: opts.actorName ?? null,
      });
      if (error) {
        console.warn("[Pulse] economy_adjust failed:", error.message);
        return null;
      }
      return data === null ? null : Number(data);
    } catch (err) {
      console.warn("[Pulse] economy_adjust threw:", err.message);
      return null;
    }
  }

  // ── Coin award hooks (called from leveling.js / giveaways.js / milestones.js
  //    / onboarding.js — all best-effort, never let the economy break the
  //    caller). Reputation is computed elsewhere, so nothing here touches it. ──

  /**
   * Activity coins for an XP award. `baseXp` is the PRE-multiplier amount so a
   * guild's local XP multiplier can't inflate the global economy.
   */
  async function awardActivity(guild, member, baseXp) {
    try {
      const coins = coinsForXp(baseXp);
      if (coins > 0) {
        await adjust(member.id, member.displayName, coins, "earn", "activity", {
          guildId: guild.id,
          guildName: guild.name,
        });
      }
    } catch (err) {
      console.warn("[Pulse] awardActivity failed:", err.message);
    }
  }

  async function awardLevelUp(guild, member, newLevel) {
    try {
      await adjust(member.id, member.displayName, levelUpCoins(newLevel), "reward", "level_up", {
        guildId: guild.id,
        guildName: guild.name,
        note: `Reached level ${newLevel}`,
      });
    } catch (err) {
      console.warn("[Pulse] awardLevelUp failed:", err.message);
    }
  }

  /** `winners` are { id, name } as produced by the giveaway draw. */
  async function awardGiveawayWin(guild, winners, prize) {
    for (const w of winners ?? []) {
      try {
        await adjust(w.id, w.name, ECONOMY_RATES.giveawayWinCoins, "reward", "giveaway_win", {
          guildId: guild?.id ?? null,
          guildName: guild?.name ?? null,
          note: prize ? `Won "${prize}"` : null,
        });
      } catch (err) {
        console.warn("[Pulse] awardGiveawayWin failed:", err.message);
      }
    }
  }

  async function awardMilestone(guild, userId, userName, milestoneName) {
    try {
      await adjust(userId, userName, ECONOMY_RATES.milestoneCoins, "reward", "milestone", {
        guildId: guild?.id ?? null,
        guildName: guild?.name ?? null,
        note: milestoneName ?? null,
      });
    } catch (err) {
      console.warn("[Pulse] awardMilestone failed:", err.message);
    }
  }

  async function awardOnboarding(guild, member) {
    try {
      await adjust(member.id, member.displayName, ECONOMY_RATES.onboardingCoins, "reward", "onboarding", {
        guildId: guild.id,
        guildName: guild.name,
      });
    } catch (err) {
      console.warn("[Pulse] awardOnboarding failed:", err.message);
    }
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  /**
   * The member's GLOBAL reputation: the existing 0-100 trust score computed
   * from activity aggregated across every guild (plus account age from the
   * snowflake). Returns { score, tier } or null if it can't be computed.
   */
  async function getGlobalReputation(userId, createdTimestamp) {
    try {
      const { data, error } = await supabase.rpc("get_global_member_reputation", {
        p_user_id: userId,
      });
      if (error) {
        console.warn("[Pulse] get_global_member_reputation failed:", error.message);
        return null;
      }
      const m = Array.isArray(data) ? data[0] : data;
      const firstSeen = m?.first_seen ? new Date(m.first_seen).getTime() : null;
      return computeReputation({
        accountAgeDays: daysSince(createdTimestamp),
        tenureDays: firstSeen ? daysSince(firstSeen) : 0,
        messages: Number(m?.message_count ?? 0),
        voiceSeconds: Number(m?.voice_seconds ?? 0),
        commands: Number(m?.command_count ?? 0),
        activeChannels: Number(m?.active_channels ?? 0),
        assignableRoles: 0, // per-guild / live-from-Discord — omitted globally
        warnings: Number(m?.warnings ?? 0),
        timeouts: Number(m?.timeouts ?? 0),
        kicks: Number(m?.kicks ?? 0),
        bans: Number(m?.bans ?? 0),
      });
    } catch (err) {
      console.warn("[Pulse] getGlobalReputation threw:", err.message);
      return null;
    }
  }

  /** Global wallet snapshot: balance, global balance rank, recent ledger. */
  async function getWallet(userId, createdTimestamp) {
    const [{ data: row }, { data: recent }, rep] = await Promise.all([
      supabase
        .from("economy_users")
        .select("balance, lifetime_earned, lifetime_spent")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("economy_transactions")
        .select("kind, reason, note, amount, guild_name, counterparty_name, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5),
      getGlobalReputation(userId, createdTimestamp),
    ]);

    const balance = Number(row?.balance ?? 0);

    let balanceRank = null;
    if (row) {
      const { count: richer } = await supabase
        .from("economy_users")
        .select("user_id", { count: "exact", head: true })
        .gt("balance", balance);
      balanceRank = (richer ?? 0) + 1;
    }

    return {
      balance,
      lifetimeEarned: Number(row?.lifetime_earned ?? 0),
      lifetimeSpent: Number(row?.lifetime_spent ?? 0),
      reputation: rep,
      balanceRank,
      recent: recent ?? [],
    };
  }

  // ── Slash commands (delegated from commands.js execute) ───────────────────

  async function handleWalletCommand({ interaction, guild, ephemeral }) {
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("money", colorHex);
    const user = interaction.options.getUser("user") ?? interaction.user;
    const isSelf = user.id === interaction.user.id;

    if (user.bot) {
      await interaction.reply({
        content: "Bots don't have a Pulse wallet.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const w = await getWallet(user.id, user.createdTimestamp);
    const name = user.globalName ?? user.username;

    const body = [
      text(
        isSelf
          ? "Your global Pulse standing — shared across every server running Pulse."
          : `${name}'s global Pulse standing — shared across every server running Pulse.`,
      ),
      divider(),
      text(
        `**Balance**\n## ${fmt(w.balance)} ${CURRENCY_NAME}` +
          (w.balanceRank
            ? `\n-# Global rank #${w.balanceRank} · ${fmt(w.lifetimeEarned)} earned · ${fmt(w.lifetimeSpent)} spent all-time`
            : ""),
      ),
    ];

    if (w.reputation) {
      body.push(
        text(
          `**Reputation:** ${w.reputation.score}/100 · ${w.reputation.tier}` +
            `\n-# Trust score across every Pulse server`,
        ),
      );
    }

    if (w.recent.length > 0) {
      body.push(divider());
      // Right-align the signed amounts into a monospaced column (inline code is
      // fixed-width in Discord, and leading spaces are preserved) so the ledger
      // reads cleanly; the relative timestamp trails each entry.
      const rows = w.recent.map((t) => ({
        amount: `${t.amount >= 0 ? "+" : "−"}${fmt(Math.abs(t.amount))}`,
        label: describeTransaction(t),
        ts: t.created_at ? Math.floor(new Date(t.created_at).getTime() / 1000) : null,
      }));
      const width = Math.max(...rows.map((r) => r.amount.length));
      const lines = rows.map((r) => {
        const when = r.ts ? ` · <t:${r.ts}:R>` : "";
        return `\`${r.amount.padStart(width)}\`  ${r.label}${when}`;
      });
      body.push(text(`**Recent activity**\n${lines.join("\n")}`));
    }

    body.push(divider());
    body.push(text("-# Balance and reputation are global. Levels are per-server — see /profile."));

    await replyContainer(
      interaction,
      buildPulseContainer({
        iconUrl: icon ? `attachment://${icon.name}` : null,
        colorHex,
        title: "Pulse Wallet",
        subtitle: name,
        body,
        footer: "Pulse · Global economy",
      }),
      icon,
      ephemeral,
    );
  }

  async function handlePayCommand({ interaction, guild, ephemeral }) {
    const target = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");
    const note = interaction.options.getString("note") ?? null;
    const colorHex = await getPulseColor(supabase, guild.id);

    const fail = async (message) => {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    };

    if (!target || target.bot) return fail("You can only send coins to a real member.");
    if (target.id === interaction.user.id) return fail("You can't pay yourself.");
    if (!Number.isInteger(amount) || amount < 1) return fail("The amount must be at least 1 coin.");
    if (amount > ECONOMY_RATES.maxTransfer)
      return fail(`The maximum transfer is ${fmt(ECONOMY_RATES.maxTransfer)} coins.`);

    let remaining = null;
    try {
      const { data, error } = await supabase.rpc("economy_transfer", {
        p_from_id: interaction.user.id,
        p_from_name: interaction.user.globalName ?? interaction.user.username,
        p_to_id: target.id,
        p_to_name: target.globalName ?? target.username,
        p_amount: amount,
        p_guild_id: guild.id,
        p_guild_name: guild.name,
        p_note: note ? note.slice(0, 300) : null,
      });
      if (error) {
        console.warn("[Pulse] economy_transfer failed:", error.message);
        return fail("Something went wrong sending the coins. Try again in a moment.");
      }
      remaining = data === null ? null : Number(data);
    } catch (err) {
      console.warn("[Pulse] economy_transfer threw:", err.message);
      return fail("Something went wrong sending the coins. Try again in a moment.");
    }

    if (remaining === null) {
      return fail("You don't have enough coins for that transfer. Check /wallet for your balance.");
    }

    const icon = await loadPulseIcon("money", colorHex);
    const body = [
      text(`<@${interaction.user.id}> sent **${fmt(amount)} ${CURRENCY_NAME}** to <@${target.id}>.`),
    ];
    if (note) body.push(text(`-# “${note.slice(0, 300)}”`));
    body.push(divider());
    body.push(text(`-# Your remaining balance: ${fmt(remaining)} coins`));

    await replyContainer(
      interaction,
      buildPulseContainer({
        iconUrl: icon ? `attachment://${icon.name}` : null,
        colorHex,
        title: "Transfer complete",
        subtitle: `${interaction.user.globalName ?? interaction.user.username} → ${target.globalName ?? target.username}`,
        body,
        footer: "Pulse · Global economy",
      }),
      icon,
      ephemeral,
    );
  }

  return {
    // hooks
    awardActivity,
    awardLevelUp,
    awardGiveawayWin,
    awardMilestone,
    awardOnboarding,
    // primitives
    adjust,
    // reads + commands
    getWallet,
    getGlobalReputation,
    handleWalletCommand,
    handlePayCommand,
  };
}

module.exports = {
  createEconomy,
  // Pure helpers exported for unit tests + reuse.
  CURRENCY_NAME,
  ECONOMY_RATES,
  coinsForXp,
  levelUpCoins,
  describeTransaction,
};
