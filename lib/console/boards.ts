"use client";
// Per-board layout storage — one saved workspace per board, not one for all six.
//
// ── THE BUG THIS EXISTS TO FIX ───────────────────────────────────────────────
// `tn.console.v1` (lib/console/store) is a SINGLE slot holding whatever board is
// on screen. Reloading the page restored it correctly, so persistence looked like
// it worked. Switching boards did not: `applyPreset` rebuilt the target board from
// its hardcoded template and wrote that over the slot, so every drag, resize and
// removal the user had made was destroyed the moment they clicked another tab and
// came back.
//
// Measured before the fix, on the EARTH board: a card moved to {x:0,y:14,w:6,h:6}
// survived a reload, then came back as the template's {x:0,y:10,w:4,h:10} after a
// WORLD → EARTH round trip. Nothing warned the user; the cards simply moved.
//
// ── THE MODEL ────────────────────────────────────────────────────────────────
// Every board id — the six built-ins and any custom board — owns a slot here. A
// board is "clean" while it has no slot (it renders its template) and "edited"
// once the user touches it. That distinction is the whole feature: it is what
// lets a tab say it has been changed, and what lets "reset" mean something.
//
// `tn.console.v1` stays exactly as it was, still holding the live layout, so a
// reload keeps working through the same path it always did and this file cannot
// regress it. Existing users are migrated implicitly rather than by a version
// bump: their single saved layout is parked into its board's slot the first time
// they switch away from it (see `applyPreset`), so the board they were last on
// keeps their edits.

import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import { sanitizeLayout } from "@/lib/console/sanitize";
import type { ShellLayout } from "@/lib/console/types";

const KEY = "tn.console.boards.v1";
const VERSION = 1;

/** Board id → that board's saved workspace. */
type BoardArchive = Record<string, ShellLayout>;

/** Boards a person can plausibly accumulate before this is a storage problem.
 *  Six built-ins plus custom boards; the cap stops a runaway writer filling
 *  localStorage and taking every other persisted store down with it. */
const MAX_BOARDS = 40;

function read(): BoardArchive {
  const raw = loadPersisted<BoardArchive>(KEY, VERSION);
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

/**
 * A board's saved layout, or null if it has never been edited.
 *
 * Sanitised on the way out, never on the way in. What lands in localStorage is
 * already a live ShellLayout this app produced, but what comes BACK is untrusted:
 * another tab, an older build, or a user with devtools can have written anything.
 * `sanitizeLayout` returning null for a corrupt slot is the desired outcome — the
 * caller falls back to the board's template, which is a working board.
 */
export function readBoardLayout(id: string): ShellLayout | null {
  const saved = read()[id];
  return saved ? sanitizeLayout(saved) : null;
}

/** Park a board's layout under its id. Called on every layout change for the
 *  active board, so it must stay cheap and must never throw — `savePersisted`
 *  already swallows quota errors. */
export function writeBoardLayout(id: string, layout: ShellLayout): void {
  if (!id) return;
  const archive = read();
  // Only refuse NEW ids past the cap. Overwriting a board that already has a slot
  // must always work, or the user whose storage is full silently stops being saved.
  if (!(id in archive) && Object.keys(archive).length >= MAX_BOARDS) return;
  archive[id] = layout;
  savePersisted(KEY, VERSION, archive);
}

/** Drop a board's edits so it renders its template again. This is "reset". */
export function forgetBoardLayout(id: string): void {
  const archive = read();
  if (!(id in archive)) return;
  delete archive[id];
  savePersisted(KEY, VERSION, archive);
}

/** Has this board been edited away from its template? Drives the tab's dot. */
export function isBoardEdited(id: string): boolean {
  return id in read();
}

/** Every edited board id — for a "reset all boards" action and for tests. */
export function editedBoardIds(): string[] {
  return Object.keys(read());
}

/**
 * A fingerprint of the ARRANGEMENT, for "is this board still its template?".
 *
 * Instance ids are excluded, and they have to be: `presets.ts` mints fresh ids from
 * a module-level counter on every `build()`, so the same board built twice is never
 * id-identical and an id-sensitive comparison would report every board as edited.
 * Widgets are compared as a sorted multiset because two boards holding the same
 * cards in the same rail slots are the same board however the array happens to be
 * ordered.
 *
 * THE TRAP THIS REPLACED: this used to fingerprint `w.rect` and `l.stageRect`.
 * Once rects left the type, that would have made every board compare unequal to
 * itself forever — the customised dot lighting on all seven built-ins the moment
 * they were opened, and Reset no longer meaning anything. `segment`/`order` are
 * the rail equivalent of position, `height` of size; `segments` (sizes and
 * collapsed state) is included at the top level because dragging a splitter is
 * exactly the kind of edit this signature exists to catch.
 */
export function layoutSignature(l: ShellLayout): string {
  const widgets = l.widgets
    .map((w) => JSON.stringify({ t: w.type, s: w.segment, o: w.order, h: w.height, c: w.collapsed, g: w.config }))
    .sort();
  return JSON.stringify({ stage: l.stage, segments: l.segments, widgets });
}
