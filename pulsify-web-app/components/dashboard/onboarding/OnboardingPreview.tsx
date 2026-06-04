'use client'

// Visual approximation of what the bot posts to a new member: the Pulse v2
// welcome embed plus the interactive onboarding panel (role menus, verify
// button, event + community links, rewards note). Mirrors index.js /
// onboarding.js output closely enough to be a faithful editor preview.

import {
  ChevronDown, ShieldCheck, CalendarDays, Gift, ExternalLink,
} from 'lucide-react'
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
  const enabled = (id: string) => config.steps.find((s) => s.id === id)?.enabled

  const ordered = config.steps.filter((s) => s.enabled)

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--line-strong)', background: '#313338' }}>
      {/* Welcome embed */}
      <div className="overflow-hidden rounded-md" style={{ background: '#2b2d31', borderLeft: `4px solid ${w.color}` }}>
        <div className="p-3.5">
          <div className="flex gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold" style={{ color: '#fff' }}>Pulse</div>
              {w.title && <div className="mt-1 text-[15px] font-bold leading-snug" style={{ color: '#fff' }}>{resolve(w.title)}</div>}
              {w.description && <div className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: '#dbdee1' }}>{resolve(w.description)}</div>}
            </div>
            {w.thumbnail !== 'none' && (
              <div className="h-14 w-14 shrink-0 rounded-full" style={{ background: 'linear-gradient(135deg,#5865f2,#404eed)' }} />
            )}
          </div>

          {w.quick_links.length > 0 && (
            <div className="mt-3 space-y-1 text-[13px]">
              {w.quick_links.map((q, i) => (
                <div key={i} style={{ color: '#dbdee1' }}>→ <span style={{ color: '#00a8fc' }}>#{chanName(q.channel_id)}</span> — {q.label}</div>
              ))}
            </div>
          )}

          {w.banner && (
            <div className="mt-3 flex h-20 items-center justify-center rounded-md text-xs font-semibold" style={{ background: `linear-gradient(135deg, ${w.color}, color-mix(in srgb, ${w.color} 50%, #000))`, color: '#fff' }}>
              {guildName}
            </div>
          )}

          <div className="mt-3 border-t pt-2 text-[11px]" style={{ borderColor: '#3f4147', color: '#949ba4' }}>
            {w.footer_text ? resolve(w.footer_text) : 'Pulse · Welcome'}
          </div>
        </div>
      </div>

      {/* Link buttons */}
      {w.buttons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {w.buttons.map((b, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-[3px] px-3 py-1.5 text-[13px] font-medium" style={{ background: '#4e5058', color: '#fff' }}>
              {b.emoji} {b.label || 'Button'} <ExternalLink size={11} />
            </span>
          ))}
        </div>
      )}

      {/* Interactive panel */}
      <div className="mt-3 space-y-2">
        {ordered.map((s) => {
          if (s.id === 'verification' && config.verification.enabled) {
            return (
              <span key="v" className="inline-flex items-center gap-1.5 rounded-[3px] px-3 py-1.5 text-[13px] font-medium" style={{ background: '#248046', color: '#fff' }}>
                <ShieldCheck size={13} /> {config.verification.button_label || 'Verify me'}
              </span>
            )
          }
          if (s.id === 'roles') {
            return config.roleCategories.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-[3px] px-3 py-2 text-[13px]" style={{ background: '#1e1f22', color: '#b5bac1' }}>
                <span>{c.label} — choose your roles…</span>
                <ChevronDown size={14} />
              </div>
            ))
          }
          if (s.id === 'events' && enabled('events')) {
            const list = events.slice(0, config.events.max)
            return (
              <div key="e" className="rounded-md p-2.5 text-[13px]" style={{ background: '#1e1f22' }}>
                <div className="mb-1 flex items-center gap-1.5 font-semibold" style={{ color: '#fff' }}><CalendarDays size={13} /> Upcoming events</div>
                {list.length === 0 ? <div style={{ color: '#949ba4' }}>No events scheduled.</div> : list.map((ev) => (
                  <div key={ev.id} style={{ color: '#dbdee1' }}>• {ev.name} — <span style={{ color: '#949ba4' }}>{new Date(ev.scheduled_start_time).toLocaleDateString()}</span></div>
                ))}
              </div>
            )
          }
          if (s.id === 'community' && enabled('community')) {
            const shown = COMMUNITY_LINK_ORDER.filter((k) => config.community[k])
            if (shown.length === 0) return null
            return (
              <div key="c" className="rounded-md p-2.5 text-[13px]" style={{ background: '#1e1f22' }}>
                <div className="mb-1 font-semibold" style={{ color: '#fff' }}>Get to know {guildName}</div>
                {shown.map((k) => (
                  <div key={k} style={{ color: '#dbdee1' }}>{COMMUNITY_LINK_META[k].emoji} {COMMUNITY_LINK_META[k].label} → <span style={{ color: '#00a8fc' }}>#{chanName(config.community[k]!)}</span></div>
                ))}
              </div>
            )
          }
          if (s.id === 'rewards' && config.rewards.enabled) {
            const parts: string[] = []
            if (config.rewards.xp) parts.push(`${config.rewards.xp} XP`)
            if (config.rewards.reputation) parts.push(`+${config.rewards.reputation} rep`)
            if (config.rewards.role_ids.length) parts.push(`${config.rewards.role_ids.length} starter role${config.rewards.role_ids.length === 1 ? '' : 's'}`)
            return (
              <div key="r" className="flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px]" style={{ background: '#1e1f22', color: '#f0b232' }}>
                <Gift size={13} /> Finish to earn {parts.join(' · ') || 'rewards'}
              </div>
            )
          }
          return null
        })}

        {(config.completion_required || config.rewards.enabled) && (
          <span className="inline-flex items-center gap-1.5 rounded-[3px] px-3 py-1.5 text-[13px] font-medium" style={{ background: '#5865f2', color: '#fff' }}>
            ✓ Finish onboarding
          </span>
        )}
      </div>
    </div>
  )
}
