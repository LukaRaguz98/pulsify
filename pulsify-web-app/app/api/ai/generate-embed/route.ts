import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { rateLimitMessage } from '@/lib/ai-rate-limit'

const AI_BASE_URL = process.env.AI_BASE_URL ?? 'https://api.groq.com/openai/v1'
const AI_MODEL    = process.env.AI_MODEL    ?? 'llama-3.1-8b-instant'

const TONE_DESCRIPTIONS: Record<string, string> = {
  professional: 'Formal, polished, business-appropriate language. No slang.',
  gaming:       'Energetic, enthusiastic. Gamer culture references are welcome.',
  community:    'Warm, inclusive language that emphasises belonging and mutual support.',
  friendly:     'Casual and upbeat. 1-2 emojis welcome.',
}

const SERVER_SIZE_HINTS: Record<string, string> = {
  small:  'Small community (< 100 members) — keep it personal and concise.',
  medium: 'Mid-size server (100–1 000 members) — balanced, structured but approachable.',
  large:  'Large community (1 000+ members) — clear, professional, comprehensive.',
}

const CONTENT_DEPTH_HINTS: Record<string, string> = {
  brief:    'Keep the message short — 1-2 sentences.',
  standard: 'Balanced length — 2-3 sentences.',
  detailed: 'Rich but still compact — 2-3 detailed sentences.',
}

// A greeting is a title and a message, nothing more (see buildMemberV2Container
// in the bot's index.js) — so there is nothing else to generate here.
const VARIANTS = {
  welcome: {
    system:    'Generate a Discord welcome message config.',
    intro:     'Generate a Discord welcome message for a server, shown when a new member JOINS.',
    titleHint: 'Welcome title (use {server} placeholder, max 50 chars)',
    descHint:  'Warm welcome body. Use {user} for the member name and {server} for server name.',
    note:      'This is a WELCOME message — make it inviting and point new members in the right direction.',
  },
  goodbye: {
    system:    'Generate a Discord goodbye message config for when a member leaves.',
    intro:     'Generate a Discord goodbye message for a server, shown when a member LEAVES.',
    titleHint: 'Goodbye title (use {server} placeholder, max 50 chars)',
    descHint:  'Warm but brief farewell. Use {user} for the member name and {server} for server name.',
    note:      'This is a GOODBYE message — keep it warm, gracious and brief. Do NOT welcome anyone or list onboarding steps.',
  },
} as const

type VariantKey = keyof typeof VARIANTS

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.AI_API_KEY) {
    return NextResponse.json({ error: 'AI provider not configured.' }, { status: 503 })
  }

  const body = await req.json() as {
    guildId: string
    guildName: string
    description: string
    tone: string
    customTone?: string
    language?: string
    embedColor?: string
    serverSize?: string
    contentDepth?: string
    includeEmojis?: boolean
    variant?: VariantKey
  }
  const { guildName, description, tone, customTone = '', language = 'english', embedColor, serverSize = 'medium', contentDepth = 'standard', includeEmojis = true, variant = 'welcome' } = body
  if (!description?.trim()) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  const v = VARIANTS[variant] ?? VARIANTS.welcome

  const toneDesc = tone === 'other' && customTone
    ? `Custom style: "${customTone}". Match this vibe closely.`
    : (TONE_DESCRIPTIONS[tone] ?? TONE_DESCRIPTIONS.friendly)

  const accentColor = embedColor ?? '#6366f1'

  const systemPrompt = `You are a Discord server setup assistant. ${v.system} Respond with a valid JSON object only — no markdown, no code fences, no explanation.`

  const userPrompt = `${v.intro}

Server name: ${guildName}
Description: ${description}
Tone: ${tone} — ${toneDesc}
Language: Write ALL text in ${language}. Use native phrasing.
Server size: ${SERVER_SIZE_HINTS[serverSize] ?? SERVER_SIZE_HINTS.medium}
Content depth: ${CONTENT_DEPTH_HINTS[contentDepth] ?? CONTENT_DEPTH_HINTS.standard}
Emojis: ${includeEmojis ? 'Include relevant emojis naturally.' : 'Do NOT use any emojis — plain text only.'}
Accent color: ${accentColor} — use this exact hex for the "color" field.
${v.note}

Respond with this exact JSON structure and nothing else:
{
  "color": "${accentColor}",
  "title": "${v.titleHint}",
  "description": "${v.descHint}"
}

Requirements:
- color: must be exactly "${accentColor}"
- title: must include {server}, max 50 characters total
- description: must use {user} and {server} placeholders`

  const aiRes = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.AI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 800,
      temperature: 0.85,
    }),
  })

  if (!aiRes.ok) {
    if (aiRes.status === 429) {
      return NextResponse.json({ error: rateLimitMessage() }, { status: 429 })
    }
    const err = await aiRes.json().catch(() => ({})) as { error?: { message?: string } }
    return NextResponse.json(
      { error: err.error?.message ?? 'AI generation failed.' },
      { status: 500 },
    )
  }

  const aiData = await aiRes.json() as { choices: { message: { content: string } }[] }
  const rawText = aiData.choices?.[0]?.message?.content ?? ''

  let result
  try {
    result = JSON.parse(rawText) as {
      color: string
      title: string
      description: string
    }
  } catch {
    return NextResponse.json({ error: 'AI returned an invalid response. Please try again.' }, { status: 500 })
  }

  // Enforce user's chosen accent color regardless of what AI returned
  result.color = accentColor

  return NextResponse.json({ result })
}
