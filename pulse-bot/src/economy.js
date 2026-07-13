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

const { MessageFlags, Events } = require("discord.js");
const { computeReputation, daysSince } = require("./reputation");
const {
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  replyContainer,
  replyNotice,
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

/** Compact voice duration: "12h 30m", "45m", "8m", "0m". */
function formatVoice(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

/** Human label for a ledger row in the /wallet recent-activity list. */
function describeTransaction(t) {
  const reasonLabels = {
    activity: "Server activity",
    activity_message: "Chatting",
    activity_voice: "Voice activity",
    activity_command: "Command use",
    activity_reaction: "Reactions received",
    activity_active_day: "Active day",
    activity_helpful: "Helpful contribution",
    level_up: "Level up",
    milestone: "Milestone",
    event_participation: "Event interest",
    event_attendance: "Event attendance",
    event_completion: "Event reward",
    event_hosting: "Hosted an event",
    giveaway_entry: "Giveaway entry",
    giveaway_win: "Giveaway win",
    giveaway_hosting: "Hosted a giveaway",
    onboarding: "Onboarding complete",
    onboarding_complete: "Onboarding complete",
    onboarding_profile: "Profile complete",
    onboarding_verify: "Verification",
    onboarding_roles: "Role selection",
    daily: "Daily reward",
    weekly: "Weekly reward",
    birthday: "Birthday reward",
    admin: "Administrative",
  };
  if (t.kind === "transfer_in") return `Transfer from ${t.counterparty_name ?? "a member"}`;
  if (t.kind === "transfer_out") return `Transfer to ${t.counterparty_name ?? "a member"}`;
  const base = reasonLabels[t.reason] ?? "Balance change";
  return t.guild_name ? `${base} — ${t.guild_name}` : base;
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

  async function handleBalanceCommand({ interaction, guild, ephemeral }) {
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("money", colorHex);
    const user = interaction.options.getUser("user") ?? interaction.user;
    const isSelf = user.id === interaction.user.id;

    if (user.bot) {
      await replyNotice(interaction, "Bots don't have a Pulse balance.");
      return;
    }

    const w = await getWallet(user.id, user.createdTimestamp);
    const name = user.globalName ?? user.username;

    // ── Balance — the headline figure, with the leaderboard position right
    //    under it so the member sees where they stand at a glance. ──
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
            ? `\n-# Leaderboard position **#${w.balanceRank}** globally`
            : "\n-# Earn coins to climb the leaderboard — try /earn"),
      ),
    ];

    // Reputation + lifetime totals as a tidy two-line block (one stat per line
    // reads better on mobile than a long comma-joined run).
    const stats = [];
    if (w.reputation) {
      stats.push(`**Reputation** — ${w.reputation.score}/100 — ${w.reputation.tier}`);
    }
    stats.push(`**Earned** — ${fmt(w.lifetimeEarned)} all-time`);
    stats.push(`**Spent** — ${fmt(w.lifetimeSpent)} all-time`);
    body.push(divider());
    body.push(text(stats.join("\n")));

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
        const when = r.ts ? ` — <t:${r.ts}:R>` : "";
        return `\`${r.amount.padStart(width)}\`  ${r.label}${when}`;
      });
      body.push(text(`**Recent activity**\n${lines.join("\n")}`));
    } else {
      body.push(divider());
      body.push(text("-# No recent activity yet — see /earn for ways to start earning."));
    }

    body.push(divider());
    body.push(text("-# Balance & reputation are global — levels are per-server (/profile) — rankings (/leaderboard)"));

    await replyContainer(
      interaction,
      buildPulseContainer({
        iconUrl: icon ? `attachment://${icon.name}` : null,
        colorHex,
        title: "Pulse Balance",
        subtitle: name,
        body,
        footer: "Pulse — Global economy",
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

    // Friendly, specific validation messages — each one tells the member exactly
    // what went wrong and (where useful) how to fix it.
    const fail = async (message) => {
      await replyNotice(interaction, message);
    };

    if (!target) return fail("Pick a member to send coins to.");
    if (target.bot) return fail("Bots don't have a Pulse balance — you can only pay real members.");
    if (target.id === interaction.user.id) return fail("You can't send coins to yourself.");
    if (!Number.isInteger(amount) || amount < 1)
      return fail("Enter a whole amount of at least **1 coin**.");
    if (amount > ECONOMY_RATES.maxTransfer)
      return fail(`That's over the limit — the most you can send at once is **${fmt(ECONOMY_RATES.maxTransfer)} coins**.`);

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
        return fail("Something went wrong sending the coins. Please try again in a moment.");
      }
      remaining = data === null ? null : Number(data);
    } catch (err) {
      console.warn("[Pulse] economy_transfer threw:", err.message);
      return fail("Something went wrong sending the coins. Please try again in a moment.");
    }

    // A null return means the atomic RPC refused the transfer for insufficient
    // funds (the balance never went negative).
    if (remaining === null) {
      return fail("You don't have enough coins for that transfer. Check your /balance.");
    }

    const senderName = interaction.user.globalName ?? interaction.user.username;
    const targetName = target.globalName ?? target.username;
    const icon = await loadPulseIcon("money", colorHex);

    // Confirmation embed that headlines the amount and makes the direction of the
    // transfer unmistakable.
    const body = [
      text(`## ${fmt(amount)} ${CURRENCY_NAME}`),
      text(`Sent from <@${interaction.user.id}> to <@${target.id}>.`),
    ];
    if (note) body.push(text(`**Note** — “${note.slice(0, 300)}”`));
    body.push(divider());
    body.push(text("-# Pulse Coins are global — they spend in every server running Pulse."));
    body.push(text(`-# Your remaining balance: **${fmt(remaining)} coins** — check /balance any time.`));

    await replyContainer(
      interaction,
      buildPulseContainer({
        iconUrl: icon ? `attachment://${icon.name}` : null,
        colorHex,
        title: "Transfer complete",
        subtitle: `${senderName} → ${targetName}`,
        body,
        footer: "Pulse — Global economy",
      }),
      icon,
      ephemeral,
    );
  }

  // ── /leaderboard ─────────────────────────────────────────────────────────
  //
  // One flexible command with a select menu to switch between six boards (two
  // global, four server-scoped) and prev/next pagination. Both the slash command
  // and the component interactions render through `renderLeaderboard`, so a page
  // turn or type switch re-fetches the board fresh (stateless — survives bot
  // restarts). The invoker's id is carried in every custom_id so only they can
  // drive the controls even when the reply is posted publicly.

  const LB_PER_PAGE = 10;
  const LB_MAX = 100; // cap each board so paging + the in-memory boards stay light

  const LB_TYPES = [
    { id: "balance", label: "Global Balance", scope: "global", blurb: "Top balances across every Pulse server" },
    { id: "reputation", label: "Global Reputation", scope: "global", blurb: "Most trusted members across Pulse" },
    { id: "level", label: "Server Level", scope: "server", blurb: "Highest levels in this server" },
    { id: "xp", label: "Server XP", scope: "server", blurb: "Most XP earned in this server" },
    { id: "messages", label: "Messages", scope: "server", blurb: "Most messages sent in this server" },
    { id: "voice", label: "Voice Activity", scope: "server", blurb: "Most time in voice in this server" },
  ];

  const lbType = (id) => LB_TYPES.find((t) => t.id === id) ?? LB_TYPES[0];

  /**
   * Resolve a row's display name + @handle. Prefers the live guild member (server
   * nickname + username); falls back to the stored name with no handle when the
   * member isn't cached (we only persist a display name, not the handle).
   */
  function lbIdentity(guild, userId, storedName) {
    const member = guild.members.cache.get(userId);
    if (member) return { name: member.displayName, username: member.user.username };
    if (storedName) return { name: storedName, username: null };
    return { name: `<@${userId}>`, username: null };
  }

  /**
   * Fetch a full board (already sorted, capped at LB_MAX) for `type`. Each row is
   * `{ id, name, username, value, isMe }`. Returns [] when there's no data yet.
   */
  async function fetchBoard(guild, type, viewerId) {
    try {
      if (type === "balance") {
        const { data } = await supabase
          .from("economy_users")
          .select("user_id, user_name, balance")
          .gt("balance", 0)
          .order("balance", { ascending: false })
          .limit(LB_MAX);
        return (data ?? []).map((r) => ({
          id: r.user_id,
          ...lbIdentity(guild, r.user_id, r.user_name),
          value: `${fmt(r.balance)} coins`,
          isMe: r.user_id === viewerId,
        }));
      }

      if (type === "reputation") {
        const members = [...guild.members.cache.values()]
          .filter((m) => !m.user.bot)
          .slice(0, 500);
        if (members.length === 0) return [];
        const ids = members.map((m) => m.id);
        const { data } = await supabase.rpc("get_global_members_reputation", { p_user_ids: ids });
        const byId = new Map((data ?? []).map((r) => [String(r.user_id), r]));
        return members
          .map((m) => {
            const g = byId.get(m.id);
            const rep = computeReputation({
              accountAgeDays: daysSince(m.user.createdTimestamp),
              tenureDays: g?.first_seen ? daysSince(new Date(g.first_seen).getTime()) : 0,
              messages: Number(g?.message_count ?? 0),
              voiceSeconds: Number(g?.voice_seconds ?? 0),
              commands: Number(g?.command_count ?? 0),
              activeChannels: Number(g?.active_channels ?? 0),
              assignableRoles: 0,
              warnings: Number(g?.warnings ?? 0),
              timeouts: Number(g?.timeouts ?? 0),
              kicks: Number(g?.kicks ?? 0),
              bans: Number(g?.bans ?? 0),
            });
            return { id: m.id, name: m.displayName, username: m.user.username, score: rep.score, tier: rep.tier };
          })
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, LB_MAX)
          .map((r) => ({ id: r.id, name: r.name, username: r.username, value: `${r.score}/100 — ${r.tier}`, isMe: r.id === viewerId }));
      }

      if (type === "level" || type === "xp") {
        const { data } = await supabase
          .from("member_levels")
          .select("user_id, user_name, xp, level")
          .eq("guild_id", guild.id)
          .gt("xp", 0)
          .order("xp", { ascending: false })
          .limit(LB_MAX);
        return (data ?? []).map((r) => ({
          id: r.user_id,
          ...lbIdentity(guild, r.user_id, r.user_name),
          value: type === "level" ? `Level ${Number(r.level ?? 0)}` : `${fmt(r.xp)} XP`,
          isMe: r.user_id === viewerId,
        }));
      }

      if (type === "messages" || type === "voice") {
        const { data } = await supabase.rpc("get_guild_members_stats", {
          p_guild_id: guild.id,
          p_since: null,
        });
        const key = type === "messages" ? "message_count" : "voice_seconds";
        return (data ?? [])
          .map((r) => ({ id: String(r.user_id), raw: Number(r[key] ?? 0) }))
          .filter((r) => r.raw > 0 && !guild.members.cache.get(r.id)?.user?.bot)
          .sort((a, b) => b.raw - a.raw)
          .slice(0, LB_MAX)
          .map((r) => ({
            id: r.id,
            ...lbIdentity(guild, r.id, null),
            value: type === "messages" ? `${fmt(r.raw)} messages` : formatVoice(r.raw),
            isMe: r.id === viewerId,
          }));
      }
    } catch (err) {
      console.warn(`[Pulse] leaderboard fetch (${type}) failed:`, err.message);
      return null; // signals "couldn't load" vs. an empty board
    }
    return [];
  }

  /** Build the type-picker select menu (current board marked default). */
  function lbSelectRow(typeId, viewerId) {
    return {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `eco:lb:sel:${viewerId}`,
          placeholder: "Choose a leaderboard…",
          options: LB_TYPES.map((t) => ({
            label: t.label,
            value: t.id,
            description: t.blurb.slice(0, 100),
            default: t.id === typeId,
          })),
        },
      ],
    };
  }

  /** Build the prev/next pagination row (omitted when a board fits one page). */
  function lbNavRow(typeId, page, totalPages, viewerId) {
    if (totalPages <= 1) return null;
    return {
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          label: "Previous",
          custom_id: `eco:lb:nav:${viewerId}:${typeId}:${page - 1}`,
          disabled: page <= 0,
        },
        {
          type: 2,
          style: 2,
          label: "Next",
          custom_id: `eco:lb:nav:${viewerId}:${typeId}:${page + 1}`,
          disabled: page >= totalPages - 1,
        },
      ],
    };
  }

  /**
   * Render the leaderboard payload for a given board + page. Returns
   * `{ components, files }`; the caller adds the message flags (reply() sets
   * ephemeral, update() must not change it).
   */
  async function renderLeaderboard({ guild, typeId, page, viewerId }) {
    const type = lbType(typeId);
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("leaderboard", colorHex);

    const rows = await fetchBoard(guild, type.id, viewerId);
    const body = [];
    let nav = null;

    if (rows === null) {
      body.push(text("That leaderboard isn't available right now — please try again in a moment."));
    } else {
      // Always render a full board of LB_PER_PAGE rows so the embed keeps a
      // fixed height — any unfilled ranks on this page show an empty placeholder.
      const totalPages = Math.max(1, Math.ceil((rows.length || 1) / LB_PER_PAGE));
      const safePage = Math.min(Math.max(0, page), totalPages - 1);
      const start = safePage * LB_PER_PAGE;
      const slice = rows.slice(start, start + LB_PER_PAGE);

      const lines = [];
      for (let i = 0; i < LB_PER_PAGE; i++) {
        const rank = start + i + 1;
        const r = slice[i];
        if (r) {
          const handle = r.username ? ` (${r.username})` : "";
          const label = r.isMe ? `**${r.name}${handle}**` : `${r.name}${handle}`;
          lines.push(`**${rank}.** ${label} — ${r.value}`);
        } else {
          // Empty slot — keep the rank but leave the field blank.
          lines.push(`**${rank}.**`);
        }
      }
      body.push(text(lines.join("\n")));

      if (rows.length === 0) {
        body.push(divider());
        body.push(text("-# No one's on this leaderboard yet — see /earn for ways to climb!"));
      }

      // Viewer's own standing, if they have a place that isn't on this page.
      const myIndex = rows.findIndex((r) => r.isMe);
      if (myIndex >= 0 && (myIndex < start || myIndex >= start + LB_PER_PAGE)) {
        body.push(divider());
        body.push(text(`-# Your position: **#${myIndex + 1}** — ${rows[myIndex].value}`));
      }

      if (totalPages > 1) {
        body.push(divider());
        body.push(text(`-# Page ${safePage + 1} of ${totalPages}`));
        nav = lbNavRow(type.id, safePage, totalPages, viewerId);
      }
    }

    const components = [
      buildPulseContainer({
        iconUrl: icon ? `attachment://${icon.name}` : null,
        colorHex,
        title: "Leaderboard",
        subtitle: `${type.label}${type.scope === "server" ? ` — ${guild.name}` : ""}`,
        body,
        footer: `Pulse — ${type.blurb}`,
        actions: [lbSelectRow(type.id, viewerId), nav],
      }),
    ];

    return { components, files: icon ? [icon] : [] };
  }

  async function handleLeaderboardCommand({ interaction, guild, ephemeral }) {
    // Honour a preselected type from the optional `type` option; default to the
    // global balance board so the command always shows something immediately.
    const requested = interaction.options.getString?.("type");
    const typeId = LB_TYPES.some((t) => t.id === requested) ? requested : "balance";
    const payload = await renderLeaderboard({
      guild,
      typeId,
      page: 0,
      viewerId: interaction.user.id,
    });
    await interaction.reply({
      ...payload,
      flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
    });
  }

  // ── /info ────────────────────────────────────────────────────────────────
  //
  // A single-embed guide to earning across Pulse: global currencies (Balance +
  // Reputation) and per-server progression (XP + Levels), kept concise so it all
  // fits in one tidy container.

  function infoBody() {
    return [
      text("Pulse **Balance** and **Reputation** are global — they follow you everywhere. **XP** and **Levels** are per-server."),
      divider(),
      text(
        "**Pulse Balance**\n" +
          "- Join **events** and **giveaways** (more for winning)\n" +
          "- Complete **onboarding** and hit **milestones**\n" +
          "- Claim **/daily** and **/weekly** to build a streak",
      ),
      divider(),
      text(
        "**Reputation** — a 0–100 trust score, *earned, not bought*\n" +
          "- Grows with steady, positive activity over time\n" +
          "- A higher score can boost how much you earn",
      ),
      divider(),
      text(
        "**Server XP & Levels**\n" +
          "- Earn XP from **messages**, **voice** and day-to-day activity\n" +
          "- Level up to unlock **role rewards** and climb the board",
      ),
      divider(),
      text("-# Check your standing with **/balance** — see the rankings with **/leaderboard**"),
    ];
  }

  async function renderInfo({ guild }) {
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("info", colorHex);

    return {
      components: [
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title: "Earning Guide",
          subtitle: "How to earn across Pulse",
          body: infoBody(),
          footer: "Pulse — Earning Guide",
        }),
      ],
      files: icon ? [icon] : [],
    };
  }

  async function handleInfoCommand({ interaction, guild, ephemeral }) {
    const payload = await renderInfo({ guild });
    await interaction.reply({
      ...payload,
      flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
    });
  }

  // ── Component routing (our own listener; index.js owns chat-input) ─────────

  async function onInteraction(interaction) {
    try {
      const isSelect = interaction.isStringSelectMenu?.();
      const isButton = interaction.isButton?.();
      if (!isSelect && !isButton) return;
      const id = interaction.customId ?? "";
      if (!id.startsWith("eco:")) return;

      const parts = id.split(":");
      const surface = parts[1]; // "lb"
      const guild = interaction.guild;
      if (!guild) return;

      // Editing a Components V2 message must keep the V2 flag; the ephemeral-ness
      // is fixed at creation, so update() never re-sends it.
      const updateFlags = MessageFlags.IsComponentsV2;

      if (surface === "lb") {
        const action = parts[2];
        const viewerId = parts[3];
        if (interaction.user.id !== viewerId) {
          await replyNotice(interaction, "This leaderboard belongs to someone else — run /leaderboard to open your own.");
          return;
        }
        let typeId = "balance";
        let page = 0;
        if (action === "sel" && isSelect) {
          typeId = interaction.values?.[0] ?? "balance";
          page = 0; // switching boards starts at the top
        } else if (action === "nav" && isButton) {
          typeId = parts[4];
          page = Number(parts[5]) || 0;
        }
        const payload = await renderLeaderboard({ guild, typeId, page, viewerId });
        await interaction.update({ ...payload, flags: updateFlags });
        return;
      }

    } catch (err) {
      console.error("[Pulse] Economy interaction failed:", err.message);
      if (interaction && !interaction.replied && !interaction.deferred) {
        await replyNotice(interaction, "Something went wrong handling that.")
          .catch(() => {});
      }
    }
  }

  function start() {
    client.on(Events.InteractionCreate, onInteraction);
    console.log("[Pulse] Economy commands started.");
  }

  return {
    // lifecycle
    start,
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
    handleBalanceCommand,
    handlePayCommand,
    handleLeaderboardCommand,
    handleInfoCommand,
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
