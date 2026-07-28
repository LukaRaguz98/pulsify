/**
 * Client-safe pricing plan definitions, feature limits and billing types
 * for the subscription system (PULSIFY-29).
 *
 * NO `server-only` here — imported from both server (lib/billing-server,
 * API routes) and client (UpgradePrompt, locked feature UI, pricing cards).
 * Server-only Stripe SDK lives in `lib/stripe.ts`; DB reads/writes and
 * webhook sync in `lib/billing-server.ts`.
 *
 * Plans are FIXED at the code level (not editable in DB) — promoting Pro to
 * include a Business feature is a deploy, not a runtime toggle. Stripe price
 * IDs come from env vars so dev/prod can target different Stripe accounts.
 */

// ── Plans ────────────────────────────────────────────────────────────────
// Ordered free → enterprise. The rank doubles as "is X at-least Y" comparisons:
// `PLAN_RANK[current] >= PLAN_RANK[required]` gates a premium feature.
export const PLANS = ['free', 'pro', 'business', 'enterprise'] as const
export type Plan = (typeof PLANS)[number]

export const PLAN_RANK: Record<Plan, number> = {
  free: 0,
  pro: 1,
  business: 2,
  enterprise: 3,
}

// Display labels are decoupled from the internal plan keys so we can rename
// tiers without a DB/Stripe migration. Internal `pro` ships as "Plus" and
// internal `business` ships as "Pro".
export const PLAN_LABELS: Record<Plan, string> = {
  free: 'Free',
  pro: 'Plus',
  business: 'Pro',
  enterprise: 'Enterprise',
}

export const PLAN_TAGLINES: Record<Plan, string> = {
  free: 'Everything you need to get started.',
  pro: 'For growing communities that mean business.',
  business: 'Manage multiple servers like a team.',
  enterprise: 'Tailored scale, security and support.',
}

/** USD monthly prices. Yearly is the per-month equivalent when billed yearly. */
export const PLAN_PRICES: Record<Plan, { monthly: number | null; yearly: number | null }> = {
  free: { monthly: 0, yearly: 0 },
  pro: { monthly: 10, yearly: 8 }, // "Plus" — 20% off when billed yearly
  business: { monthly: 20, yearly: 16 }, // "Pro" — 20% off when billed yearly
  enterprise: { monthly: null, yearly: null }, // "Contact sales"
}

export type BillingCycle = 'monthly' | 'yearly'

/**
 * Stripe price ID lookup. Reads NEXT_PUBLIC_* env vars so the client can also
 * resolve them (the checkout endpoint sends the plan + cycle, not a raw price
 * id, so this is mostly for debug clarity). Returns null when env is unset OR
 * the plan is a non-billable tier (free, enterprise).
 */
export function getStripePriceId(plan: Plan, cycle: BillingCycle): string | null {
  if (plan === 'free' || plan === 'enterprise') return null
  // Naming convention: NEXT_PUBLIC_STRIPE_PRICE_PRO_MONTHLY etc.
  const key = `NEXT_PUBLIC_STRIPE_PRICE_${plan.toUpperCase()}_${cycle.toUpperCase()}`
  const value = process.env[key]
  return value && value.length > 0 ? value : null
}

// ── Status ───────────────────────────────────────────────────────────────
// Mirrors the Stripe Subscription.status enum verbatim. The dashboard treats
// active + trialing + past_due (grace period) as "user keeps access"; the
// rest demote them to free until they resolve billing.
export const SUBSCRIPTION_STATUSES = [
  'active', 'trialing', 'past_due', 'canceled',
  'incomplete', 'incomplete_expired', 'unpaid', 'paused',
] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

/** Statuses that grant feature access (i.e. behave as the paid plan). */
export const ACCESS_GRANTING_STATUSES: SubscriptionStatus[] = ['active', 'trialing', 'past_due']

// ── Feature limits (the "gating matrix") ─────────────────────────────────
// Single source of truth for plan-based limits. Reading numbers from a flat
// map keeps the UI (usage indicators) and the backend (validation) literally
// the same data. Use `Infinity` for "unlimited" so comparisons stay numeric.
export type FeatureLimits = {
  /** Workspaces a user can OWN (Business+ unlocks multi-workspace ops). */
  maxWorkspaces: number
  /** Servers a single workspace can hold. */
  maxServersPerWorkspace: number
  /** Days of analytics retained on the dashboard charts. */
  analyticsRetentionDays: number
  /**
   * Days of moderation / server-history surfaced.
   *
   * ENFORCED since PULSIFY-63: it's the query window the Server Timeline (feed,
   * statistics and exports) reads through. Rows are never deleted, so this
   * hides history rather than destroying it — a downgrade narrows the view and
   * an upgrade brings the older events straight back. Still display-only for
   * the moderation log itself (see PULSIFY-62 audit §7.6).
   */
  logRetentionDays: number
  /** AI moderation (Pulse Guard) on at all. Plus+. */
  aiModeration: boolean
  /** Extended AI categories + tunable thresholds. Pro+. */
  advancedAiModeration: boolean
  /** Active tickets allowed across a guild's panels. */
  maxActiveTicketsPerGuild: number
  /** Concurrent event/scheduled automations per guild. */
  maxAutomationsPerGuild: number
  /** Concurrent giveaways per guild. */
  maxConcurrentGiveaways: number
  /** Concurrent open community polls per guild. */
  maxActivePolls: number
  /** Concurrent scheduled events per guild. */
  maxScheduledEvents: number
  /** Self-assign role menus a guild can publish. */
  maxSelfRoleMenus: number
  /** Live server-statistics counter channels per guild. */
  maxStatisticChannels: number
  /** Concurrent live join-to-create private voice channels per guild. */
  maxPrivateChannelsActive: number
  /** Concurrent active temporary-role grants per guild. */
  maxTemporaryRolesActive: number
  /** Connected integrations per guild. */
  maxIntegrations: number
  /** Saved (custom) feature-enablement templates per guild. */
  maxSavedTemplates: number
  /** Member-milestone definitions per guild. */
  maxMilestones: number
  /** Per-guild economy reward configs (economy itself is global). */
  maxCustomRewards: number
  /** Open application forms per guild. */
  maxApplications: number
  /** Beyond standard ban/kick: bulk moderation, raid shield, etc. Plus+. */
  advancedModeration: boolean
  /** Alt-risk view + `/alt check`. Free (basic). */
  altDetection: boolean
  /** Join-time auto-flagging + investigations at scale. Plus+. */
  advancedAltDetection: boolean
  /** DDoS detection + auto-mitigation module. Plus+. */
  ddosProtection: boolean
  /** Custom DDoS rules/presets beyond defaults. Pro+. */
  advancedDdosProtection: boolean
  /** Custom bot name + avatar per guild (Plus+). */
  customBranding: boolean
  /** Workspaces + multi-server collaboration (Pro+). */
  multiServerManagement: boolean
  /** Advanced analytics insights (heatmaps, cohorts). Pro+. */
  advancedAnalytics: boolean
  /**
   * Gaming Analytics (PULSIFY-64) — presence-based play tracking, per-game and
   * per-member statistics, leaderboards, live activity.
   *
   * FREE on every plan, deliberately. It is the module a gaming community
   * evaluates Pulsify on, and gating the whole thing would mean a server never
   * sees the data that would make it upgrade. Depth is what costs: history
   * length rides `logRetentionDays`, and the derived views below are Plus+.
   */
  gamingAnalytics: boolean
  /**
   * The derived half of Gaming: squad detection, activity heatmaps, popularity
   * trends and exports. These are the expensive queries and the ones a server
   * only wants once it has months of history to look at. Plus+.
   */
  advancedGamingAnalytics: boolean
  /** Backup/restore of guild config (Pro+). */
  backupRestore: boolean
  /** Public REST API / webhooks (Enterprise). */
  apiAccess: boolean
  /** Priority / dedicated support tier (display-only). */
  prioritySupport: boolean
}

export const PLAN_LIMITS: Record<Plan, FeatureLimits> = {
  free: {
    maxWorkspaces: 1,
    maxServersPerWorkspace: 2,
    analyticsRetentionDays: 7,
    logRetentionDays: 30,
    aiModeration: false,
    advancedAiModeration: false,
    maxActiveTicketsPerGuild: 5,
    maxAutomationsPerGuild: 3,
    maxConcurrentGiveaways: 1,
    maxActivePolls: 2,
    maxScheduledEvents: 3,
    maxSelfRoleMenus: 2,
    maxStatisticChannels: 3,
    maxPrivateChannelsActive: 5,
    maxTemporaryRolesActive: 5,
    maxIntegrations: 1,
    maxSavedTemplates: 2,
    maxMilestones: 3,
    maxCustomRewards: 5,
    maxApplications: 1,
    advancedModeration: false,
    altDetection: true,
    advancedAltDetection: false,
    ddosProtection: false,
    advancedDdosProtection: false,
    customBranding: false,
    multiServerManagement: false,
    advancedAnalytics: false,
    gamingAnalytics: true,
    advancedGamingAnalytics: false,
    backupRestore: false,
    apiAccess: false,
    prioritySupport: false,
  },
  pro: {
    maxWorkspaces: 1,
    maxServersPerWorkspace: 5,
    analyticsRetentionDays: 30,
    logRetentionDays: 90,
    aiModeration: true,
    advancedAiModeration: false,
    maxActiveTicketsPerGuild: 50,
    maxAutomationsPerGuild: 25,
    maxConcurrentGiveaways: 10,
    maxActivePolls: 15,
    maxScheduledEvents: 20,
    maxSelfRoleMenus: 10,
    maxStatisticChannels: 10,
    maxPrivateChannelsActive: 25,
    maxTemporaryRolesActive: 50,
    maxIntegrations: 5,
    maxSavedTemplates: 10,
    maxMilestones: 15,
    maxCustomRewards: 25,
    maxApplications: 5,
    advancedModeration: true,
    altDetection: true,
    advancedAltDetection: true,
    ddosProtection: true,
    advancedDdosProtection: false,
    customBranding: true,
    multiServerManagement: false,
    advancedAnalytics: false,
    gamingAnalytics: true,
    // Plus is where the derived gaming views unlock — one tier below
    // `advancedAnalytics`, because squads and heatmaps are the reason a gaming
    // community upgrades at all, and holding them to Pro would put the module's
    // whole point behind the wrong door.
    advancedGamingAnalytics: true,
    backupRestore: false,
    apiAccess: false,
    prioritySupport: true,
  },
  business: {
    maxWorkspaces: 3,
    maxServersPerWorkspace: 25,
    analyticsRetentionDays: 90,
    logRetentionDays: 180,
    aiModeration: true,
    advancedAiModeration: true,
    maxActiveTicketsPerGuild: 250,
    maxAutomationsPerGuild: 100,
    maxConcurrentGiveaways: 50,
    maxActivePolls: 75,
    maxScheduledEvents: 100,
    maxSelfRoleMenus: 50,
    maxStatisticChannels: 25,
    maxPrivateChannelsActive: 100,
    maxTemporaryRolesActive: 250,
    maxIntegrations: 15,
    maxSavedTemplates: 50,
    maxMilestones: 50,
    maxCustomRewards: 100,
    maxApplications: 25,
    advancedModeration: true,
    altDetection: true,
    advancedAltDetection: true,
    ddosProtection: true,
    advancedDdosProtection: true,
    customBranding: true,
    multiServerManagement: true,
    advancedAnalytics: true,
    gamingAnalytics: true,
    advancedGamingAnalytics: true,
    backupRestore: true,
    apiAccess: false,
    prioritySupport: true,
  },
  enterprise: {
    maxWorkspaces: Infinity,
    maxServersPerWorkspace: Infinity,
    analyticsRetentionDays: 365,
    logRetentionDays: 365,
    aiModeration: true,
    advancedAiModeration: true,
    maxActiveTicketsPerGuild: Infinity,
    maxAutomationsPerGuild: Infinity,
    maxConcurrentGiveaways: Infinity,
    maxActivePolls: Infinity,
    maxScheduledEvents: Infinity,
    maxSelfRoleMenus: Infinity,
    maxStatisticChannels: Infinity,
    maxPrivateChannelsActive: Infinity,
    maxTemporaryRolesActive: Infinity,
    maxIntegrations: Infinity,
    maxSavedTemplates: Infinity,
    maxMilestones: Infinity,
    maxCustomRewards: Infinity,
    maxApplications: Infinity,
    advancedModeration: true,
    altDetection: true,
    advancedAltDetection: true,
    ddosProtection: true,
    advancedDdosProtection: true,
    customBranding: true,
    multiServerManagement: true,
    advancedAnalytics: true,
    gamingAnalytics: true,
    advancedGamingAnalytics: true,
    backupRestore: true,
    apiAccess: true,
    prioritySupport: true,
  },
}

// ── Plan comparison features (for the marketing/billing cards) ───────────
// Bulleted user-facing feature lists per plan. Kept here (not in
// components/landing/landing-data.ts) so the in-dashboard pricing modal and
// the public landing card show the exact same list.
export const PLAN_FEATURES: Record<Plan, string[]> = {
  free: [
    'Every core module included',
    'Moderation, leveling, economy & reputation',
    'Birthdays, invites, polls, giveaways & events',
    'Alt-detection risk checks',
    `Server timeline with ${PLAN_LIMITS.free.logRetentionDays} days of history`,
    `${PLAN_LIMITS.free.analyticsRetentionDays}-day analytics retention`,
    `Up to ${PLAN_LIMITS.free.maxAutomationsPerGuild} automations`,
    'Community support',
  ],
  pro: [
    'Everything in Free, with higher limits',
    'AI moderation (Pulse Guard)',
    'Advanced & bulk moderation + raid shield',
    'Alt-detection auto-flagging',
    'DDoS protection',
    'Custom bot branding',
    `${PLAN_LIMITS.pro.logRetentionDays}-day server timeline history`,
    `${PLAN_LIMITS.pro.analyticsRetentionDays}-day analytics retention`,
    'Priority support',
  ],
  business: [
    'Everything in Plus',
    `Multi-server workspaces (up to ${PLAN_LIMITS.business.maxServersPerWorkspace} servers)`,
    'Team & admin collaboration',
    'Advanced analytics insights',
    'Advanced AI moderation categories',
    'Custom DDoS rules & presets',
    'Backup & restore system',
    `${PLAN_LIMITS.business.logRetentionDays}-day server timeline history`,
    `${PLAN_LIMITS.business.analyticsRetentionDays}-day analytics retention`,
  ],
  enterprise: [
    'Everything in Pro',
    'Unlimited servers, workspaces & usage',
    'REST API + webhook access',
    'Dedicated support',
    'Custom integrations',
    'Advanced security tools',
    'Early access to new features',
  ],
}

// ── Early access (everything-free kill switch) ───────────────────────────
// During early access ALL plans behave as the top tier (everything unlocked,
// limits unlimited) and Stripe checkout/portal are turned off — Pulsify ships
// free until the operator flips `EARLY_ACCESS` off, at which point the normal
// plan/limit gating resumes with no other code change.
//
// The flag is read from `EARLY_ACCESS` (server) and falls back to
// `NEXT_PUBLIC_EARLY_ACCESS` so the value can optionally be inlined into client
// bundles too. In practice the server resolves it and threads the boolean to
// the client via PlanProvider / page props, so the public mirror is optional.
export const EARLY_ACCESS_PLAN: Plan = 'enterprise'

export function isEarlyAccess(): boolean {
  const raw = process.env.EARLY_ACCESS ?? process.env.NEXT_PUBLIC_EARLY_ACCESS
  if (!raw) return false
  const v = raw.trim().toLowerCase()
  return v === 'yes' || v === 'true' || v === '1' || v === 'on'
}

// ── Capability checks (the single gate used everywhere) ──────────────────
/** True if `current` plan is at least `required`. */
export function hasPlan(current: Plan, required: Plan): boolean {
  return PLAN_RANK[current] >= PLAN_RANK[required]
}

/** True if the subscription's status grants feature access. */
export function isActiveStatus(status: SubscriptionStatus): boolean {
  return ACCESS_GRANTING_STATUSES.includes(status)
}

/**
 * The "current effective plan" the rest of the app should use. A user's stored
 * plan may be Pro but if their subscription went `canceled` or `unpaid` we
 * demote them to free — the row stays for history. Returns 'free' for any
 * non-access-granting status. Server callers compose this with their DB read.
 */
export function effectivePlan(
  storedPlan: Plan | null | undefined,
  status: SubscriptionStatus | null | undefined,
): Plan {
  if (!storedPlan) return 'free'
  if (status && !isActiveStatus(status)) return 'free'
  return storedPlan
}

/**
 * Format a feature limit for UI display. Infinity → "Unlimited", otherwise the
 * number formatted with the locale's thousands separators.
 */
export function formatLimit(n: number): string {
  if (!Number.isFinite(n)) return 'Unlimited'
  return n.toLocaleString()
}

// ── Plan card metadata (icons, recommended, CTA) ─────────────────────────
// Shared by the public landing page and the in-dashboard upgrade modal so the
// recommended highlight and CTA labels stay consistent.
export const PLAN_RECOMMENDED: Plan = 'pro'

export const PLAN_CTA: Record<Plan, string> = {
  free: 'Start free',
  pro: 'Upgrade to Plus',
  business: 'Choose Pro',
  enterprise: 'Contact sales',
}

/** Plans the user can self-serve checkout for (excludes free + enterprise). */
export const BILLABLE_PLANS: Plan[] = ['pro', 'business']

// ── Subscription row shape (mirrors public.subscriptions) ────────────────
export type SubscriptionRow = {
  user_id: string
  stripe_customer_id: string
  stripe_subscription_id: string | null
  plan: Plan
  status: SubscriptionStatus
  billing_cycle: BillingCycle
  renewal_date: string | null
  cancel_at_period_end: boolean
  trial_ends_at: string | null
  created_at: string
  updated_at: string
}

/** The trimmed shape sent to the client (no stripe ids). */
export type ClientSubscription = {
  plan: Plan
  status: SubscriptionStatus
  billing_cycle: BillingCycle
  renewal_date: string | null
  cancel_at_period_end: boolean
  trial_ends_at: string | null
}
