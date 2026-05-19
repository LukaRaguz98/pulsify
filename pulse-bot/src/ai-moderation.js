// Pulse Guard forwarder.
//
// Every new guild message in the bot is forwarded to the web app's
// /api/bot/ai-moderation/analyze endpoint. The endpoint owns all the policy
// (whitelists, sensitivity, per-category auto-actions, LLM call, Discord
// alert post) so the bot stays a thin pipe — we send context, the web app
// decides what to do with it.
//
// Auth: `Authorization: Bearer ${PULSIFY_BOT_SECRET}`. The secret MUST match
// the one configured on the web app side; without it the endpoint rejects
// with 401.
//
// Required env:
//   PULSIFY_BOT_SECRET — shared secret
//   APP_URL            — web app base, e.g. http://localhost:3000

const DEFAULT_TIMEOUT_MS = 8000;

let warnedNoSecret = false;
let warnedNoUrl = false;

/**
 * Forward a Discord.js `Message` to Pulse Guard. Fire-and-forget — we never
 * block the message handler on this. Errors are logged and dropped so a
 * web-app outage can't take the bot down.
 */
async function forwardMessageToPulseGuard(message) {
  const secret = process.env.PULSIFY_BOT_SECRET;
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  if (!secret) {
    if (!warnedNoSecret) {
      console.warn(
        "[PulseGuard] PULSIFY_BOT_SECRET not set — skipping all message forwarding.",
      );
      warnedNoSecret = true;
    }
    return;
  }
  if (!appUrl) {
    if (!warnedNoUrl) {
      console.warn(
        "[PulseGuard] APP_URL not set — skipping all message forwarding.",
      );
      warnedNoUrl = true;
    }
    return;
  }

  // Skip the moment we can — saves a network round-trip for the bulk of
  // chat that's bot messages, DMs, or pure attachment posts.
  if (!message.guild) return;
  if (message.author?.bot) return;
  if (!message.content || message.content.trim().length === 0) return;

  const body = {
    guild_id: message.guild.id,
    channel_id: message.channelId,
    channel_name: message.channel?.name ?? null,
    message_id: message.id,
    author_id: message.author.id,
    author_name:
      message.member?.displayName ??
      message.author.globalName ??
      message.author.username ??
      null,
    author_username: message.author.username ?? null,
    author_role_ids: message.member?.roles?.cache
      ? [...message.member.roles.cache.keys()].filter(
          (id) => id !== message.guild.id,
        )
      : [],
    content: message.content,
    // mentions.users counts resolved <@…> tags; @everyone / @here are flagged
    // by content regex on the web-app side, so they don't need a separate count.
    mention_count:
      (message.mentions?.users?.size ?? 0) +
      (message.mentions?.roles?.size ?? 0),
  };

  // AbortController so a hanging web app doesn't leak open sockets.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${appUrl}/api/bot/ai-moderation/analyze`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      // 401 = secret mismatch, 503 = secret missing on web app, anything
      // else is unexpected. Log and move on — never throw.
      const text = await res.text().catch(() => "");
      console.warn(
        `[PulseGuard] analyze ${res.status} for guild ${body.guild_id}: ${text.slice(0, 200)}`,
      );
    }
    // Successful response is intentionally ignored. The web app already
    // executed the configured auto-action (delete / timeout / warn) via the
    // bot token, recorded the event, and posted the alert. Nothing for the
    // bot to do with the response beyond eventually noticing in the
    // dashboard.
  } catch (err) {
    if (err.name === "AbortError") {
      console.warn(`[PulseGuard] analyze timed out for guild ${body.guild_id}`);
    } else {
      console.warn(
        `[PulseGuard] analyze failed for guild ${body.guild_id}:`,
        err.message,
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { forwardMessageToPulseGuard };
