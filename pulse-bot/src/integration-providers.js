// Integration provider pollers (PULSIFY-34, bot side).
//
// One poller per external service the Integrations Hub supports. Each poller is
// a pure-ish fetch function: given a stored `integrations` row, it queries the
// provider, works out which items are NEW relative to the row's opaque `cursor`,
// and returns `{ items, cursor }` where:
//
//   • items  — the new events in CHRONOLOGICAL order (oldest first), each shaped
//              as `{ placeholders }`. The engine renders the row's template
//              against `placeholders` and posts one Discord message per item.
//   • cursor — the new cursor to persist (typically the newest item's id).
//
// First-run contract: when `cursor` is null the poller returns `items: []` and a
// cursor pinned to the newest item, so connecting a feed establishes a baseline
// WITHOUT dumping the entire backlog into the channel.
//
// Pollers throw on hard failures (bad credentials, provider down). The engine
// catches, records the error on the row + log, and retries next tick. They never
// touch Supabase or Discord directly — that's the engine's job (integrations.js),
// the same split the scheduler/giveaway workers use.

// ── HTTP + parsing helpers ────────────────────────────────────────────────────

const UA = "Pulse-Integrations/1.0 (+https://pulsify.app)";

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { "User-Agent": UA, Accept: "application/json", ...(opts.headers || {}) },
  });
  if (res.status === 429) throw new Error("Rate limited by the provider — backing off.");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 140)}` : ""}`);
  }
  return res.json();
}

async function fetchText(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { "User-Agent": UA, ...(opts.headers || {}) },
  });
  if (res.status === 429) throw new Error("Rate limited by the provider — backing off.");
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function truncate(s, max) {
  const t = String(s || "").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Given provider entries NEWEST-FIRST, return the ones newer than `cursor` in
 * chronological order plus the new cursor (the newest entry's id). Caps how many
 * are returned so a long-dormant feed can't flood a channel. Stops scanning at
 * the first entry whose id matches the cursor (the last one we delivered).
 */
function diffByCursor(entriesNewestFirst, cursor, idOf, max = 5) {
  const newest = entriesNewestFirst.length ? idOf(entriesNewestFirst[0]) : cursor;
  if (cursor == null) return { items: [], cursor: newest ?? null };
  const fresh = [];
  for (const e of entriesNewestFirst) {
    if (idOf(e) === cursor) break;
    fresh.push(e);
    if (fresh.length >= max) break;
  }
  fresh.reverse(); // chronological
  return { items: fresh, cursor: newest ?? cursor };
}

/**
 * Timestamp-watermark diff, for feeds whose items mutate IN PLACE rather than
 * being append-only — Jira issues, Notion pages, Calendar events all "change"
 * by advancing their `updated` time while keeping the same id. Keying off a
 * per-revision id (`id@updated`) is fragile: any shift in result ordering or
 * timestamp formatting makes the stored cursor match nothing, so every poll
 * re-posts the whole page. Instead we store the newest `updated` time and only
 * forward entries updated strictly after it.
 *
 * `updatedOf(entry)` returns the entry's updated timestamp (ISO string). Returns
 * the entries newer than `cursor` (chronological, capped to `max`) and the new
 * cursor (newest updated ISO seen). A null OR unparseable cursor (e.g. a legacy
 * `id@updated` value from before this approach) establishes a baseline — no
 * items — so connecting (or upgrading) never backfills the whole feed. Immune to
 * result ordering and timestamp format because everything is compared as Dates.
 */
function watermarkDiff(entries, cursor, updatedOf, max = 8) {
  const wm = cursor ? new Date(cursor) : null;
  const watermark = wm && !Number.isNaN(wm.getTime()) ? wm.getTime() : null;

  // Newest updated across the page — don't trust the provider's ordering.
  let newestIso = null;
  let newestMs = -Infinity;
  for (const e of entries) {
    const iso = updatedOf(e);
    const t = new Date(iso).getTime();
    if (!Number.isNaN(t) && t > newestMs) {
      newestMs = t;
      newestIso = iso;
    }
  }
  if (watermark == null) return { items: [], cursor: newestIso ?? cursor ?? null };

  const fresh = [];
  for (const e of entries) {
    const t = new Date(updatedOf(e)).getTime();
    if (Number.isNaN(t) || t <= watermark) continue; // not newer than what we've posted
    fresh.push({ e, t });
  }
  fresh.sort((a, b) => a.t - b.t); // chronological
  return { items: fresh.slice(-max).map((x) => x.e), cursor: newestIso ?? cursor };
}

// ── RSS / Atom feed parsing (used by `rss` and `youtube`) ──────────────────────

function xmlTag(block, tag) {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block);
  if (!m) return "";
  return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
}

function xmlAttr(block, tag, attr) {
  const m = new RegExp(`<${tag}\\b[^>]*\\b${attr}=["']([^"']*)["']`, "i").exec(block);
  return m ? m[1] : "";
}

/** Parse an RSS or Atom document into entries (document order — usually newest first). */
function parseFeed(xml) {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry\b[\s\S]*?<\/entry>/gi : /<item\b[\s\S]*?<\/item>/gi) || [];
  return blocks.map((b) => {
    const title = xmlTag(b, "title");
    let link = isAtom ? xmlAttr(b, "link", "href") : xmlTag(b, "link");
    if (!link) link = xmlTag(b, "link");
    const id = xmlTag(b, isAtom ? "id" : "guid") || link || title;
    const authorBlock = xmlTag(b, "author");
    const author = authorBlock ? stripTags(authorBlock) : xmlTag(b, "dc:creator");
    const summary = xmlTag(b, isAtom ? "summary" : "description") || xmlTag(b, "content");
    const videoId = xmlTag(b, "yt:videoId");
    return {
      id: videoId || id,
      videoId,
      title: stripTags(title),
      link,
      author: stripTags(author),
      summary: truncate(stripTags(summary), 300),
    };
  });
}

// ── developer: GitHub ──────────────────────────────────────────────────────────
// Single events feed, filtered by the connection's `events` select. Event ids are
// monotonic so the cursor is the newest id we've seen across ALL types (filtered
// or not), which keeps us from reprocessing.

function ghMatchesFilter(type, filter) {
  if (filter === "releases") return type === "ReleaseEvent";
  if (filter === "prs") return type === "PullRequestEvent";
  if (filter === "issues") return type === "IssuesEvent";
  return ["PushEvent", "PullRequestEvent", "IssuesEvent", "ReleaseEvent"].includes(type);
}

function ghRender(repo, ev) {
  const actor = ev.actor?.login || "someone";
  const p = ev.payload || {};
  switch (ev.type) {
    case "PushEvent": {
      const n = (p.commits || []).length;
      const branch = String(p.ref || "").replace("refs/heads/", "");
      return { event: "push", title: `${n} new commit${n === 1 ? "" : "s"} to ${branch}`, author: actor, url: `https://github.com/${repo}/commits/${branch}` };
    }
    case "PullRequestEvent":
      return { event: "pull request", title: `#${p.number} ${p.pull_request?.title || ""} (${p.action})`.trim(), author: actor, url: p.pull_request?.html_url || `https://github.com/${repo}/pulls` };
    case "IssuesEvent":
      return { event: "issue", title: `#${p.issue?.number} ${p.issue?.title || ""} (${p.action})`.trim(), author: actor, url: p.issue?.html_url || `https://github.com/${repo}/issues` };
    case "ReleaseEvent":
      return { event: "release", title: p.release?.name || p.release?.tag_name || "New release", author: actor, url: p.release?.html_url || `https://github.com/${repo}/releases` };
    default:
      return null;
  }
}

async function pollGithub(integration) {
  const cfg = integration.config || {};
  const repo = String(cfg.repo || "").trim();
  if (!repo) throw new Error("No repository configured.");
  const filter = cfg.events || "all";
  const headers = { Accept: "application/vnd.github+json" };
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  const events = await fetchJson(`https://api.github.com/repos/${repo}/events?per_page=30`, { headers });

  const { items: fresh, cursor } = diffByCursor(events, integration.cursor, (e) => String(e.id), 8);
  const items = [];
  for (const ev of fresh) {
    if (!ghMatchesFilter(ev.type, filter)) continue;
    const r = ghRender(repo, ev);
    if (r) items.push({ placeholders: { repo, ...r } });
  }
  return { items, cursor };
}

// ── developer: GitLab (gitlab.com) ──────────────────────────────────────────────

function glMatchesFilter(ev, filter) {
  const t = ev.target_type;
  if (filter === "mrs") return t === "MergeRequest";
  if (filter === "issues") return t === "Issue";
  if (filter === "releases") return false; // handled by the releases endpoint path
  return t === "MergeRequest" || t === "Issue" || /pushed/i.test(ev.action_name || "");
}

async function pollGitlab(integration) {
  const cfg = integration.config || {};
  const path = String(cfg.project || "").trim();
  if (!path) throw new Error("No project configured.");
  const enc = encodeURIComponent(path);
  const filter = cfg.events || "all";
  const headers = {};
  if (cfg.token) headers["PRIVATE-TOKEN"] = cfg.token;

  // Releases aren't reliable in the events feed — poll the releases endpoint.
  if (filter === "releases") {
    const releases = await fetchJson(`https://gitlab.com/api/v4/projects/${enc}/releases?per_page=10`, { headers });
    const { items: fresh, cursor } = diffByCursor(releases, integration.cursor, (r) => String(r.tag_name), 5);
    return {
      items: fresh.map((r) => ({ placeholders: { repo: path, event: "release", title: r.name || r.tag_name, author: r.author?.username || "", url: r._links?.self || `https://gitlab.com/${path}/-/releases` } })),
      cursor,
    };
  }

  const events = await fetchJson(`https://gitlab.com/api/v4/projects/${enc}/events?per_page=30`, { headers });
  const { items: fresh, cursor } = diffByCursor(events, integration.cursor, (e) => String(e.id), 8);
  const items = [];
  for (const ev of fresh) {
    if (!glMatchesFilter(ev, filter)) continue;
    const author = ev.author_username || ev.author?.username || "someone";
    let event = "activity";
    let url = `https://gitlab.com/${path}`;
    if (ev.target_type === "MergeRequest") {
      event = "merge request";
      url = `https://gitlab.com/${path}/-/merge_requests/${ev.target_iid}`;
    } else if (ev.target_type === "Issue") {
      event = "issue";
      url = `https://gitlab.com/${path}/-/issues/${ev.target_iid}`;
    } else if (/pushed/i.test(ev.action_name || "")) {
      event = "push";
      url = `https://gitlab.com/${path}/-/commits`;
    }
    const title = ev.target_title || `${ev.action_name || "activity"}`;
    items.push({ placeholders: { repo: path, event, title, author, url } });
  }
  return { items, cursor };
}

// ── streaming: YouTube (channel RSS, no API key) ────────────────────────────────

const ytChannelCache = new Map(); // input -> channelId

async function resolveYoutubeChannelId(input) {
  const raw = String(input || "").trim();
  if (/^UC[\w-]{20,}$/.test(raw)) return raw;
  const fromUrl = /\/channel\/(UC[\w-]{20,})/.exec(raw);
  if (fromUrl) return fromUrl[1];
  if (ytChannelCache.has(raw)) return ytChannelCache.get(raw);

  // Resolve a handle / custom URL by scraping the channel page's canonical id.
  let url = raw;
  if (/^@[\w.-]+$/.test(raw)) url = `https://www.youtube.com/${raw}`;
  else if (!/^https?:\/\//i.test(raw)) url = `https://www.youtube.com/@${raw.replace(/^@/, "")}`;
  const html = await fetchText(url);
  const m = /"channelId":"(UC[\w-]{20,})"/.exec(html) || /\/channel\/(UC[\w-]{20,})/.exec(html);
  if (!m) throw new Error("Couldn't resolve that YouTube channel — paste its UC… id or /channel/ URL.");
  ytChannelCache.set(raw, m[1]);
  return m[1];
}

async function pollYoutube(integration) {
  const cfg = integration.config || {};
  const channelId = await resolveYoutubeChannelId(cfg.channel);
  const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  const entries = parseFeed(xml);
  // The channel RSS feed can't distinguish a premiere/live from a normal upload,
  // so the `kind` filter (uploads/live/all) is treated as "announce new entries".
  const max = Number(cfg.limit) || 3;
  const { items: fresh, cursor } = diffByCursor(entries, integration.cursor, (e) => String(e.id), max);
  return {
    items: fresh.map((e) => ({ placeholders: { author: e.author, title: e.title, url: e.videoId ? `https://youtu.be/${e.videoId}` : e.link } })),
    cursor,
  };
}

// ── streaming: Twitch (Helix, app credentials from env) ─────────────────────────

let twitchToken = { value: null, expiresAt: 0 };

async function getTwitchToken() {
  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("Twitch isn't configured on the bot — set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET.");
  }
  if (twitchToken.value && Date.now() < twitchToken.expiresAt - 60000) return twitchToken.value;
  const res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`, {
    method: "POST",
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`Twitch auth failed (${res.status}).`);
  const data = await res.json();
  twitchToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return twitchToken.value;
}

async function pollTwitch(integration) {
  const cfg = integration.config || {};
  const login = String(cfg.channel || "").trim().toLowerCase();
  if (!login) throw new Error("No Twitch channel configured.");
  const token = await getTwitchToken();
  const data = await fetchJson(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`, {
    headers: { "Client-Id": process.env.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` },
  });
  const stream = (data.data || [])[0];
  // Cursor holds the live stream id while live, "" while offline. A go-live posts
  // once when the id changes; going offline resets so the next stream alerts again.
  if (!stream) {
    return { items: [], cursor: "" };
  }
  if (integration.cursor === stream.id) {
    return { items: [], cursor: stream.id };
  }
  const baseline = integration.cursor == null; // never armed → don't alert for an already-live stream
  const items = baseline
    ? []
    : [{ placeholders: { author: stream.user_name, title: stream.title || "Live now", game: stream.game_name || "", url: `https://twitch.tv/${login}` } }];
  return { items, cursor: stream.id };
}

// ── social: Reddit (public JSON) ────────────────────────────────────────────────

async function pollReddit(integration) {
  const cfg = integration.config || {};
  let sub = String(cfg.subreddit || "").trim();
  if (!sub) throw new Error("No subreddit configured.");
  if (!/^r\//i.test(sub)) sub = `r/${sub}`;
  const sort = cfg.sort || "new";
  const keyword = String(cfg.keyword || "").trim().toLowerCase();
  const data = await fetchJson(`https://www.reddit.com/${sub}/${sort}.json?limit=15&raw_json=1`);
  const posts = (data?.data?.children || []).map((c) => c.data).filter(Boolean);
  const { items: fresh, cursor } = diffByCursor(posts, integration.cursor, (p) => String(p.name), 5);
  const items = [];
  for (const p of fresh) {
    if (keyword && !(`${p.title} ${p.selftext || ""}`.toLowerCase().includes(keyword))) continue;
    items.push({ placeholders: { subreddit: sub, title: p.title, author: `u/${p.author}`, url: `https://www.reddit.com${p.permalink}` } });
  }
  return { items, cursor };
}

// ── content: RSS / Atom ──────────────────────────────────────────────────────────

async function pollRss(integration) {
  const cfg = integration.config || {};
  const url = String(cfg.url || "").trim();
  if (!url) throw new Error("No feed URL configured.");
  const xml = await fetchText(url);
  const entries = parseFeed(xml);
  const max = Number(cfg.limit) || 1;
  const { items: fresh, cursor } = diffByCursor(entries, integration.cursor, (e) => String(e.id), max);
  return {
    items: fresh.map((e) => ({ placeholders: { title: e.title, author: e.author, summary: e.summary, url: e.link } })),
    cursor,
  };
}

// ── content: Steam (ISteamNews) ──────────────────────────────────────────────────

const steamNameCache = new Map();

async function steamGameName(appId) {
  if (steamNameCache.has(appId)) return steamNameCache.get(appId);
  try {
    const data = await fetchJson(`https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic`);
    const name = data?.[appId]?.data?.name;
    if (name) steamNameCache.set(appId, name);
    return name || `App ${appId}`;
  } catch {
    return `App ${appId}`;
  }
}

async function pollSteam(integration) {
  const cfg = integration.config || {};
  const appId = String(cfg.appId || "").trim();
  if (!appId) throw new Error("No Steam App ID configured.");
  const data = await fetchJson(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=10&maxlength=300`);
  const news = data?.appnews?.newsitems || [];
  const { items: fresh, cursor } = diffByCursor(news, integration.cursor, (n) => String(n.gid), 5);
  if (!fresh.length) return { items: [], cursor };
  const game = await steamGameName(appId);
  return {
    items: fresh.map((n) => ({ placeholders: { game, title: n.title, url: n.url } })),
    cursor,
  };
}

// ── social: Patreon (posts) ──────────────────────────────────────────────────────

async function pollPatreon(integration) {
  const cfg = integration.config || {};
  const token = String(cfg.token || "").trim();
  if (!token) throw new Error("Patreon needs an access token (open settings).");
  if (cfg.notify === "patrons") {
    // Reading the patron list needs the identity[memberships] scope + member
    // enumeration, which this connection doesn't collect — surface it clearly.
    throw new Error("New-patron alerts aren't supported yet — switch this connection to posts.");
  }
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const campaigns = await fetchJson("https://www.patreon.com/api/oauth2/v2/campaigns", auth);
  const campaignId = campaigns?.data?.[0]?.id;
  if (!campaignId) throw new Error("No Patreon campaign found for this token.");
  const posts = await fetchJson(
    `https://www.patreon.com/api/oauth2/v2/campaigns/${campaignId}/posts?fields%5Bpost%5D=title,url,published_at&sort=-published_at`,
    auth,
  );
  const rows = (posts?.data || []).filter((p) => p.attributes?.published_at);
  const { items: fresh, cursor } = diffByCursor(rows, integration.cursor, (p) => String(p.id), 5);
  const author = String(cfg.campaign || "Patreon");
  return {
    items: fresh.map((p) => ({ placeholders: { title: p.attributes?.title || "New post", author, action: "shared a new post", url: p.attributes?.url || "https://patreon.com" } })),
    cursor,
  };
}

// ── productivity helpers ──────────────────────────────────────────────────────────
// Productivity providers store per-event toggles in config.events as a
// { [eventKey]: boolean } map. `eventEnabled` defaults missing keys to ON.

function eventEnabled(config, key) {
  const events = config?.events;
  if (!events || typeof events !== "object") return true;
  return events[key] !== false;
}

// ── productivity: Jira ─────────────────────────────────────────────────────────────

async function pollJira(integration) {
  const cfg = integration.config || {};
  const site = String(cfg.site || "").trim().replace(/\/$/, "");
  const project = String(cfg.project || "").trim();
  const email = String(cfg.email || "").trim();
  const token = String(cfg.token || "").trim();
  if (!site || !project) throw new Error("Jira site URL and project key are required.");
  if (!email || !token) throw new Error("Jira needs an account email + API token (open settings).");

  const basic = Buffer.from(`${email}:${token}`).toString("base64");
  const jql = encodeURIComponent(`project = ${project} ORDER BY updated DESC`);
  // The legacy /rest/api/3/search was retired (410 Gone); the enhanced
  // /rest/api/3/search/jql replaces it (token-paginated, fields must be explicit;
  // we only need the first page, newest-updated first).
  const data = await fetchJson(
    `${site}/rest/api/3/search/jql?jql=${jql}&maxResults=20&fields=summary,status,assignee,created,updated`,
    { headers: { Authorization: `Basic ${basic}` } },
  );
  const issues = data?.issues || [];
  // Watermark on `updated` — a status change/edit advances the issue's updated
  // time, crossing the watermark and firing once (see watermarkDiff).
  const { items: changed, cursor } = watermarkDiff(issues, integration.cursor, (i) => i.fields?.updated, 8);
  const items = [];
  for (const issue of changed) {
    const f = issue.fields || {};
    const created = new Date(f.created).getTime();
    const updated = new Date(f.updated).getTime();
    const isNew = Math.abs(updated - created) < 2000;
    const eventKey = isNew ? "issue_created" : "issue_transitioned";
    if (!eventEnabled(cfg, eventKey)) continue;
    items.push({
      placeholders: {
        key: issue.key,
        title: f.summary || "",
        status: f.status?.name || "—",
        assignee: f.assignee?.displayName || "Unassigned",
        url: `${site}/browse/${issue.key}`,
      },
    });
  }
  return { items, cursor };
}

// ── productivity: Trello ───────────────────────────────────────────────────────────

function trelloBoardId(input) {
  const raw = String(input || "").trim();
  const m = /\/b\/([A-Za-z0-9]+)/.exec(raw);
  return m ? m[1] : raw;
}

async function pollTrello(integration) {
  const cfg = integration.config || {};
  const board = trelloBoardId(cfg.board);
  const key = String(cfg.apiKey || "").trim();
  const token = String(cfg.token || "").trim();
  if (!board) throw new Error("No Trello board configured.");
  if (!key || !token) throw new Error("Trello needs an API key + token (open settings).");
  const data = await fetchJson(
    `https://api.trello.com/1/boards/${board}/actions?key=${key}&token=${token}&limit=25&filter=createCard,updateCard,commentCard`,
  );
  const { items: fresh, cursor } = diffByCursor(data || [], integration.cursor, (a) => String(a.id), 8);
  const items = [];
  for (const a of fresh) {
    const d = a.data || {};
    const card = d.card || {};
    let eventKey = null;
    let action = "";
    if (a.type === "createCard") {
      eventKey = "card_created";
      action = "created a card";
    } else if (a.type === "updateCard" && d.listAfter) {
      eventKey = "card_moved";
      action = `moved to ${d.listAfter.name}`;
    } else if (a.type === "commentCard") {
      eventKey = "card_commented";
      action = "commented";
    } else {
      continue; // renames / other updates: skip to keep the channel quiet
    }
    if (!eventEnabled(cfg, eventKey)) continue;
    items.push({
      placeholders: {
        title: card.name || "",
        list: (d.listAfter || d.list || {}).name || "",
        actor: a.memberCreator?.fullName || "Someone",
        action,
        url: card.shortLink ? `https://trello.com/c/${card.shortLink}` : "https://trello.com",
      },
    });
  }
  return { items, cursor };
}

// ── productivity: Notion ────────────────────────────────────────────────────────────

function notionTitle(page) {
  const props = page.properties || {};
  for (const v of Object.values(props)) {
    if (v?.type === "title" && Array.isArray(v.title)) {
      return v.title.map((t) => t.plain_text).join("").trim() || "Untitled";
    }
  }
  return "Untitled";
}

async function pollNotion(integration) {
  const cfg = integration.config || {};
  const database = String(cfg.database || "").trim();
  const token = String(cfg.token || "").trim();
  if (!database || !token) throw new Error("Notion needs a database id + integration token.");
  const data = await fetchJson(`https://api.notion.com/v1/databases/${database}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ page_size: 10, sorts: [{ timestamp: "last_edited_time", direction: "descending" }] }),
  });
  const pages = data?.results || [];
  // Watermark on `last_edited_time` — an edit advances it past the watermark and
  // fires once; immune to ordering/format drift (see watermarkDiff).
  const { items: changed, cursor } = watermarkDiff(pages, integration.cursor, (p) => p.last_edited_time, 8);
  const items = [];
  for (const page of changed) {
    const created = new Date(page.created_time).getTime();
    const edited = new Date(page.last_edited_time).getTime();
    const isNew = Math.abs(edited - created) < 2000;
    const eventKey = isNew ? "page_created" : "page_updated";
    if (!eventEnabled(cfg, eventKey)) continue;
    items.push({
      placeholders: {
        title: notionTitle(page),
        actor: "Someone",
        action: isNew ? "created a page" : "updated the page",
        url: page.url || "https://notion.so",
      },
    });
  }
  return { items, cursor };
}

// ── productivity: Google Calendar ─────────────────────────────────────────────────

function formatWhen(ev) {
  const start = ev.start?.dateTime || ev.start?.date;
  if (!start) return "";
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return String(start);
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: ev.start?.dateTime ? "short" : undefined });
}

// How far ahead a "starting soon" reminder fires, and how long a fired reminder
// is remembered so the same event doesn't re-alert every minute.
const REMINDER_WINDOW_MS = 15 * 60 * 1000;
const REMINDER_KEEP_MS = 2 * 60 * 60 * 1000;

// Calendar packs two streams into the single `cursor` column as JSON:
//   { u: "<newest updated-time watermark ISO>", r: ["<eventId>@<startISO>", …] }
// `u` drives the created/updated stream (via watermarkDiff); `r` is the set of
// events we've already sent a reminder for (keyed by start so a rescheduled
// event re-alerts). A legacy plain-string or `id@updated` `u` is unparseable as
// a date, so watermarkDiff treats it as a fresh baseline (no backfill).
function parseCalendarCursor(cursor) {
  if (!cursor) return { u: null, r: [] };
  try {
    const o = JSON.parse(cursor);
    if (o && typeof o === "object" && !Array.isArray(o)) {
      return { u: o.u ?? null, r: Array.isArray(o.r) ? o.r : [] };
    }
  } catch {
    return { u: cursor, r: [] }; // legacy updated-only cursor
  }
  return { u: null, r: [] };
}

function eventStartMs(ev) {
  const start = ev.start?.dateTime || ev.start?.date;
  return start ? new Date(start).getTime() : NaN;
}

async function pollGoogleCalendar(integration) {
  const cfg = integration.config || {};
  const calendarId = String(cfg.calendarId || "").trim();
  const apiKey = String(cfg.apiKey || "").trim();
  if (!calendarId) throw new Error("No calendar configured.");
  if (!apiKey) throw new Error("Google Calendar needs an API key (open settings).");
  const enc = encodeURIComponent(calendarId);
  const base = `https://www.googleapis.com/calendar/v3/calendars/${enc}/events?key=${apiKey}&singleEvents=true`;

  const firstRun = integration.cursor == null;
  const { u: updatedCursor, r: remindedRaw } = parseCalendarCursor(integration.cursor);
  const wantCreatedUpdated = eventEnabled(cfg, "created") || eventEnabled(cfg, "updated");
  const wantReminder = eventEnabled(cfg, "reminder");
  const items = [];
  let newUpdatedCursor = updatedCursor;

  // ── Created / updated stream (ordered by last edit) ──
  if (wantCreatedUpdated) {
    const data = await fetchJson(`${base}&orderBy=updated&maxResults=20`);
    const events = (data?.items || []).filter((e) => e.status !== "cancelled");
    // Watermark on `updated` (see watermarkDiff) — an edit re-fires once; the
    // updated-stream cursor `u` is now the newest updated ISO.
    const { items: changed, cursor } = watermarkDiff(events, updatedCursor, (e) => e.updated, 8);
    newUpdatedCursor = cursor;
    for (const ev of changed) {
      const created = new Date(ev.created).getTime();
      const updated = new Date(ev.updated).getTime();
      const isNew = Math.abs(updated - created) < 2000;
      if (!eventEnabled(cfg, isNew ? "created" : "updated")) continue;
      items.push({
        placeholders: {
          title: ev.summary || "(no title)",
          when: formatWhen(ev),
          location: ev.location || "",
          url: ev.htmlLink || "https://calendar.google.com",
        },
      });
    }
  }

  // ── Reminder stream (events starting within the next window) ──
  let reminded = remindedRaw;
  if (wantReminder) {
    const now = Date.now();
    const timeMin = encodeURIComponent(new Date(now).toISOString());
    const timeMax = encodeURIComponent(new Date(now + REMINDER_WINDOW_MS).toISOString());
    const data = await fetchJson(`${base}&orderBy=startTime&timeMin=${timeMin}&timeMax=${timeMax}&maxResults=10`);
    const upcoming = (data?.items || []).filter((e) => e.status !== "cancelled" && (e.start?.dateTime || e.start?.date));
    const remindedSet = new Set(reminded);
    for (const ev of upcoming) {
      const startMs = eventStartMs(ev);
      if (Number.isNaN(startMs) || startMs < now) continue; // already started
      const key = `${ev.id}@${ev.start.dateTime || ev.start.date}`;
      if (remindedSet.has(key)) continue;
      remindedSet.add(key);
      // First run only establishes the baseline — record what's upcoming without
      // alerting, so connecting doesn't fire reminders for the whole next window.
      if (firstRun) continue;
      items.push({
        placeholders: {
          title: ev.summary || "(no title)",
          when: `Starting soon — ${formatWhen(ev)}`,
          location: ev.location || "",
          url: ev.htmlLink || "https://calendar.google.com",
        },
      });
    }
    // Prune remembered reminders whose start has aged out, keeping the set bounded.
    reminded = [...remindedSet].filter((k) => {
      const t = new Date(k.slice(k.indexOf("@") + 1)).getTime();
      return !Number.isNaN(t) && t > now - REMINDER_KEEP_MS;
    });
  }

  return { items, cursor: JSON.stringify({ u: newUpdatedCursor, r: reminded }) };
}

// ── Registry ───────────────────────────────────────────────────────────────────

const POLLERS = {
  github: pollGithub,
  gitlab: pollGitlab,
  youtube: pollYoutube,
  twitch: pollTwitch,
  reddit: pollReddit,
  rss: pollRss,
  steam: pollSteam,
  patreon: pollPatreon,
  jira: pollJira,
  trello: pollTrello,
  notion: pollNotion,
  "google-calendar": pollGoogleCalendar,
};

// Providers with no usable polling path. The engine surfaces the reason on the
// row instead of silently doing nothing. Mirrors the catalog `availability`
// metadata in pulsify-web-app/lib/integrations.ts.
const UNSUPPORTED = {
  tiktok: "TikTok has no public API for reading a creator's posts.",
  twitter: "X/Twitter removed free API access for reading posts.",
  kick: "Kick has no official API yet — support is planned.",
};

module.exports = { POLLERS, UNSUPPORTED };
