// Rewards Shop — bot-side fulfilment & notifications (PULSIFY-46).
//
// Purchases happen in the DASHBOARD: the web app runs the atomic economy_purchase
// RPC and, for role rewards, grants the Discord role immediately over REST. This
// module owns the GATEWAY-only side of the shop:
//
//   • Purchase announcements — on a new reward_purchases row, DM the buyer a
//     Pulse-styled receipt and record a dashboard notification.
//   • Expiry sweep — temporary rewards (timed roles, XP boosters) carry an
//     expires_at; a periodic sweep removes expired roles and marks the purchase
//     'expired'. Mirrors the milestones sweep.
//
// It also owns the live ACTIVE-BOOSTER registry: an in-memory map of every
// member with a running XP booster, kept fresh over realtime + the sweep, that
// leveling.js consults on its hot message/voice path (so addXp never has to hit
// the DB per message). Giveaway-entry grants are wired in giveaways.js.
//
// Pure category labels mirror lib/shop.ts CATEGORY_META — keep in sync.

const { recordNotification } = require("./notifications");
const {
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  text,
  divider,
} = require("./commands");
const { MessageFlags } = require("discord.js");

// Five current types (mirror lib/shop.ts CATEGORY_META) + legacy aliases so
// purchases bought before the consolidation still get a label.
const CATEGORY_LABELS = {
  role: "Discord role",
  xp_booster: "XP booster",
  giveaway_entry: "Giveaway entries",
  perk: "Custom perk",
  cosmetic: "Profile cosmetic",
  // legacy
  custom: "Custom perk",
  event: "Custom perk",
  badge: "Profile cosmetic",
};

const fmtCoins = (n) => Math.max(0, Math.round(Number(n) || 0)).toLocaleString();

const SWEEP_MS = 5 * 60 * 1000; // expire timed rewards every 5 minutes
const ANNOUNCE_DELAY_MS = 2500; // let the web finish role-grant/auto-refund first
const BOOSTER_MAX = 5; // hard ceiling on an XP booster multiplier (mirror lib/shop.ts REWARD_LIMITS)

/**
 * Is this purchase a live, activated XP booster? Boosters are the only category
 * that carries BOTH an activated_at (set when the member starts the timer) and
 * an expires_at while still 'active' — timed roles set expires_at but never
 * activated_at, so this uniquely identifies a running booster.
 */
function isLiveBooster(row, nowMs = Date.now()) {
  if (!row || row.status !== "active") return false;
  if ((row.reward_snapshot ?? {}).category !== "xp_booster") return false;
  if (!row.activated_at || !row.expires_at) return false;
  return new Date(row.expires_at).getTime() > nowMs;
}

function boosterMultiplier(row) {
  const m = Number(row?.reward_snapshot?.payload?.multiplier);
  if (!Number.isFinite(m)) return 1;
  return Math.max(1, Math.min(BOOSTER_MAX, m));
}

function createShop(client, supabase) {
  let sweepTimer = null;
  let sweeping = false;

  // `${guildId}:${userId}` -> { multiplier, expiresAt(ms) } for the member's
  // strongest running booster. leveling.js reads this on every XP award, so it
  // must stay a pure in-memory lookup (no awaits) — realtime + the sweep keep it
  // honest, and getBoosterMultiplier self-evicts anything that has lapsed.
  const boosters = new Map();
  const boosterKey = (guildId, userId) => `${guildId}:${userId}`;

  // ── Purchase receipt (DM) ──────────────────────────────────────────────────

  async function announcePurchase(purchase) {
    const snap = purchase.reward_snapshot ?? {};
    const guildId = purchase.guild_id;
    const colorHex = await getPulseColor(supabase, guildId ?? "");
    const icon = await loadPulseIcon("money", colorHex);

    const label = CATEGORY_LABELS[snap.category] ?? "Reward";
    const guild = guildId ? client.guilds.cache.get(guildId) : null;
    const where = guild ? ` in **${guild.name}**` : "";

    const body = [
      text(`You bought **${snap.name ?? "a reward"}**${where}.`),
      divider(),
      text(`**${label}** · ${fmtCoins(purchase.cost)} Pulse Coins`),
    ];
    if (purchase.expires_at) {
      body.push(text(`-# Expires <t:${Math.floor(new Date(purchase.expires_at).getTime() / 1000)}:R>`));
    }
    if (snap.category === "perk" || snap.category === "custom" || snap.category === "event") {
      body.push(text("-# Redeem it any time from your dashboard Inventory."));
    } else if (snap.category === "xp_booster") {
      body.push(text("-# Activate it from your dashboard Inventory when you want the boost."));
    } else if (snap.category === "giveaway_entry") {
      body.push(text("-# Applied automatically the next time you join a giveaway in this server."));
    } else if (snap.category === "badge" || snap.category === "cosmetic") {
      body.push(text("-# It now decorates your global Pulse profile."));
    }

    const container = buildPulseContainer({
      iconUrl: icon ? `attachment://${icon.name}` : null,
      colorHex,
      title: "Purchase confirmed",
      subtitle: snap.name ?? undefined,
      body,
      footer: "Pulse · Shop",
    });

    try {
      const user = await client.users.fetch(purchase.user_id).catch(() => null);
      if (user) {
        await user
          .send({ flags: MessageFlags.IsComponentsV2, components: [container], files: icon ? [icon] : [] })
          .catch(() => {});
      }
    } catch {
      /* DMs closed — best-effort; the dashboard notification still lands */
    }

    if (guildId) {
      await recordNotification(supabase, {
        guildId,
        type: "reward_purchased",
        title: `${purchase.user_name ?? "A member"} bought "${snap.name ?? "a reward"}"`,
        body: `${label} · ${fmtCoins(purchase.cost)} Pulse Coins`,
        link: `/dashboard/${guildId}/economy-rewards`,
        targetId: purchase.user_id,
        targetName: purchase.user_name ?? null,
        metadata: { category: snap.category, cost: purchase.cost },
      });
    }
  }

  async function onPurchaseInsert(row) {
    // Re-read shortly after insert: a role-grant failure auto-refunds the
    // purchase web-side, and we don't want to announce a reverted buy.
    setTimeout(async () => {
      try {
        const { data } = await supabase
          .from("reward_purchases")
          .select("*")
          .eq("id", row.id)
          .maybeSingle();
        if (!data || data.status === "refunded") return;
        await announcePurchase(data);
      } catch (err) {
        console.warn("[Pulse] shop announce failed:", err.message);
      }
    }, ANNOUNCE_DELAY_MS);
  }

  // ── Active-booster registry ─────────────────────────────────────────────────

  /** Fold a single purchase row into the booster map (or evict it if lapsed). */
  function indexBooster(row) {
    const key = boosterKey(row.guild_id, row.user_id);
    if (!isLiveBooster(row)) {
      // An UPDATE that ended the booster (expired/refunded) clears it. We only
      // drop the key if it was THIS purchase driving it — otherwise a second
      // active booster keeps the member boosted.
      const cur = boosters.get(key);
      if (cur && cur.purchaseId === row.id) boosters.delete(key);
      return;
    }
    const mult = boosterMultiplier(row);
    const expiresAt = new Date(row.expires_at).getTime();
    const cur = boosters.get(key);
    // Keep the strongest booster; tie-break on the one that lasts longest.
    if (!cur || mult > cur.multiplier || (mult === cur.multiplier && expiresAt > cur.expiresAt)) {
      boosters.set(key, { multiplier: mult, expiresAt, purchaseId: row.id });
    }
  }

  /** Reload every live booster from scratch (start + after each sweep). */
  async function loadBoosters() {
    try {
      const { data } = await supabase
        .from("reward_purchases")
        .select("id, guild_id, user_id, status, activated_at, expires_at, reward_snapshot")
        .eq("status", "active")
        .not("activated_at", "is", null)
        .not("expires_at", "is", null)
        .gt("expires_at", new Date().toISOString())
        .limit(2000);
      boosters.clear();
      for (const row of data ?? []) indexBooster(row);
    } catch (err) {
      console.warn("[Pulse] shop booster load failed:", err.message);
    }
  }

  /**
   * The XP multiplier a member's active booster grants in a guild (1 = none).
   * Pure + synchronous — safe to call on the per-message XP path. Self-evicts a
   * lapsed entry so a missed sweep can't keep a booster alive forever.
   */
  function getBoosterMultiplier(guildId, userId) {
    const entry = boosters.get(boosterKey(guildId, userId));
    if (!entry) return 1;
    if (entry.expiresAt <= Date.now()) {
      boosters.delete(boosterKey(guildId, userId));
      return 1;
    }
    return entry.multiplier;
  }

  // ── Expiry sweep ────────────────────────────────────────────────────────────

  async function expirePurchase(p) {
    const snap = p.reward_snapshot ?? {};
    // Pull a timed role back off the member.
    if (snap.category === "role" && p.guild_id) {
      const roleId = snap.payload?.role_id;
      if (roleId) {
        const guild = client.guilds.cache.get(p.guild_id);
        if (guild) {
          const member = await guild.members.fetch(p.user_id).catch(() => null);
          if (member && member.roles.cache.has(roleId)) {
            await member.roles.remove(roleId, "Pulse shop: reward expired").catch(() => {});
          }
        }
      }
    }
    // Drop an expired booster from the live registry immediately (the reload at
    // the end of the sweep would catch it too, but eviction here is instant).
    if (snap.category === "xp_booster") {
      const key = boosterKey(p.guild_id, p.user_id);
      const cur = boosters.get(key);
      if (cur && cur.purchaseId === p.id) boosters.delete(key);
    }
    await supabase.from("reward_purchases").update({ status: "expired" }).eq("id", p.id);
  }

  async function sweep() {
    if (sweeping) return;
    sweeping = true;
    try {
      const { data } = await supabase
        .from("reward_purchases")
        .select("*")
        .eq("status", "active")
        .not("expires_at", "is", null)
        .lt("expires_at", new Date().toISOString())
        .limit(500);
      for (const p of data ?? []) {
        await expirePurchase(p);
      }
    } catch (err) {
      console.warn("[Pulse] shop sweep failed:", err.message);
    } finally {
      sweeping = false;
    }
    // Re-sync the booster registry against the DB so an activation we somehow
    // missed over realtime (or a clock skew) is reconciled at least every sweep.
    await loadBoosters();
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  function subscribe() {
    supabase
      .channel("reward-purchases-watch")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "reward_purchases" },
        (payload) => {
          if (payload.new?.id) void onPurchaseInsert(payload.new);
        },
      )
      // Boosters become live via an UPDATE (the web inventory route stamps
      // activated_at/expires_at), and lapse via an UPDATE (status -> expired).
      // Keep the in-memory registry in step so the boost applies/clears live.
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "reward_purchases" },
        (payload) => {
          if (payload.new) indexBooster(payload.new);
        },
      )
      .subscribe();
  }

  async function start() {
    subscribe();
    await loadBoosters();
    setTimeout(() => {
      void sweep();
      sweepTimer = setInterval(() => void sweep(), SWEEP_MS);
      if (sweepTimer.unref) sweepTimer.unref();
    }, 20_000);
    console.log("[Pulse] Rewards shop system started.");
  }

  return { start, sweep, getBoosterMultiplier };
}

module.exports = { createShop, CATEGORY_LABELS, isLiveBooster, boosterMultiplier };
