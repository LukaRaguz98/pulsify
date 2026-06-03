// Integrations Hub catalog + pure helpers (PULSIFY-34).
//
// No JSX / framework / IO imports live here (icons are referenced by lucide
// NAME, resolved in the UI layer) so this file is safe to import from both
// client components and server actions — same split as lib/announcements.ts and
// lib/giveaways.ts.
//
// The Integrations Hub is (for now) a DASHBOARD-ONLY surface: the dashboard
// connects external services, stores their config, and posts notifications to
// Discord through the REST API. The bot never touches the `integrations` table.
// This module is the single source of truth for the provider catalog (what can
// be connected, what each connection collects, and how its notifications read)
// shared by the server action and the UI.

// ── Categories ────────────────────────────────────────────────────────────────

export type IntegrationCategory =
  | 'developer'
  | 'streaming'
  | 'social'
  | 'content'
  | 'productivity'

export const CATEGORY_META: Record<
  IntegrationCategory,
  { label: string; blurb: string; icon: string; order: number }
> = {
  developer: {
    label: 'Developer',
    blurb: 'Pushes, pull/merge requests, releases and issues from your code platforms.',
    icon: 'GitBranch',
    order: 0,
  },
  streaming: {
    label: 'Streaming & Video',
    blurb: 'Go-live alerts and new-upload announcements from video & streaming platforms.',
    icon: 'MonitorPlay',
    order: 1,
  },
  social: {
    label: 'Social & Community',
    blurb: 'Posts and updates from the social platforms your community follows.',
    icon: 'AtSign',
    order: 2,
  },
  content: {
    label: 'Content & Feeds',
    blurb: 'Forward news, blogs, patch notes and any RSS feed into Discord.',
    icon: 'Rss',
    order: 3,
  },
  productivity: {
    label: 'Productivity',
    blurb: 'Sync calendars, boards and docs so your team stays in lockstep with Discord.',
    icon: 'Briefcase',
    order: 4,
  },
}

/** Categories in display order — derived once from CATEGORY_META. */
export const CATEGORY_ORDER: IntegrationCategory[] = (
  Object.keys(CATEGORY_META) as IntegrationCategory[]
).sort((a, b) => CATEGORY_META[a].order - CATEGORY_META[b].order)

// ── Status ────────────────────────────────────────────────────────────────────

export type IntegrationStatus = 'connected' | 'disconnected' | 'error'

export const STATUS_META: Record<
  IntegrationStatus,
  { label: string; icon: string; color: string; order: number }
> = {
  connected:    { label: 'Connected',    icon: 'CheckCircle2',  color: '#22c55e', order: 0 },
  error:        { label: 'Needs attention', icon: 'AlertTriangle', color: '#ef4444', order: 1 },
  disconnected: { label: 'Disconnected', icon: 'PlugZap',       color: '#94a3b8', order: 2 },
}

export function normaliseStatus(v: unknown): IntegrationStatus {
  return v === 'connected' || v === 'disconnected' || v === 'error' ? v : 'connected'
}

/**
 * Health is what the cards/indicators surface: a connection that's connected
 * AND enabled is "healthy"; connected-but-paused is "paused"; everything else
 * mirrors the status. Kept separate from `status` so "turned off on purpose"
 * doesn't read as a problem.
 */
export type IntegrationHealth = 'healthy' | 'paused' | 'error' | 'disconnected'

export const HEALTH_META: Record<
  IntegrationHealth,
  { label: string; color: string }
> = {
  healthy:      { label: 'Healthy',      color: '#22c55e' },
  paused:       { label: 'Paused',       color: '#f59e0b' },
  error:        { label: 'Error',        color: '#ef4444' },
  disconnected: { label: 'Disconnected', color: '#94a3b8' },
}

export function health(i: Pick<Integration, 'status' | 'enabled'>): IntegrationHealth {
  if (i.status === 'error') return 'error'
  if (i.status === 'disconnected') return 'disconnected'
  return i.enabled ? 'healthy' : 'paused'
}

// ── Wizard field schema ───────────────────────────────────────────────────────
// Each provider declares the fields its setup wizard collects. Field types map
// to inputs in the UI; `secret` masks the value (API tokens), `select` renders a
// dropdown from `options`.

export type FieldType = 'text' | 'url' | 'secret' | 'select'

export type IntegrationField = {
  key: string
  label: string
  type: FieldType
  placeholder?: string
  help?: string
  required?: boolean
  /** Regex (as a string) the value must match. */
  pattern?: string
  /** Options for `select` fields. */
  options?: { value: string; label: string }[]
}

// ── Sync event toggles (productivity integrations) ─────────────────────────────
// Productivity providers expose a small set of event types the admin can toggle
// individually ("post when a card moves", "post 15m before an event"). Stored in
// config.events as a { [eventKey]: boolean } map.

export type SyncEvent = { key: string; label: string; description: string; defaultOn: boolean }

// ── Provider catalog ──────────────────────────────────────────────────────────

export type IntegrationProvider = {
  id: string
  name: string
  category: IntegrationCategory
  /** lucide icon name, resolved in the UI (components/.../icons.tsx). */
  icon: string
  /** Accent used for the card glyph + brand chip. */
  accent: string
  /** One-liner for the available-integrations card. */
  blurb: string
  /** Longer copy shown in the setup wizard. */
  description: string
  capabilities: { notifications: boolean; sync: boolean }
  /**
   * Whether the bot's polling worker can actually deliver this provider today.
   * Omitted ⇒ 'available'. 'unavailable' = no usable public API (can't be
   * connected); 'planned' = supported soon (shown but not connectable). The bot
   * (pulse-bot/src/integration-providers.js UNSUPPORTED) mirrors these.
   */
  availability?: 'available' | 'unavailable' | 'planned'
  /** Why a non-available provider can't be connected — shown in the UI. */
  availabilityNote?: string
  /** Wizard fields collected on connect. */
  fields: IntegrationField[]
  /** Field whose value labels the connection (falls back to the provider name). */
  labelField?: string
  /** Field stored as `external_ref` (for de-dupe + display). */
  refField?: string
  /** Configurable sync events (productivity providers). */
  syncEvents?: SyncEvent[]
  /** Default notification template (supports {{placeholders}}). */
  defaultTemplate: string
  /** Placeholders the template understands, for the wizard's helper. */
  placeholders: { token: string; description: string }[]
  /** Search keywords beyond the name. */
  keywords?: string
  docsUrl?: string
}

export const PROVIDERS: IntegrationProvider[] = [
  // ── Discord-adjacent / notification sources ─────────────────────────────────
  {
    id: 'github',
    name: 'GitHub',
    category: 'developer',
    icon: 'GitBranch',
    accent: '#8b949e',
    blurb: 'Post commits, pull requests, releases and issues from a repository.',
    description:
      'Connect a GitHub repository to announce pushes, pull requests, releases and new issues in Discord — perfect for keeping contributors and players in the loop.',
    capabilities: { notifications: true, sync: false },
    fields: [
      { key: 'repo', label: 'Repository', type: 'text', placeholder: 'owner/repo', required: true, pattern: '^[\\w.-]+/[\\w.-]+$', help: 'e.g. pulsify/pulse-bot' },
      { key: 'events', label: 'Events', type: 'select', required: true, options: [
        { value: 'all', label: 'All activity' },
        { value: 'releases', label: 'Releases only' },
        { value: 'prs', label: 'Pull requests only' },
        { value: 'issues', label: 'Issues only' },
      ] },
      { key: 'token', label: 'Access token', type: 'secret', placeholder: 'github_pat_… (optional for public repos)', help: 'A fine-grained token with read access. Optional for public repositories.' },
    ],
    labelField: 'repo',
    refField: 'repo',
    defaultTemplate: '**{{repo}}** · {{event}}\n{{title}}\n{{url}}',
    placeholders: [
      { token: '{{repo}}', description: 'The repository (owner/repo)' },
      { token: '{{event}}', description: 'The event type (push, release, …)' },
      { token: '{{title}}', description: 'Commit / PR / release title' },
      { token: '{{author}}', description: 'Who triggered it' },
      { token: '{{url}}', description: 'Link to the item on GitHub' },
    ],
    keywords: 'git repository commits pull request release issue code',
    docsUrl: 'https://docs.github.com/webhooks',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    category: 'developer',
    icon: 'GitMerge',
    accent: '#fc6d26',
    blurb: 'Post pushes, merge requests, releases and issues from a project.',
    description:
      'Connect a GitLab project to announce pushes, merge requests, releases and new issues in Discord.',
    capabilities: { notifications: true, sync: false },
    fields: [
      { key: 'project', label: 'Project path', type: 'text', placeholder: 'group/project', required: true, pattern: '^[\\w.-]+(/[\\w.-]+)+$', help: 'e.g. gitlab-org/gitlab' },
      { key: 'events', label: 'Events', type: 'select', required: true, options: [
        { value: 'all', label: 'All activity' },
        { value: 'releases', label: 'Releases only' },
        { value: 'mrs', label: 'Merge requests only' },
        { value: 'issues', label: 'Issues only' },
      ] },
      { key: 'token', label: 'Access token', type: 'secret', placeholder: 'glpat-… (optional for public projects)', help: 'A token with read_api scope. Optional for public projects.' },
    ],
    labelField: 'project',
    refField: 'project',
    defaultTemplate: '**{{repo}}** · {{event}}\n{{title}}\n{{url}}',
    placeholders: [
      { token: '{{repo}}', description: 'The project (group/project)' },
      { token: '{{event}}', description: 'The event type (push, release, …)' },
      { token: '{{title}}', description: 'Commit / MR / release title' },
      { token: '{{author}}', description: 'Who triggered it' },
      { token: '{{url}}', description: 'Link to the item on GitLab' },
    ],
    keywords: 'git repository commits merge request release issue code devops',
    docsUrl: 'https://docs.gitlab.com/ee/user/project/integrations/webhooks.html',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    category: 'streaming',
    icon: 'MonitorPlay',
    accent: '#ff0000',
    blurb: 'Announce new uploads and live streams from a channel.',
    description:
      'Connect a YouTube channel so Pulse posts an announcement the moment a new video goes up or a stream goes live.',
    capabilities: { notifications: true, sync: false },
    fields: [
      { key: 'channel', label: 'Channel URL or ID', type: 'text', placeholder: 'https://youtube.com/@channel or UC…', required: true, help: 'Paste the channel link or its UC… id.' },
      { key: 'kind', label: 'Notify on', type: 'select', required: true, options: [
        { value: 'all', label: 'Uploads & live streams' },
        { value: 'uploads', label: 'Uploads only' },
        { value: 'live', label: 'Live streams only' },
      ] },
    ],
    labelField: 'channel',
    refField: 'channel',
    defaultTemplate: '**{{author}}** just posted: {{title}}\n{{url}}',
    placeholders: [
      { token: '{{author}}', description: 'The channel name' },
      { token: '{{title}}', description: 'Video / stream title' },
      { token: '{{url}}', description: 'Link to the video' },
    ],
    keywords: 'video upload stream live creator channel',
    docsUrl: 'https://developers.google.com/youtube',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    category: 'streaming',
    icon: 'Music2',
    accent: '#ff0050',
    blurb: 'Announce new videos from a TikTok creator.',
    description:
      'Connect a TikTok account so Pulse posts an announcement whenever a new video drops.',
    capabilities: { notifications: true, sync: false },
    availability: 'unavailable',
    availabilityNote: 'TikTok has no public API for reading a creator’s posts.',
    fields: [
      { key: 'handle', label: 'Account handle', type: 'text', placeholder: '@pulsify', required: true, pattern: '^@?[\\w.]{2,24}$' },
    ],
    labelField: 'handle',
    refField: 'handle',
    defaultTemplate: '**{{author}}** posted a new TikTok: {{title}}\n{{url}}',
    placeholders: [
      { token: '{{author}}', description: 'The creator handle' },
      { token: '{{title}}', description: 'Video caption' },
      { token: '{{url}}', description: 'Link to the video' },
    ],
    keywords: 'tiktok video short creator clip',
    docsUrl: 'https://developers.tiktok.com',
  },
  {
    id: 'twitch',
    name: 'Twitch',
    category: 'streaming',
    icon: 'Tv',
    accent: '#9146ff',
    blurb: 'Go-live alerts when a streamer starts broadcasting.',
    description:
      'Connect a Twitch channel for instant go-live alerts — Pulse pings your community the second the stream starts.',
    capabilities: { notifications: true, sync: false },
    fields: [
      { key: 'channel', label: 'Twitch username', type: 'text', placeholder: 'shroud', required: true, pattern: '^[\\w]{3,25}$', help: "The streamer's login name." },
      { key: 'role', label: 'Mention role ID', type: 'text', placeholder: '(optional) role to @mention', pattern: '^\\d{15,21}$' },
    ],
    labelField: 'channel',
    refField: 'channel',
    defaultTemplate: '**{{author}}** is now live: {{title}}\n{{url}}',
    placeholders: [
      { token: '{{author}}', description: 'The streamer' },
      { token: '{{title}}', description: 'Stream title' },
      { token: '{{game}}', description: 'Category / game being played' },
      { token: '{{url}}', description: 'Link to the stream' },
    ],
    keywords: 'stream live broadcast gaming creator go-live',
    docsUrl: 'https://dev.twitch.tv/docs/eventsub',
  },
  {
    id: 'kick',
    name: 'Kick',
    category: 'streaming',
    icon: 'TvMinimalPlay',
    accent: '#53fc18',
    blurb: 'Go-live alerts when a Kick streamer starts broadcasting.',
    description:
      'Connect a Kick channel for instant go-live alerts — Pulse pings your community the moment the stream starts.',
    capabilities: { notifications: true, sync: false },
    availability: 'planned',
    availabilityNote: 'Kick has no official API yet — support is coming soon.',
    fields: [
      { key: 'channel', label: 'Kick username', type: 'text', placeholder: 'xqc', required: true, pattern: '^[\\w-]{3,25}$', help: "The streamer's channel slug." },
      { key: 'role', label: 'Mention role ID', type: 'text', placeholder: '(optional) role to @mention', pattern: '^\\d{15,21}$' },
    ],
    labelField: 'channel',
    refField: 'channel',
    defaultTemplate: '**{{author}}** is now live on Kick: {{title}}\n{{url}}',
    placeholders: [
      { token: '{{author}}', description: 'The streamer' },
      { token: '{{title}}', description: 'Stream title' },
      { token: '{{game}}', description: 'Category being streamed' },
      { token: '{{url}}', description: 'Link to the stream' },
    ],
    keywords: 'kick stream live broadcast gaming creator go-live',
    docsUrl: 'https://docs.kick.com',
  },
  {
    id: 'reddit',
    name: 'Reddit',
    category: 'social',
    icon: 'MessageCircle',
    accent: '#ff4500',
    blurb: 'New posts from a subreddit, filtered by flair or keyword.',
    description:
      'Track a subreddit and forward new posts into Discord — optionally filtered so only the threads you care about come through.',
    capabilities: { notifications: true, sync: false },
    fields: [
      { key: 'subreddit', label: 'Subreddit', type: 'text', placeholder: 'r/discordapp', required: true, pattern: '^(r/)?[\\w]{2,21}$' },
      { key: 'sort', label: 'Watch', type: 'select', required: true, options: [
        { value: 'new', label: 'New posts' },
        { value: 'hot', label: 'Hot posts' },
        { value: 'top', label: 'Top posts' },
      ] },
      { key: 'keyword', label: 'Keyword filter', type: 'text', placeholder: '(optional) only posts containing…' },
    ],
    labelField: 'subreddit',
    refField: 'subreddit',
    defaultTemplate: 'New on **{{subreddit}}**: {{title}}\n{{url}}',
    placeholders: [
      { token: '{{subreddit}}', description: 'The subreddit' },
      { token: '{{title}}', description: 'Post title' },
      { token: '{{author}}', description: 'Who posted it' },
      { token: '{{url}}', description: 'Link to the post' },
    ],
    keywords: 'subreddit posts threads community forum',
    docsUrl: 'https://www.reddit.com/dev/api',
  },
  {
    id: 'twitter',
    name: 'X / Twitter',
    category: 'social',
    icon: 'AtSign',
    accent: '#1d9bf0',
    blurb: 'Mirror posts from an account into a channel.',
    description:
      'Mirror posts from an X (Twitter) account into Discord so your community never misses an update.',
    capabilities: { notifications: true, sync: false },
    availability: 'unavailable',
    availabilityNote: 'X/Twitter removed API access for reading posts.',
    fields: [
      { key: 'handle', label: 'Account handle', type: 'text', placeholder: '@pulsify', required: true, pattern: '^@?[\\w]{1,15}$' },
      { key: 'include', label: 'Include', type: 'select', required: true, options: [
        { value: 'posts', label: 'Posts only' },
        { value: 'all', label: 'Posts & replies' },
        { value: 'media', label: 'Media posts only' },
      ] },
    ],
    labelField: 'handle',
    refField: 'handle',
    defaultTemplate: '**{{author}}** posted:\n{{title}}\n{{url}}',
    placeholders: [
      { token: '{{author}}', description: 'The account handle' },
      { token: '{{title}}', description: 'The post text' },
      { token: '{{url}}', description: 'Link to the post' },
    ],
    keywords: 'twitter x tweet posts social account',
    docsUrl: 'https://developer.twitter.com',
  },
  {
    id: 'rss',
    name: 'RSS Feed',
    category: 'content',
    icon: 'Rss',
    accent: '#f59e0b',
    blurb: 'Forward new items from any RSS or Atom feed.',
    description:
      'Point Pulse at any RSS or Atom feed — blogs, news, podcasts, patch notes — and new items land in your channel automatically.',
    capabilities: { notifications: true, sync: false },
    fields: [
      { key: 'url', label: 'Feed URL', type: 'url', placeholder: 'https://example.com/feed.xml', required: true, pattern: '^https?://.+' },
      { key: 'limit', label: 'Max per check', type: 'select', required: true, options: [
        { value: '1', label: 'Only the newest item' },
        { value: '3', label: 'Up to 3 new items' },
        { value: '5', label: 'Up to 5 new items' },
      ] },
    ],
    labelField: 'url',
    refField: 'url',
    defaultTemplate: '{{title}}\n{{url}}',
    placeholders: [
      { token: '{{title}}', description: 'Item title' },
      { token: '{{author}}', description: 'Item author (if any)' },
      { token: '{{summary}}', description: 'Short summary' },
      { token: '{{url}}', description: 'Link to the item' },
    ],
    keywords: 'feed atom blog news syndication',
    docsUrl: 'https://www.rssboard.org/rss-specification',
  },
  {
    id: 'steam',
    name: 'Steam',
    category: 'content',
    icon: 'Gamepad2',
    accent: '#66c0f4',
    blurb: 'Post news, patch notes and updates for a game.',
    description:
      'Track a game on Steam and forward its news, patch notes and updates into Discord — ideal for gaming communities.',
    capabilities: { notifications: true, sync: false },
    fields: [
      { key: 'appId', label: 'Steam App ID', type: 'text', placeholder: '730', required: true, pattern: '^\\d{2,8}$', help: "The game's numeric App ID (from its store URL)." },
    ],
    labelField: 'appId',
    refField: 'appId',
    defaultTemplate: '**{{game}}** — {{title}}\n{{url}}',
    placeholders: [
      { token: '{{game}}', description: 'The game title' },
      { token: '{{title}}', description: 'News / update headline' },
      { token: '{{url}}', description: 'Link to the news item' },
    ],
    keywords: 'steam game news patch notes update gaming valve',
    docsUrl: 'https://partner.steamgames.com/doc/webapi/ISteamNews',
  },
  {
    id: 'patreon',
    name: 'Patreon',
    category: 'social',
    icon: 'HeartHandshake',
    accent: '#f96854',
    blurb: 'Announce new posts and patrons from your campaign.',
    description:
      'Connect your Patreon campaign so new posts and patrons are celebrated in Discord — perfect for creator and membership communities.',
    capabilities: { notifications: true, sync: false },
    fields: [
      { key: 'campaign', label: 'Campaign URL or name', type: 'text', placeholder: 'https://patreon.com/yourname', required: true },
      { key: 'notify', label: 'Notify on', type: 'select', required: true, options: [
        { value: 'all', label: 'New posts & patrons' },
        { value: 'posts', label: 'New posts only' },
        { value: 'patrons', label: 'New patrons only' },
      ] },
      { key: 'token', label: 'Access token', type: 'secret', placeholder: 'Patreon API access token' },
    ],
    labelField: 'campaign',
    refField: 'campaign',
    defaultTemplate: '**{{title}}**\n{{author}} — {{action}}\n{{url}}',
    placeholders: [
      { token: '{{title}}', description: 'Post title or patron name' },
      { token: '{{author}}', description: 'The creator / campaign' },
      { token: '{{action}}', description: 'What happened (new post, new patron)' },
      { token: '{{url}}', description: 'Link to the post or campaign' },
    ],
    keywords: 'patreon membership creator support patrons posts crowdfunding',
    docsUrl: 'https://docs.patreon.com',
  },
  // ── Productivity / sync ─────────────────────────────────────────────────────
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    category: 'productivity',
    icon: 'CalendarDays',
    accent: '#4285f4',
    blurb: 'Sync calendar events and post reminders into Discord.',
    description:
      'Connect a Google Calendar so upcoming events post to your channel and members get a heads-up before they start.',
    capabilities: { notifications: true, sync: true },
    fields: [
      { key: 'calendarId', label: 'Calendar ID', type: 'text', placeholder: 'you@gmail.com or …@group.calendar.google.com', required: true },
      { key: 'apiKey', label: 'API key', type: 'secret', placeholder: 'Google API key', help: 'A key with read access to the calendar.' },
    ],
    labelField: 'calendarId',
    refField: 'calendarId',
    syncEvents: [
      { key: 'created', label: 'Event created', description: 'A new event is added to the calendar.', defaultOn: true },
      { key: 'updated', label: 'Event updated', description: 'An event is rescheduled or edited.', defaultOn: true },
      { key: 'reminder', label: 'Starting soon', description: 'Post a reminder shortly before an event starts.', defaultOn: true },
    ],
    defaultTemplate: '**{{title}}**\n{{when}}\n{{url}}',
    placeholders: [
      { token: '{{title}}', description: 'Event title' },
      { token: '{{when}}', description: 'Start time (and end)' },
      { token: '{{location}}', description: 'Event location' },
      { token: '{{url}}', description: 'Link to the event' },
    ],
    keywords: 'calendar events schedule reminders meetings sync',
    docsUrl: 'https://developers.google.com/calendar',
  },
  {
    id: 'trello',
    name: 'Trello',
    category: 'productivity',
    icon: 'Kanban',
    accent: '#0079bf',
    blurb: 'Post board activity as cards move and lists change.',
    description:
      'Connect a Trello board so card moves, comments and new cards are announced in Discord — great for community projects and event planning.',
    capabilities: { notifications: true, sync: true },
    fields: [
      { key: 'board', label: 'Board URL or ID', type: 'text', placeholder: 'https://trello.com/b/…', required: true },
      { key: 'apiKey', label: 'API key', type: 'secret', placeholder: 'Trello API key' },
      { key: 'token', label: 'Token', type: 'secret', placeholder: 'Trello token' },
    ],
    labelField: 'board',
    refField: 'board',
    syncEvents: [
      { key: 'card_created', label: 'Card created', description: 'A new card is added to the board.', defaultOn: true },
      { key: 'card_moved', label: 'Card moved', description: 'A card moves between lists.', defaultOn: true },
      { key: 'card_commented', label: 'Card commented', description: 'Someone comments on a card.', defaultOn: false },
    ],
    defaultTemplate: '**{{list}}** · {{title}}\n{{actor}} — {{action}}\n{{url}}',
    placeholders: [
      { token: '{{title}}', description: 'Card name' },
      { token: '{{list}}', description: 'The list the card is in' },
      { token: '{{actor}}', description: 'Who made the change' },
      { token: '{{action}}', description: 'What happened' },
      { token: '{{url}}', description: 'Link to the card' },
    ],
    keywords: 'board cards lists kanban project tasks sync',
    docsUrl: 'https://developer.atlassian.com/cloud/trello',
  },
  {
    id: 'jira',
    name: 'Jira',
    category: 'productivity',
    icon: 'SquareKanban',
    accent: '#2684ff',
    blurb: 'Notify on issue creation, status changes and assignments.',
    description:
      'Connect a Jira project so issue activity — new tickets, status transitions, assignments — flows into Discord for your team.',
    capabilities: { notifications: true, sync: true },
    fields: [
      { key: 'site', label: 'Site URL', type: 'url', placeholder: 'https://your-org.atlassian.net', required: true, pattern: '^https?://.+' },
      { key: 'project', label: 'Project key', type: 'text', placeholder: 'PULSIFY', required: true, pattern: '^[A-Z][A-Z0-9]{1,9}$' },
      { key: 'email', label: 'Account email', type: 'text', placeholder: 'you@org.com' },
      { key: 'token', label: 'API token', type: 'secret', placeholder: 'Atlassian API token' },
    ],
    labelField: 'project',
    refField: 'project',
    syncEvents: [
      { key: 'issue_created', label: 'Issue created', description: 'A new issue is filed.', defaultOn: true },
      { key: 'issue_transitioned', label: 'Status changed', description: 'An issue moves to a new status.', defaultOn: true },
      { key: 'issue_assigned', label: 'Issue assigned', description: 'An issue is assigned to someone.', defaultOn: false },
    ],
    defaultTemplate: '**{{key}}** {{title}}\n{{status}} · {{assignee}}\n{{url}}',
    placeholders: [
      { token: '{{key}}', description: 'Issue key (e.g. PULSIFY-34)' },
      { token: '{{title}}', description: 'Issue summary' },
      { token: '{{status}}', description: 'Current status' },
      { token: '{{assignee}}', description: 'Assigned to' },
      { token: '{{url}}', description: 'Link to the issue' },
    ],
    keywords: 'issues tickets project tracker agile sprint sync atlassian',
    docsUrl: 'https://developer.atlassian.com/cloud/jira',
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'productivity',
    icon: 'NotebookPen',
    accent: '#cbd5e1',
    blurb: 'Surface database changes and new pages from a workspace.',
    description:
      'Connect a Notion database so new pages and edits surface in Discord — keep your community wiki, roadmap or knowledge base visible.',
    capabilities: { notifications: true, sync: true },
    fields: [
      { key: 'database', label: 'Database ID', type: 'text', placeholder: '32-character database id', required: true, pattern: '^[\\w-]{20,}$' },
      { key: 'token', label: 'Integration token', type: 'secret', placeholder: 'secret_…', required: true },
    ],
    labelField: 'database',
    refField: 'database',
    syncEvents: [
      { key: 'page_created', label: 'Page created', description: 'A new page is added to the database.', defaultOn: true },
      { key: 'page_updated', label: 'Page updated', description: 'A page in the database is edited.', defaultOn: false },
    ],
    defaultTemplate: '**{{title}}**\n{{actor}} — {{action}}\n{{url}}',
    placeholders: [
      { token: '{{title}}', description: 'Page title' },
      { token: '{{actor}}', description: 'Who made the change' },
      { token: '{{action}}', description: 'What happened' },
      { token: '{{url}}', description: 'Link to the page' },
    ],
    keywords: 'notion docs database wiki pages knowledge base sync',
    docsUrl: 'https://developers.notion.com',
  },
]

const PROVIDER_MAP = new Map(PROVIDERS.map((p) => [p.id, p]))

export function providerById(id: string): IntegrationProvider | undefined {
  return PROVIDER_MAP.get(id)
}

export function providersByCategory(category: IntegrationCategory): IntegrationProvider[] {
  return PROVIDERS.filter((p) => p.category === category)
}

/** A provider can be connected unless it's flagged unavailable/planned. */
export function isConnectable(provider: IntegrationProvider): boolean {
  return (provider.availability ?? 'available') === 'available'
}

// ── Row model ───────────────────────────────────────────────────────────────

export type Integration = {
  id: string
  guild_id: string
  provider: string
  label: string
  external_ref: string | null
  status: IntegrationStatus
  config: Record<string, unknown>
  channel_id: string | null
  template: string | null
  enabled: boolean
  cursor: string | null
  last_sync_at: string | null
  last_error: string | null
  author_id: string | null
  author_name: string | null
  created_at: string
  updated_at: string
}

export function normaliseIntegration(row: Record<string, unknown>): Integration {
  return {
    id: String(row.id),
    guild_id: String(row.guild_id ?? ''),
    provider: String(row.provider ?? ''),
    label: String(row.label ?? ''),
    external_ref: (row.external_ref as string | null) ?? null,
    status: normaliseStatus(row.status),
    config: (row.config as Record<string, unknown>) ?? {},
    channel_id: (row.channel_id as string | null) ?? null,
    template: (row.template as string | null) ?? null,
    enabled: row.enabled !== false,
    cursor: (row.cursor as string | null) ?? null,
    last_sync_at: (row.last_sync_at as string | null) ?? null,
    last_error: (row.last_error as string | null) ?? null,
    author_id: (row.author_id as string | null) ?? null,
    author_name: (row.author_name as string | null) ?? null,
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  }
}

// ── Logs ──────────────────────────────────────────────────────────────────────

export type LogLevel = 'info' | 'success' | 'warning' | 'error'

export const LOG_LEVEL_META: Record<LogLevel, { color: string; icon: string }> = {
  info:    { color: '#60a5fa', icon: 'Info' },
  success: { color: '#22c55e', icon: 'CheckCircle2' },
  warning: { color: '#f59e0b', icon: 'AlertTriangle' },
  error:   { color: '#ef4444', icon: 'XCircle' },
}

export function normaliseLogLevel(v: unknown): LogLevel {
  return v === 'success' || v === 'warning' || v === 'error' ? v : 'info'
}

export type IntegrationLog = {
  id: string
  guild_id: string
  integration_id: string
  level: LogLevel
  event: string
  message: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export function normaliseLog(row: Record<string, unknown>): IntegrationLog {
  return {
    id: String(row.id),
    guild_id: String(row.guild_id ?? ''),
    integration_id: String(row.integration_id ?? ''),
    level: normaliseLogLevel(row.level),
    event: String(row.event ?? ''),
    message: (row.message as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: String(row.created_at ?? new Date().toISOString()),
  }
}

// ── Draft + validation ──────────────────────────────────────────────────────

export type IntegrationDraft = {
  provider: string
  label: string
  channel_id: string | null
  config: Record<string, string>
  /** Per-event sync toggles (productivity providers). */
  events: Record<string, boolean>
  template: string | null
  enabled: boolean
}

export const TEMPLATE_MAX = 1000

/** Build a blank draft for a provider, seeding defaults from the catalog. */
export function emptyDraft(provider: IntegrationProvider): IntegrationDraft {
  const events: Record<string, boolean> = {}
  for (const e of provider.syncEvents ?? []) events[e.key] = e.defaultOn
  return {
    provider: provider.id,
    label: '',
    channel_id: null,
    config: {},
    events,
    template: provider.defaultTemplate,
    enabled: true,
  }
}

/** Derive the connection label from the catalog's labelField, or the provider name. */
export function deriveLabel(provider: IntegrationProvider, config: Record<string, string>): string {
  const fromField = provider.labelField ? config[provider.labelField]?.trim() : ''
  return (fromField || provider.name).slice(0, 80)
}

/**
 * Validate a draft against its provider's field schema. Returns an error string
 * for the first problem, or null when it's good to connect. `requireChannel`
 * is false when only saving config without a notification destination.
 */
export function validateDraft(draft: IntegrationDraft): string | null {
  const provider = providerById(draft.provider)
  if (!provider) return 'Unknown integration.'

  for (const field of provider.fields) {
    const raw = (draft.config[field.key] ?? '').trim()
    if (field.required && !raw) return `${field.label} is required.`
    if (!raw) continue
    if (field.type === 'url' && !/^https?:\/\/.+/i.test(raw)) {
      return `${field.label} must be a valid URL.`
    }
    if (field.pattern && !new RegExp(field.pattern).test(raw)) {
      return `${field.label} doesn't look right — check the format.`
    }
    if (field.type === 'select' && field.options && !field.options.some((o) => o.value === raw)) {
      return `Pick a valid option for ${field.label}.`
    }
  }

  if (draft.channel_id && !/^\d{15,21}$/.test(draft.channel_id)) {
    return 'Pick a valid notification channel.'
  }
  if (draft.template && draft.template.length > TEMPLATE_MAX) {
    return `Template must be ${TEMPLATE_MAX} characters or fewer.`
  }
  return null
}

// ── Stats ───────────────────────────────────────────────────────────────────

export type IntegrationStats = {
  total: number
  connected: number
  paused: number
  errors: number
  available: number
}

export function computeStats(list: Integration[]): IntegrationStats {
  const stats: IntegrationStats = {
    total: list.length,
    connected: 0,
    paused: 0,
    errors: 0,
    available: PROVIDERS.filter(isConnectable).length,
  }
  for (const i of list) {
    switch (health(i)) {
      case 'healthy': stats.connected++; break
      case 'paused':  stats.paused++; break
      case 'error':   stats.errors++; break
    }
  }
  return stats
}

// ── Display helpers ───────────────────────────────────────────────────────────

/**
 * Render a template against a sample context — used for the wizard's live
 * preview and the "send test" notification. Unknown tokens are left as-is so
 * the author sees exactly which placeholders resolved.
 */
export function renderTemplate(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, key) => ctx[key] ?? m)
}

// Provider-specific sample title/action so the preview + test notification read
// like a real event for that service instead of a generic placeholder.
const SAMPLE_BY_PROVIDER: Record<string, { title?: string; action?: string; event?: string }> = {
  github: { title: 'Release v1.4.0 published', event: 'release' },
  gitlab: { title: 'Release v1.4.0 published', event: 'release' },
  youtube: { title: 'How we built the Integrations Hub' },
  tiktok: { title: 'Behind the scenes 👀' },
  twitch: { title: 'Ranked grind — road to top 100' },
  kick: { title: 'Late night ranked 🎮' },
  reddit: { title: 'What features would you love to see next?' },
  twitter: { title: 'Big things shipping this week — stay tuned.' },
  rss: { title: 'Introducing the Pulsify Integrations Hub' },
  steam: { title: 'Patch 1.4.0 — performance & balance' },
  patreon: { title: 'New behind-the-scenes post', action: 'shared a new post' },
  'google-calendar': { title: 'Community Game Night' },
  trello: { title: 'Launch checklist', action: 'moved to In Progress' },
  jira: { title: 'Add Kick integration', action: 'moved to In Progress' },
  notion: { title: 'Roadmap — Q3', action: 'updated the page' },
}

/** Sample values per provider, for the wizard preview + test notification. */
export function sampleContext(provider: IntegrationProvider, config: Record<string, string>): Record<string, string> {
  const sample = SAMPLE_BY_PROVIDER[provider.id] ?? {}
  return {
    repo: config.repo || config.project || 'pulsify/pulse-bot',
    event: sample.event ?? 'update',
    title: sample.title ?? 'Sample update from your integration',
    author: config.handle?.replace(/^@?/, '@') || config.channel || 'Pulsify',
    url: provider.docsUrl ?? 'https://pulsify.app',
    subreddit: config.subreddit?.startsWith('r/') ? config.subreddit : `r/${config.subreddit || 'discordapp'}`,
    handle: config.handle?.replace(/^@?/, '@') || '@pulsify',
    when: 'Today at 6:00 PM',
    location: 'Online',
    list: 'In Progress',
    actor: 'Pulsify',
    action: sample.action ?? 'created',
    key: config.project || 'PULSIFY-34',
    status: 'In Progress',
    assignee: 'Pulse',
    summary: 'A short summary of the item.',
    game: 'Counter-Strike 2',
  }
}

/** Short, human "x ago" for last-sync timestamps. */
export function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}
