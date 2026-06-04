'use client'

import {
  LayoutTemplate,
  Gamepad2,
  Sparkles,
  LifeBuoy,
  Rocket,
  Users,
  Zap,
  Shield,
  ShieldAlert,
  Compass,
  Server,
  Gift,
  Megaphone,
  Award,
  Star,
  Crown,
  Boxes,
  GraduationCap,
  type LucideIcon,
} from 'lucide-react'

// Icon-by-name resolver for templates (sections, categories, template cards).
// Mirrors MilestoneIcon — lib/templates.ts references icons by lucide name so
// it stays JSX-free; the UI resolves them here.
const ICONS: Record<string, LucideIcon> = {
  LayoutTemplate,
  Gamepad2,
  Sparkles,
  LifeBuoy,
  Rocket,
  Users,
  Zap,
  Shield,
  ShieldAlert,
  Compass,
  Server,
  Gift,
  Megaphone,
  Award,
  Star,
  Crown,
  Boxes,
  GraduationCap,
}

export function TemplateIcon({ name, size = 16 }: { name: string; size?: number }) {
  const Icon = ICONS[name] ?? LayoutTemplate
  return <Icon size={size} />
}

/** Icon choices offered when creating/editing a template. */
export const TEMPLATE_ICON_CHOICES = [
  'LayoutTemplate',
  'Gamepad2',
  'Sparkles',
  'LifeBuoy',
  'Rocket',
  'Users',
  'Server',
  'Gift',
  'Megaphone',
  'Award',
  'Star',
  'Crown',
  'Boxes',
  'GraduationCap',
] as const
