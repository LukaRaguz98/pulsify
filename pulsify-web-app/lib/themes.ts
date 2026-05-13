export type ThemeId = 'violet' | 'blue' | 'emerald' | 'rose'

export interface Theme {
  id: ThemeId
  name: string
  description: string
  accent: string
}

export const THEMES: Theme[] = [
  {
    id: 'violet',
    name: 'Violet',
    description: 'Deep violet — the default Pulsify look',
    accent: '#8b5cf6',
  },
  {
    id: 'blue',
    name: 'Midnight',
    description: 'Cool blue tones with a deep navy base',
    accent: '#3b82f6',
  },
  {
    id: 'emerald',
    name: 'Emerald',
    description: 'Fresh green for a nature-inspired feel',
    accent: '#10b981',
  },
  {
    id: 'rose',
    name: 'Rose',
    description: 'Bold rose red with warm dark tones',
    accent: '#f43f5e',
  },
]
