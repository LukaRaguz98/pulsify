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

// Display names for the `-# <Provider> · Integration` subtitle. Mirrors the
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

// Mirror of renderTemplate in lib/integrations.ts: unknown {{tokens}} are left
// as-is. Templates are authored + validated on the dashboard.
function renderTemplate(template, ctx) {
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (m, key) =>
    ctx[key] != null ? String(ctx[key]) : m,
  );
}

// Pulse v2 container, matching the dashboard's notificationContainer() and the
// announcement/giveaway layout: a `**Pulse**` label + connection-label heading +
// `-# <Provider> · Integration` subtitle sitting beside the Pulse integrations
// badge (type-9 Section), a braille width spacer, the rendered body split on
// blank lines, a divider, and the `-# Pulse · Integrations` footer. An optional
// leading mention line pings a role for go-live alerts.
function buildContainer(provider, label, body, mentionLine) {
  const text = (content) => ({ type: 10, content });
  const headerLines = [
    text("**Pulse**"),
    text(`# ${label}`),
    text(`-# ${providerName(provider)} · Integration`),
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
  for (const para of String(body || "")
    .trim()
    .split(/\n{2,}/)) {
    if (para.trim()) components.push(text(para.trim()));
  }
  components.push({ type: 14, divider: true, spacing: 1 });
  components.push(text("-# Pulse · Integrations"));
  return { type: 17, accent_color: BRAND, components };
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
    const body = renderTemplate(row.template, item.placeholders || {});
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
