import { Fragment } from 'react'
import { Check, Minus } from 'lucide-react'
import {
  PLANS,
  PLAN_LABELS,
  PLAN_LIMITS,
  PLAN_RECOMMENDED,
  formatLimit,
  type Plan,
  type FeatureLimits,
} from '@/lib/billing'

/**
 * Full feature comparison table for the /pricing page (PULSIFY-62).
 *
 * Driven entirely by PLAN_LIMITS so it can never drift from what the app
 * actually enforces — change a limit in lib/billing.ts and this table, the
 * billing page and the server gates all move together. Server component: pure
 * render off the shared matrix, no client state.
 */

type Row =
  // A module included on every plan (Generous Free) — a check in all columns.
  | { kind: 'all'; label: string }
  // A numeric limit read straight from the matrix.
  | { kind: 'num'; label: string; key: keyof FeatureLimits; suffix?: string }
  // A boolean feature — check where the plan includes it, dash otherwise.
  | { kind: 'bool'; label: string; key: keyof FeatureLimits }

type Section = { title: string; rows: Row[] }

const SECTIONS: Section[] = [
  {
    title: 'Core & community — included on every plan',
    rows: [
      { kind: 'all', label: 'Moderation (warn, timeout, kick, ban, purge, logs)' },
      { kind: 'all', label: 'Levels & XP' },
      { kind: 'all', label: 'Global economy, coins & reputation' },
      { kind: 'all', label: 'Birthdays, invites & onboarding' },
      { kind: 'all', label: 'Community polls, giveaways & events' },
      { kind: 'all', label: 'Tickets & applications' },
      { kind: 'all', label: 'Roles, hierarchy & self-assign menus' },
      { kind: 'all', label: 'Server assets, statistics & private channels' },
      { kind: 'all', label: 'Alt-detection risk checks' },
      { kind: 'all', label: 'Server insights & analytics' },
      { kind: 'all', label: 'Feature-enablement templates' },
    ],
  },
  {
    title: 'Usage limits',
    rows: [
      { kind: 'num', label: 'Analytics retention', key: 'analyticsRetentionDays', suffix: ' days' },
      { kind: 'num', label: 'Moderation log history', key: 'logRetentionDays', suffix: ' days' },
      { kind: 'num', label: 'Automations', key: 'maxAutomationsPerGuild' },
      { kind: 'num', label: 'Concurrent giveaways', key: 'maxConcurrentGiveaways' },
      { kind: 'num', label: 'Concurrent polls', key: 'maxActivePolls' },
      { kind: 'num', label: 'Scheduled events', key: 'maxScheduledEvents' },
      { kind: 'num', label: 'Active tickets', key: 'maxActiveTicketsPerGuild' },
      { kind: 'num', label: 'Self-assign role menus', key: 'maxSelfRoleMenus' },
      { kind: 'num', label: 'Statistics channels', key: 'maxStatisticChannels' },
      { kind: 'num', label: 'Private voice channels', key: 'maxPrivateChannelsActive' },
      { kind: 'num', label: 'Temporary role grants', key: 'maxTemporaryRolesActive' },
      { kind: 'num', label: 'Milestones', key: 'maxMilestones' },
      { kind: 'num', label: 'Custom economy rewards', key: 'maxCustomRewards' },
      { kind: 'num', label: 'Application forms', key: 'maxApplications' },
      { kind: 'num', label: 'Integrations', key: 'maxIntegrations' },
      { kind: 'num', label: 'Saved templates', key: 'maxSavedTemplates' },
      { kind: 'num', label: 'Servers per workspace', key: 'maxServersPerWorkspace' },
      { kind: 'num', label: 'Workspaces', key: 'maxWorkspaces' },
    ],
  },
  {
    title: 'Premium features',
    rows: [
      { kind: 'bool', label: 'AI moderation (Pulse Guard)', key: 'aiModeration' },
      { kind: 'bool', label: 'Advanced & bulk moderation', key: 'advancedModeration' },
      { kind: 'bool', label: 'Alt-detection auto-flagging', key: 'advancedAltDetection' },
      { kind: 'bool', label: 'DDoS protection', key: 'ddosProtection' },
      { kind: 'bool', label: 'Custom bot branding', key: 'customBranding' },
      { kind: 'bool', label: 'Advanced AI moderation categories', key: 'advancedAiModeration' },
      { kind: 'bool', label: 'Custom DDoS rules & presets', key: 'advancedDdosProtection' },
      { kind: 'bool', label: 'Advanced analytics insights', key: 'advancedAnalytics' },
      { kind: 'bool', label: 'Multi-server & team collaboration', key: 'multiServerManagement' },
      { kind: 'bool', label: 'Backup & restore', key: 'backupRestore' },
      { kind: 'bool', label: 'REST API + webhooks', key: 'apiAccess' },
      { kind: 'bool', label: 'Priority / dedicated support', key: 'prioritySupport' },
    ],
  },
]

function Yes() {
  return (
    <span
      className="mx-auto flex h-5 w-5 items-center justify-center rounded-full"
      style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
    >
      <Check size={12} />
    </span>
  )
}

function No() {
  return (
    <span className="mx-auto flex h-5 w-5 items-center justify-center" style={{ color: 'var(--text-3)' }}>
      <Minus size={12} />
    </span>
  )
}

function cell(row: Row, plan: Plan) {
  if (row.kind === 'all') return <Yes />
  if (row.kind === 'bool') {
    return PLAN_LIMITS[plan][row.key] ? <Yes /> : <No />
  }
  const value = PLAN_LIMITS[plan][row.key]
  const n = typeof value === 'number' ? value : 0
  return (
    <span className="text-sm font-medium text-foreground">
      {formatLimit(n)}
      {Number.isFinite(n) && row.suffix ? row.suffix : ''}
    </span>
  )
}

export function PricingComparison() {
  return (
    <section className="mt-20">
      <h2 className="text-center text-2xl font-bold tracking-tight text-foreground">Compare every feature</h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-sm" style={{ color: 'var(--text-2)' }}>
        Everything Pulsify does, and how it scales across plans. Free includes every module — paid plans lift the
        limits and unlock AI, scale and team tools.
      </p>

      <div className="mt-10 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr>
              <th className="w-[38%] pb-4 pr-4 align-bottom text-sm font-semibold" style={{ color: 'var(--text-2)' }}>
                Feature
              </th>
              {PLANS.map((plan) => (
                <th key={plan} className="pb-4 text-center align-bottom">
                  <span
                    className="text-sm font-bold"
                    style={{ color: plan === PLAN_RECOMMENDED ? 'var(--p-1)' : 'var(--text)' }}
                  >
                    {PLAN_LABELS[plan]}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map((section) => (
              <Fragment key={section.title}>
                <tr>
                  <td
                    colSpan={1 + PLANS.length}
                    className="pt-7 pb-2 text-xs font-bold uppercase tracking-wider"
                    style={{ color: 'var(--text-3)' }}
                  >
                    {section.title}
                  </td>
                </tr>
                {section.rows.map((row, i) => (
                  <tr
                    key={row.label}
                    style={{ borderTop: '1px solid var(--line)', background: i % 2 ? 'var(--panel)' : 'transparent' }}
                  >
                    <td className="py-2.5 pr-4 text-sm" style={{ color: 'var(--text-2)' }}>
                      {row.label}
                    </td>
                    {PLANS.map((plan) => (
                      <td key={plan} className="py-2.5 text-center">
                        {cell(row, plan)}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
