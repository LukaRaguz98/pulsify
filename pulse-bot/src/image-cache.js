// Tiny in-memory cache for bot-fetched generated images (the next/og routes:
// profile bars/cards, banner frame, milestone cards/banner, …).
//
// The web app renders these images deterministically from their query string —
// the SAME url always yields the SAME PNG — so once we've fetched one we can
// reuse the bytes instead of asking the web app to render it again. This is the
// "read, don't re-create" win: identical embeds (a member re-running /profile,
// the same accent-coloured milestone banner across calls, two members at the
// same progress) become instant, and in production a CDN in front of the web
// app caches the first render too (the routes also send Cache-Control).
//
// The url already encodes everything that affects the output, so when a member's
// stats change the url changes and we naturally miss + re-fetch (no staleness).

const cache = new Map(); // url -> { buf, expires }
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 min — plenty for repeated commands
const MAX_ENTRIES = 300;

/**
 * Fetch a generated image as a Discord attachment, served from cache when a
 * fresh copy for this exact url exists. Returns { attachment, name } or null.
 * On a fetch failure a stale cached copy is returned if we have one (better a
 * slightly old image than none). `ttlMs` lets near-static images (banners) live
 * far longer than per-member ones.
 */
async function fetchImageCached(url, name, { ttlMs = DEFAULT_TTL_MS, timeoutMs = 8000 } = {}) {
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && hit.expires > now) return { attachment: hit.buf, name };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      cache.set(url, { buf, expires: now + ttlMs });
      // Crude size bound: drop the oldest inserted entry when over the cap.
      if (cache.size > MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      return { attachment: buf, name };
    }
  } catch {
    /* fall through — serve stale or null */
  } finally {
    clearTimeout(timer);
  }
  if (hit) return { attachment: hit.buf, name }; // stale-on-error
  return null;
}

module.exports = { fetchImageCached };
