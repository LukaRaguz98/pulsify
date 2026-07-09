"use strict";

// Single source of truth for the Pulse embed accent colour. The dashboard saves
// it to guild_settings.settings.embed_color (Server Settings › Pulse Assistant →
// Embed Appearance); every Pulse embed reads it from here so a server's brand
// colour is applied consistently across all embeds the bot posts.
//
// Semantic status colours (a closed poll's grey, a severity red, an explicit
// per-feature colour like a ticket panel) are NOT this — callers keep those and
// only use the guild accent as their brand/default colour.

const DEFAULT_HEX = "#8b5cf6"; // Pulsify violet
const DEFAULT_INT = 0x8b5cf6;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// Small TTL cache so hot paths (a poll vote re-render, a giveaway tick) don't
// hit the DB every time. Keyed by guildId.
const cache = new Map(); // guildId -> { hex, at }
const TTL_MS = 60_000;

async function readHex(supabase, guildId) {
  const cached = cache.get(guildId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.hex;
  let hex = DEFAULT_HEX;
  try {
    const { data } = await supabase
      .from("guild_settings")
      .select("settings")
      .eq("guild_id", guildId)
      .maybeSingle();
    const color = data?.settings?.embed_color;
    if (HEX_RE.test(color ?? "")) hex = color;
  } catch {
    // fall back to the default violet
  }
  cache.set(guildId, { hex, at: Date.now() });
  return hex;
}

/** The guild's accent as a `#rrggbb` hex string (default Pulsify violet). */
async function getGuildAccentHex(supabase, guildId) {
  return readHex(supabase, guildId);
}

/** The guild's accent as a Discord integer colour (default Pulsify violet). */
async function getGuildAccent(supabase, guildId) {
  const hex = await readHex(supabase, guildId);
  const int = parseInt(hex.replace("#", ""), 16);
  return Number.isNaN(int) ? DEFAULT_INT : int;
}

/** Drop a guild's cached accent (call after the colour is changed). */
function invalidateGuildAccent(guildId) {
  cache.delete(guildId);
}

module.exports = {
  getGuildAccent,
  getGuildAccentHex,
  invalidateGuildAccent,
  DEFAULT_ACCENT_INT: DEFAULT_INT,
  DEFAULT_ACCENT_HEX: DEFAULT_HEX,
};
