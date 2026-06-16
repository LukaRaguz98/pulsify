'use client'

// Visual approximation of what the bot posts to a new member: the Pulse v2
// welcome embed plus the interactive onboarding panel, all inside one accented
// container — mirroring pulse-bot/src/onboarding.js's build order (header →
// quick links → banner → step blocks → one action-button row → footer) so the
// editor preview matches the real embed.

import { ShieldCheck, ExternalLink, ChevronDown } from 'lucide-react'
import {
  COMMUNITY_LINK_META, COMMUNITY_LINK_ORDER,
  type MemberOnboardingConfig,
} from '@/lib/onboarding'
import type { ChannelOpt, RoleOpt, EventOpt } from './parts'

export function OnboardingPreview({
  config, guildName, channels, events,
}: {
  config: MemberOnboardingConfig
  guildName: string
  guildIcon: string | null
  channels: ChannelOpt[]
  roles: RoleOpt[]
  events: EventOpt[]
}) {
  const resolve = (t: string) => t.replace(/\{user\}/g, '@NewMember').replace(/\{server\}/g, guildName)
  const w = config.welcome
  const chanName = (id: string) => channels.find((c) => c.id === id)?.name ?? 'channel'
  const ordered = config.steps.filter((s) => s.enabled)

  // Action buttons mirror the bot: verify → finish → external link buttons, in
  // one continuous row.
  const showVerify =
    ordered.some((s) => s.id === 'verification') &&
    config.verification.enabled &&
    !!config.verification.role_id
  const showFinish = config.completion_required || config.rewards.enabled
  const linkButtons = w.buttons.filter((b) => b.label && b.url)
  const hasActions = showVerify || showFinish || linkButtons.length > 0

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--line-strong)', background: '#313338' }}>
      <div className="overflow-hidden rounded-md" style={{ background: '#2b2d31', borderLeft: `4px solid ${w.color}` }}>
        <div className="p-3.5 text-[13px]">
          {/* Header */}
          <div className="flex gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold" style={{ color: '#fff' }}>Pulse</div>
              {w.title && <div className="mt-1 text-[15px] font-bold leading-snug" style={{ color: '#fff' }}>{resolve(w.title)}</div>}
              {w.description && <div className="mt-1.5 whitespace-pre-wrap leading-relaxed" style={{ color: '#dbdee1' }}>{resolve(w.description)}</div>}
            </div>
            {w.thumbnail !== 'none' && (
              <div className="h-14 w-14 shrink-0 rounded-full" style={{ background: 'linear-gradient(135deg,#5865f2,#404eed)' }} />
            )}
          </div>

          {/* Quick links */}
          {w.quick_links.length > 0 && (
            <div className="mt-3 space-y-1">
              {w.quick_links.map((q, i) => (
                <div key={i} style={{ color: '#dbdee1' }}>→ <Chan name={chanName(q.channel_id)} /> — {q.label}</div>
              ))}
            </div>
          )}

          {/* Banner — custom image, else the generated server banner */}
          {w.banner && (
            w.banner_url ? (
              <div
                className="mt-3 h-24 w-full rounded-md bg-cover bg-center"
                style={{ backgroundImage: `url("${w.banner_url}")`, backgroundColor: '#1e1f22' }}
              />
            ) : (
              <div className="mt-3 flex h-20 items-center justify-center rounded-md text-xs font-semibold" style={{ background: `linear-gradient(135deg, ${w.color}, color-mix(in srgb, ${w.color} 50%, #000))`, color: '#fff' }}>
                {guildName}
              </div>
            )
          )}

          {/* Step blocks (roles — events — community — rewards) */}
          {ordered.map((s) => {
            if (s.id === 'roles' && config.roleCategories.length > 0) {
              return (
                <div key="roles">
                  {config.roleCategories.map((c) => (
                    <div key={c.id}>
                      <Divider />
                      <div className="font-bold" style={{ color: '#fff' }}>{c.label || 'Roles'}</div>
                      {c.description && <div className="text-[11px]" style={{ color: '#949ba4' }}>{c.description}</div>}
                      <div className="mt-1.5 flex items-center justify-between rounded-[3px] px-3 py-2" style={{ background: '#1e1f22', color: '#b5bac1' }}>
                        <span>Choose your roles…</span><ChevronDown size={14} />
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
            if (s.id === 'events' && config.events.enabled) {
              const list = events.slice(0, Math.max(1, config.events.max))
              return (
                <div key="events">
                  <Divider />
                  <div className="font-bold" style={{ color: '#fff' }}>Upcoming events</div>
                  {list.length === 0 ? (
                    <div style={{ color: '#949ba4' }}>No events scheduled.</div>
                  ) : list.map((ev) => (
                    <div key={ev.id} className="border-l-2 pl-2.5" style={{ color: '#dbdee1', borderColor: '#3f4147' }}>
                      <strong style={{ color: '#fff' }}>{ev.name}</strong> — <span style={{ color: '#949ba4' }}>{new Date(ev.scheduled_start_time).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              )
            }
            if (s.id === 'community') {
              const shown = COMMUNITY_LINK_ORDER.filter((k) => config.community[k])
              if (shown.length === 0) return null
              return (
                <div key="community">
                  <Divider />
                  <div className="font-bold" style={{ color: '#fff' }}>Explore {guildName}</div>
                  <div className="mb-1 text-[11px]" style={{ color: '#949ba4' }}>The channels worth knowing before you dive in.</div>
                  {shown.map((k) => (
                    <div key={k} className="border-l-2 pl-2.5" style={{ color: '#dbdee1', borderColor: '#3f4147' }}>
                      <Chan name={chanName(config.community[k]!)} /> <strong style={{ color: '#fff' }}>{COMMUNITY_LINK_META[k].label}</strong>
                    </div>
                  ))}
                </div>
              )
            }
            if (s.id === 'rewards' && config.rewards.enabled) {
              const parts: string[] = []
              if (config.rewards.xp) parts.push(`${config.rewards.xp} XP`)
              if (config.rewards.reputation) parts.push(`${config.rewards.reputation} reputation`)
              if (config.rewards.role_ids.length) parts.push(`${config.rewards.role_ids.length} starter role${config.rewards.role_ids.length === 1 ? '' : 's'}`)
              if (parts.length === 0) return null
              return (
                <div key="rewards">
                  <Divider />
                  <div style={{ color: '#dbdee1' }}>
                    Finish onboarding to earn{' '}
                    {parts.map((p, i) => (
                      <span key={i}><strong style={{ color: '#fff' }}>{p}</strong>{i < parts.length - 1 ? ' & ' : ''}</span>
                    ))}.
                  </div>
                </div>
              )
            }
            return null
          })}

          {/* Action buttons — verify, finish and link buttons on one row */}
          {hasActions && (
            <>
              <Divider />
              <div className="flex flex-wrap gap-2">
                {showVerify && (
                  <span className="inline-flex items-center gap-1.5 rounded-[3px] px-3 py-1.5 font-medium" style={{ background: '#248046', color: '#fff' }}>
                    <ShieldCheck size={13} /> {config.verification.button_label || 'Verify me'}
                  </span>
                )}
                {showFinish && (
                  <span className="inline-flex items-center gap-1.5 rounded-[3px] px-3 py-1.5 font-medium" style={{ background: '#5865f2', color: '#fff' }}>
                    Finish onboarding
                  </span>
                )}
                {linkButtons.map((b, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 rounded-[3px] px-3 py-1.5 font-medium" style={{ background: '#4e5058', color: '#fff' }}>
                    {b.emoji} {b.label} <ExternalLink size={11} />
                  </span>
                ))}
              </div>
            </>
          )}

          {/* Footer */}
          <Divider />
          <div className="text-[11px]" style={{ color: '#949ba4' }}>
            {w.footer_text ? resolve(w.footer_text) : 'Pulse — Welcome'}
          </div>
        </div>
      </div>
    </div>
  )
}

function Divider() {
  return <div className="my-2.5 border-t" style={{ borderColor: '#3f4147' }} />
}

function Chan({ name }: { name: string }) {
  return <span style={{ color: '#00a8fc' }}>#{name}</span>
}
