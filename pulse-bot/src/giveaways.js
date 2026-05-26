// Giveaways & Community Engagement (bot side) — PULSIFY-24.
//
// The bot owns the Discord-native flow:
//   • posts the giveaway message (a Components V2 embed with a Join button),
//   • handles the `gw:join:` button — validating entry requirements + the
//     blacklist before recording an entry,
//   • on a once-a-minute tick, flips SCHEDULED giveaways to ACTIVE when their
//     start time arrives and draws winners when an ACTIVE giveaway ends,
//   • performs dashboard-requested draws/rerolls immediately (it watches the
//     `draw_requested_at` column over realtime, same idea as the scheduler's
//     "Run now").
// The dashboard (app/dashboard/[guildId]/giveaways) creates/edits/cancels
// giveaways via the Discord REST API and writes the same tables; realtime keeps
// this module's in-memory cache fresh.
//
// The status model, requirement evaluation, winner-pick and the `gw:` custom_id
// scheme MIRROR pulsify-web-app/lib/giveaways.ts — keep the two in sync (same as
// tickets.js ↔ lib/tickets.ts and scheduler.js ↔ lib/automations.ts).

const { Events, MessageFlags } = require("discord.js");
const { recordNotification } = require("./notifications");

const GW = "gw";
const TICK_MS = 30 * 1000; // lifecycle scan every 30s
const BRAND = 0x8b5cf6; // Pulsify violet — the giveaway accent
const ANTI_ALT_DEFAULT_DAYS = 30;
const DISCORD_EPOCH = 1420070400000n;

// ── Components V2 shorthands (raw objects — match what the dashboard posts) ───
const td = (content) => ({ type: 10, content });
const divider = () => ({ type: 14, divider: true, spacing: 1 });

function snowflakeToDate(id) {
  try {
    return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
  } catch {
    return new Date();
  }
}

function daysBetween(from, to) {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

// ── Requirement helpers (mirror lib/giveaways.ts) ────────────────────────────

function normaliseRequirements(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    required_role_ids: Array.isArray(r.required_role_ids) ? r.required_role_ids.filter((x) => typeof x === "string") : [],
    required_role_mode: r.required_role_mode === "all" ? "all" : "any",
    min_account_age_days: Number(r.min_account_age_days) || 0,
    min_server_age_days: Number(r.min_server_age_days) || 0,
    min_messages: Number(r.min_messages) || 0,
    anti_alt: Boolean(r.anti_alt),
  };
}

function effectiveAccountAgeDays(req) {
  if (req.min_account_age_days > 0) return req.min_account_age_days;
  return req.anti_alt ? ANTI_ALT_DEFAULT_DAYS : 0;
}

function hasRequirements(req) {
  return (
    req.required_role_ids.length > 0 ||
    effectiveAccountAgeDays(req) > 0 ||
    req.min_server_age_days > 0 ||
    req.min_messages > 0
  );
}

/** Pure eligibility check (mirror of checkEligibility in lib/giveaways.ts). */
function checkEligibility(req, facts, now = new Date()) {
  if (req.required_role_ids.length > 0) {
    const held = req.required_role_ids.filter((r) => facts.roleIds.includes(r));
    const ok = req.required_role_mode === "all" ? held.length === req.required_role_ids.length : held.length > 0;
    if (!ok) {
      return {
        ok: false,
        reason:
          req.required_role_mode === "all"
            ? "You need all of the required roles to enter this giveaway."
            : "You need one of the required roles to enter this giveaway.",
      };
    }
  }
  const accountFloor = effectiveAccountAgeDays(req);
  if (accountFloor > 0) {
    const ageDays = daysBetween(facts.accountCreatedAt, now);
    if (ageDays < accountFloor) {
      return { ok: false, reason: `Your Discord account must be at least ${accountFloor} day${accountFloor === 1 ? "" : "s"} old to enter.` };
    }
  }
  if (req.min_server_age_days > 0) {
    const memberDays = facts.joinedAt ? daysBetween(facts.joinedAt, now) : 0;
    if (memberDays < req.min_server_age_days) {
      return { ok: false, reason: `You must have been in this server for at least ${req.min_server_age_days} day${req.min_server_age_days === 1 ? "" : "s"} to enter.` };
    }
  }
  if (req.min_messages > 0 && facts.messageCount < req.min_messages) {
    return { ok: false, reason: `You need at least ${req.min_messages} message${req.min_messages === 1 ? "" : "s"} in this server to enter.` };
  }
  return { ok: true };
}

function describeRequirements(req) {
  const out = [];
  if (req.required_role_ids.length > 0) {
    const verb = req.required_role_mode === "all" ? "all of" : "one of";
    out.push(`${verb} ${req.required_role_ids.map((r) => `<@&${r}>`).join(", ")}`);
  }
  const acct = effectiveAccountAgeDays(req);
  if (acct > 0) out.push(`account > ${acct}d old`);
  if (req.min_server_age_days > 0) out.push(`member > ${req.min_server_age_days}d`);
  if (req.min_messages > 0) out.push(`> ${req.min_messages} messages`);
  return out;
}

// ── Winner pick (mirror of pickWinners in lib/giveaways.ts) ──────────────────

function pickWinners(entrantIds, count, exclude = []) {
  const excludeSet = new Set(exclude);
  const pool = [...new Set(entrantIds)].filter((id) => !excludeSet.has(id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, count));
}

function createGiveaways(client, supabase) {
  // id -> giveaway row (scheduled + active only; ended ones drop out of cache)
  const cache = new Map();
  // id -> last-seen draw_requested_at (so each dashboard request fires once)
  const drawSeen = new Map();
  // ids currently being drawn — guards against a tick + realtime double-draw
  const drawing = new Set();
  let tickTimer = null;

  // ── Embed builders ─────────────────────────────────────────────────────────

  function joinRow(giveawayId, entryCount) {
    return {
      type: 1,
      components: [
        { type: 2, style: 1, label: "Join Giveaway", emoji: { name: "🎉" }, custom_id: `${GW}:join:${giveawayId}` },
        { type: 2, style: 2, label: `${entryCount} ${entryCount === 1 ? "entry" : "entries"}`, custom_id: `${GW}:count:${giveawayId}`, disabled: true },
      ],
    };
  }

  /** The live giveaway container (active). Discord renders <t:unix:R> as a
   *  self-updating countdown, so the "ends in" line never needs editing — only
   *  the entry-count button does. */
  function activeContainer(g) {
    const req = normaliseRequirements(g.requirements);
    const endUnix = Math.floor(new Date(g.ends_at).getTime() / 1000);
    const body = [td(`# 🎉 ${g.title}`)];
    if (g.description) body.push(td(String(g.description).slice(0, 1500)));
    body.push(
      td(
        `**Prize:** ${g.prize}\n` +
          `**Winners:** ${g.winner_count}\n` +
          `**Ends:** <t:${endUnix}:R> (<t:${endUnix}:f>)`,
      ),
    );
    if (hasRequirements(req)) {
      const lines = describeRequirements(req).map((r) => `-# • ${r}`).join("\n");
      body.push(td(`-# 🔒 Requirements:\n${lines}`));
    }
    if (g.host_name || g.host_id) {
      body.push(td(`-# Hosted by ${g.host_id ? `<@${g.host_id}>` : g.host_name}`));
    }
    body.push(divider());
    body.push(joinRow(g.id, g.entry_count ?? 0));
    return { type: 17, accent_color: BRAND, components: body };
  }

  /** The settled container (ended / cancelled) — no Join button. */
  function endedContainer(g, winners) {
    const body = [td(`# 🎉 ${g.title}`)];
    if (g.description) body.push(td(String(g.description).slice(0, 1500)));
    body.push(td(`**Prize:** ${g.prize}`));
    if (g.status === "cancelled") {
      body.push(divider());
      body.push(td("❌ This giveaway was cancelled."));
      return { type: 17, accent_color: 0x94a3b8, components: body };
    }
    body.push(divider());
    if (winners && winners.length > 0) {
      body.push(td(`🏆 **Winner${winners.length === 1 ? "" : "s"}:** ${winners.map((w) => `<@${w.id}>`).join(", ")}`));
    } else {
      body.push(td("😔 No eligible entries — no winner could be drawn."));
    }
    body.push(td(`-# ${g.entry_count ?? 0} entr${(g.entry_count ?? 0) === 1 ? "y" : "ies"} · Giveaway ended`));
    return { type: 17, accent_color: 0xa855f7, components: body };
  }

  async function editGiveawayMessage(g, container) {
    if (!g.channel_id || !g.message_id) return;
    try {
      const channel = await client.channels.fetch(g.channel_id).catch(() => null);
      if (!channel?.isTextBased?.()) return;
      const msg = await channel.messages.fetch(g.message_id).catch(() => null);
      if (msg) await msg.edit({ flags: MessageFlags.IsComponentsV2, components: [container] }).catch(() => {});
    } catch {
      /* best-effort */
    }
  }

  // ── Persistence / cache ──────────────────────────────────────────────────

  async function reload() {
    const { data, error } = await supabase
      .from("giveaways")
      .select("*")
      .in("status", ["scheduled", "active"]);
    if (error) {
      console.warn("[Pulse] giveaways load failed:", error.message);
      return;
    }
    cache.clear();
    for (const row of data ?? []) {
      cache.set(row.id, row);
      if (!drawSeen.has(row.id)) drawSeen.set(row.id, row.draw_requested_at ?? null);
    }
    console.log(`[Pulse] Loaded ${cache.size} live giveaway(s).`);
  }

  function subscribe() {
    supabase
      .channel("giveaways-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "giveaways" }, (payload) => {
        if (payload.eventType === "DELETE") {
          if (payload.old?.id) {
            cache.delete(payload.old.id);
            drawSeen.delete(payload.old.id);
          }
          return;
        }
        const row = payload.new;
        if (!row) return;
        // Keep only live giveaways cached; drop settled ones.
        if (row.status === "scheduled" || row.status === "active") cache.set(row.id, row);
        else cache.delete(row.id);

        // A bumped draw_requested_at = the dashboard asked us to draw/reroll now.
        const seen = drawSeen.get(row.id) ?? null;
        if (row.draw_requested_at && row.draw_requested_at !== seen) {
          drawSeen.set(row.id, row.draw_requested_at);
          void manualDraw(row);
        }
      })
      .subscribe();
  }

  async function loadGiveaway(id) {
    const { data } = await supabase.from("giveaways").select("*").eq("id", id).maybeSingle();
    return data ?? null;
  }

  // ── Join flow ──────────────────────────────────────────────────────────────

  function resolveFacts(interaction) {
    const member = interaction.member;
    const roleIds = member?.roles?.cache ? [...member.roles.cache.keys()] : [];
    const accountCreatedAt = interaction.user.createdAt ?? snowflakeToDate(interaction.user.id);
    const joinedAt = member?.joinedAt ?? null;
    return { roleIds, accountCreatedAt, joinedAt, messageCount: 0 };
  }

  // Only pay for the count query when a message minimum is actually set.
  async function countMessages(guildId, userId) {
    const { count } = await supabase
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("guild_id", guildId)
      .eq("event_type", "message")
      .eq("user_id", userId);
    return count ?? 0;
  }

  async function handleJoin(interaction, giveawayId) {
    const row = cache.get(giveawayId) ?? (await loadGiveaway(giveawayId));
    if (!row) {
      return interaction.reply({ content: "This giveaway no longer exists.", flags: MessageFlags.Ephemeral });
    }
    if (row.status !== "active") {
      const msg = row.status === "scheduled" ? "This giveaway hasn't started yet." : "This giveaway has ended.";
      return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
    if (new Date(row.ends_at).getTime() <= Date.now()) {
      return interaction.reply({ content: "This giveaway has just ended.", flags: MessageFlags.Ephemeral });
    }

    const blacklist = Array.isArray(row.blacklist_user_ids) ? row.blacklist_user_ids : [];
    if (blacklist.includes(interaction.user.id)) {
      return interaction.reply({ content: "You're not eligible to enter this giveaway.", flags: MessageFlags.Ephemeral });
    }

    const req = normaliseRequirements(row.requirements);
    const facts = resolveFacts(interaction);
    if (req.min_messages > 0) facts.messageCount = await countMessages(interaction.guildId, interaction.user.id);

    const verdict = checkEligibility(req, facts);
    if (!verdict.ok) {
      return interaction.reply({ content: `❌ ${verdict.reason}`, flags: MessageFlags.Ephemeral });
    }

    // Idempotent insert — the unique (giveaway_id, user_id) constraint turns a
    // double-click into a "you're already in" rather than a duplicate.
    const displayName = interaction.member?.displayName ?? interaction.user.globalName ?? interaction.user.username;
    const { error } = await supabase.from("giveaway_entries").insert({
      giveaway_id: giveawayId,
      guild_id: row.guild_id,
      user_id: interaction.user.id,
      user_name: displayName,
    });
    if (error) {
      if (error.code === "23505" || /duplicate key/i.test(error.message || "")) {
        return interaction.reply({ content: "🎟️ You're already entered — good luck!", flags: MessageFlags.Ephemeral });
      }
      console.warn("[Pulse] giveaway entry insert failed:", error.message);
      return interaction.reply({ content: "Sorry — I couldn't record your entry. Try again in a moment.", flags: MessageFlags.Ephemeral });
    }

    // Recount (race-safe) and refresh the cached row + the message button.
    const { count } = await supabase
      .from("giveaway_entries")
      .select("id", { count: "exact", head: true })
      .eq("giveaway_id", giveawayId);
    const entryCount = count ?? (row.entry_count ?? 0) + 1;
    await supabase.from("giveaways").update({ entry_count: entryCount }).eq("id", giveawayId);
    row.entry_count = entryCount;
    cache.set(giveawayId, row);
    await editGiveawayMessage(row, activeContainer(row));

    await interaction.reply({ content: "🎉 You're in! Good luck.", flags: MessageFlags.Ephemeral });
  }

  // ── Lifecycle: start scheduled, end + draw ───────────────────────────────────

  async function postGiveaway(g) {
    const channel = await client.channels.fetch(g.channel_id).catch(() => null);
    if (!channel?.isTextBased?.()) {
      console.warn(`[Pulse] Giveaway ${g.id}: channel ${g.channel_id} not postable.`);
      return null;
    }
    const sent = await channel
      .send({ flags: MessageFlags.IsComponentsV2, components: [activeContainer(g)] })
      .catch((e) => {
        console.warn(`[Pulse] Giveaway ${g.id} post failed:`, e.message);
        return null;
      });
    return sent;
  }

  async function startScheduled(g) {
    // Flip status in-memory up front so a tick firing during the post's await
    // window doesn't post the giveaway a second time.
    if (g.status !== "scheduled") return;
    g.status = "active";
    const sent = await postGiveaway(g);
    const patch = {
      status: "active",
      message_id: sent?.id ?? g.message_id ?? null,
      updated_at: new Date().toISOString(),
    };
    Object.assign(g, patch);
    await supabase.from("giveaways").update(patch).eq("id", g.id);
    cache.set(g.id, g);
    await recordNotification(supabase, {
      guildId: g.guild_id,
      type: "giveaway_started",
      title: `Giveaway started: ${g.title}`,
      body: `Prize: ${g.prize}`,
      link: `/dashboard/${g.guild_id}/giveaways`,
      targetId: g.channel_id,
      metadata: { giveaway_id: g.id },
    });
    console.log(`[Pulse] Giveaway "${g.title}" started in ${g.guild_id}.`);
  }

  // Draw winners for an ACTIVE giveaway that has reached its end (or was ended
  // early from the dashboard). `reroll` re-draws an already-ended giveaway,
  // excluding its previous winners.
  async function drawWinners(g, { reroll = false } = {}) {
    if (drawing.has(g.id)) return;
    drawing.add(g.id);
    try {
      const fresh = (await loadGiveaway(g.id)) ?? g;
      if (!reroll && fresh.status === "ended") return; // already drawn
      if (reroll && fresh.status !== "ended") return; // can only reroll an ended one

      const { data: entries } = await supabase
        .from("giveaway_entries")
        .select("user_id, user_name")
        .eq("giveaway_id", g.id);
      const all = entries ?? [];
      const nameById = new Map(all.map((e) => [e.user_id, e.user_name]));

      const blacklist = Array.isArray(fresh.blacklist_user_ids) ? fresh.blacklist_user_ids : [];
      const previousWinners = reroll ? (fresh.winners ?? []).map((w) => w.id) : [];
      const exclude = [...blacklist, ...previousWinners];

      const winnerIds = pickWinners(all.map((e) => e.user_id), fresh.winner_count, exclude);
      const winners = winnerIds.map((id) => ({ id, name: nameById.get(id) ?? null }));

      const patch = {
        status: "ended",
        winners,
        ended_at: new Date().toISOString(),
        entry_count: all.length,
        draw_requested_at: null,
        updated_at: new Date().toISOString(),
      };
      await supabase.from("giveaways").update(patch).eq("id", g.id);
      Object.assign(fresh, patch);
      cache.delete(g.id);

      if (winnerIds.length > 0) {
        await supabase.from("giveaway_entries").update({ is_winner: true }).eq("giveaway_id", g.id).in("user_id", winnerIds);
      }

      // Edit the original message to its settled state and announce winners.
      await editGiveawayMessage(fresh, endedContainer(fresh, winners));
      const channel = await client.channels.fetch(fresh.channel_id).catch(() => null);
      if (channel?.isTextBased?.()) {
        const link = fresh.message_id ? `https://discord.com/channels/${fresh.guild_id}/${fresh.channel_id}/${fresh.message_id}` : null;
        const lines =
          winners.length > 0
            ? [
                td(`# 🎉 ${reroll ? "New winner" : "Giveaway winner"}${winners.length === 1 ? "" : "s"} drawn!`),
                td(`Congratulations ${winners.map((w) => `<@${w.id}>`).join(", ")} — you won **${fresh.prize}**!`),
                link ? td(`-# [Jump to the giveaway](${link})`) : null,
              ].filter(Boolean)
            : [
                td(`# 🎉 ${fresh.title}`),
                td(`No eligible entries — no winner could be drawn for **${fresh.prize}**.`),
              ];
        await channel
          .send({
            flags: MessageFlags.IsComponentsV2,
            components: [{ type: 17, accent_color: 0xa855f7, components: lines }],
            allowedMentions: { users: winnerIds },
          })
          .catch(() => {});
      }

      await recordNotification(supabase, {
        guildId: fresh.guild_id,
        type: reroll ? "giveaway_rerolled" : "giveaway_ended",
        title: `${reroll ? "Reroll" : "Giveaway ended"}: ${fresh.title}`,
        body: winners.length > 0 ? `Winner${winners.length === 1 ? "" : "s"}: ${winners.map((w) => w.name ?? w.id).join(", ")}` : "No eligible entries.",
        link: `/dashboard/${fresh.guild_id}/giveaways`,
        metadata: { giveaway_id: fresh.id },
      });
      console.log(`[Pulse] Giveaway "${fresh.title}" ${reroll ? "rerolled" : "ended"} in ${fresh.guild_id} (${winnerIds.length} winner(s)).`);
    } catch (err) {
      console.error(`[Pulse] Giveaway draw failed for ${g.id}:`, err.message);
    } finally {
      drawing.delete(g.id);
    }
  }

  // Dashboard-requested draw: end-early (active) or reroll (ended).
  async function manualDraw(row) {
    if (row.status === "active") await drawWinners(row, { reroll: false });
    else if (row.status === "ended") await drawWinners(row, { reroll: true });
  }

  async function tick() {
    const now = Date.now();
    for (const g of [...cache.values()]) {
      if (!client.guilds.cache.has(g.guild_id)) continue;
      if (g.status === "scheduled") {
        const startsAt = g.starts_at ? new Date(g.starts_at).getTime() : 0;
        if (startsAt <= now) void startScheduled(g);
      } else if (g.status === "active") {
        if (new Date(g.ends_at).getTime() <= now) void drawWinners(g);
      }
    }
  }

  // ── Interaction routing (our own listener; index.js owns chat-input) ─────────

  async function onInteraction(interaction) {
    try {
      if (!interaction.isButton()) return;
      const id = interaction.customId;
      if (!id.startsWith(`${GW}:`)) return;
      const [, action, arg] = id.split(":");
      if (action === "join") return handleJoin(interaction, arg);
      // gw:count is a disabled display button — never actually invoked.
    } catch (err) {
      console.error("[Pulse] Giveaway interaction failed:", err.message);
      if (interaction && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Something went wrong handling that.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  }

  async function start() {
    await reload();
    subscribe();
    client.on(Events.InteractionCreate, onInteraction);
    setTimeout(() => {
      void tick();
      tickTimer = setInterval(() => void tick(), TICK_MS);
      if (tickTimer.unref) tickTimer.unref();
    }, 15_000);
    console.log("[Pulse] Giveaway system started.");
  }

  return { start, reload };
}

module.exports = { createGiveaways, pickWinners, checkEligibility };
