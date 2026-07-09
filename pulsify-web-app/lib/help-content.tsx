import type { ReactNode } from 'react'
import type { Plan } from './billing'

/**
 * Central registry for contextual help (the ⓘ markers rendered by <HelpTip>).
 *
 * Keeping the copy in one place keeps call sites tiny (`<HelpTip id="…" />`),
 * makes the guidance easy to review/edit as features evolve, and lets the same
 * entry be reused across a page header and a related card.
 *
 * Body copy convention: lead with *what it does*, then *when to use it*, then a
 * **Tip:** / **Heads up:** line for considerations or best practices. Keep it
 * skimmable — this is a tooltip, not a doc.
 *
 * `plan` is the MINIMUM tier the feature needs and is shown (accent-coloured) in
 * every tooltip. Note the internal→display mapping in lib/billing: internal
 * `pro` ships as "Plus" and internal `business` ships as "Pro". So:
 *   plan: 'free'     → "Free"
 *   plan: 'pro'      → "Plus"
 *   plan: 'business' → "Pro"
 * <HelpTip> renders the label via PLAN_LABELS so it always matches billing.
 */
export type HelpEntry = {
  title: string
  body: ReactNode
  /** Minimum plan the feature requires — rendered as an accent badge. */
  plan: Plan
  /** Optional deep link to fuller documentation. */
  docHref?: string
}

export const HELP_CONTENT: Record<string, HelpEntry> = {
  // ── Guild · overview & core ──────────────────────────────────────────────
  overview: {
    title: 'Server Overview',
    plan: 'free',
    body: (
      <>
        <p>Your server&apos;s home base — health at a glance, quick setup status and shortcuts into every Pulsify module.</p>
        <p><strong>Tip:</strong> Start here after inviting Pulse; the setup banner walks you through the essentials.</p>
      </>
    ),
  },
  moderation: {
    title: 'Moderation',
    plan: 'free',
    body: (
      <>
        <p>Review members, issue bans and kicks, and track moderator activity for this server — all from the dashboard.</p>
        <p><strong>Tip:</strong> Use the activity log to see who took which action and when, so your team stays accountable.</p>
      </>
    ),
  },
  'pulse-guard': {
    title: 'Pulse Guard',
    plan: 'pro',
    body: (
      <>
        <p>AI-driven moderation that scans messages for scams, phishing and toxicity in multiple languages, then scores each one with a confidence band.</p>
        <p><strong>When to use:</strong> Turn it on to catch threats automatically; start in a low-severity action mode and watch the signals before enabling auto-bans.</p>
      </>
    ),
  },
  'pulse-guard-settings': {
    title: 'Pulse Guard settings',
    plan: 'pro',
    body: (
      <>
        <p>Tune the detection engine — sensitivity, which detectors run, auto-actions, and channel/role exclusions.</p>
        <p><strong>Tip:</strong> Exclude staff and bot channels first to avoid false positives, then raise sensitivity gradually.</p>
      </>
    ),
  },
  'ddos-protection': {
    title: 'DDoS Protection',
    plan: 'pro',
    body: (
      <>
        <p>Monitors Pulse-connected traffic for suspicious spikes and abuse — command floods, mass ticket / application / giveaway activity, member-join bursts and automated spam — then applies the protection rules and mitigations you configure.</p>
        <p><strong>When to use:</strong> Turn it on before opening your server to the public. Start with the Balanced preset, watch the activity graph, then tighten thresholds or enable auto-lockdown for raid-prone servers.</p>
        <p><strong>Heads up:</strong> Automatic mitigations are temporary and recover on their own; manual lockdown stays until you lift it.</p>
      </>
    ),
  },
  'ai-setup': {
    title: 'Pulse Assistant',
    plan: 'free',
    body: (
      <>
        <p>Generate welcome messages, rules, onboarding guides and channel structures with AI, then drop them straight into your server.</p>
        <p><strong>Tip:</strong> Treat the output as a strong first draft — review and tweak the tone to match your community.</p>
      </>
    ),
  },
  'pulse-assistant': {
    title: 'Pulse Assistant',
    plan: 'free',
    body: (
      <>
        <p>Configure what Pulse knows about your server when generating content, and how its output looks.</p>
        <p><strong>Tip:</strong> The more context you give (server theme, tone, audience), the better the generated content fits.</p>
      </>
    ),
  },
  analytics: {
    title: 'Analytics',
    plan: 'free',
    body: (
      <>
        <p>Server growth, activity and engagement trends drawn from your message, join and voice data.</p>
        <p><strong>Heads up:</strong> Retention depends on your plan — Free keeps 7 days, paid tiers keep 30–90+. Compare windows to see if a campaign moved the needle.</p>
      </>
    ),
  },
  insights: {
    title: 'Server Insights',
    plan: 'free',
    body: (
      <>
        <p>Automated observations about your community — what&apos;s trending up or down and where attention is needed — from a rule engine over your recent activity.</p>
        <p><strong>When to use:</strong> Check in weekly for a quick read on community health without digging through raw charts.</p>
      </>
    ),
  },
  management: {
    title: 'Management Analytics',
    plan: 'free',
    body: (
      <>
        <p>Staff-performance analytics across moderation, support and community actions — see who&apos;s carrying the load and how response times trend.</p>
        <p><strong>Tip:</strong> Pair this with role assignments to balance workload across your team.</p>
      </>
    ),
  },

  // ── Guild · engagement ─────────────────────────────────────────────────────
  events: {
    title: 'Events',
    plan: 'free',
    body: (
      <>
        <p>Create and manage Discord scheduled events for this server directly from Pulsify.</p>
        <p><strong>Heads up:</strong> Voice/stage events need the matching channel to exist first, and Discord controls reminders and RSVPs.</p>
      </>
    ),
  },
  giveaways: {
    title: 'Giveaways',
    plan: 'free',
    body: (
      <>
        <p>Run prize giveaways with a one-click Join button. Set a winner count and an end time, and the bot draws automatically when it ends.</p>
        <p><strong>Heads up:</strong> Free allows one giveaway at a time; paid tiers raise the concurrent limit. You can re-roll if a winner is unreachable.</p>
      </>
    ),
  },
  polls: {
    title: 'Community Polls',
    plan: 'free',
    body: (
      <>
        <p>Run polls members vote on right in Discord — single/multiple choice, yes-no, ratings or feature voting. Every vote is tracked in Pulsify with live results and analytics.</p>
        <p>The <strong>Results</strong> tab holds the history of every closed poll with its final breakdown and participation, plus engagement trends across all your polls.</p>
        <p><strong>Tip:</strong> Restrict who can vote (roles, account age, level, reputation) and add governance rules — weighted voting, approval thresholds and minimum participation.</p>
      </>
    ),
  },
  milestones: {
    title: 'Member Milestones',
    plan: 'free',
    body: (
      <>
        <p>Automatically recognise members when they cross thresholds — messages sent, time in server, levels reached — with announcements and reward roles.</p>
        <p><strong>Tip:</strong> The bot sweeps periodically, so recognition may arrive a few minutes after the threshold is crossed.</p>
      </>
    ),
  },
  economy: {
    title: 'Global Economy',
    plan: 'free',
    body: (
      <>
        <p>One Pulse identity everywhere: members carry a single coin balance and reputation across every server running Pulse, earned through activity, level-ups, giveaways, milestones and onboarding. Levels &amp; XP stay specific to each server.</p>
        <p><strong>Tip:</strong> The Overview combines analytics, leaderboards and the full transaction ledger. Reputation is computed, never granted — only coins can be adjusted, by operators, under Economy › Controls.</p>
      </>
    ),
  },
  shop: {
    title: 'Rewards Shop',
    plan: 'free',
    body: (
      <>
        <p>Spend your global Pulse Coins on rewards your server offers — Discord roles, perks, XP boosters, cosmetics and giveaway entries. Some rewards have requirements (a minimum reputation or level) or limited stock.</p>
        <p><strong>Tip:</strong> Roles are granted the moment you buy. Boosters wait in your Inventory until you activate them; perks are redeemed there too.</p>
      </>
    ),
  },
  inventory: {
    title: 'Inventory',
    plan: 'free',
    body: (
      <>
        <p>Everything you own from the shop. Activate an XP booster when you want the boost to start, redeem a manual perk so staff can fulfil it, and review your active, expired and past purchases.</p>
        <p><strong>Tip:</strong> Timed rewards (roles, boosters) show when they expire. Badges &amp; cosmetics decorate your global Pulse profile automatically.</p>
      </>
    ),
  },
  rewards: {
    title: 'Rewards',
    plan: 'free',
    body: (
      <>
        <p>Create the rewards members of this server can buy with Pulse Coins — roles, perks, boosters, cosmetics and more. Set the cost, stock, per-member limit and any purchase requirements.</p>
        <p><strong>Tip:</strong> Toggle a reward inactive to hide it from the shop without deleting it. Existing purchases keep working — each carries a snapshot.</p>
      </>
    ),
  },
  'economy-controls': {
    title: 'Economy Controls',
    plan: 'free',
    body: (
      <>
        <p>Grant or remove global Pulse Coins for any member. Every adjustment is recorded in the economy moderation log with the acting operator&apos;s name.</p>
        <p><strong>Heads up:</strong> The economy is bot-wide, so this surface is operator-only — server admins can view the economy but not mint coins. Reputation has no controls: it&apos;s computed, never granted.</p>
      </>
    ),
  },
  'economy-earning': {
    title: 'Earnings settings',
    plan: 'free',
    body: (
      <>
        <p>The earning half of Rewards — decide how members earn the Pulse Coins they spend: per-source amounts for activity, events, giveaways, onboarding and progression, plus daily &amp; weekly claims.</p>
        <p><strong>Tip:</strong> Use the simulator to preview a payout, and the analytics below to see what your config is actually minting. Reputation is never granted — it&apos;s only an optional earning multiplier.</p>
      </>
    ),
  },
  'economy-streaks': {
    title: 'Daily & Weekly Rewards',
    plan: 'free',
    body: (
      <>
        <p>Claimable coin rewards (<code>/daily</code>, <code>/weekly</code>) that grow a streak each consecutive period. Loyalty milestones pay a one-off bonus at chosen streak lengths.</p>
        <p><strong>Heads up:</strong> Claims reset at UTC midnight (daily) / weekly. Miss a period and the streak resets to 1.</p>
      </>
    ),
  },
  'economy-multipliers': {
    title: 'Multipliers & Bonuses',
    plan: 'free',
    body: (
      <>
        <p>Scale payouts for reputation, server boosters, premium servers, event-category rewards and limited-time seasonal boosts. Multipliers stack multiplicatively, capped at 10×.</p>
        <p><strong>Tip:</strong> The reputation multiplier rewards trusted members without ever turning reputation into a points balance.</p>
      </>
    ),
  },
  'economy-antiabuse': {
    title: 'Anti-Abuse Protection',
    plan: 'free',
    body: (
      <>
        <p>Keep the economy healthy: ignore channels/roles, block brand-new accounts, and cap how many coins a member can farm per day (per source and overall).</p>
        <p><strong>Heads up:</strong> Per-source cooldowns and reaction de-duplication run automatically; a global daily cap of 0 means unlimited.</p>
      </>
    ),
  },
  leveling: {
    title: 'Levels & XP',
    plan: 'free',
    body: (
      <>
        <p>Members earn XP for chatting and level up over time. Optionally hand out reward roles at milestone levels.</p>
        <p><strong>Heads up:</strong> XP is server-specific. Set per-channel multipliers or exclusions to stop XP farming in spam channels.</p>
      </>
    ),
  },
  reputation: {
    title: 'Reputation',
    plan: 'free',
    body: (
      <>
        <p>A community-driven trust score per member, built from positive signals and tempered by moderation history.</p>
        <p><strong>Tip:</strong> Reputation pairs well with Levels &amp; XP — XP rewards activity, reputation reflects being valued and trusted.</p>
      </>
    ),
  },

  // ── Guild · members & onboarding ──────────────────────────────────────────
  members: {
    title: 'Members',
    plan: 'free',
    body: (
      <>
        <p>Browse your member directory and the XP leaderboard, inspect individual profiles, and manage roles.</p>
        <p><strong>Tip:</strong> Sort by activity or level to find rising community members worth recognising.</p>
      </>
    ),
  },
  profile: {
    title: 'Member profile',
    plan: 'free',
    body: (
      <>
        <p>A full breakdown of a single member — activity, levels &amp; XP, global reputation, achievements and (for admins) moderation history.</p>
        <p><strong>Tip:</strong> Use the back link at the top to return to wherever you opened this profile from.</p>
      </>
    ),
  },
  onboarding: {
    title: 'Onboarding & Welcome',
    plan: 'free',
    body: (
      <>
        <p>Design the interactive panel new members see when they join — welcome message, rules acknowledgement and self-assign roles.</p>
        <p><strong>Best practice:</strong> Keep it short. One clear call to action beats a wall of text for first impressions.</p>
      </>
    ),
  },
  verification: {
    title: 'Verification',
    plan: 'free',
    body: (
      <>
        <p>A verify gate that grants a role and access only after a member clicks through — cutting down on bots and raid accounts.</p>
        <p><strong>Heads up:</strong> The bot needs Manage Roles, and the verified role must sit below Pulse&apos;s top role in the hierarchy.</p>
      </>
    ),
  },

  // ── Guild · support & comms ───────────────────────────────────────────────
  tickets: {
    title: 'Ticket System',
    plan: 'free',
    body: (
      <>
        <p>Members open private support tickets from a Discord panel; your staff handle them and you review everything here.</p>
        <p><strong>When to use:</strong> Great for support, reports and applications. Configure categories and the staff role under Ticket settings before going live.</p>
      </>
    ),
  },
  'ticket-settings': {
    title: 'Ticket settings',
    plan: 'free',
    body: (
      <>
        <p>Configure the ticket panel, categories, the staff role that can review, application types, anti-spam cooldowns and notification channels.</p>
        <p><strong>Tip:</strong> Set the staff role before publishing the panel — only that role can see and act on tickets.</p>
      </>
    ),
  },
  applications: {
    title: 'Applications',
    plan: 'free',
    body: (
      <>
        <p>A channel-less flow for recruiting staff, partners and creators. Members apply in a guided dialog and every submission lands here for review.</p>
        <p><strong>Tip:</strong> Approve, reject or request more info with an optional note the applicant sees — and keep internal staff notes private.</p>
      </>
    ),
  },
  announcements: {
    title: 'Announcements',
    plan: 'free',
    body: (
      <>
        <p>Compose and send polished Pulse-styled announcement embeds to any channel, with optional role pings.</p>
        <p><strong>Best practice:</strong> Preview before sending — embeds can&apos;t be un-sent, only edited or deleted afterwards.</p>
      </>
    ),
  },
  notifications: {
    title: 'Notifications',
    plan: 'free',
    body: (
      <>
        <p>A real-time activity feed for this server — new entries appear without a refresh.</p>
        <p><strong>Tip:</strong> Use it as a live pulse during events or raids; tune what shows up under Notification settings.</p>
      </>
    ),
  },
  'notification-settings': {
    title: 'Notification settings',
    plan: 'free',
    body: (
      <>
        <p>Pick which server events should notify you and whether to show in-app toasts.</p>
        <p><strong>Tip:</strong> Mute noisy event types so the important signals don&apos;t get buried.</p>
      </>
    ),
  },

  // ── Guild · automation ────────────────────────────────────────────────────
  automations: {
    title: 'Automations',
    plan: 'free',
    body: (
      <>
        <p>Event-triggered rules: <strong>when</strong> something happens (a member joins, a keyword is posted), <strong>do</strong> an action automatically.</p>
        <p><strong>Heads up:</strong> Free allows a few automations per server; paid tiers raise the limit. For time-based jobs, use Scheduled instead.</p>
      </>
    ),
  },
  scheduled: {
    title: 'Scheduled Workflows',
    plan: 'free',
    body: (
      <>
        <p>Run actions on a recurring schedule — daily reminders, weekly recaps, periodic role sweeps.</p>
        <p><strong>Tip:</strong> Unlike Automations (which react to events), these fire on the clock whether or not anything happened.</p>
      </>
    ),
  },
  'private-channels': {
    title: 'Private Channels',
    plan: 'free',
    body: (
      <>
        <p>Join-to-create temporary voice channels. Pulse makes a category and a trigger channel; joining the trigger spins up a private channel the member owns and can manage.</p>
        <p><strong>Tip:</strong> Configure the trigger, naming and permissions under Private channels settings — empty channels auto-delete so the list stays clean.</p>
      </>
    ),
  },

  // ── Guild · config & branding ─────────────────────────────────────────────
  roles: {
    title: 'Roles',
    plan: 'free',
    body: (
      <>
        <p>View and manage the roles configured on your server, including colour and ordering.</p>
        <p><strong>Heads up:</strong> The bot can only manage roles positioned <em>below</em> its own highest role in Discord&apos;s hierarchy.</p>
      </>
    ),
  },
  'self-roles': {
    title: 'Self-Assign Roles',
    plan: 'free',
    body: (
      <>
        <p>Post interactive menus where members pick their own roles with buttons or a dropdown — a modern replacement for reaction-role bots.</p>
        <p><strong>Selection:</strong> <em>Multiple</em> lets members toggle any of the roles; <em>Single</em> is mutually exclusive — picking one switches off the others.</p>
        <p><strong>Heads up:</strong> Every offered role must sit <em>below</em> Pulse&apos;s highest role in the hierarchy, or the bot can&apos;t assign it.</p>
      </>
    ),
  },
  'role-hierarchy': {
    title: 'How categorization works',
    plan: 'free',
    body: (
      <>
        <p>Every role is sorted into one bucket using simple, predictable rules — no AI:</p>
        <p><strong>Bots</strong> — managed integration roles, or roles whose name reads like a bot.</p>
        <p><strong>Management</strong> — roles with the Administrator or moderation permissions, or staff-style names (owner, admin, mod, support).</p>
        <p><strong>Community</strong> — everything else (members, boosters, streamers).</p>
        <p><strong>Tip:</strong> Hover any role to see exactly why it landed where it did.</p>
      </>
    ),
  },
  channels: {
    title: 'Channels',
    plan: 'free',
    body: (
      <>
        <p>Manage Discord channels and categories from the dashboard without switching to the Discord client.</p>
      </>
    ),
  },
  assets: {
    title: 'Assets',
    plan: 'free',
    body: (
      <>
        <p>One place to manage your server&apos;s emojis, stickers and soundboard sounds — preview them, rename, duplicate, import via drag-and-drop and export individually or as a full package.</p>
        <p><strong>Tip:</strong> Select multiple assets to rename, export or delete them in bulk. Pulse needs the <em>Manage Expressions</em> permission to upload, rename and delete.</p>
      </>
    ),
  },
  commands: {
    title: 'Command Center',
    plan: 'free',
    body: (
      <>
        <p>Manage Pulse&apos;s slash commands, permissions, limits and usage for this server.</p>
        <p><strong>Tip:</strong> Restrict sensitive commands to staff roles, and use placeholders to personalise responses.</p>
      </>
    ),
  },
  presence: {
    title: 'Bot Presence',
    plan: 'pro',
    body: (
      <>
        <p>Customise the bot&apos;s Discord status and activity — including rotation, placeholders and a maintenance mode.</p>
        <p><strong>Heads up:</strong> The bot shows one presence globally, driven by the active config pointer. Part of custom branding.</p>
      </>
    ),
  },
  'server-settings': {
    title: 'Server Settings',
    plan: 'free',
    body: (
      <>
        <p>Core Discord server configuration Pulse can manage — the baseline settings other modules build on.</p>
        <p><strong>Tip:</strong> Get these right first; onboarding, moderation and automations all rely on them.</p>
      </>
    ),
  },

  // ── Guild · growth & ops ──────────────────────────────────────────────────
  integrations: {
    title: 'Integrations Hub',
    plan: 'free',
    body: (
      <>
        <p>Connect external services (like Twitch and other providers) so Pulsify can deliver live updates into your server.</p>
        <p><strong>Heads up:</strong> Some providers need API credentials, and availability depends on what&apos;s enabled for your instance. Use Test to confirm a connection works.</p>
      </>
    ),
  },
  templates: {
    title: 'Server Templates',
    plan: 'free',
    body: (
      <>
        <p>Save a profile of which Pulsify features are switched on (Pulse Guard, DDoS Protection, Tickets, Levels, …), then apply it to any server in one click — or start from an official preset.</p>
        <p><strong>When to use:</strong> Spinning up a new community, or keeping sister servers in sync. Applying a template flips each feature&apos;s master switch; you still configure the specifics in each feature&apos;s settings.</p>
      </>
    ),
  },
  backups: {
    title: 'Backup & Restore',
    plan: 'business',
    body: (
      <>
        <p>Versioned snapshots of your server configuration. Take them manually or on a schedule, then restore, compare or roll back.</p>
        <p><strong>Heads up:</strong> Restores are additive-safe and show a live preview first, so you can review changes before applying.</p>
      </>
    ),
  },
  feedback: {
    title: 'Community Feedback',
    plan: 'free',
    body: (
      <>
        <p>Collect real testimonials and reviews from your members. The top-rated ones can surface on your public landing page.</p>
        <p><strong>Tip:</strong> Each user can leave one review; votes and reports help you moderate what gets featured.</p>
      </>
    ),
  },
  billing: {
    title: 'Billing & Plan',
    plan: 'free',
    body: (
      <>
        <p>Manage your subscription, view invoices and change plans. Your plan unlocks features across every server you manage.</p>
        <p><strong>Tip:</strong> Premium-gated features show an upgrade prompt in place — check here to see what each tier includes.</p>
      </>
    ),
  },

  // ── Workspaces (team / multi-server — internal "business" = "Pro") ─────────
  workspaces: {
    title: 'Workspaces',
    plan: 'business',
    body: (
      <>
        <p>Group multiple servers under one team workspace with shared roles and permissions — an organisation layer above individual servers.</p>
        <p><strong>When to use:</strong> Managing several communities with a shared staff team. Capabilities follow each member&apos;s workspace role.</p>
      </>
    ),
  },
  'workspace-overview': {
    title: 'Workspace Overview',
    plan: 'business',
    body: (
      <>
        <p>The home view for a multi-server workspace — team activity, servers at a glance and shortcuts into shared tools.</p>
        <p><strong>Tip:</strong> Workspaces sit above individual servers; switch into a server&apos;s dashboard for per-guild settings.</p>
      </>
    ),
  },
  'workspace-analytics': {
    title: 'Workspace Analytics',
    plan: 'business',
    body: (
      <>
        <p>A centralised 30-day overview across every server in this workspace, so you can compare communities side by side.</p>
        <p><strong>Tip:</strong> Use it to spot which servers need attention without opening each one.</p>
      </>
    ),
  },
  'workspace-servers': {
    title: 'Workspace Servers',
    plan: 'business',
    body: (
      <>
        <p>The servers attached to this workspace. Add or remove servers and jump into any one&apos;s dashboard.</p>
        <p><strong>Heads up:</strong> Your plan caps how many servers a workspace can hold.</p>
      </>
    ),
  },
  'workspace-team': {
    title: 'Workspace Team',
    plan: 'business',
    body: (
      <>
        <p>Invite teammates and assign workspace roles. Roles decide what each member can see and do across the workspace.</p>
        <p><strong>Best practice:</strong> Grant the least access needed — you can always promote someone later.</p>
      </>
    ),
  },
  'workspace-moderation': {
    title: 'Workspace Moderation',
    plan: 'business',
    body: (
      <>
        <p>A cross-server moderation view for your team — track actions and coordinate across every server in the workspace.</p>
      </>
    ),
  },
  'workspace-incidents': {
    title: 'Incidents',
    plan: 'business',
    body: (
      <>
        <p>Log and track notable incidents (raids, escalations, outages) across the workspace so your team stays coordinated.</p>
        <p><strong>Tip:</strong> Keep a short, factual timeline — it&apos;s invaluable during post-incident reviews.</p>
      </>
    ),
  },
  'workspace-notes': {
    title: 'Shared Notes',
    plan: 'business',
    body: (
      <>
        <p>Shared staff and moderation notes for the workspace. Tag teammates with @ to keep everyone in the loop.</p>
      </>
    ),
  },
  'workspace-tasks': {
    title: 'Workspace Tasks',
    plan: 'business',
    body: (
      <>
        <p>A shared task board for your moderation/management team across servers.</p>
        <p><strong>Tip:</strong> Assign owners and due dates so follow-ups don&apos;t slip between servers.</p>
      </>
    ),
  },
  'workspace-notifications': {
    title: 'Workspace Notifications',
    plan: 'business',
    body: (
      <>
        <p>A combined activity feed across every server in the workspace.</p>
        <p><strong>Tip:</strong> Tune what appears under Notification settings to keep it signal, not noise.</p>
      </>
    ),
  },
  'workspace-notification-settings': {
    title: 'Workspace Notification settings',
    plan: 'business',
    body: (
      <>
        <p>Choose which workspace events notify your team and how.</p>
      </>
    ),
  },
  'workspace-settings': {
    title: 'Workspace Settings',
    plan: 'business',
    body: (
      <>
        <p>Rename or recolour the workspace, leave it, or delete it. Deleting removes the team, notes, tasks and incidents.</p>
        <p><strong>Heads up:</strong> Deleting a workspace never touches your Discord servers or the bot — only the workspace layer.</p>
      </>
    ),
  },

  // ── Advanced actions / sub-sections ───────────────────────────────────────
  'pulse-guard-detection': {
    title: 'Detection & auto-actions',
    plan: 'pro',
    body: (
      <>
        <p><strong>Sensitivity</strong> sets how aggressively Pulse flags content — higher catches more but risks false positives. Each <strong>detector</strong> (scams, toxicity, …) can run on its own, and its <strong>auto-action</strong> decides what happens on a hit.</p>
        <p><strong>Best practice:</strong> Start on a low sensitivity with actions set to just flag/log, watch the review queue for a few days, then raise sensitivity and switch on deletes or timeouts once you trust the calls.</p>
      </>
    ),
  },
  'pulse-guard-exclusions': {
    title: 'Whitelists & exclusions',
    plan: 'pro',
    body: (
      <>
        <p>Channels, roles or users listed here are <strong>never</strong> scanned or actioned by Pulse Guard.</p>
        <p><strong>When to use:</strong> Exempt staff, bots and trusted partners, plus channels where stronger language is expected (e.g. memes). This is the first thing to set if you&apos;re seeing false positives.</p>
      </>
    ),
  },
  'leveling-curve': {
    title: 'Level curve',
    plan: 'free',
    body: (
      <>
        <p>Controls how much XP each level requires — the difficulty ramp of your progression.</p>
        <p><strong>Tip:</strong> Higher values = slower levelling (good for big/old servers so veterans stay ahead); lower values reward newcomers faster. Change it gradually — it reshapes everyone&apos;s level at once.</p>
      </>
    ),
  },
  'leveling-ignored': {
    title: 'Ignored channels & roles',
    plan: 'free',
    body: (
      <>
        <p>Messages in these channels — or from members with these roles — earn <strong>no XP</strong>.</p>
        <p><strong>When to use:</strong> Add spam, bot-command and off-topic channels to stop XP farming, and add bot roles so they don&apos;t climb the leaderboard.</p>
      </>
    ),
  },
  'leveling-rewards': {
    title: 'Reward roles',
    plan: 'free',
    body: (
      <>
        <p>Automatically grant a role when a member reaches a chosen level.</p>
        <p><strong>Heads up:</strong> The reward role must sit <em>below</em> Pulse&apos;s top role in the hierarchy, or the bot can&apos;t assign it. Decide whether lower reward roles are kept or replaced as members level up.</p>
      </>
    ),
  },
  'backups-automatic': {
    title: 'Automatic backups',
    plan: 'business',
    body: (
      <>
        <p>Let Pulse take snapshots on a schedule so you always have a recent recovery point without remembering to do it.</p>
        <p><strong>Heads up:</strong> <strong>Retention</strong> caps how many automatic backups are kept — older ones are pruned as new ones arrive, so set it high enough to cover the window you might need to roll back to.</p>
      </>
    ),
  },
  'backups-restore': {
    title: 'Restore this backup',
    plan: 'business',
    body: (
      <>
        <p>Re-applies the saved configuration to your live server. It&apos;s <strong>additive-safe</strong> and shows a <strong>live preview</strong> of every change first — nothing is applied until you confirm.</p>
        <p><strong>Heads up:</strong> Restoring doesn&apos;t delete things that exist now but weren&apos;t in the snapshot; it adds/updates to match the backup. Review the preview before confirming.</p>
      </>
    ),
  },
  'presence-rotation': {
    title: 'Rotation & schedule',
    plan: 'pro',
    body: (
      <>
        <p>Cycle the bot through several statuses/activities automatically, optionally on a time schedule.</p>
        <p><strong>Heads up:</strong> The bot shows <strong>one</strong> presence globally, driven by the active config — rotation changes what that single presence displays over time.</p>
      </>
    ),
  },
  'ticket-types': {
    title: 'Ticket types',
    plan: 'free',
    body: (
      <>
        <p>The categories members choose from when opening a ticket. Each type can ask its <strong>own questions</strong>, collected before the ticket opens.</p>
        <p><strong>Tip:</strong> Keep questions short and specific per type (e.g. Support vs. Report) so staff get the context they need up front.</p>
      </>
    ),
  },
  'ticket-channels': {
    title: 'Ticket channels & access',
    plan: 'free',
    body: (
      <>
        <p>Where each new ticket channel is created, who can see it, and how it&apos;s named.</p>
        <p><strong>Heads up:</strong> Access is driven by the staff role — make sure it&apos;s set so only your team sees open tickets. Pulse needs Manage Channels to create them.</p>
      </>
    ),
  },

  // ── Preferences ───────────────────────────────────────────────────────────
  'contextual-help-pref': {
    title: 'Show Contextual Help',
    plan: 'free',
    body: (
      <>
        <p>Controls both the ⓘ help markers <strong>and</strong> the guided dashboard tour across the whole app. Turn it off once you know your way around, and back on any time.</p>
        <p>Your choice is saved and persists across sessions.</p>
      </>
    ),
  },
}
