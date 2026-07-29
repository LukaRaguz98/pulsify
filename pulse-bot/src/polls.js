// Community Polls & Voting (bot side) — PULSIFY-51.
//
// The bot owns the Discord-native flow:
//   • posts the poll message (a Components V2 embed with vote buttons or a
//     select menu),
//   • handles the `pv:vote:` buttons and `pv:select:` menu — validating the
//     voting restrictions before recording a vote (single-choice replaces a
//     prior vote; multiple-choice toggles up to the cap),
//   • on a once-a-minute tick, flips SCHEDULED polls to ACTIVE when their start
//     time arrives and CLOSES active polls when their end time passes (computing
//     the result snapshot + announcing the outcome),
//   • performs dashboard-requested closes immediately (it watches the
//     `close_requested_at` column over realtime, same idea as giveaways' draw).
// The dashboard (app/dashboard/[guildId]/polls) creates/edits/closes/archives
// polls via the Discord REST API and writes the same tables; realtime keeps this
// module's in-memory cache fresh.
//
// The poll-type model, restriction evaluation, vote weighting, result
// computation and the `pv:` custom_id scheme MIRROR pulsify-web-app/lib/polls.ts
// — keep the two in sync (same as giveaways.js ↔ lib/giveaways.ts).

const { Events, MessageFlags } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");
const { recordNotification } = require("./notifications");
const { replyNotice, PULSE_BADGES_ENABLED } = require("./commands");
const { computeReputation } = require("./reputation");
const { getGuildAccent } = require("./guild-accent");
// One duration grammar everywhere — /poll create parses "1h", "2d", "90m" with
// the same parser /timeout, /role temp and /giveaway create use. Whole minutes.
const { parseDuration } = require("./moderation");
const { checkLimit } = require("./feature-gate");

const PV = "pv";
const TICK_MS = 30 * 1000; // lifecycle scan every 30s

// Mirror of lib/polls.ts POLL_LIMITS — /poll create validates against the same
// bounds the dashboard enforces.
const POLL_LIMITS = {
  maxTitle: 200,
  maxDescription: 1500,
  maxOptions: 10,
  minOptions: 2,
  maxOptionLabel: 80,
  maxDurationMinutes: 60 * 24 * 60, // 60 days
  minDurationMinutes: 1,
};
// Every poll embed — open, archived or closed — wears the guild's accent
// (guild_settings.embed_color, set in the dashboard's Server Settings). No
// per-state colours: the state is written in the embed's own text ("This poll
// was archived", the results block, the footer), and the colour belongs to the
// server's brand.
const BUTTON_OPTION_LIMIT = 5;
const DISCORD_EPOCH = 1420070400000n;

// ── Brand icon ────────────────────────────────────────────────────────────────
// Reuse the giveaway badge if a dedicated poll badge isn't shipped, so the embed
// always has a header thumbnail (matches /serverinfo + giveaways). Absent ⇒
// plain heading, never a broken ref.
const ICON_NAME = fs.existsSync(path.join(__dirname, "..", "resources", "images", "pulse-poll.png"))
  ? "pulse-poll.png"
  : "pulse-giveaway.png";
let ICON_BUFFER = null;
try {
  ICON_BUFFER = fs.readFileSync(path.join(__dirname, "..", "resources", "images", ICON_NAME));
} catch {
  ICON_BUFFER = null;
}
// Off while the Pulse badges are switched off globally (see commands.js).
const HAS_ICON = PULSE_BADGES_ENABLED && ICON_BUFFER !== null;
const iconFiles = () => (HAS_ICON ? [{ attachment: ICON_BUFFER, name: ICON_NAME }] : []);

// ── Components V2 shorthands (raw objects — match what the dashboard posts) ───
const td = (content) => ({ type: 10, content });
const divider = () => ({ type: 14, divider: true, spacing: 1 });
const VOTE_BLURB = "Cast your vote below — your choice is tracked by Pulse.";

function headerBlocks(title, subtitle) {
  const lines = [td("**Pulse**"), td(`# ${title}`)];
  if (subtitle) lines.push(td(`-# ${subtitle}`));
  if (!HAS_ICON) return lines;
  return [
    {
      type: 9,
      components: lines,
      accessory: { type: 11, media: { url: `attachment://${ICON_NAME}` }, description: "Pulse poll" },
    },
  ];
}

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

// ── Helpers mirrored from lib/polls.ts ───────────────────────────────────────

function normalisePollType(v) {
  return v === "single" || v === "multiple" || v === "yes_no" || v === "rating" || v === "feature" ? v : "single";
}

function optionsForType(type, explicit) {
  if (type === "yes_no") {
    return [
      { id: "yes", label: "Yes", emoji: "✅" },
      { id: "no", label: "No", emoji: "❌" },
    ];
  }
  return Array.isArray(explicit) ? explicit : [];
}

function normaliseOptions(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    if (typeof o.id !== "string" || typeof o.label !== "string") continue;
    out.push({ id: o.id, label: o.label, ...(typeof o.emoji === "string" && o.emoji ? { emoji: o.emoji } : {}) });
  }
  return out;
}

function pollOptions(row) {
  return optionsForType(normalisePollType(row.poll_type), normaliseOptions(row.options));
}

function normaliseRequirements(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    required_role_ids: Array.isArray(r.required_role_ids) ? r.required_role_ids.filter((x) => typeof x === "string") : [],
    required_role_mode: r.required_role_mode === "all" ? "all" : "any",
    min_account_age_days: Number(r.min_account_age_days) || 0,
    min_level: Number(r.min_level) || 0,
    min_reputation: Number(r.min_reputation) || 0,
  };
}

function normaliseGovernance(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    weighted: Boolean(r.weighted),
    weight_basis: r.weight_basis === "level" ? "level" : "reputation",
    approval_threshold: Number(r.approval_threshold) || 0,
    min_participation: Number(r.min_participation) || 0,
  };
}

function hasRequirements(req) {
  return req.required_role_ids.length > 0 || req.min_account_age_days > 0 || req.min_level > 0 || req.min_reputation > 0;
}

function describeRequirements(req, resolveRole = (id) => `<@&${id}>`) {
  const out = [];
  if (req.required_role_ids.length > 0) {
    const mode = req.required_role_mode === "all" ? "all" : "any";
    const names = req.required_role_ids.map(resolveRole);
    out.push(names.length === 1 ? `Required role: ${names[0]}` : `Required roles (${mode}): ${names.join(" ")}`);
  }
  if (req.min_account_age_days > 0) out.push(`Account age: ${req.min_account_age_days}+ ${req.min_account_age_days === 1 ? "day" : "days"}`);
  if (req.min_level > 0) out.push(`Level: ${req.min_level}+`);
  if (req.min_reputation > 0) out.push(`Reputation: ${req.min_reputation}+`);
  return out;
}

function checkEligibility(req, facts, now = new Date()) {
  if (req.required_role_ids.length > 0) {
    const held = req.required_role_ids.filter((r) => facts.roleIds.includes(r));
    const ok = req.required_role_mode === "all" ? held.length === req.required_role_ids.length : held.length > 0;
    if (!ok) {
      return {
        ok: false,
        reason:
          req.required_role_mode === "all"
            ? "You need all of the required roles to vote in this poll."
            : "You need one of the required roles to vote in this poll.",
      };
    }
  }
  if (req.min_account_age_days > 0) {
    const ageDays = daysBetween(facts.accountCreatedAt, now);
    if (ageDays < req.min_account_age_days) {
      return { ok: false, reason: `Your Discord account must be at least ${req.min_account_age_days} day${req.min_account_age_days === 1 ? "" : "s"} old to vote.` };
    }
  }
  if (req.min_level > 0 && facts.level < req.min_level) {
    return { ok: false, reason: `You must be at least level ${req.min_level} in this server to vote.` };
  }
  if (req.min_reputation > 0 && facts.reputation < req.min_reputation) {
    return { ok: false, reason: `You need a reputation of at least ${req.min_reputation} to vote.` };
  }
  return { ok: true };
}

function voteWeight(gov, facts) {
  if (!gov.weighted) return 1;
  if (gov.weight_basis === "level") return Math.max(1, 1 + Math.floor((facts.level || 0) / 5));
  return Math.max(1, 1 + Math.floor((facts.reputation || 0) / 20));
}

function computeResults(options, gov, votes) {
  const tally = new Map();
  for (const o of options) tally.set(o.id, 0);
  const voters = new Set();
  let totalWeight = 0;
  for (const v of votes) {
    const w = Math.max(1, Math.floor(Number(v.weight) || 1));
    if (tally.has(v.option_id)) {
      tally.set(v.option_id, (tally.get(v.option_id) || 0) + w);
      totalWeight += w;
    }
    if (v.user_id) voters.add(v.user_id);
  }
  const optionResults = options.map((o) => {
    const votesFor = tally.get(o.id) || 0;
    return { id: o.id, label: o.label, votes: votesFor, pct: totalWeight > 0 ? Math.round((votesFor / totalWeight) * 100) : 0 };
  });
  const max = optionResults.reduce((m, o) => Math.max(m, o.votes), 0);
  const winner_ids = max > 0 ? optionResults.filter((o) => o.votes === max).map((o) => o.id) : [];
  const leadShare = totalWeight > 0 ? (max / totalWeight) * 100 : 0;
  const approved = gov.approval_threshold > 0 ? leadShare >= gov.approval_threshold : max > 0;
  const participation_met = gov.min_participation > 0 ? voters.size >= gov.min_participation : true;
  return { options: optionResults, winner_ids, total_votes: totalWeight, total_voters: voters.size, approved, participation_met };
}

// Compact text bar for the results embed.
function bar(pct) {
  const filled = Math.round((pct / 100) * 12);
  return "█".repeat(filled) + "░".repeat(12 - filled);
}

function createPolls(client, supabase) {
  // id -> poll row (scheduled + active only; closed/archived drop out of cache)
  const cache = new Map();
  // id -> last-seen close_requested_at (so each dashboard request fires once)
  const closeSeen = new Map();
  // ids currently being closed — guards against a tick + realtime double-close
  const closing = new Set();
  let tickTimer = null;

  // ── Embed builders ─────────────────────────────────────────────────────────

  function emojiObj(raw) {
    if (!raw) return undefined;
    // Custom emoji <:name:id> / <a:name:id> → { id, name }; otherwise unicode.
    const m = /^<a?:(\w+):(\d+)>$/.exec(raw);
    if (m) return { id: m[2], name: m[1] };
    return { name: raw };
  }

  /** Vote controls: buttons for a small single-choice poll, else a select menu. */
  function voteControls(p, options) {
    const multi = p.poll_type === "multiple" || p.poll_type === "feature";
    const useButtons = !multi && options.length <= BUTTON_OPTION_LIMIT;
    if (useButtons) {
      return [
        {
          type: 1,
          components: options.map((o) => ({
            type: 2,
            style: p.poll_type === "yes_no" ? (o.id === "yes" ? 3 : 4) : 2,
            label: o.label.slice(0, 80),
            ...(o.emoji ? { emoji: emojiObj(o.emoji) } : {}),
            custom_id: `${PV}:vote:${p.id}:${o.id}`,
          })),
        },
      ];
    }
    const max = multi ? Math.max(1, Math.min(Number(p.max_choices) || 1, options.length)) : 1;
    return [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `${PV}:select:${p.id}`,
            placeholder: multi ? `Pick up to ${max}` : "Pick an option",
            min_values: 1,
            max_values: max,
            options: options.slice(0, 25).map((o) => ({
              label: o.label.slice(0, 100),
              value: o.id,
              ...(o.emoji ? { emoji: emojiObj(o.emoji) } : {}),
            })),
          },
        ],
      },
    ];
  }

  function metaLine(p) {
    const bits = [];
    const multi = p.poll_type === "multiple" || p.poll_type === "feature";
    if (multi) bits.push(`Pick up to ${Math.max(1, Math.min(Number(p.max_choices) || 1, pollOptions(p).length))}`);
    if (p.anonymous) bits.push("Anonymous");
    if (p.allow_change === false) bits.push("Votes are final");
    return bits.join(" — ");
  }

  /** The live poll container (active). Discord renders <t:unix:R> as a
   *  self-updating countdown; only the totals line needs editing on each vote. */
  async function activeContainer(p) {
    const req = normaliseRequirements(p.requirements);
    const gov = normaliseGovernance(p.governance);
    const options = pollOptions(p);
    const subtitle = p.description ? String(p.description).slice(0, 1500) : VOTE_BLURB;
    const body = [...headerBlocks(p.title, subtitle)];

    // Options list (labels only on the live embed — keeps voting unbiased; the
    // full breakdown appears when the poll closes).
    if (p.poll_type !== "yes_no") {
      body.push(td(options.map((o) => `${o.emoji ? `${o.emoji} ` : "• "}${o.label}`).join("\n")));
    }

    const meta = metaLine(p);
    if (meta) body.push(td(`-# ${meta}`));

    const lines = [`**Votes:** ${p.vote_count ?? 0}`, `**Voters:** ${p.voter_count ?? 0}`];
    if (p.ends_at) {
      const endUnix = Math.floor(new Date(p.ends_at).getTime() / 1000);
      lines.push(`**Closes:** <t:${endUnix}:R> (<t:${endUnix}:f>)`);
    } else {
      lines.push("**Closes:** when a moderator closes it");
    }
    body.push(td(lines.join("\n")));

    if (hasRequirements(req)) body.push(td(`-# **Who can vote:** ${describeRequirements(req).join(" — ")}`));
    if (gov.weighted) body.push(td(`-# Weighted by ${gov.weight_basis === "level" ? "level" : "reputation"}.`));
    if (p.host_name || p.host_id) body.push(td(`-# Started by ${p.host_id ? `<@${p.host_id}>` : p.host_name}`));

    body.push(divider());
    for (const row of voteControls(p, options)) body.push(row);
    body.push(td("-# Pulse — Poll"));
    const accent = await getGuildAccent(supabase, p.guild_id);
    return { type: 17, accent_color: accent, components: body };
  }

  /** The settled container (closed / archived) — results, no vote controls. */
  async function closedContainer(p, results) {
    const accent = await getGuildAccent(supabase, p.guild_id);
    const gov = normaliseGovernance(p.governance);
    const body = [...headerBlocks(p.title, p.description ? String(p.description).slice(0, 1500) : null)];
    body.push(divider());

    if (p.status === "archived" && !results) {
      body.push(td("This poll was archived."));
      body.push(td("-# Pulse — Poll archived"));
      return { type: 17, accent_color: accent, components: body };
    }

    const r = results || { options: [], winner_ids: [], total_votes: 0, total_voters: 0, approved: false, participation_met: true };
    const winnerSet = new Set(r.winner_ids);
    const lines = r.options
      .map((o) => `${winnerSet.has(o.id) ? "**" : ""}${o.label} — ${o.pct}% (${o.votes})${winnerSet.has(o.id) ? "**" : ""}\n\`${bar(o.pct)}\``)
      .join("\n");
    if (lines) body.push(td(lines));

    const summary = [`**Votes:** ${r.total_votes}`, `**Voters:** ${r.total_voters}`];
    if (gov.approval_threshold > 0) summary.push(`**Threshold:** ${gov.approval_threshold}% — ${r.approved ? "met" : "not met"}`);
    if (gov.min_participation > 0) summary.push(`**Participation:** ${r.participation_met ? "met" : "not met"} (need ${gov.min_participation})`);
    body.push(td(summary.join("\n")));

    if (r.winner_ids.length > 0) {
      const names = r.options.filter((o) => winnerSet.has(o.id)).map((o) => `\`${o.label}\``);
      body.push(td(`**Result:** ${names.join(" ")}`));
    } else {
      body.push(td("No votes were cast."));
    }
    body.push(td("-# Pulse — Poll closed"));
    return { type: 17, accent_color: accent, components: body };
  }

  async function editPollMessage(p, container) {
    if (!p.channel_id || !p.message_id) return;
    try {
      const channel = await client.channels.fetch(p.channel_id).catch(() => null);
      if (!channel?.isTextBased?.()) return;
      const msg = await channel.messages.fetch(p.message_id).catch(() => null);
      if (msg) await msg.edit({ flags: MessageFlags.IsComponentsV2, components: [container] }).catch(() => {});
    } catch {
      /* best-effort */
    }
  }

  // ── Persistence / cache ──────────────────────────────────────────────────

  async function reload() {
    const { data, error } = await supabase.from("polls").select("*").in("status", ["scheduled", "active"]);
    if (error) {
      console.warn("[Pulse] polls load failed:", error.message);
      return;
    }
    cache.clear();
    for (const row of data ?? []) {
      cache.set(row.id, row);
      if (!closeSeen.has(row.id)) closeSeen.set(row.id, row.close_requested_at ?? null);
    }
    console.log(`[Pulse] Loaded ${cache.size} live poll(s).`);
  }

  function subscribe() {
    supabase
      .channel("polls-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "polls" }, (payload) => {
        if (payload.eventType === "DELETE") {
          if (payload.old?.id) {
            cache.delete(payload.old.id);
            closeSeen.delete(payload.old.id);
          }
          return;
        }
        const row = payload.new;
        if (!row) return;
        if (row.status === "scheduled" || row.status === "active") cache.set(row.id, row);
        else cache.delete(row.id);

        const seen = closeSeen.get(row.id) ?? null;
        if (row.close_requested_at && row.close_requested_at !== seen) {
          closeSeen.set(row.id, row.close_requested_at);
          void closePoll(row, { manual: true });
        }
      })
      .subscribe();
  }

  async function loadPoll(id) {
    const { data } = await supabase.from("polls").select("*").eq("id", id).maybeSingle();
    return data ?? null;
  }

  // ── Voter facts (roles, account age, level, reputation) ──────────────────────

  async function getLevel(guildId, userId) {
    const { data } = await supabase
      .from("member_levels")
      .select("level")
      .eq("guild_id", guildId)
      .eq("user_id", userId)
      .maybeSingle();
    return Number(data?.level) || 0;
  }

  // Approximate reputation from the dominant, cheap inputs (account age, server
  // tenure, message count) — same scorer as the dashboard, fewer inputs. Good
  // enough for a vote gate / weight; never blocks the vote on failure.
  async function getReputation(member, userId, guildId) {
    try {
      const accountCreatedAt = member?.user?.createdAt ?? snowflakeToDate(userId);
      const accountAgeDays = daysBetween(accountCreatedAt, new Date());
      const tenureDays = member?.joinedAt ? daysBetween(member.joinedAt, new Date()) : 0;
      const { count } = await supabase
        .from("analytics_events")
        .select("id", { count: "exact", head: true })
        .eq("guild_id", guildId)
        .eq("event_type", "message")
        .eq("user_id", userId);
      return computeReputation({ accountAgeDays, tenureDays, messages: count ?? 0 }).score;
    } catch {
      return 0;
    }
  }

  async function resolveFacts(interaction, req, gov) {
    const member = interaction.member;
    const roleIds = member?.roles?.cache ? [...member.roles.cache.keys()] : [];
    const accountCreatedAt = interaction.user.createdAt ?? snowflakeToDate(interaction.user.id);
    const facts = { roleIds, accountCreatedAt, level: 0, reputation: 0 };
    const needLevel = req.min_level > 0 || (gov.weighted && gov.weight_basis === "level");
    const needRep = req.min_reputation > 0 || (gov.weighted && gov.weight_basis === "reputation");
    if (needLevel) facts.level = await getLevel(interaction.guildId, interaction.user.id);
    if (needRep) facts.reputation = await getReputation(member, interaction.user.id, interaction.guildId);
    return facts;
  }

  // ── Vote flow ────────────────────────────────────────────────────────────────

  async function refreshTallies(pollId, row) {
    const { data: votes } = await supabase.from("poll_votes").select("user_id").eq("poll_id", pollId);
    const all = votes ?? [];
    const voters = new Set(all.map((v) => v.user_id));
    const patch = { vote_count: all.length, voter_count: voters.size };
    await supabase.from("polls").update(patch).eq("id", pollId);
    if (row) {
      Object.assign(row, patch);
      cache.set(pollId, row);
      await editPollMessage(row, await activeContainer(row));
    }
  }

  // Record one member's choices for a poll. `chosen` is the array of option ids
  // they selected this interaction. Single-choice polls replace any prior vote;
  // multiple-choice stores exactly the chosen set (respecting the cap).
  async function recordVote(p, interaction, chosen) {
    const options = pollOptions(p);
    const validIds = new Set(options.map((o) => o.id));
    const picks = [...new Set(chosen)].filter((id) => validIds.has(id));
    if (picks.length === 0) return replyNotice(interaction, "That option is no longer available.");

    const multi = p.poll_type === "multiple" || p.poll_type === "feature";
    const max = multi ? Math.max(1, Math.min(Number(p.max_choices) || 1, options.length)) : 1;
    if (picks.length > max) return replyNotice(interaction, `You can pick at most ${max} option${max === 1 ? "" : "s"}.`);

    // Existing votes for this member in this poll.
    const { data: existing } = await supabase
      .from("poll_votes")
      .select("id, option_id")
      .eq("poll_id", p.id)
      .eq("user_id", interaction.user.id);
    const had = existing ?? [];

    if (!multi && had.length > 0 && p.allow_change === false) {
      return replyNotice(interaction, "You've already voted and this poll doesn't allow changing your vote.");
    }

    const req = normaliseRequirements(p.requirements);
    const gov = normaliseGovernance(p.governance);
    const facts = await resolveFacts(interaction, req, gov);
    const verdict = checkEligibility(req, facts);
    if (!verdict.ok) return replyNotice(interaction, verdict.reason);
    const weight = voteWeight(gov, facts);

    const displayName = interaction.member?.displayName ?? interaction.user.globalName ?? interaction.user.username;

    if (multi) {
      // Toggle semantics for a single clicked option (buttons), or set semantics
      // for a select menu. We treat the chosen set as the member's full new set.
      const hadIds = new Set(had.map((v) => v.option_id));
      const wantIds = new Set(picks);
      if (had.length > 0 && p.allow_change === false) {
        return replyNotice(interaction, "You've already voted and this poll doesn't allow changing your vote.");
      }
      const toRemove = had.filter((v) => !wantIds.has(v.option_id)).map((v) => v.id);
      const toAdd = picks.filter((id) => !hadIds.has(id));
      if (toRemove.length) await supabase.from("poll_votes").delete().in("id", toRemove);
      if (toAdd.length) {
        await supabase.from("poll_votes").insert(
          toAdd.map((option_id) => ({
            poll_id: p.id,
            guild_id: p.guild_id,
            user_id: interaction.user.id,
            user_name: displayName,
            option_id,
            weight,
          })),
        );
      }
      // Keep the kept votes' weight current.
      const kept = had.filter((v) => wantIds.has(v.option_id)).map((v) => v.id);
      if (kept.length) await supabase.from("poll_votes").update({ weight }).in("id", kept);
    } else {
      // Single-choice: replace any prior vote with the one pick.
      const optionId = picks[0];
      if (had.length === 1 && had[0].option_id === optionId) {
        return replyNotice(interaction, "You've already voted for that — your vote stands.");
      }
      if (had.length) await supabase.from("poll_votes").delete().eq("poll_id", p.id).eq("user_id", interaction.user.id);
      const { error } = await supabase.from("poll_votes").insert({
        poll_id: p.id,
        guild_id: p.guild_id,
        user_id: interaction.user.id,
        user_name: displayName,
        option_id: optionId,
        weight,
      });
      if (error && !(error.code === "23505")) {
        console.warn("[Pulse] poll vote insert failed:", error.message);
        return replyNotice(interaction, "Sorry — I couldn't record your vote. Try again in a moment.");
      }
    }

    await refreshTallies(p.id, cache.get(p.id) ?? p);

    const chosenLabels = options.filter((o) => picks.includes(o.id)).map((o) => `\`${o.label}\``);
    const weightNote = weight > 1 ? ` (weight ${weight})` : "";
    return replyNotice(interaction, `Vote recorded${weightNote}: ${chosenLabels.join(" ")}`);
  }

  async function handleVote(interaction, pollId, chosen) {
    const row = cache.get(pollId) ?? (await loadPoll(pollId));
    if (!row) return replyNotice(interaction, "This poll no longer exists.");
    if (row.status !== "active") {
      const msg = row.status === "scheduled" ? "This poll hasn't opened yet." : "This poll is closed.";
      return replyNotice(interaction, msg);
    }
    if (row.ends_at && new Date(row.ends_at).getTime() <= Date.now()) {
      return replyNotice(interaction, "This poll has just closed.");
    }
    return recordVote(row, interaction, chosen);
  }

  // ── Lifecycle: publish scheduled, close + tally ──────────────────────────────

  async function postPoll(p) {
    const channel = await client.channels.fetch(p.channel_id).catch(() => null);
    if (!channel?.isTextBased?.()) {
      console.warn(`[Pulse] Poll ${p.id}: channel ${p.channel_id} not postable.`);
      return null;
    }
    const container = await activeContainer(p);
    return channel
      .send({ flags: MessageFlags.IsComponentsV2, components: [container], files: iconFiles() })
      .catch((e) => {
        console.warn(`[Pulse] Poll ${p.id} post failed:`, e.message);
        return null;
      });
  }

  async function startScheduled(p) {
    if (p.status !== "scheduled") return;
    p.status = "active";
    const sent = await postPoll(p);
    const patch = { status: "active", message_id: sent?.id ?? p.message_id ?? null, updated_at: new Date().toISOString() };
    Object.assign(p, patch);
    await supabase.from("polls").update(patch).eq("id", p.id);
    cache.set(p.id, p);
    await recordNotification(supabase, {
      guildId: p.guild_id,
      type: "poll_started",
      title: `Poll opened: ${p.title}`,
      link: `/dashboard/${p.guild_id}/polls`,
      targetId: p.channel_id,
      metadata: { poll_id: p.id },
    });
    console.log(`[Pulse] Poll "${p.title}" opened in ${p.guild_id}.`);
  }

  async function closePoll(p, { manual = false, archived = false } = {}) {
    if (closing.has(p.id)) return;
    closing.add(p.id);
    try {
      const fresh = (await loadPoll(p.id)) ?? p;
      if (fresh.status === "closed" || fresh.status === "archived") return; // already settled

      const options = pollOptions(fresh);
      const gov = normaliseGovernance(fresh.governance);
      const { data: votes } = await supabase
        .from("poll_votes")
        .select("user_id, option_id, weight")
        .eq("poll_id", fresh.id);
      const results = computeResults(options, gov, votes ?? []);

      const patch = {
        status: archived ? "archived" : "closed",
        results,
        vote_count: results.total_votes,
        voter_count: results.total_voters,
        closed_at: new Date().toISOString(),
        close_requested_at: null,
        updated_at: new Date().toISOString(),
      };
      await supabase.from("polls").update(patch).eq("id", fresh.id);
      Object.assign(fresh, patch);
      cache.delete(fresh.id);

      await editPollMessage(fresh, await closedContainer(fresh, results));

      // Announce the result in-channel.
      const channel = await client.channels.fetch(fresh.channel_id).catch(() => null);
      if (channel?.isTextBased?.() && !archived) {
        const winnerNames = results.options
          .filter((o) => results.winner_ids.includes(o.id))
          .map((o) => `\`${o.label}\``);
        const headline =
          results.total_votes === 0
            ? "The poll closed with no votes."
            : `Winner: ${winnerNames.join(" ")} (${results.total_voters} voter${results.total_voters === 1 ? "" : "s"}).`;
        const link = fresh.message_id ? `https://discord.com/channels/${fresh.guild_id}/${fresh.channel_id}/${fresh.message_id}` : null;
        await channel
          .send({
            flags: MessageFlags.IsComponentsV2,
            components: [
              {
                type: 17,
                accent_color: await getGuildAccent(supabase, fresh.guild_id),
                components: [
                  ...headerBlocks("Poll closed", headline),
                  link ? td(`-# [Jump to the poll](${link})`) : null,
                  td("-# Pulse — Poll"),
                ].filter(Boolean),
              },
            ],
            files: iconFiles(),
          })
          .catch(() => {});
      }

      await recordNotification(supabase, {
        guildId: fresh.guild_id,
        type: "poll_closed",
        title: `Poll closed: ${fresh.title}`,
        body:
          results.total_votes === 0
            ? "No votes were cast."
            : `${results.total_voters} voter(s), ${results.total_votes} vote(s).`,
        link: `/dashboard/${fresh.guild_id}/polls`,
        metadata: { poll_id: fresh.id },
      });
      console.log(`[Pulse] Poll "${fresh.title}" ${manual ? "closed (manual)" : "closed"} in ${fresh.guild_id}.`);
    } catch (err) {
      console.error(`[Pulse] Poll close failed for ${p.id}:`, err.message);
    } finally {
      closing.delete(p.id);
    }
  }

  // ── Slash commands (delegated from commands.js execute) ─────────────────────
  // Mirror the dashboard's poll actions (app/.../polls/actions.ts): create posts
  // a new poll, close goes THROUGH `close_requested_at` so the bot stays the
  // single closer (the tick + realtime watcher run the tally), and results is a
  // read. Rating/feature types, restrictions, governance and scheduling are
  // dashboard-only — the command keeps to the common single/multiple/yes-no case.

  async function handleCreateCommand({ interaction, guild, ephemeral }) {
    const title = interaction.options.getString("question", true).trim();
    const type = normalisePollType(interaction.options.getString("type", true));
    const rawOptions = interaction.options.getString("options");
    const durationRaw = interaction.options.getString("duration");
    const anonymous = interaction.options.getBoolean("anonymous") ?? false;
    const description = interaction.options.getString("description")?.trim() || null;
    const channel = interaction.options.getChannel("channel") ?? interaction.channel;

    if (!title) return replyNotice(interaction, "Give your poll a question.");
    if (!channel?.isTextBased?.() || channel.isDMBased?.()) {
      return replyNotice(interaction, "Pick a text channel I can post the poll in.");
    }
    if (channel.guildId && channel.guildId !== guild.id) {
      return replyNotice(interaction, "That channel isn't in this server.");
    }

    // Yes/No generates its options; single + multiple need 2-10 explicit labels
    // (comma- or newline-separated), deduped so identical options can't split a
    // vote. max_choices lets a multiple-choice voter pick any number.
    let options = [];
    let maxChoices = 1;
    if (type === "yes_no") {
      options = optionsForType("yes_no", []);
    } else {
      const labels = (rawOptions ?? "")
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const seen = new Set();
      for (const label of labels) {
        const key = label.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        options.push({ id: `opt-${options.length + 1}`, label: label.slice(0, POLL_LIMITS.maxOptionLabel) });
      }
      if (options.length < POLL_LIMITS.minOptions) {
        return replyNotice(interaction, `Add at least ${POLL_LIMITS.minOptions} different options, separated by commas.`);
      }
      if (options.length > POLL_LIMITS.maxOptions) {
        return replyNotice(interaction, `A poll can have at most ${POLL_LIMITS.maxOptions} options.`);
      }
      maxChoices = type === "multiple" ? options.length : 1;
    }

    let endsAt = null;
    if (durationRaw) {
      const minutes = parseDuration(durationRaw);
      if (!minutes || minutes < POLL_LIMITS.minDurationMinutes) {
        return replyNotice(interaction, "Enter a valid duration — e.g. `1h`, `2d` — or leave it out to close the poll yourself.");
      }
      if (minutes > POLL_LIMITS.maxDurationMinutes) {
        return replyNotice(interaction, "A poll can run for at most 60 days.");
      }
      endsAt = new Date(Date.now() + minutes * 60_000);
    }

    // Plan limit (PULSIFY-62): concurrent open polls, gated on the guild
    // owner's plan — same cap the dashboard enforces. Live polls only.
    const { count: livePolls } = await supabase
      .from("polls")
      .select("id", { count: "exact", head: true })
      .eq("guild_id", guild.id)
      .in("status", ["active", "scheduled"]);
    const gate = await checkLimit(supabase, guild, "maxActivePolls", livePolls ?? 0);
    if (!gate.allowed) return replyNotice(interaction, gate.reason);

    const hostName =
      interaction.member?.displayName ?? interaction.user.globalName ?? interaction.user.username;
    const insert = {
      guild_id: guild.id,
      title: title.slice(0, POLL_LIMITS.maxTitle),
      description: description ? description.slice(0, POLL_LIMITS.maxDescription) : null,
      poll_type: type,
      options,
      anonymous,
      allow_change: true,
      max_choices: maxChoices,
      channel_id: channel.id,
      status: "active",
      requirements: {},
      governance: {},
      starts_at: null,
      ends_at: endsAt?.toISOString() ?? null,
      vote_count: 0,
      voter_count: 0,
      host_id: interaction.user.id,
      host_name: hostName,
      created_by: interaction.user.id,
    };

    const { data: inserted, error } = await supabase.from("polls").insert(insert).select("id").single();
    if (error || !inserted) {
      console.warn("[Pulse] /poll create insert failed:", error?.message);
      return replyNotice(interaction, "Sorry — I couldn't create the poll. Try again in a moment.");
    }
    const p = { ...insert, id: inserted.id };

    const sent = await postPoll(p);
    if (!sent) {
      await supabase.from("polls").delete().eq("id", p.id);
      return replyNotice(
        interaction,
        `I couldn't post in <#${channel.id}> — check I can send messages there, then try again.`,
      );
    }
    p.message_id = sent.id;
    await supabase.from("polls").update({ message_id: sent.id }).eq("id", p.id);
    cache.set(p.id, p);

    await recordNotification(supabase, {
      guildId: guild.id,
      type: "poll_started",
      title: `Poll opened: ${p.title}`,
      link: `/dashboard/${guild.id}/polls`,
      targetId: channel.id,
      metadata: { poll_id: p.id },
    });

    const when = endsAt
      ? `, closing <t:${Math.floor(endsAt.getTime() / 1000)}:R>`
      : " — close it with `/poll close` when you're ready";
    await replyNotice(interaction, `Poll posted in <#${channel.id}>${when}.`, ephemeral);
  }

  async function handleCloseCommand({ interaction, guild, ephemeral }) {
    const id = interaction.options.getString("poll", true);
    const row = await loadPoll(id);
    if (!row || row.guild_id !== guild.id) {
      return replyNotice(interaction, "I couldn't find that poll in this server.");
    }
    if (row.status === "scheduled") {
      return replyNotice(interaction, "That poll hasn't opened yet — delete it from the dashboard instead.");
    }
    if (row.status !== "active") {
      return replyNotice(interaction, "That poll isn't active.");
    }

    // Same write the dashboard makes: end the clock and request a close. The
    // realtime watcher + the tick run the single authoritative tally.
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from("polls")
      .update({ ends_at: nowIso, close_requested_at: nowIso, updated_at: nowIso })
      .eq("id", id)
      .eq("guild_id", guild.id);
    if (error) {
      return replyNotice(interaction, "Sorry — I couldn't close that poll. Try again in a moment.");
    }
    await replyNotice(
      interaction,
      `Closing **${row.title}** and posting the results in <#${row.channel_id}>.`,
      ephemeral,
    );
  }

  async function handleResultsCommand({ interaction, guild, ephemeral }) {
    const id = interaction.options.getString("poll", true);
    const row = await loadPoll(id);
    if (!row || row.guild_id !== guild.id) {
      return replyNotice(interaction, "I couldn't find that poll in this server.");
    }

    const options = pollOptions(row);
    const gov = normaliseGovernance(row.governance);
    // Use the stored snapshot for a settled poll; tally live votes otherwise.
    let results;
    if ((row.status === "closed" || row.status === "archived") && row.results) {
      results = row.results;
    } else {
      const { data: votes } = await supabase
        .from("poll_votes")
        .select("user_id, option_id, weight")
        .eq("poll_id", id);
      results = computeResults(options, gov, votes ?? []);
    }

    const statusLabel =
      row.status === "active"
        ? "Live results"
        : row.status === "scheduled"
          ? "Not open yet"
          : "Final results";
    const body = [...headerBlocks(row.title, statusLabel)];
    body.push(divider());
    if (!results || results.total_votes === 0) {
      body.push(td("No votes have been cast yet."));
    } else {
      const sorted = [...results.options].sort((a, b) => b.votes - a.votes);
      const lines = sorted.map((o) => {
        const winMark = results.winner_ids.includes(o.id) ? " — winner" : "";
        return `**${o.label}**${winMark} — ${o.pct}% (${o.votes})\n\`${bar(o.pct)}\``;
      });
      body.push(td(lines.join("\n")));
      body.push(divider());
      body.push(
        td(
          `-# ${results.total_voters} voter${results.total_voters === 1 ? "" : "s"} — ${results.total_votes} vote${results.total_votes === 1 ? "" : "s"}${gov.weighted ? " (weighted)" : ""}`,
        ),
      );
    }
    body.push(td("-# Pulse — Poll results"));

    await interaction.reply({
      flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
      components: [{ type: 17, accent_color: await getGuildAccent(supabase, guild.id), components: body }],
      files: iconFiles(),
    });
  }

  // Autocomplete the `poll` option: close offers ACTIVE polls, results offers any
  // (live + recent). Discord can't picker a DB row, so we surface poll titles.
  async function autocompletePoll({ interaction, guild }) {
    const sub = interaction.options.getSubcommand();
    const statuses = sub === "close" ? ["active"] : ["active", "scheduled", "closed", "archived"];
    const focused = (interaction.options.getFocused() ?? "").toString().toLowerCase();
    const { data } = await supabase
      .from("polls")
      .select("id, title, status, created_at")
      .eq("guild_id", guild.id)
      .in("status", statuses)
      .order("created_at", { ascending: false })
      .limit(25);
    const choices = (data ?? [])
      .filter((r) => !focused || r.title.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((r) => ({
        name: `${r.title}${r.status !== "active" ? ` (${r.status})` : ""}`.slice(0, 100),
        value: r.id,
      }));
    await interaction.respond(choices);
  }

  async function tick() {
    const now = Date.now();
    for (const p of [...cache.values()]) {
      if (!client.guilds.cache.has(p.guild_id)) continue;
      if (p.status === "scheduled") {
        const startsAt = p.starts_at ? new Date(p.starts_at).getTime() : 0;
        if (startsAt <= now) void startScheduled(p);
      } else if (p.status === "active") {
        if (p.ends_at && new Date(p.ends_at).getTime() <= now) void closePoll(p);
      }
    }
  }

  // ── Interaction routing (our own listener; index.js owns chat-input) ─────────

  async function onInteraction(interaction) {
    try {
      const id = interaction.customId ?? "";
      if (!id.startsWith(`${PV}:`)) return;
      const [, action, pollId] = id.split(":");
      if (action === "vote" && interaction.isButton?.()) {
        const optionId = id.split(":")[3];
        return handleVote(interaction, pollId, [optionId]);
      }
      if (action === "select" && interaction.isStringSelectMenu?.()) {
        return handleVote(interaction, pollId, interaction.values ?? []);
      }
    } catch (err) {
      console.error("[Pulse] Poll interaction failed:", err.message);
      if (interaction && !interaction.replied && !interaction.deferred) {
        await replyNotice(interaction, "Something went wrong handling that.").catch(() => {});
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
    console.log("[Pulse] Poll system started.");
  }

  return {
    start,
    reload,
    handleCreateCommand,
    handleCloseCommand,
    handleResultsCommand,
    autocompletePoll,
  };
}

module.exports = {
  createPolls,
  checkEligibility,
  computeResults,
  voteWeight,
  describeRequirements,
  normaliseRequirements,
  normaliseGovernance,
};
