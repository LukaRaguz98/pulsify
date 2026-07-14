// Integrations Hub — polling worker (PULSIFY-34, bot side).
//
// The dashboard (pulsify-web-app) lets admins connect external services (a
// GitHub repo, a YouTube channel, an RSS feed, a Jira project, …) and stores one
// row per connection in `integrations`. This worker is the inbound half the
// schema was always shaped for (note the `cursor`, `last_sync_at`, `last_error`
// columns): once a minute it polls every armed connection, forwards anything new
// into the configured Discord channel as a Pulse v2 notification, advances the
// cursor, and records the outcome in `integration_logs`.
//
// Structure mirrors scheduler.js / giveaways.js: createIntegrations(client,
// supabase) → { start, reload }, a realtime cache, a once-a-minute tick, and a
// per-row running guard. The provider-specific fetching lives in
// integration-providers.js; this file owns scheduling, posting and bookkeeping.
//
// The notification CONTAINER + template semantics mirror the dashboard's
// "Test connection" path (pulsify-web-app/.../integrations/actions.ts) so a live
// notification reads exactly like the test that proved the channel works.

const fs = require("fs");
const path = require("path");
const { MessageFlags } = require("discord.js");
const { recordNotification } = require("./notifications");
const { POLLERS, UNSUPPORTED } = require("./integration-providers");
const { getGuildAccent } = require("./guild-accent");

// Last-resort fallback only — the real colour always comes from the guild accent.
const BRAND = 0x8b5cf6;

// ── Brand icon ──────────────────────────────────────────────────────────────
// Integration notifications carry the Pulse integrations badge as a header
// thumbnail, the same way giveaways/tickets/announcements do. Loaded once at
// startup; if the asset is missing the header falls back to plain text (no
// broken ref). The buffer is re-attached on every post via `files`.
const ICON_NAME = "pulse-integrations.png";
let ICON_BUFFER = null;
try {
  ICON_BUFFER = fs.readFileSync(
    path.join(__dirname, "..", "resources", "images", ICON_NAME),
  );
} catch {
  ICON_BUFFER = null;
}
const HAS_ICON = ICON_BUFFER !== null;
const iconFiles = () =>
  HAS_ICON ? [{ attachment: ICON_BUFFER, name: ICON_NAME }] : [];

// Display names for the `-# <Provider> — Integration` subtitle. Mirrors the
// catalog in pulsify-web-app/lib/integrations.ts — keep in sync when adding
// providers. Falls back to the capitalised id for anything missing.
const PROVIDER_NAMES = {
  github: "GitHub",
  gitlab: "GitLab",
  youtube: "YouTube",
  tiktok: "TikTok",
  twitch: "Twitch",
  kick: "Kick",
  reddit: "Reddit",
  twitter: "X / Twitter",
  rss: "RSS Feed",
  steam: "Steam",
  patreon: "Patreon",
  "google-calendar": "Google Calendar",
  trello: "Trello",
  jira: "Jira",
  notion: "Notion",
};

function providerName(id) {
  return (
    PROVIDER_NAMES[id] ||
    (id ? id.charAt(0).toUpperCase() + id.slice(1) : "Integration")
  );
}

// Provider brand colours. These no longer tint the embed — every Pulse embed
// wears the GUILD's accent (guild_settings.embed_color, set in the dashboard's
// Server Settings) — but the map is kept because the dashboard still shows each
// provider in its own brand colour.
const PROVIDER_ACCENTS = {
  github: 0x8b949e,
  gitlab: 0xfc6d26,
  youtube: 0xff0000,
  tiktok: 0xff0050,
  twitch: 0x9146ff,
  kick: 0x53fc18,
  reddit: 0xff4500,
  twitter: 0x1d9bf0,
  rss: 0xf59e0b,
  steam: 0x66c0f4,
  patreon: 0xf96854,
  "google-calendar": 0x4285f4,
  trello: 0x0079bf,
  jira: 0x2684ff,
  notion: 0xcbd5e1,
};

// Which placeholder fields surface as a labeled "details" block, and the verb on
// the source-link button — mirrors notificationDetails()/notificationLink() in
// pulsify-web-app/lib/integrations.ts so a live post reads like the dashboard test.
const META_FIELDS = {
  github: [{ key: "event", label: "Event" }, { key: "author", label: "Author" }],
  gitlab: [{ key: "event", label: "Event" }, { key: "author", label: "Author" }],
  youtube: [{ key: "author", label: "Channel" }],
  twitch: [{ key: "game", label: "Playing" }],
  kick: [{ key: "game", label: "Playing" }],
  reddit: [{ key: "author", label: "Posted by" }],
  twitter: [{ key: "author", label: "Account" }],
  tiktok: [{ key: "author", label: "Creator" }],
  rss: [{ key: "author", label: "Author" }],
  steam: [{ key: "game", label: "Game" }],
  patreon: [{ key: "author", label: "Creator" }, { key: "action", label: "Update" }],
  "google-calendar": [{ key: "when", label: "When" }, { key: "location", label: "Location" }],
  trello: [{ key: "list", label: "List" }, { key: "actor", label: "By" }, { key: "action", label: "Change" }],
  jira: [{ key: "status", label: "Status" }, { key: "assignee", label: "Assignee" }],
  notion: [{ key: "actor", label: "By" }, { key: "action", label: "Change" }],
};

const LINK_LABELS = {
  github: "View on GitHub",
  gitlab: "View on GitLab",
  youtube: "Watch on YouTube",
  twitch: "Watch on Twitch",
  kick: "Watch on Kick",
  reddit: "View on Reddit",
  twitter: "View post",
  tiktok: "View on TikTok",
  rss: "Read more",
  steam: "View on Steam",
  patreon: "View on Patreon",
  "google-calendar": "Open in Calendar",
  trello: "View card",
  jira: "View issue",
  notion: "Open page",
};

function notificationDetails(providerId, ctx) {
  const out = [];
  for (const f of META_FIELDS[providerId] || []) {
    const v = String(ctx[f.key] ?? "").trim();
    if (v) out.push({ label: f.label, value: v.slice(0, 120) });
  }
  return out;
}

function notificationLink(providerId, ctx) {
  const url = String(ctx.url ?? "").trim();
  if (!/^https?:\/\/.+/i.test(url)) return null;
  return { label: LINK_LABELS[providerId] || "Open link", url };
}

// Drop a line that's just the source URL once a link button carries it — keeps a
// URL used inline within a sentence. Mirrors stripStandaloneUrl() in the web app.
function stripStandaloneUrl(body, url) {
  if (!url) return body;
  return String(body)
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return t !== url && t !== `<${url}>`;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Mirror of renderTemplate in lib/integrations.ts: unknown {{tokens}} are left
// as-is. Templates are authored + validated on the dashboard.
function renderTemplate(template, ctx) {
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (m, key) =>
    ctx[key] != null ? String(ctx[key]) : m,
  );
}

// Rich Pulse v2 container, matching the dashboard's notificationContainer() and
// the command-embed structure: a `**Pulse**` label + connection-label heading +
// `-# <Provider> — Integration` subtitle beside the Pulse integrations badge
// (type-9 Section), a braille width spacer, a `-# <when>` relative-time chip, the
// rendered body (raw URL line stripped), a divider + labeled details block, a
// source-link button, then the `-# Pulse — Integrations` footer. Accent is the
// provider's brand colour. An optional leading mention line pings a role.
function buildContainer(provider, label, body, mentionLine, ctx = {}, accent = BRAND) {
  const text = (content) => ({ type: 10, content });
  const headerLines = [
    text("**Pulse**"),
    text(`# ${label}`),
    text(`-# ${providerName(provider)} — Integration`),
  ];
  const components = [];
  if (mentionLine) components.push(text(mentionLine));
  if (HAS_ICON) {
    components.push({
      type: 9,
      components: headerLines,
      accessory: {
        type: 11,
        media: { url: `attachment://${ICON_NAME}` },
        description: "Pulse integration",
      },
    });
  } else {
    components.push(...headerLines);
  }
  components.push(text(`-# ${"⠀".repeat(40)}`));

  // Relative-time chip — Discord renders <t:…:R> as "just now" and ages it.
  components.push(text(`-# <t:${Math.floor(Date.now() / 1000)}:R>`));

  const link = notificationLink(provider, ctx);
  const cleanBody = stripStandaloneUrl(body, link && link.url);
  for (const para of String(cleanBody || "")
    .trim()
    .split(/\n{2,}/)) {
    if (para.trim()) components.push(text(para.trim()));
  }

  const details = notificationDetails(provider, ctx);
  if (details.length > 0) {
    components.push({ type: 14, divider: true, spacing: 1 });
    components.push(
      text(details.map((d) => `**${d.label}**  ${d.value}`).join("\n")),
    );
  }

  if (link) {
    components.push({
      type: 1,
      components: [{ type: 2, style: 5, label: link.label, url: link.url }],
    });
  }

  components.push({ type: 14, divider: true, spacing: 1 });
  components.push(text("-# Pulse — Integrations"));
  return {
    type: 17,
    accent_color: typeof accent === "number" ? accent : BRAND,
    components,
  };
}

function createIntegrations(client, supabase) {
  const cache = new Map(); // id -> row
  const running = new Set(); // ids currently polling
  // ids we've already alerted the dashboard about while in error, so a recurring
  // failure doesn't spam the bell every minute. Cleared on the next success.
  const erroredSeen = new Set();
  let tickTimer = null;

  // ── Persistence ──────────────────────────────────────────────────────────

  async function reload() {
    const { data, error } = await supabase.from("integrations").select("*");
    if (error) {
      console.warn("[Pulse] integrations load failed:", error.message);
      return;
    }
    cache.clear();
    for (const row of data ?? []) cache.set(row.id, row);
    console.log(`[Pulse] Loaded ${cache.size} integration(s).`);
  }

  async function recordLog(row, level, event, message, metadata) {
    try {
      await supabase.from("integration_logs").insert({
        guild_id: row.guild_id,
        integration_id: row.id,
        level,
        event,
        message: message ? String(message).slice(0, 500) : null,
        metadata: metadata ?? {},
      });
    } catch (err) {
      console.warn("[Pulse] integration_logs insert threw:", err.message);
    }
  }

  // Persist poll bookkeeping and keep the in-memory cache in step.
  async function patchRow(row, patch) {
    Object.assign(row, patch);
    try {
      await supabase.from("integrations").update(patch).eq("id", row.id);
    } catch (err) {
      console.warn("[Pulse] integrations update threw:", err.message);
    }
  }

  // Optimistically advance the cursor, succeeding only if it still matches the
  // value we polled against. Returns true when THIS worker won the right to post
  // the batch. Because the advance is a single conditional UPDATE, only one
  // caller can win even if several ticks — or several bot instances sharing this
  // database — poll the same row at once. This is what guarantees an update is
  // delivered exactly once instead of being duplicated.
  async function claimCursor(row, prevCursor, nextCursor, nowIso) {
    let query = supabase
      .from("integrations")
      .update({
        cursor: nextCursor,
        last_sync_at: nowIso,
        updated_at: nowIso,
        status: "connected",
        last_error: null,
      })
      .eq("id", row.id);
    query =
      prevCursor == null
        ? query.is("cursor", null)
        : query.eq("cursor", prevCursor);
    try {
      const { data, error } = await query.select("id");
      if (error) {
        // Fail closed: don't deliver if we can't prove we claimed the batch.
        console.warn("[Pulse] integrations cursor claim failed:", error.message);
        return false;
      }
      if (data && data.length > 0) {
        Object.assign(row, {
          cursor: nextCursor,
          last_sync_at: nowIso,
          status: "connected",
          last_error: null,
        });
        return true;
      }
      return false; // lost the race — another worker already advanced the cursor
    } catch (err) {
      console.warn("[Pulse] integrations cursor claim threw:", err.message);
      return false;
    }
  }

  // ── Delivery ──────────────────────────────────────────────────────────────

  // Post one rendered item to the given (pre-resolved) channel. Throws on a
  // delivery failure so the caller can mark the row in error.
  async function deliver(row, channel, item) {
    const placeholders = item.placeholders || {};
    const body = renderTemplate(row.template, placeholders);
    const roleId = row.config?.role;
    const mentionLine = roleId ? `<@&${roleId}>` : null;
    const allowedMentions = roleId
      ? { parse: [], roles: [String(roleId)] }
      : { parse: [] };
    const container = buildContainer(
      row.provider,
      row.label,
      body,
      mentionLine,
      placeholders,
      await getGuildAccent(supabase, row.guild_id),
    );
    await channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      allowedMentions,
      files: iconFiles(),
    });
  }

  // ── Orchestration ───────────────────────────────────────────────────────────

  async function execute(row) {
    if (running.has(row.id)) return;
    running.add(row.id);
    const nowIso = new Date().toISOString();
    try {
      // Providers with no usable polling path: record the reason once, then stay
      // quiet until the connection changes provider.
      const unsupported = UNSUPPORTED[row.provider];
      if (unsupported) {
        if (row.last_error !== unsupported || row.status !== "error") {
          await patchRow(row, {
            status: "error",
            last_error: unsupported,
            updated_at: nowIso,
          });
          await recordLog(row, "warning", "sync", unsupported);
        }
        return;
      }

      const poller = POLLERS[row.provider];
      if (!poller) return; // unknown provider id — nothing to do

      const firstRun = row.cursor == null;
      const prevCursor = row.cursor;
      const { items, cursor } = await poller(row);
      const nextCursor = cursor ?? row.cursor;

      const guild = client.guilds.cache.get(row.guild_id);
      const willDeliver = items.length > 0 && row.channel_id && guild;

      // Deliver (only when armed + a channel is set). A paused/channel-less row
      // still advances its cursor so it never backfills history on resume.
      if (willDeliver) {
        const channel = await guild.channels
          .fetch(row.channel_id)
          .catch(() => null);
        if (
          !channel ||
          typeof channel.isTextBased !== "function" ||
          !channel.isTextBased()
        ) {
          throw new Error("Destination channel not found or not text-based.");
        }

        // Claim the batch before posting. If the cursor already moved — a
        // concurrent tick or a second bot instance got here first — we skip,
        // which is what prevents the same update being posted more than once.
        const claimed = await claimCursor(row, prevCursor, nextCursor, nowIso);
        if (!claimed) return;

        let delivered = 0;
        for (const item of items) {
          await deliver(row, channel, item);
          delivered++;
        }
        erroredSeen.delete(row.id);
        await recordLog(
          row,
          "success",
          "notification",
          `Delivered ${delivered} update${delivered === 1 ? "" : "s"} to #${channel.name}.`,
          { count: delivered, channel_id: row.channel_id },
        );
        console.log(
          `[Pulse] Integration "${row.label}" delivered ${delivered} update(s).`,
        );
        return;
      }

      // Nothing to post (baseline, no new items, or no channel/guild yet). Just
      // advance bookkeeping — no race to guard since nothing is delivered.
      const patch = {
        cursor: nextCursor,
        last_sync_at: nowIso,
        updated_at: nowIso,
      };
      if (row.status === "error") {
        patch.status = "connected";
        patch.last_error = null;
      }
      await patchRow(row, patch);
      erroredSeen.delete(row.id);

      if (firstRun) {
        await recordLog(
          row,
          "info",
          "sync",
          "Baseline established — new activity from now on will be posted.",
        );
      }
    } catch (err) {
      const message = err?.message || "Unknown error";
      // Only write a log / alert when the error is new, so a persistent outage
      // doesn't flood the diagnostics trail or the dashboard bell every minute.
      if (row.last_error !== message || row.status !== "error") {
        await patchRow(row, {
          status: "error",
          last_error: message,
          updated_at: new Date().toISOString(),
        });
        await recordLog(row, "error", "sync", message);
      }
      if (!erroredSeen.has(row.id)) {
        erroredSeen.add(row.id);
        await recordNotification(supabase, {
          guildId: row.guild_id,
          type: "bot_warning",
          title: `Integration "${row.label}" needs attention`,
          body: message,
          link: `/dashboard/${row.guild_id}/integrations`,
          metadata: { integration_id: row.id, provider: row.provider },
        });
      }
      console.warn(`[Pulse] Integration "${row.label}" poll failed:`, message);
    } finally {
      running.delete(row.id);
    }
  }

  // Poll every armed connection. Disconnected + paused rows are skipped; errored
  // rows keep retrying so a fixed credential recovers on its own.
  async function tick() {
    for (const row of cache.values()) {
      if (!row.enabled) continue;
      if (row.status === "disconnected") continue;
      // Skip guilds the bot isn't in (the dashboard may outlive a kick).
      if (!client.guilds.cache.has(row.guild_id)) continue;
      void execute(row);
    }
  }

  // ── Realtime: connects / edits / disconnects from the dashboard ──────────────

  function subscribe() {
    supabase
      .channel("integrations-worker")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "integrations" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const id = payload.old?.id;
            if (id) {
              cache.delete(id);
              erroredSeen.delete(id);
            }
            return;
          }
          const row = payload.new;
          if (row) cache.set(row.id, row);
        },
      )
      .subscribe();
  }

  async function start() {
    await reload();
    subscribe();
    // Align the first tick to the top of the next minute, then run every minute —
    // same cadence as the scheduler so external APIs see a steady, predictable rate.
    const msToNextMinute = 60000 - (Date.now() % 60000);
    setTimeout(() => {
      void tick();
      tickTimer = setInterval(() => void tick(), 60000);
      if (tickTimer.unref) tickTimer.unref();
    }, msToNextMinute);
    console.log("[Pulse] Integrations worker started.");
  }

  return { start, reload };
}

module.exports = { createIntegrations };
