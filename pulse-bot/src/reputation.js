// Member reputation scoring (bot side).
//
// MIRRORS pulsify-web-app/lib/reputation.ts — keep the math in sync so a
// member's score is identical on the dashboard and in the /profile embed. A
// reputation is a deterministic 0-100 score from account age + server tenure,
// participation (messages, voice, commands, channels, roles) and moderation
// history (warnings/timeouts/kicks/bans subtract). Nothing is stored — it's
// computed on the fly from the same inputs the profile already loads.

function clamp01(n) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// Diminishing-returns curve: maps a raw count to 0..1, hitting ~1 at `full`.
function logScale(value, full) {
  if (value <= 0) return 0;
  return clamp01(Math.log10(value + 1) / Math.log10(full + 1));
}

function tierForScore(score) {
  if (score >= 80) return "Trusted";
  if (score >= 60) return "Established";
  if (score >= 40) return "Active";
  if (score >= 20) return "Newcomer";
  return "At risk";
}

/**
 * Compute a member's reputation. Positive components sum to ~85 on top of a
 * 15-point baseline; infractions subtract. Result clamped to 0-100. Returns the
 * score plus a human-readable tier label.
 */
function computeReputation(input) {
  const baseline = 15;
  const age = clamp01((input.accountAgeDays ?? 0) / 365) * 15;
  const tenure = clamp01((input.tenureDays ?? 0) / 180) * 15;
  const messages = logScale(input.messages ?? 0, 1000) * 30;
  const voice = clamp01((input.voiceSeconds ?? 0) / (50 * 3600)) * 10;
  const engagement =
    clamp01((input.activeChannels ?? 0) / 10) * 5 + logScale(input.commands ?? 0, 50) * 5;
  const roles = clamp01((input.assignableRoles ?? 0) / 3) * 5;

  const penalty =
    (input.warnings ?? 0) * 8 +
    (input.timeouts ?? 0) * 6 +
    (input.kicks ?? 0) * 15 +
    (input.bans ?? 0) * 40;

  const raw = baseline + age + tenure + messages + voice + engagement + roles - penalty;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, tier: tierForScore(score) };
}

/** Days between a past epoch-ms timestamp and now (floored, never negative). */
function daysSince(ms) {
  if (!ms) return 0;
  const diff = Date.now() - ms;
  return diff <= 0 ? 0 : Math.floor(diff / 86_400_000);
}

module.exports = { computeReputation, tierForScore, daysSince, logScale, clamp01 };
