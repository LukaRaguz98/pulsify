// Shared shape of the Server Rules embed (Server › Onboarding › Server Rules).
// Lives here rather than in the server action because the client needs the same
// helpers to render an honest preview — and every export of a 'use server'
// module has to be an async action.

/** How the rules get posted — one combined embed, or a bare embed per rule. */
export type RulesLayout = 'single' | 'per_rule'

/** One rule in the `per_rule` layout. `title` is the embed's heading and may be
 *  empty, which posts the rule text on its own. */
export type RuleItem = { title: string; text: string }

/** Guard against a runaway list — 25 separate messages is already a lot. */
export const MAX_RULE_MESSAGES = 25

/**
 * Split the single-embed textarea into one entry per rule. Lines are the unit;
 * the numbering Pulse writes when it generates (`1. `, `2. `) and hand-typed
 * bullets are stripped, since a per-rule embed carries its own heading.
 */
export function parseRuleLines(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim().replace(/^(?:\d+[.)]|[-*•·])\s*/, '').trim())
    .filter((line) => line.length > 0)
}

/** Seed the per-rule list from the single-embed body — one untitled rule per
 *  line, so flipping the layout on existing content isn't a blank slate. */
export function ruleItemsFromContent(content: string): RuleItem[] {
  return parseRuleLines(content).map((text) => ({ title: '', text }))
}

/** Rules worth posting — a row with no text at all is dropped. */
export function usableRuleItems(items: RuleItem[]): RuleItem[] {
  return items.filter((item) => item.text.trim().length > 0)
}
