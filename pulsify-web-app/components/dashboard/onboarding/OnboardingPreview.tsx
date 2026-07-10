'use client'

// A realistic Discord render of what the bot posts to a new member: the Pulse
// bot message (avatar + APP tag) wrapping the accented Components-V2 container —
// mirroring pulse-bot/src/onboarding.js's build order (header → quick links →
// banner → step blocks → one action-button row → footer). Section headings use
// `##`-style weight to match the bot's headings.

import { ShieldCheck, ExternalLink, ChevronDown, Tags, CalendarDays, Compass, Gift, Hash } from 'lucide-react'
import {
  COMMUNITY_LINK_META, COMMUNITY_LINK_ORDER,
  type MemberOnboardingConfig,
} from '@/lib/onboarding'
import type { ChannelOpt, RoleOpt, EventOpt } from './parts'
import { PreviewStage } from './PreviewStage'

// All surface/text colours key off the app's semantic theme vars so the preview
// stays legible and on-brand in every theme — light or dark — instead of baking
// in Discord's dark palette (which turned unreadable on the white theme).
const C = {
  heading: 'var(--text)',
  body: 'var(--text)',
  muted: 'var(--text-3)',
  divider: 'var(--line-strong)',
}

export function OnboardingPreview({
  config, guildName, guildIcon, embedColor, channels, events,
}: {
  config: MemberOnboardingConfig
  guildName: string
  guildIcon: string | null
  embedColor: string
  channels: ChannelOpt[]
  roles: RoleOpt[]
  events: EventOpt[]
}) {
  const resolve = (t: string) => t.replace(/\{user\}/g, '@NewMember').replace(/\{server\}/g, guildName)
  const w = config.welcome
  // The embed accent is the guild's global colour (Server Settings › Embed
  // Appearance) — the exact colour the bot posts with — not a per-message pick.
  const accent = embedColor
  const chanName = (id: string) => channels.find((c) => c.id === id)?.name ?? 'channel'
  const ordered = config.steps.filter((s) => s.enabled)

  const showVerify =
    ordered.some((s) => s.id === 'verification') &&
    config.verification.enabled &&
    !!config.verification.role_id
  const showFinish = config.completion_required || config.rewards.enabled
  const linkButtons = w.buttons.filter((b) => b.label && b.url)
  const hasActions = showVerify || showFinish || linkButtons.length > 0

  return (
    // The bot render floats over the shared animated field (see PreviewStage).
    <PreviewStage>
      {/* Bot message row */}
      <div className="flex gap-2.5 sm:gap-3">
        {/* The poster is the Pulse bot itself — use its brand mark as the mock
            avatar (not the server icon / a coloured plate). */}
        <div className="mt-0.5 h-9 w-9 shrink-0 overflow-hidden rounded-full sm:h-10 sm:w-10" style={{ background: 'var(--panel-2)' }}>
          <img src="/logo.png" alt="Pulse" className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold" style={{ color: C.heading }}>Pulse</span>
            <span className="rounded px-1 py-px text-[10px] font-bold uppercase leading-none" style={{ background: '#5865f2', color: '#fff' }}>App</span>
            <span className="text-[11px]" style={{ color: C.muted }}>Today at 12:00</span>
          </div>

          {/* Accented container — translucent app glass so the animated field
              glows through it, with the embed's own accent stripe kept. */}
          <div
            className="mt-1.5 overflow-hidden rounded-lg"
            style={{
              background: 'color-mix(in srgb, var(--panel-2) 55%, transparent)',
              border: '1px solid var(--line)',
              borderLeftWidth: '3px',
              borderLeftColor: accent,
              boxShadow: '0 20px 55px -26px color-mix(in srgb, var(--text) 30%, transparent)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              overflowWrap: 'break-word',
              wordBreak: 'break-word',
            }}
          >
            <div className="space-y-2.5 p-3.5 text-[14px] leading-[1.4]" style={{ color: C.body }}>
              {/* Header */}
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: C.muted }}>Pulse</div>
                  {w.title && <div className="mt-0.5 text-[19px] font-bold leading-tight" style={{ color: C.heading }}>{resolve(w.title)}</div>}
                  {w.description && <div className="mt-1 whitespace-pre-wrap" style={{ color: C.body }}>{resolve(w.description)}</div>}
                </div>
                {w.thumbnail !== 'none' && (
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg" style={{ background: 'var(--panel-2)' }}>
                    <img
                      src={w.thumbnail === 'guild_icon' && guildIcon ? guildIcon : '/logo.png'}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </div>
                )}
              </div>

              {/* Quick links */}
              {w.quick_links.length > 0 && (
                <div className="flex flex-col gap-1">
                  {w.quick_links.map((q, i) => (
                    <div key={i} className="flex items-center gap-1.5" style={{ color: C.body }}>
                      <span style={{ color: C.muted }}>→</span>
                      <Chan name={chanName(q.channel_id)} />
                      <span style={{ color: C.muted }}>—</span>
                      <span>{q.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Banner */}
              {w.banner && (
                w.banner_url ? (
                  <div className="h-28 w-full rounded-md bg-cover bg-center" style={{ backgroundImage: `url("${w.banner_url}")`, backgroundColor: 'color-mix(in srgb, var(--text) 12%, transparent)' }} />
                ) : (
                  <div className="flex h-24 items-center justify-center rounded-md text-sm font-bold tracking-wide" style={{ background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 45%, #000))`, color: '#fff' }}>
                    {guildName}
                  </div>
                )
              )}

              {/* Step blocks */}
              {ordered.map((s) => {
                if (s.id === 'roles' && config.roleCategories.length > 0) {
                  return (
                    <div key="roles" className="space-y-2.5">
                      {config.roleCategories.map((c) => (
                        <div key={c.id}>
                          <Divider />
                          <SectionHeading icon={<Tags size={14} />} label={c.label || 'Roles'} />
                          {c.description && <div className="mt-0.5 text-[12px]" style={{ color: C.muted }}>{c.description}</div>}
                          <div className="mt-1.5 flex items-center justify-between rounded px-3 py-2" style={{ background: 'color-mix(in srgb, var(--text) 7%, transparent)', border: '1px solid var(--line)', color: 'var(--text-2)' }}>
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
                      <SectionHeading icon={<CalendarDays size={14} />} label="Upcoming events" />
                      <div className="mt-1 space-y-1">
                        {list.length === 0 ? (
                          <div style={{ color: C.muted }}>No events scheduled.</div>
                        ) : list.map((ev) => (
                          <div key={ev.id} className="border-l-2 pl-2.5" style={{ borderColor: C.divider }}>
                            <strong style={{ color: C.heading }}>{ev.name}</strong>
                            <span style={{ color: C.muted }}> — {new Date(ev.scheduled_start_time).toLocaleDateString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                }
                if (s.id === 'community') {
                  const shown = COMMUNITY_LINK_ORDER.filter((k) => config.community[k])
                  if (shown.length === 0) return null
                  return (
                    <div key="community">
                      <Divider />
                      <SectionHeading icon={<Compass size={14} />} label={`Explore ${guildName}`} />
                      <div className="mt-0.5 mb-1 text-[12px]" style={{ color: C.muted }}>The channels worth knowing before you dive in.</div>
                      <div className="space-y-1">
                        {shown.map((k) => (
                          <div key={k} className="flex items-center gap-1.5 border-l-2 pl-2.5" style={{ borderColor: C.divider }}>
                            <Chan name={chanName(config.community[k]!)} />
                            <strong style={{ color: C.heading }}>{COMMUNITY_LINK_META[k].label}</strong>
                          </div>
                        ))}
                      </div>
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
                      <div className="flex items-center gap-2 rounded-md px-3 py-2" style={{ background: 'color-mix(in srgb, var(--p-1) 10%, transparent)' }}>
                        <Gift size={14} style={{ color: accent }} />
                        <span style={{ color: C.body }}>
                          Finish onboarding to earn{' '}
                          {parts.map((p, i) => (
                            <span key={i}><strong style={{ color: C.heading }}>{p}</strong>{i < parts.length - 1 ? ' & ' : ''}</span>
                          ))}.
                        </span>
                      </div>
                    </div>
                  )
                }
                return null
              })}

              {/* Action buttons */}
              {hasActions && (
                <>
                  <Divider />
                  <div className="flex flex-wrap gap-2">
                    {showVerify && (
                      <Btn bg="#248046"><ShieldCheck size={14} /> {config.verification.button_label || 'Verify me'}</Btn>
                    )}
                    {showFinish && <Btn bg={accent}>Finish onboarding</Btn>}
                    {linkButtons.map((b, i) => (
                      <Btn key={i} bg="#4e5058">{b.emoji} {b.label} <ExternalLink size={12} /></Btn>
                    ))}
                  </div>
                </>
              )}

              {/* Footer */}
              <Divider />
              <div className="text-[11px]" style={{ color: C.muted }}>
                {w.footer_text ? resolve(w.footer_text) : 'Pulse — Welcome'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PreviewStage>
  )
}

function SectionHeading({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[15px] font-bold" style={{ color: C.heading }}>
      <span style={{ color: C.muted }}>{icon}</span>
      {label}
    </div>
  )
}

function Btn({ bg, children }: { bg: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[13px] font-medium" style={{ background: bg, color: '#fff' }}>
      {children}
    </span>
  )
}

function Divider() {
  return <div className="border-t" style={{ borderColor: C.divider }} />
}

// Channel mentions keep Discord's real blurple pill (not the embed/accent
// colour) so the preview reads like the actual client. Styled via a class so it
// can flip text/background per light-vs-dark theme.
function Chan({ name }: { name: string }) {
  return (
    <span className="ob-chan inline-flex items-center gap-0.5 rounded px-1 py-px text-[13px] font-medium">
      <Hash size={11} />{name}
    </span>
  )
}
