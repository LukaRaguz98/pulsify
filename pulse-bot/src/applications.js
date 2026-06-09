// Applications System (bot side, pure helpers) — PULSIFY-43.
//
// Applications are the CHANNEL-LESS upgrade of the old "Application" ticket
// type: a member picks what they're applying for, writes details, and submits —
// the submission is stored in `ticket_applications` and reviewed in Pulsify,
// with NO Discord channel created. The interaction wiring lives in tickets.js
// (it already owns the ticket config cache + the Components V2 helpers); this
// module holds the framework-free pieces the bot needs.
//
// The TYPE catalog, statuses and custom_id scheme MIRROR
// pulsify-web-app/lib/applications.ts. Keep the two in sync (same as
// tickets.js ↔ lib/tickets.ts).

// ── Statuses ────────────────────────────────────────────────────────────────
const APPLICATION_STATUS_META = {
  pending:    { label: "Pending review",  emoji: "🕓" },
  approved:   { label: "Approved",        emoji: "✅" },
  rejected:   { label: "Rejected",        emoji: "⛔" },
  needs_info: { label: "Needs more info", emoji: "❓" },
};

// ── Types ─────────────────────────────────────────────────────────────────────
const OTHER_TYPE_ID = "other";
const OTHER_TYPE = {
  id: OTHER_TYPE_ID,
  label: "Other",
  emoji: "✨",
  description: "Something else — tell us what.",
  enabled: true,
};

const DEFAULT_APPLICATION_TYPES = [
  { id: "staff",        label: "Staff",        emoji: "🛡️", enabled: true, description: "Join the staff team." },
  { id: "moderator",    label: "Moderator",    emoji: "🔨", enabled: true, description: "Help moderate the community." },
  { id: "partner",      label: "Partner",      emoji: "🤝", enabled: true, description: "Partner your server or project." },
  { id: "creator",      label: "Creator",      emoji: "🎨", enabled: true, description: "Apply as a content creator." },
  { id: "support-team", label: "Support Team", emoji: "🎧", enabled: true, description: "Help members in support." },
  { id: "event-team",   label: "Event Team",   emoji: "🎉", enabled: true, description: "Run and host community events." },
];

const APPLICATION_LIMITS = {
  maxTypes: 24,
  maxMessageLength: 2000,
  maxCustomTypeLength: 80,
};

function slugify(s) {
  return (
    String(s || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "type"
  );
}

/** Coerce a raw catalog (config.application_types) into a safe type array. */
function normaliseApplicationTypes(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_APPLICATION_TYPES.map((t) => ({ ...t }));
  }
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (!label) continue;
    const id = item.id ? slugify(item.id) : slugify(label);
    if (!id || id === OTHER_TYPE_ID || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: label.slice(0, 60),
      emoji: typeof item.emoji === "string" ? item.emoji.slice(0, 8) : undefined,
      description: typeof item.description === "string" ? item.description.slice(0, 100) : undefined,
      enabled: item.enabled === undefined ? true : Boolean(item.enabled),
    });
    if (out.length >= APPLICATION_LIMITS.maxTypes) break;
  }
  return out.length > 0 ? out : DEFAULT_APPLICATION_TYPES.map((t) => ({ ...t }));
}

/** Enabled catalog types + the built-in "Other" — the options shown in Discord. */
function selectableTypes(types) {
  return [...types.filter((t) => t.enabled), { ...OTHER_TYPE }];
}

function typeLabel(types, id) {
  if (id === OTHER_TYPE_ID) return OTHER_TYPE.label;
  const found = types.find((t) => t.id === id);
  return found ? found.label : id;
}

// ── Interaction custom_ids (mirror lib/applications.ts) ──────────────────────
const APL = "apl";
const APPLICATION_SELECT_ID = `${APL}:type`;
const applicationModalId = (typeId) => `${APL}:form:${typeId}`;
const APPLICATION_FIELD_MESSAGE = "message";
const APPLICATION_FIELD_CUSTOM_TYPE = "custom_type";

module.exports = {
  APPLICATION_STATUS_META,
  OTHER_TYPE_ID,
  OTHER_TYPE,
  DEFAULT_APPLICATION_TYPES,
  APPLICATION_LIMITS,
  normaliseApplicationTypes,
  selectableTypes,
  typeLabel,
  slugify,
  APL,
  APPLICATION_SELECT_ID,
  applicationModalId,
  APPLICATION_FIELD_MESSAGE,
  APPLICATION_FIELD_CUSTOM_TYPE,
};
