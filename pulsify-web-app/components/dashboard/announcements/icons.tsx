'use client'

import {
  CheckCircle2,
  CalendarClock,
  FileText,
  AlertTriangle,
  type LucideProps,
} from 'lucide-react'

// Resolve the lucide icon NAME stored in STATUS_META (lib/announcements.ts is
// framework-free, so it references icons by string) to a real component.
const MAP: Record<string, React.ComponentType<LucideProps>> = {
  CheckCircle2,
  CalendarClock,
  FileText,
  AlertTriangle,
}

export function StatusIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = MAP[name] ?? FileText
  return <Icon {...props} />
}
