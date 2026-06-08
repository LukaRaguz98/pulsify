/**
 * Pulse Guard multilingual evaluation harness (PULSIFY-41).
 *
 * Runs a labelled corpus through the DETERMINISTIC heuristic layer
 * (`analyzeContent` with `heuristicsOnly`) so we can measure precision / recall
 * across languages without needing the LLM provider. Cases that genuinely need
 * the model are tagged `llmOnly` and reported separately, not counted as
 * heuristic failures.
 *
 * Run:  npx tsx scripts/pulse-guard-eval.ts
 *   or  npx tsc scripts/pulse-guard-eval.ts lib/ai-moderation.ts --outDir .tmp \
 *         --module nodenext --moduleResolution nodenext --target es2022 && \
 *       node .tmp/scripts/pulse-guard-eval.js
 */

import {
  analyzeContent,
  DEFAULT_AI_MODERATION_SETTINGS,
  type AIModerationSettings,
  type CategoryId,
} from '../lib/ai-moderation'

type Case = {
  lang: string
  text: string
  /** Expected: should this be flagged as a violation by HEURISTICS alone? */
  violation: boolean
  /** Expected top category when it should violate. */
  category?: CategoryId
  /** True = needs the LLM; a heuristic miss here is acceptable (reported only). */
  llmOnly?: boolean
  note?: string
}

// All detectors on, balanced sensitivity — the default a server gets.
const SETTINGS: AIModerationSettings = {
  ...DEFAULT_AI_MODERATION_SETTINGS,
  enabled: true,
  sensitivity: 'medium',
}

const CASES: Case[] = [
  // ── BENIGN — must NOT flag (false-positive guard), many languages ──────────
  { lang: 'en', text: 'Hey, anyone up for ranked tonight around 8?', violation: false },
  { lang: 'hr', text: 'Zašto mi je jučer Mario spamao u dm?', violation: false, note: 'mentions "spam"' },
  { lang: 'hr', text: 'Ja sam admin, kako vam mogu pomoći?', violation: false, note: 'real admin' },
  { lang: 'en', text: 'I am admin, how can I help you?', violation: false, note: 'real admin' },
  { lang: 'hr', text: 'Je li ovo prevara? Pazite na takve poruke.', violation: false, note: 'warning about scam' },
  { lang: 'en', text: 'Is this a scam? Be careful with these links.', violation: false },
  { lang: 'es', text: '¿Alguien quiere jugar una partida esta noche?', violation: false },
  { lang: 'de', text: 'Hat jemand Lust heute Abend zu zocken?', violation: false },
  { lang: 'fr', text: 'Quelqu’un veut faire une partie ce soir ?', violation: false },
  { lang: 'pt', text: 'Alguém quer jogar uma ranked hoje à noite?', violation: false },
  { lang: 'ru', text: 'Кто-нибудь хочет поиграть сегодня вечером?', violation: false },
  { lang: 'tr', text: 'Bu akşam oynamak isteyen var mı?', violation: false },
  { lang: 'en', text: 'spam', violation: false, note: 'bare topic word' },
  { lang: 'en', text: 'The word essex and class are fine here.', violation: false, note: 'substring traps' },
  { lang: 'hr', text: 'Možeš li mi poslati domaću zadaću kasnije?', violation: false, note: '"poslati" not phishing' },
  { lang: 'en', text: 'Check out my project at github.com/me/cool-repo', violation: false, note: 'legit link' },
  { lang: 'en', text: 'Join our book club: discord.gg/readers', violation: false, note: 'single legit invite' },
  // Benign stress tests for the new multilingual lexicons (must NOT flag).
  { lang: 'en', text: 'I got free shipping on my order today, nice!', violation: false, note: 'free + no reward' },
  { lang: 'en', text: 'nitro is a great perk honestly, I love the perks', violation: false, note: 'reward + no free' },
  { lang: 'de', text: 'Ich muss noch Geld verdienen diese Woche.', violation: false, note: 'earn money, legit' },
  { lang: 'es', text: 'La versión gratis es suficiente para mí', violation: false, note: 'free, no reward' },
  { lang: 'en', text: 'My homework is about Essex and classical music', violation: false, note: 'substring traps' },
  { lang: 'hr', text: 'Možeš li mi poslati screenshot kasnije?', violation: false, note: 'send screenshot, legit' },

  // ── SCAM — multilingual ────────────────────────────────────────────────────
  { lang: 'en', text: 'CLAIM YOUR FREE DISCORD NITRO NOW — only 50 spots left! Act now!', violation: true, category: 'scam' },
  { lang: 'hr', text: 'BESPLATNI NITRO za prvih 50 ljudi! Preuzmi odmah dok traje akcija!', violation: true, category: 'scam' },
  { lang: 'es', text: '¡NITRO GRATIS para los primeros 100! Reclama tu premio ahora.', violation: true, category: 'scam' },
  { lang: 'de', text: 'KOSTENLOSES NITRO geschenkt! Hol dir dein Geschenk, nur heute!', violation: true, category: 'scam' },
  { lang: 'fr', text: 'NITRO GRATUIT pour les 50 premiers ! Réclame ton cadeau maintenant.', violation: true, category: 'scam' },
  { lang: 'pt', text: 'NITRO GRÁTIS para os primeiros 100! Resgate seu prêmio agora.', violation: true, category: 'scam' },
  { lang: 'en', text: 'Double your crypto! Guaranteed profit, connect your wallet to claim.', violation: true, category: 'scam' },
  { lang: 'hr', text: 'Udvostruči svoj novac! Zagarantirana zarada, samo poveži novčanik.', violation: true, category: 'scam', llmOnly: true },

  // ── PHISHING / malicious links — structural, language-agnostic ─────────────
  { lang: 'en', text: 'Your account was suspended. Verify your account here: https://discrod-gift.com/login', violation: true, category: 'phishing' },
  { lang: 'hr', text: 'Tvoj račun je suspendiran, verificiraj se odmah: https://discord-nitro.tk/verify', violation: true, category: 'phishing' },
  { lang: 'de', text: 'Klick hier um dein Konto zu bestätigen: http://steamcommunlty.com/gift', violation: true, category: 'phishing' },
  { lang: 'es', text: 'Mira esto bit.ly/3xKf9 te regalan nitro', violation: true, category: 'scam' },
  { lang: 'en', text: 'free stuff here: http://192.168.10.5/claim', violation: true, category: 'suspicious_link' },
  { lang: 'en', text: 'visit http://xn--80ak6aa92e.com for a surprise', violation: true, category: 'phishing' },

  // ── IMPERSONATION — claim + manipulation ───────────────────────────────────
  { lang: 'en', text: "I'm from Discord staff. Verify your account or you will be banned.", violation: true, category: 'impersonation' },
  { lang: 'hr', text: 'Ja sam Discord osoblje. Pošalji mi svoju lozinku ili će ti račun biti obrisan odmah.', violation: true, category: 'impersonation', llmOnly: true },
  { lang: 'en', text: "I'm an admin — DM me your password to verify your account right now.", violation: true, category: 'impersonation' },

  // ── MASS MENTION / spam structural — language-agnostic ─────────────────────
  { lang: 'en', text: '@everyone @everyone LOOK AT THIS @user1 @user2 @user3 @user4 @user5', violation: true, category: 'mention_flood' },
  { lang: 'hr', text: 'aaaaaaaaaaaaaaaaaaaaaaaa kupi kupi kupi kupi kupi kupi', violation: true, category: 'spam' },
  { lang: 'multi', text: 'JOIN JOIN JOIN JOIN JOIN discord.gg/scammers FREE ROBUX', violation: true },

  // ── TOXICITY — slurs / self-harm (worst, unambiguous) ──────────────────────
  { lang: 'en', text: 'kys you worthless r3tard, nobody likes you', violation: true, category: 'toxicity' },
  { lang: 'hr', text: 'ubij se smeće jedno, nitko te ne želi ovdje', violation: true, category: 'toxicity', llmOnly: true },
  { lang: 'es', text: 'eres un idiota, mátate', violation: true, category: 'toxicity', llmOnly: true },

  // ── NSFW — multilingual keyword ────────────────────────────────────────────
  { lang: 'en', text: 'check my onlyfans for leaked nudes', violation: true, category: 'nsfw' },
  { lang: 'hr', text: 'evo gole slike i porno na mom profilu', violation: true, category: 'nsfw' },
]

function pad(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n)
}

async function main() {
  let pass = 0
  let fail = 0
  let llmMiss = 0
  const failures: string[] = []

  for (const c of CASES) {
    const v = await analyzeContent(c.text, SETTINGS, { heuristicsOnly: true })
    const gotViolation = v.violates
    const gotCategory = v.topCategory
    let ok: boolean
    if (c.violation) {
      ok = gotViolation && (!c.category || gotCategory === c.category)
    } else {
      ok = !gotViolation
    }

    if (ok) {
      pass++
    } else if (c.violation && c.llmOnly && !gotViolation) {
      llmMiss++ // acceptable: needs the model
    } else {
      fail++
      failures.push(
        `[${pad(c.lang, 5)}] want=${c.violation ? c.category ?? 'violation' : 'clean'} ` +
          `got=${gotViolation ? gotCategory : 'clean'} (${Math.round(v.confidence * 100)}%) :: ${c.text}`,
      )
    }
  }

  console.log('── Pulse Guard heuristic eval ─────────────────────────────')
  console.log(`PASS ${pass}/${CASES.length}   FAIL ${fail}   (LLM-only misses, not counted: ${llmMiss})`)
  if (failures.length) {
    console.log('\nFailures:')
    for (const f of failures) console.log('  ✗ ' + f)
  } else {
    console.log('\nAll heuristic-testable cases passed. ✓')
  }
  process.exit(fail > 0 ? 1 : 0)
}

main()
