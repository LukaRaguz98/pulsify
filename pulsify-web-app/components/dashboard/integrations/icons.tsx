'use client'

import {
  // provider glyphs
  GitBranch,
  GitMerge,
  MonitorPlay,
  Music2,
  Tv,
  TvMinimalPlay,
  Gamepad2,
  HeartHandshake,
  MessageCircle,
  AtSign,
  Rss,
  CalendarDays,
  Kanban,
  SquareKanban,
  NotebookPen,
  // category / status / log glyphs
  Bell,
  Briefcase,
  CheckCircle2,
  AlertTriangle,
  PlugZap,
  Info,
  XCircle,
  Plug,
  type LucideProps,
} from 'lucide-react'

// lib/integrations.ts is framework-free and references icons by string name, so
// the UI resolves those names to real components here. Brand icons (GitHub,
// YouTube, …) were removed from this lucide version for trademark reasons, so
// providers use the closest available generic glyph (see the catalog).
const MAP: Record<string, React.ComponentType<LucideProps>> = {
  GitBranch,
  GitMerge,
  MonitorPlay,
  Music2,
  Tv,
  TvMinimalPlay,
  Gamepad2,
  HeartHandshake,
  MessageCircle,
  AtSign,
  Rss,
  CalendarDays,
  Kanban,
  SquareKanban,
  NotebookPen,
  Bell,
  Briefcase,
  CheckCircle2,
  AlertTriangle,
  PlugZap,
  Info,
  XCircle,
  Plug,
}

export function IntegrationIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = MAP[name] ?? Plug
  return <Icon {...props} />
}
