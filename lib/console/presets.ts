"use client";
import { createDefaultLayout, STAGE_ID, type ShellLayout } from "@/lib/console/types";
import { addWidget, setStage, setSegmentSize, setWidgetHeight } from "@/lib/console/reducers";
import { splitSpan } from "@/lib/terminal/rails";
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

/** A camera board's left rail. Wider than RAIL_PX for one reason, kept below:
 *  a camera frame is 16:9 and a 320px rail letterboxes it. */
const WALL_RAIL_PX = 480;

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
 * A CAMERA board. Identical machinery to `compose`, one number different.
 *
 * ── WHAT THIS USED TO BE, AND WHY IT IS NOT A REDESIGN ──────────────────────
 * `composeWall` called `arrangeWall`, which tiled equal cards three across and
 * gave the map one card's width over two bands. It existed because
 * `arrangeHouse` hardcoded a 4-of-12-column rail, and measured at 1400px that
 * rail gave camera cards aspect ratios from 2.68 to 6.30 — nowhere near the
 * 16:9 a camera frame actually is, so a board whose whole purpose is showing
 * pictures showed letterboxed slivers.
 *
 * That is a statement about WIDTH, and width is now one number rather than a
 * separate arrangement function. So the wall becomes a wider rail: the cards
 * keep their equal weights, their order and their configs, and nothing is
 * rearranged. The `stage.w >= 8` exemption the Streets board needed in
 * `console-presets.test.ts` goes with it — a wider rail still leaves the map
 * more than half the window, so Streets now passes the same assertion as every
 * other board instead of being written out of it.
 *
 * Deliberately NOT redesigned here (Sam's call, 2026-09-03). Its final shape is
 * a separate job after the camslot overlay lands, because the overlay's own
 * measurements — a stage of at least 300x170 CSS px for the full two-row
 * readout, 240x135 compact, self-hiding below 90px — are the numbers to design
 * against, and they belong to whoever owns that tile.
 */
function composeWall(stage: ShellLayout["stage"], shell: { w: number; h: number }, cards: CardSpec[]): ShellLayout {
  return composeRail(stage, shell, cards, WALL_RAIL_PX);
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
  // ── Brief — what changed since you last looked. The landing board ────────
  // Was "World Overview": an anomaly list, a country risk index, London traffic
  // cameras and crypto prices. Reviewers called it "miscellaneous" and "the tab
  // I'd have designed last, and it's the one you land on". Markets moved to its
  // own board and the photo-geolocation tool moved to Recon, which is where the
  // other query-and-answer surfaces live — it had been holding a 250px card on
  // the landing board every day to show an empty dropzone.
  // Webcams is ON here and nowhere else. The Brief board is the one a fresh
  // visitor lands on, and its job is "what changed since you last looked" — a
  // ground-level view of somewhere is exactly that, and the webcam layer is the
  // only one that covers the places our government camera feeds do not (Brazil,
  // Belgium, most of the southern hemisphere). It stays opt-in on every other
  // board and in lib/layers.ts's defaults; this is a per-board choice, not a
  // change to what the layer does by default.
  // THE STAGE IS map3d, and this one line is what makes /app open on the globe.
  //
  // Not lib/shell/viewMode.ts. DEFAULT_VIEW_MODE reads like the switch and is not:
  // StageHost.tsx has a mount effect that sets viewModeStore from the board's stage,
  // so whatever viewMode hydrates to is overwritten by the literal below before the
  // map is built. Editing that constant alone changes nothing on screen, which is a
  // good way to spend an afternoon.
  //
  // Returning visitors are NOT migrated. `stage` is part of the persisted shell
  // layout, so anyone with a saved board keeps the stage they had. Bumping the
  // layout version to force this would wipe every saved board - widgets, sizes and
  // all - to change a default, and someone who deliberately chose 2D is not a
  // regression to fix. New visitors and anyone who resets their board get the globe.
  { id: "overview", title: "Brief", icon: "🌐", blurb: "what changed since you last looked",
    mapSignals: ["gdacs", "earthquakes", "conflict", "wildfires"],
    mapCore: ["webcams"],
    build: (shell = DEFAULT_SHELL) => compose("map3d", shell, [
      { type: "anomaly", weight: 3 },
      { type: "events", weight: 3 },
      { type: "headlines", weight: 2 },
      { type: "cameras", weight: 2 },
  ]) },

  // ── Conflict — armed events, protest, military movement ─────────────────
  // Was "Situation Room". "Situation" is the most overloaded word in this trade:
  // every board is a situation and every report is a sitrep, so the label carried
  // no information. ACLED is key-gated and dormant in production, so it takes the
  // smallest slot rather than the top-right corner it used to hold empty.
  { id: "situation", title: "Conflict", icon: "🎯", blurb: "armed events, protest & military movement", build: (shell = DEFAULT_SHELL) => compose("map2d", shell, [
      { type: "signal:conflict", weight: 3 },
      { type: "signal:military-air", weight: 2 },
      { type: "signal:protests", weight: 2 },
      { type: "news", weight: 2 },
      { type: "signal:instability", weight: 2 },
      { type: "signal:acled", weight: 1 },
  ]) },

  // ── Hazards — quakes, fire, flood, storm ────────────────────────────────
  // Was "Earth Systems". Floods and air quality are frequently empty and sized
  // accordingly; weather docks under the map as a strip.
  //
  // GDACS is second, not first, and that is a reversal worth writing down. A
  // humanitarian duty officer reviewing this asked for GDACS as the board's spine,
  // on the good argument that it is the alerting layer OVER the others rather than
  // a peer feed — it is the card that answers "does this need anyone to do
  // something". It was built that way, and the first screenshot showed the largest
  // card on the board reading "Nothing in World." while its own badge said 8: the
  // card carries a recency filter that its header does not mention. Until that is
  // fixed (see the widget-level follow-ups), giving the top slot to a feed that is
  // routinely blank ships exactly the failure the same reviewer described. So the
  // slot goes to the card that reliably has something in it, and GDACS keeps the
  // second — restore the order once the empty state distinguishes "no alerts" from
  // "filtered out" from "no key".
  { id: "earth", title: "Hazards", icon: "🌍", blurb: "quakes, fire, flood & storm", build: (shell = DEFAULT_SHELL) => compose("map2d", shell, [
      { type: "signal:earthquakes", weight: 3 },
      { type: "signal:gdacs", weight: 2 },
      { type: "signal:wildfires", weight: 2 },
      { type: "signal:tropical-cyclones", weight: 2 },
      { type: "signal:floods", weight: 1 },
      { type: "signal:airquality", weight: 1 },
      { type: "signal:weather", weight: 1 },
  ]) },

  // ── Transit — things that move, and the lanes they move in (globe stage) ─
  // Was "Air · Sea · Space": three domains and two separators in one tab. One
  // word, and it survives rail or road being added later.
  { id: "mobility", title: "Transit", icon: "🛰", blurb: "aircraft, vessels & orbit", build: (shell = DEFAULT_SHELL) => compose("map3d", shell, [
      { type: "aviation", weight: 3 },
      { type: "satellites", weight: 2 },
      { type: "signal:ais", weight: 2 },
      { type: "signal:launches", weight: 2 },
      { type: "signal:ports", weight: 1 },
      { type: "signal:aurora", weight: 1 },
      { type: "signal:cables", weight: 1 },
  ]) },

  // ── Markets & Cyber — the economy and the infrastructure under it ───────
  // Was "MKT·CYBER" in the tab strip. Abbreviating one half of a pair and not the
  // other reads as a rendering fault, and the header band has the room.
  { id: "markets", title: "Markets & Cyber", icon: "📈", blurb: "economy, outages & intrusions", build: (shell = DEFAULT_SHELL) => compose("map2d", shell, [
      { type: "markets", weight: 3 },
      { type: "signal:internet-outages", weight: 2 },
      { type: "signal:cyber-ransomware", weight: 2 },
      { type: "signal:cyber-c2", weight: 2 },
      { type: "signal:grid-load", weight: 1 },
      { type: "headlines", weight: 1 },
  ]) },

  // ── Recon — passive lookups: you ask, it answers ────────────────────────
  // Was "Tools", the only tab naming a UI category rather than a subject. It is
  // also the one board with a different contract from the rest — every other board
  // monitors, this one is queried — so it takes the two other query surfaces:
  // photo geolocation, and displacement, which is an annual stock figure that was
  // sitting on a live conflict board looking like it moved.
  { id: "tools", title: "Recon", icon: "🔎", blurb: "domain & IP intel, photo geolocation", build: (shell = DEFAULT_SHELL) => compose("map2d", shell, [
      { type: "recon:dns", weight: 2 },
      { type: "recon:whois", weight: 2 },
      { type: "recon:certs", weight: 2 },
      { type: "recon:ports", weight: 2 },
      { type: "recon:threat", weight: 2 },
      { type: "recon:bgp", weight: 2 },
      { type: "locate", weight: 2 },
      { type: "signal:displacement", weight: 1 },
  ]) },

  // ── Streets — the places people actually walk ────────────────────────────
  // Built for a user request: "custom dashboards so I can see images from major
  // cities' high pedestrian zones throughout the day."
  //
  // Not called "Cameras": that word already names a widget, a widget category, a
  // ⌘K palette section and a map layer key, and a fifth meaning would make the
  // palette ambiguous.
  //
  // Authored with composeWall, NOT compose — see the note on composeWall for why a
  // camera board cannot live in arrangeHouse's 4-column rail. Exactly four cards,
  // which is what tiles the 3-across grid beside the map with no uncovered cell.
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
  // `composeWall` hands `arrangeWall` a bare id list; `arrangeWall` takes no weights
  // at all and tiles fixed 4-column cards with the map pinned at 4 columns by
  // `CARD_W`. Measured over the whole ROWS ladder the preset test uses (24/28/32/40),
  // weights of 9/3/3/1 produce rects identical to 3/3/3/3 — stage {0,0,4,rows}, four
  // cards 4 x rows/2. So the stage cannot be widened from here: it needs `arrangeWall`
  // (shared with `arrangeConsole` and the reducers' wall mode, and pinned by
  // tests/unit/terminal-layout-grid.test.ts) or `composeWall` to change, and widening
  // it also has to keep the "no uncovered cell right of the stage" assertion true —
  // a 6-column stage leaves 6 columns that 4-wide cards cannot tile.
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
