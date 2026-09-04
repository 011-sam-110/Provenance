"use client";
import { createDefaultLayout, STAGE_ID, type ShellLayout } from "@/lib/console/types";
import { addWidget, arrangeBoard, setStage, setSegmentCollapsed, setSegmentSize, setWidgetHeight } from "@/lib/console/reducers";
import { splitSpan } from "@/lib/terminal/rails";
import { GAP_PX, ROW_PX } from "@/lib/terminal/layoutGrid";
import { visibleShell } from "@/lib/terminal/rowBudget";
import { shellLayoutStore } from "@/lib/console/store";
import { layersStore, type LayerKey } from "@/lib/layers";
import { signalsStore } from "@/lib/signals/store";
import { layersForLayout } from "@/lib/console/presetLayers";
import { activePresetStore } from "@/lib/console/activePreset";
import { forgetBoardLayout, isBoardEdited, layoutSignature, readBoardLayout, writeBoardLayout } from "@/lib/console/boards";
import { sanitizeLayout } from "@/lib/console/sanitize";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";

// A preset is a persona: a curated workspace aimed at ONE kind of user. `blurb` is the
// short "who it's for" tag surfaced next to the title in the ⌘K Profiles section, so the
// list reads as an audience menu rather than a pile of domains.
export interface ConsolePreset {
  id: string;
  title: string;
  icon: string;
  blurb: string;
  /** Signal layers this board lights ON THE MAP without spending a card on each.
   *  For boards whose cards are merged lists rather than one card per source —
   *  without it the Brief board's map would show nothing but camera pins. */
  mapSignals?: string[];
  /** Core layers this board lights ON THE MAP without spending a card on each —
   *  the `mapSignals` idea applied to cameras/planes/satellites/webcams. Needed
   *  because a core layer is otherwise only ever implied by a widget, and webcams
   *  has no widget to imply it. */
  mapCore?: LayerKey[];
  /** `shell` is the workspace box the board is composed against — see the note
   *  on WEIGHTS below. Defaults to DEFAULT_SHELL so tests and any off-DOM caller
   *  still get a real board. It was a row COUNT until the grid was deleted; it is
   *  a px box now, because a rail's cards are sized in px and there is no row
   *  pitch left to divide by. */
  build(shell?: { w: number; h: number }): ShellLayout;
}

/** The workspace box a board is composed against when nobody measured one — an
 *  off-DOM caller, a unit test, SSR. Matches `rowBudget.ts`'s own fallback, and
 *  the two are the same measurement of the same element. */
const DEFAULT_SHELL = { w: 1440, h: 820 };

/** The board a fresh visitor lands on (ConsoleShell first-run seed + "Reset to default"). */
export const DEFAULT_PRESET_ID = "overview";

// ── WEIGHTS, AND WHY BOARDS ARE AUTHORED THIS WAY NOW ────────────────────────
//
// A board used to be authored as "these widgets, in the left / right / bottom
// segment", and `seedRectsFromSegments` turned that into three stacks of identical
// 10-row cards. Two things were measured in the running app at 1440x900:
//
//   .tn-cw-shell (the band the board lives in)   clientHeight   820px
//   .tn-seg      (the board)                     scrollHeight  1249px
//
// — and the band is `overflow: hidden` while the grid carries an inline min-height
// equal to its own content, so the grid never overflows itself and its own
// `overflow: auto` never engages. Setting scrollTop on it does nothing. So 429px,
// a THIRD of the board, was clipped and genuinely unreachable: the Headlines card
// on this board sat at rows 40-50 and never drew at all. The second effect was a
// ~470x400px empty rectangle under the 4-column map — larger in area than the map.
//
// Both are gone TWICE OVER now, and the second time is structural. A board
// declares cards in PRIORITY order with a WEIGHT, and `composeRail` fits them to
// the measured shell beside a map that runs the full height of the board. But
// the clipping above cannot recur even if that fitting is wrong, because the
// RAIL ITSELF SCROLLS: a board too tall for the window is a scroll, not a card
// nobody can reach. The measurement is now about opening in good shape rather
// than about staying inside a hard ceiling.
//
// Weight is a claim about attention, not size:
//
//   3 — the card this board exists for. First thing the eye should land on.
//   2 — a card that is read.
//   1 — a card that is checked. Lands at the floor: a header and a line. That is
//       the right size for a feed that is usually empty or key-gated (ACLED,
//       floods), and it is deliberate — a dormant feed used to hold a full 250px
//       card to say "Nothing in World.", on the most valuable slot of the board.
//
// THE SIXTH-CARD OVERFLOW IS GONE. Cards past the sixth used to dock in a strip
// beneath the map, because a rail could not scroll and card seven had to go
// somewhere. Card seven now goes under card six, which is where someone looking
// for it would look.

let seed = 0;
const id = () => `p${(seed += 1).toString(36)}`;

interface CardSpec {
  type: string;
  weight: number;
  /** Seed config for this card. Without it a preset can only place EMPTY widgets —
   *  addWidget already accepts `config`, compose just never passed it, so every
   *  built-in board shipped `config: {}` and a board could not open pre-filled. */
  config?: Record<string, unknown>;
}

/** A standard board's left rail, in px. Matches `createDefaultLayout`, so a
 *  built-in board and a board built by hand from an empty console agree. */
const RAIL_PX = 320;

/** The map dock's width on a wall board, when it is open. Wider than RAIL_PX
 *  because it holds a MAP with its own search, zoom and scope controls, not a
 *  column of cards — and it is only ever on screen when the user asked for it. */
const WALL_DOCK_PX = 400;

/** No card is composed shorter than this. A card below it is a header and a
 *  clipped first row, which reads as broken rather than as small. */
const MIN_CARD_PX = 120;

/**
 * Build a board: every card in the left rail, in priority order, with the
 * weights spent on HEIGHT.
 *
 * ── THE WEIGHT VOCABULARY SURVIVED THE GRID; ITS UNITS DID NOT ──────────────
 * A weight has always been a claim about attention rather than about size, and
 * that claim is unchanged (3 = the card this board exists for, 2 = a card that
 * is read, 1 = a card that is checked). What changed is what it buys: it used
 * to buy grid ROWS from `arrangeHouse`, and now it buys PIXELS from
 * `splitSpan`, which moved into `lib/terminal/rails.ts` unchanged for exactly
 * this caller. Same proportions, same exact-total guarantee, same absorb-the-
 * rounding-drift-into-the-largest-card rule.
 *
 * There is no longer an overflow into a bottom dock past the sixth card, and
 * that deletion is the point rather than a simplification: `RAIL_CAPACITY`
 * existed because a rail could not scroll, so card seven had to go somewhere.
 * A rail scrolls now. Card seven goes under card six, where a reader looking
 * for it would look.
 */
function compose(stage: ShellLayout["stage"], shell: { w: number; h: number }, cards: CardSpec[]): ShellLayout {
  return composeRail(stage, shell, cards, RAIL_PX);
}

/**
 * A CAMERA WALL board — `mode: "wall"`, and the only shape that uses it.
 *
 * ── WHAT THIS WAS BETWEEN #146 AND NOW ─────────────────────────────────────
 * A wider rail. #146 turned the wall into `composeRail(..., 480)`, so Streets
 * opened as ONE VERTICAL COLUMN of camera cards beside the map — a list, not a
 * wall — and the note left here said its final shape was a separate job. This
 * is that job.
 *
 * The tiles are laid out by `arrangeWall` on the twelve-column grid and the map
 * moves into a dock that opens closed. WEIGHTS DO NOTHING HERE and are left
 * equal to say so: `arrangeWall` tiles uniform 4-column cards and takes no
 * weights at all. A board that wants a hero tile gets one by the user dragging
 * it, which is the entire point of the mode.
 *
 * ── THE COMMENT THIS REPLACED, KEPT FOR ITS FACTS ──────────────────────────
 * It recorded that `arrangeHouse` hardcoded a 4-of-12-column rail and that,
 * measured at 1400px, that rail gave camera cards aspect ratios from 2.68 to
 * 6.30 — nowhere near the 16:9 a camera frame actually is, so a board whose
 * whole purpose is showing pictures showed letterboxed slivers. That
 * measurement is why a wall tile is 4 columns wide and three across, and it is
 * the reason this is a grid rather than a wider rail.
 *
 * ── THE TILE'S OWN MEASUREMENTS, WHICH THIS HAS TO RESPECT ─────────────────
 * The camslot overlay needs a stage of at least 300x170 CSS px for its full
 * two-row readout, 240x135 for the compact one, and hides itself below 90px.
 * A 4-column tile on a 1440px board is ~355px wide and 6 rows is 144px, so the
 * OPENING size clears the compact threshold and a user who wants the full
 * readout drags the tile bigger — which is a thing they can now do, and could
 * not before.
 */
function composeWall(stage: ShellLayout["stage"], shell: { w: number; h: number }, cards: CardSpec[]): ShellLayout {
  let l: ShellLayout = { ...setStage(createDefaultLayout(), stage), mode: "wall" };

  // `mode` is set BEFORE the widgets go in, and that ordering is load-bearing:
  // `addWidget` mints a rect only on a wall, so seeding first and flipping the
  // mode afterwards would produce four tiles with no rects — mounted, holding
  // their configs, drawing nothing.
  for (const c of cards) {
    l = addWidget(l, c.type, id(), {
      segment: "left",
      ...(c.config ? { config: c.config } : {}),
    });
  }

  // Then lay them out properly. `addWidget` places each tile in the first free
  // cell it finds, which packs them but takes no view on how tall a band should
  // be; `arrangeWall` fits the bands to the window this board is opening on.
  l = arrangeBoard(l, Math.floor(shell.h / (ROW_PX + GAP_PX)));

  // THE MAP DOCK OPENS CLOSED, and its width is remembered anyway. `collapsed`
  // is the open/closed flag and `size` is the width it returns to, so the first
  // click on the dock control gives a usable panel rather than a 220px sliver.
  l = setSegmentSize(l, "right", WALL_DOCK_PX);
  l = setSegmentCollapsed(l, "right", true);

  // `segments.left` is left at its default rather than zeroed. A wall does not
  // render rails at all, so the value is invisible here — but the tiles keep
  // `segment: "left"`, so it is the width they would land in if this board were
  // ever switched back to rails, and 0 would clamp to RAIL_MIN and mean nothing
  // anyway.
  return l;
}

function composeRail(
  stage: ShellLayout["stage"],
  shell: { w: number; h: number },
  cards: CardSpec[],
  railPx: number,
): ShellLayout {
  let l = setStage(createDefaultLayout(), stage);
  // `segment` is no longer legacy authoring input that something else overrides
  // — it IS the widget's position. Every built-in board opens with one rail; the
  // other two are empty and therefore take no space at all.
  for (const c of cards) {
    l = addWidget(l, c.type, id(), {
      segment: "left",
      ...(c.config ? { config: c.config } : {}),
    });
  }
  l = setSegmentSize(l, "left", railPx);

  // The rail scrolls, so this is a starting shape rather than a hard budget: it
  // is the height at which the board opens with everything visible on THIS
  // window, not a promise that it can never exceed it.
  const heights = splitSpan(cards.map((c) => c.weight), shell.h, MIN_CARD_PX);
  l.widgets.forEach((w, i) => { l = setWidgetHeight(l, w.id, heights[i]); });
  return l;
}

// SIX broad boards — deliberately few. The *union* still touches every widget group
// (all seven core cards + every signal group), so the lineup exercises the whole
// catalogue; `tests/unit/console-presets.test.ts` asserts that and the row budget.
//
// ── ON THE NAMES ────────────────────────────────────────────────────────────
// Six reviewers were briefed separately as different real users — a conflict
// researcher, a newsroom duty editor, a humanitarian duty officer, a first-time
// visitor, a power user, and a design/accessibility auditor. Every one of them
// independently reported that WORLD and EARTH are the same word in English and
// that nothing in either label says which is "a bit of everything" and which is
// "natural hazards". CONFLICT and HAZARDS were proposed by all six unprompted.
//
// The ids below are NOT renamed. They are pinned by `?c=` share links, the
// first-run seed and the saved-board archive; changing them would silently
// orphan every layout anyone has saved. Only what the user reads changes.
export const BUILTIN_PRESETS: ConsolePreset[] = [
  // ── Globe — the landing board, and deliberately empty ────────────────
  // Was "Brief": an anomaly list, an events feed, headlines and a camera slot. All
  // four are gone and the board now composes NO cards at all, which is the whole
  // point — /app opens on a bare rotating globe and nothing else.
  //
  // WHY AN EMPTY BOARD RATHER THAN A DELETED ONE. It is still a real preset because
  // "Reset to default" and the first-run seed both resolve through DEFAULT_PRESET_ID,
  // and because the ⌘K palette has to be able to put you back here after you have
  // dragged widgets onto the board yourself. An empty board is a destination; no
  // board is a crash.
  //
  // THE STAGE IS map3d, and this one line is what makes /app open on the globe.
  //
  // Not lib/shell/viewMode.ts. DEFAULT_VIEW_MODE reads like the switch and is not:
  // StageHost.tsx has a mount effect that sets viewModeStore from the board's stage,
  // so whatever viewMode hydrates to is overwritten by the literal below before the
  // map is built. Editing that constant alone changes nothing on screen, which is a
  // good way to spend an afternoon. That matters more now than it did: the 3D/2D
  // switch has been removed, so this literal is the ONLY thing choosing the
  // projection for a new visitor.
  //
  // The globe SPINS ON ITS OWN, and that is existing behaviour rather than something
  // added here: WorldMap runs an idle rotation while the camera is zoomed out past
  // SPIN_MAX_ZOOM and no pointer has touched it for IDLE_RESUME_MS. An empty board
  // simply stops putting four cards in front of it.
  //
  // NO mapSignals AND NO mapCore, both deleted with the widgets. The globe opens on
  // the basemap and borders alone; every layer is one switch away in the Sources
  // rail, which is where that choice belongs now the board is not making it for you.
  //
  // Returning visitors are NOT migrated. `stage` is part of the persisted shell
  // layout, so anyone with a saved board keeps the stage they had. Bumping the
  // layout version to force this would wipe every saved board - widgets, sizes and
  // all - to change a default, and someone who deliberately chose 2D is not a
  // regression to fix. New visitors and anyone who resets their board get the globe.
  { id: "overview", title: "Globe", icon: "🌍", blurb: "the world, and nothing in front of it",
    build: (shell = DEFAULT_SHELL) => compose("map3d", shell, []) },

  // ── Streets — the places people actually walk ────────────────────────────
  // Built for a user request: "custom dashboards so I can see images from major
  // cities' high pedestrian zones throughout the day."
  //
  // Not called "Cameras": that word already names a widget, a widget category, a
  // ⌘K palette section and a map layer key, and a fifth meaning would make the
  // palette ambiguous.
  //
  // THE ONLY `mode: "wall"` BOARD. Authored with composeWall, which is now a
  // different shape rather than a wider rail: the tiles sit on a free twelve-column
  // grid the user can drag and resize, and the map moves into a dock that opens
  // closed. Everything else on the console stays on rails, and a stored layout with
  // no `mode` at all reads as rails — which is what leaves every saved board and
  // every `?c=` link behaving exactly as it does today.
  //
  // mapCore is REQUIRED. presetLayers hard-resets cameras/webcams to false on every
  // board switch and only maps a handful of widget types back on; without this the
  // board would open with a map showing no camera pins at all.
  //
  // THE SEEDS ROT AND THAT IS EXPECTED. These are real Windy ids, verified live on
  // 2026-08-15, but the webcam layer is an unranked sample of a third-party
  // catalogue and any of them can be unpublished without notice. A dead id renders
  // an honest "no longer published" tile (see camslot.tsx / CameraImage), which is
  // why seeding is safe at all. The fourth slot is deliberately empty: it is the
  // affordance that teaches the board is yours to fill.
  //
  // `name` IS RENDERED — do not drop it. It used to be dead config: WidgetFrame drew
  // the widget TYPE's title, so all four walls here carried the identical header
  // "CAMERA WALL" and no user could say which tile a camera would land in. The
  // registry's `titleOf` (see camslotTitle in camslot.tsx) now reads it. That is what
  // makes these three strings load-bearing rather than decorative.
  //
  // THE WEIGHTS BELOW DO NOTHING ON THIS BOARD, and they are left equal to say so.
  // `composeWall` hands `arrangeWall` a bare id list and `arrangeWall` takes no
  // weights at all — it tiles uniform 4-column cards, three across. That is not a
  // gap to be filled in later: a wall's whole proposition is that the user sizes it,
  // so an opening size that already claimed one tile mattered more than another
  // would be a preference the board had made on their behalf.
  //
  // FOUR CARDS FILLS TWO BANDS EXACTLY (3 across, then 1). The fourth is
  // deliberately empty — see the note above.
  { id: "streets", title: "Streets", icon: "📷", blurb: "city squares and crossings, live",
    mapCore: ["cameras", "webcams"],
    build: (shell = DEFAULT_SHELL) => composeWall("map2d", shell, [
      { type: "camslot", weight: 3, config: { name: "London", intervalMs: 8000, streams: [{ k: "webcam", id: "windy:1420893641", t: "London: Trafalgar Square" }] } },
      { type: "camslot", weight: 3, config: { name: "Madrid", intervalMs: 8000, streams: [{ k: "webcam", id: "windy:1606332744", t: "Madrid: Cortes: Plaza Canalejas" }] } },
      { type: "camslot", weight: 3, config: { name: "Prague", intervalMs: 8000, streams: [{ k: "webcam", id: "windy:1345327762", t: "Prague: Wenceslas Square" }] } },
      { type: "camslot", weight: 3, config: { streams: [] } },
  ]) },
];

const KEY = "tn.console.presets.v1";
const VERSION = 1;
interface CustomPreset { id: string; title: string; layout: ShellLayout }

function loadCustom(): CustomPreset[] { return loadPersisted<CustomPreset[]>(KEY, VERSION) ?? []; }

/**
 * The board a given id renders when it has never been edited.
 *
 * Built at the CURRENT row budget, not the default one. Comparing a live board
 * against a template built at `DEFAULT_BOARD_ROWS` compares two different windows:
 * on a 900px-tall screen the live board is 32 rows and the default template is 28,
 * so every card's height differs, every board looks edited the moment you glance at
 * it, and the "customised" dot lights on boards nobody has touched. Observed doing
 * exactly that on the Brief tab after a single board switch.
 */
function templateFor(presetId: string): ShellLayout | null {
  const built = BUILTIN_PRESETS.find((p) => p.id === presetId);
  if (built) return built.build(visibleShell());
  return loadCustom().find((p) => p.id === presetId)?.layout ?? null;
}

/**
 * ONE-TIME MIGRATION, and nothing more.
 *
 * Ordinary edits need no help: `shellLayoutStore` files every change under the open
 * board as it happens, so by the time anyone switches away the slot already exists.
 * The single case this covers is a user who customised a board BEFORE per-board
 * storage shipped — their work is sitting in the old single slot with no board slot
 * to its name, and without this it would be destroyed by their first tab click,
 * which is precisely the bug being fixed.
 *
 * Both guards matter. Skipping boards that already have a slot keeps this off the
 * hot path. Comparing against the template is what stops merely LOOKING at a board
 * from filing its template as "the user's edits" — which would light the edited dot
 * on every board the moment it was viewed, and leave a board dirty right after a
 * reset.
 */
function migrateOutgoing(presetId: string): void {
  if (isBoardEdited(presetId)) return;
  const template = templateFor(presetId);
  if (!template) return;
  const live = shellLayoutStore.get();
  // Sanitise the template before comparing: the live layout has been through
  // `sanitizeLayout`, and comparing a settled board against an unsettled one would
  // report a difference that only the sanitiser introduced.
  const clean = sanitizeLayout(template) ?? template;
  if (layoutSignature(clean) === layoutSignature(live)) return;
  writeBoardLayout(presetId, live);
}

/**
 * Open a board.
 *
 * The order of the first three steps is the whole fix, and each one is load-bearing:
 *
 *  1. Rescue the outgoing board if it predates per-board storage (see above).
 *  2. Set the active id BEFORE the layout lands. `shellLayoutStore` files every
 *     change under whatever board is current, so replacing the layout first would
 *     write the INCOMING board's cards into the OUTGOING board's slot — the same
 *     class of bug, moved one step along.
 *  3. Saved edits beat the template. `reset: true` is the one caller that wants the
 *     template back, and it is also what makes "Reset this board" a real action
 *     rather than a relabelled reload.
 */
export function applyPreset(presetId: string, opts: { reset?: boolean } = {}): void {
  const built = BUILTIN_PRESETS.find((p) => p.id === presetId);
  const custom = built ? undefined : loadCustom().find((p) => p.id === presetId);
  if (!built && !custom) return;

  const outgoing = activePresetStore.get();
  if (outgoing && outgoing !== presetId) migrateOutgoing(outgoing);

  activePresetStore.set(presetId);

  if (opts.reset) forgetBoardLayout(presetId);
  const saved = opts.reset ? null : readBoardLayout(presetId);
  // Only the TEMPLATE is fitted to the window. A saved layout is the user's own
  // arrangement and is restored verbatim — re-flowing someone's board because they
  // unplugged a monitor is how a workspace loses trust.
  const layout = saved ?? (built ? built.build(visibleShell()) : custom!.layout);
  // `archive: false` — opening a board is not editing it. See store.ts's emit().
  shellLayoutStore.replace(layout, { archive: Boolean(saved) });
  // Drive the globe to match the board: the persona's widgets decide which core +
  // signal layers are lit, so switching persona actually re-skins the map (not just
  // the side rail). See lib/console/presetLayers.ts.
  const { core, signals } = layersForLayout(layout, built?.mapSignals ?? [], built?.mapCore ?? []);
  layersStore.applyExact(core);
  signalsStore.applyExact(signals);
}

/**
 * Throw away a board's edits and put its authored default back.
 *
 * Deliberately NOT "reset the workspace": resetting has to be per-board now that
 * saving is, or the escape hatch is more destructive than the thing it rescues you
 * from. Falls back to the landing board when nothing is open, so the command is
 * never a silent no-op.
 */
export function resetActiveBoard(): void {
  applyPreset(activePresetStore.get() ?? DEFAULT_PRESET_ID, { reset: true });
}

export function saveCustomPreset(title: string): void {
  const list = loadCustom();
  list.push({ id: `custom-${Date.now().toString(36)}`, title, layout: shellLayoutStore.get() });
  savePersisted(KEY, VERSION, list);
}

export function listPresets(): { id: string; title: string; icon: string; blurb: string }[] {
  return [...BUILTIN_PRESETS.map((p) => ({ id: p.id, title: p.title, icon: p.icon, blurb: p.blurb })),
          ...loadCustom().map((p) => ({ id: p.id, title: p.title, icon: "★", blurb: "saved" }))];
}
