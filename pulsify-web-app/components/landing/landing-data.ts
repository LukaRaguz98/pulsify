import type { ComponentType, CSSProperties } from 'react'
import {
  Shield,
  ShieldAlert,
  BarChart3,
  Crown,
  CalendarDays,
  Hash,
  Zap,
  Activity,
  Bell,
  ScrollText,
  Bot,
  Gauge,
  Workflow,
  Cpu,
} from 'lucide-react'

/** Structural icon type — compatible with every lucide-react icon. */
export type IconType = ComponentType<{ size?: number | string; className?: string; style?: CSSProperties }>

export type TrustBadge = { label: string; icon: IconType }

export const TRUST_BADGES: TrustBadge[] = [
  { label: 'AI Powered', icon: Cpu },
  { label: 'Real-Time Analytics', icon: BarChart3 },
  { label: 'Smart Moderation', icon: ShieldAlert },
  { label: 'Discord Automation', icon: Workflow },
]

export type Feature = {
  title: string
  desc: string
  icon: IconType
  /** CSS colour token used for the icon accent + glow. */
  accent: string
}

// Every shipped MVP system, ordered roughly by how often admins touch them.
export const FEATURES: Feature[] = [
  {
    title: 'Moderation',
    desc: 'Bans, kicks, timeouts and warnings with full hierarchy checks — run every action from the dashboard or let Pulse handle it.',
    icon: Shield,
    accent: 'var(--p-1)',
  },
  {
    title: 'Pulse Guard',
    desc: 'AI moderation that reads every message for spam, scams, phishing, toxicity and NSFW — then acts on your rules automatically.',
    icon: ShieldAlert,
    accent: 'var(--pink)',
  },
  {
    title: 'Analytics',
    desc: 'Live member, message and voice activity with trends over any timeframe. Know exactly how your community is growing.',
    icon: BarChart3,
    accent: 'var(--cyan)',
  },
  {
    title: 'Roles Management',
    desc: 'Create, edit, reorder and clone roles with a visual permission editor and reusable permission presets.',
    icon: Crown,
    accent: 'var(--amber)',
  },
  {
    title: 'Events Management',
    desc: 'Schedule, edit and track Discord events with a calendar view, cover images and a live participants list.',
    icon: CalendarDays,
    accent: 'var(--green)',
  },
  {
    title: 'Channels Management',
    desc: 'Organise, reorder, duplicate and fine-tune channel permissions without ever leaving the dashboard.',
    icon: Hash,
    accent: 'var(--p-1)',
  },
  {
    title: 'Automations',
    desc: 'Welcome and goodbye messages, auto-roles and rich V2 embeds that fire the moment a member joins or leaves.',
    icon: Zap,
    accent: 'var(--cyan)',
  },
  {
    title: 'Notifications',
    desc: 'A real-time activity feed for every join, ban, role change and automation, with per-type preferences.',
    icon: Bell,
    accent: 'var(--amber)',
  },
  {
    title: 'Audit Logs',
    desc: 'Attribute every change to the moderator who made it — whether it happened in Discord or on the dashboard.',
    icon: ScrollText,
    accent: 'var(--pink)',
  },
]

export type Step = { title: string; desc: string; icon: IconType }

export const STEPS: Step[] = [
  {
    title: 'Invite Pulse',
    desc: 'Add the Pulse bot to your server in two clicks. It syncs your channels, roles and members instantly.',
    icon: Bot,
  },
  {
    title: 'Open the dashboard',
    desc: 'Sign in with Discord. Every server you manage shows up automatically — no setup, no config files.',
    icon: Gauge,
  },
  {
    title: 'Configure & automate',
    desc: 'Turn on Pulse Guard, set up automations and tune moderation. Changes sync to Discord the moment you save.',
    icon: Workflow,
  },
  {
    title: 'Watch it grow',
    desc: 'Track analytics, review flagged content and keep your community healthy — all from one clean place.',
    icon: Activity,
  },
]

export type WhyPoint = { title: string; desc: string; icon: IconType }

export const WHY_POINTS: WhyPoint[] = [
  {
    title: 'One dashboard, everything',
    desc: 'Moderation, analytics, events, roles, channels and automations — no more juggling five different bots.',
    icon: Gauge,
  },
  {
    title: 'AI that actually helps',
    desc: 'Pulse Guard blends fast heuristics with an LLM pass to catch what keyword filters miss, with near-zero false positives.',
    icon: Cpu,
  },
  {
    title: 'Real-time, always in sync',
    desc: 'Edits made on the dashboard hit Discord instantly, and changes made in Discord show up in your activity feed.',
    icon: Activity,
  },
  {
    title: 'Built for scale',
    desc: 'From a single community to a multi-server network, Pulsify keeps everything fast, organised and under control.',
    icon: BarChart3,
  },
]

export type Plan = {
  name: string
  /** null = "Custom". */
  monthly: number | null
  /** Per-month price when billed yearly. null = "Custom". */
  yearly: number | null
  tagline: string
  features: string[]
  cta: string
  /** Visually highlighted as the recommended tier. */
  recommended?: boolean
  icon: IconType
}

export const PLANS: Plan[] = [
  {
    name: 'Free',
    monthly: 0,
    yearly: 0,
    tagline: 'Everything you need to get started.',
    icon: Activity,
    cta: 'Start free',
    features: [
      'Basic moderation',
      'Limited analytics',
      'Basic automations',
      'Limited Pulse Guard',
      'Community support',
    ],
  },
  {
    name: 'Pro',
    monthly: 9,
    yearly: 7,
    tagline: 'For growing communities that mean business.',
    icon: Zap,
    recommended: true,
    cta: 'Upgrade to Pro',
    features: [
      'Advanced moderation',
      'Full analytics',
      'AI moderation features',
      'Advanced automations',
      'Custom bot branding',
      'Priority support',
    ],
  },
  {
    name: 'Business',
    monthly: 29,
    yearly: 24,
    tagline: 'Manage multiple servers like a team.',
    icon: BarChart3,
    cta: 'Choose Business',
    features: [
      'Everything in Pro',
      'Multi-server management',
      'Advanced audit logs',
      'Team & admin management',
      'Advanced analytics insights',
      'Extended AI features',
      'Backup & restore system',
    ],
  },
  {
    name: 'Enterprise',
    monthly: null,
    yearly: null,
    tagline: 'Tailored scale, security and support.',
    icon: Crown,
    cta: 'Contact sales',
    features: [
      'Everything in Business',
      'Unlimited scaling',
      'Dedicated support',
      'Custom integrations',
      'Advanced security tools',
      'API & Webhook access',
      'Early access features',
    ],
  },
]

export type Faq = { q: string; a: string }

export const FAQS: Faq[] = [
  {
    q: 'Is Pulsify free to use?',
    a: 'Yes. The Free plan includes core moderation, limited analytics and basic automations — no credit card required. You can upgrade any time as your community grows.',
  },
  {
    q: 'How does Pulse Guard (AI moderation) work?',
    a: 'Every message is screened with fast deterministic heuristics first, then an optional AI pass for the fuzzier categories like toxicity and harassment. You choose the sensitivity and the action per category — flag, delete, warn or timeout.',
  },
  {
    q: 'Do I need to host anything?',
    a: 'No. Invite the Pulse bot, sign in with Discord, and you are ready. Pulsify is fully managed — there are no config files or servers to run.',
  },
  {
    q: 'What permissions does the bot need?',
    a: 'Pulse only needs the permissions for the features you use. The dashboard clearly shows the bot’s effective permissions per server and warns you if something it needs is missing.',
  },
  {
    q: 'Can I manage more than one server?',
    a: 'Absolutely. Every server you have Manage Server or Administrator on shows up automatically. Multi-server management tools are part of the Business plan.',
  },
  {
    q: 'Can I change plans or cancel any time?',
    a: 'Yes — upgrade, downgrade or cancel whenever you like. Your settings and data stay intact, and the Free plan is always available to fall back on.',
  },
]

export type Testimonial = { quote: string; name: string; role: string; initial: string }

export const TESTIMONIALS: Testimonial[] = [
  {
    quote: 'Pulse Guard caught a wave of scam links before any of my mods even woke up. The dashboard is genuinely the cleanest I have used.',
    name: 'Community Owner',
    role: 'Gaming server · 40k members',
    initial: 'G',
  },
  {
    quote: 'We replaced three bots with Pulsify. Analytics, events and moderation in one place — my mod team finally agrees on something.',
    name: 'Head Moderator',
    role: 'Creator community · 12k members',
    initial: 'C',
  },
  {
    quote: 'The automations and welcome embeds are gorgeous out of the box, and the real-time feed means I never miss a thing.',
    name: 'Server Admin',
    role: 'Study & dev hub · 8k members',
    initial: 'S',
  },
]
