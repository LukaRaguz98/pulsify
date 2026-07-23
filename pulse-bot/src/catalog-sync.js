// Command catalog → Supabase sync (PULSIFY-61).
//
// The bot owns the command catalog (src/commands.js). This pushes it into the
// `command_catalog` table on startup so the dashboard's Command Center can
// render what the RUNNING bot actually serves — command list, category, module
// association, required permission level and plan — instead of a hand-mirrored
// copy that drifts (which is exactly what happened to lib/commands.ts).
//
// Enabled/disabled state is NOT synced here: that's per-guild and already lives
// in `command_configs`. This table is the guild-agnostic "what Pulse offers"
// half; the dashboard joins the two on command_name.
//
// The sync is idempotent and runs on every boot: a deploy that adds, changes or
// removes a command reconciles the table with no migration and no manual step.

const { COMMANDS } = require("./commands");

/**
 * Flatten a SlashCommandBuilder's options into the descriptor shape the
 * dashboard preview renders: { name, description, type, required }.
 *
 * Discord's option type is an integer enum; the dashboard speaks names
 * (lib/commands.ts CommandOptionType), so map it. SUB_COMMAND (1) and
 * SUB_COMMAND_GROUP (2) are containers rather than inputs — we flatten their
 * children up with a qualified name ("set month") so a subcommand-based command
 * like /birthday still shows its real arguments instead of an empty list.
 */
const OPTION_TYPE_NAMES = {
  3: "string",
  4: "integer",
  5: "boolean",
  6: "user",
  7: "channel",
  8: "role",
  9: "mentionable",
  10: "number",
  11: "attachment",
};

function flattenOptions(options, prefix = "") {
  const out = [];
  for (const opt of options ?? []) {
    const qualified = prefix ? `${prefix} ${opt.name}` : opt.name;
    if (opt.type === 1 || opt.type === 2) {
      // A subcommand (group). Record it so the preview lists the subcommand
      // itself, then flatten its own options underneath.
      out.push({
        name: qualified,
        description: opt.description ?? "",
        type: "subcommand",
        required: false,
      });
      out.push(...flattenOptions(opt.options, qualified));
      continue;
    }
    out.push({
      name: qualified,
      description: opt.description ?? "",
      type: OPTION_TYPE_NAMES[opt.type] ?? "string",
      required: Boolean(opt.required),
    });
  }
  return out;
}

/** One catalog entry → one `command_catalog` row. */
function toRow(def, syncedAt) {
  const json = def.data.toJSON();
  return {
    command_name: def.name,
    description: json.description ?? "",
    category: def.category ?? "utility",
    module: def.module ?? null,
    // The catalog authors 'everyone'; the DB stores it verbatim so the
    // dashboard's existing permission_level vocabulary keeps working.
    default_permission: def.defaultPermission ?? "everyone",
    default_ephemeral: def.defaultEphemeral !== false,
    min_plan: def.minPlan ?? "free",
    options: flattenOptions(json.options),
    examples: def.examples ?? [],
    detail: def.detail ?? "",
    synced_at: syncedAt,
  };
}

/**
 * Upsert every catalog entry and delete rows for commands the bot no longer
 * defines, so a removed command disappears from the Command Center.
 *
 * Best-effort: a failure here must NOT stop the bot from starting. The
 * dashboard falls back to its static catalog when the table is empty or stale,
 * and commands still register and run regardless — this table is a projection
 * for the UI, never the thing that makes a command work.
 */
async function syncCatalog(supabase) {
  const syncedAt = new Date().toISOString();
  const rows = COMMANDS.map((def) => toRow(def, syncedAt));

  // Defensive: an empty catalog would make the prune below `not in ()` — a
  // syntax error at best, and "delete everything Pulse offers" at worst. A
  // build with no commands is a bug, not an instruction to wipe the table.
  if (rows.length === 0) {
    console.warn("[Pulse] Command catalog is empty — skipping sync.");
    return { ok: false, error: "empty catalog" };
  }

  try {
    const { error } = await supabase
      .from("command_catalog")
      .upsert(rows, { onConflict: "command_name" });
    if (error) throw new Error(error.message);

    // Prune anything not in this build. Scoped by name rather than by
    // `synced_at < syncedAt` so two bot instances syncing concurrently can't
    // delete each other's freshly-written rows.
    const names = rows.map((r) => r.command_name);
    const { error: pruneError } = await supabase
      .from("command_catalog")
      .delete()
      .not("command_name", "in", `(${names.map((n) => `"${n}"`).join(",")})`);
    if (pruneError) throw new Error(pruneError.message);

    console.log(`[Pulse] Command catalog synced — ${rows.length} commands.`);
    return { ok: true, count: rows.length };
  } catch (err) {
    console.warn(
      "[Pulse] Command catalog sync failed (the dashboard will fall back to its static catalog):",
      err.message,
    );
    return { ok: false, error: err.message };
  }
}

module.exports = { syncCatalog, toRow, flattenOptions };
