// Copy the shared release notes into the bot package so they ship with it.
//
// The canonical notes live at the monorepo root (`resources/notes/vX.Y.Z.txt`)
// — the SAME files the web app parses. The bot, however, is deployed on its own
// (only the `pulse-bot/` folder travels to the host), so that root folder isn't
// reachable in production and `version.js` falls back to the minimal static
// list — which is why `/changelog` looked empty there.
//
// This script mirrors the root notes into `pulse-bot/resources/notes/`, the
// second candidate `version.js` already checks (`../resources/notes`). Those
// copies are committed, so they travel with the bot automatically. Run it
// whenever the root notes change (it's wired into `prestart`/`sync-notes`); if
// the root folder isn't present (e.g. on the production host) it no-ops cleanly.

const { mkdir, readdir, copyFile, readFile, writeFile, rm, stat } = require("node:fs/promises");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "..", "resources", "notes");
const DEST = path.join(__dirname, "..", "resources", "notes");
const NOTE_RE = /^v\d.*\.txt$/;

async function main() {
  let srcEntries;
  try {
    if (!(await stat(SRC)).isDirectory()) throw new Error("not a directory");
    srcEntries = await readdir(SRC);
  } catch {
    // No source folder reachable (standalone deploy) — nothing to sync.
    console.log("[sync-notes] root notes folder not found, skipping:", SRC);
    return;
  }

  await mkdir(DEST, { recursive: true });
  const wanted = srcEntries.filter((f) => NOTE_RE.test(f));

  // Drop stale copies that no longer exist at the source so the bot never
  // serves a renamed/removed release.
  const existing = (await readdir(DEST).catch(() => [])).filter((f) => NOTE_RE.test(f));
  const wantedSet = new Set(wanted);
  for (const f of existing) {
    if (!wantedSet.has(f)) await rm(path.join(DEST, f));
  }

  let copied = 0;
  for (const f of wanted) {
    const from = path.join(SRC, f);
    const to = path.join(DEST, f);
    // Only rewrite when content actually differs, to keep mtimes/git stable.
    const [next, prev] = await Promise.all([
      readFile(from, "utf8"),
      readFile(to, "utf8").catch(() => null),
    ]);
    if (next !== prev) {
      await copyFile(from, to);
      copied++;
    }
  }

  console.log(`[sync-notes] synced ${wanted.length} note(s) → ${DEST} (${copied} updated)`);
}

main().catch((err) => {
  // Never fail the build/start over notes syncing — the static fallback covers it.
  console.warn("[sync-notes] failed (non-fatal):", err.message);
});
