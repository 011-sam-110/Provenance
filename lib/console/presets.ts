"use client";
import { createDefaultLayout, type SegmentId, type ShellLayout, type StageId } from "@/lib/console/types";
import { addWidget, arrangeBoard, setStage, setSegmentCollapsed, setSegmentSize, setWidgetHeight } from "@/lib/console/reducers";
import { splitSpan } from "@/lib/terminal/rails";
import { GAP_PX, ROW_PX } from "@/lib/terminal/layoutGrid";
import { visibleShell } from "@/lib/terminal/rowBudget";
import { shellLayoutStore } from "@/lib/console/store";
import { layersStore, type LayerKey, type LayerState } from "@/lib/layers";
import { signalsStore, type SignalState } from "@/lib/signals/store";
import { layersForLayout } from "@/lib/console/presetLayers";
import { activePresetStore } from "@/lib/console/activePreset";
import { forgetBoardLayout, isBoardEdited, layoutSignature, readBoardLayout, writeBoardLayout } from "@/lib/console/boards";
import { sanitizeLayout } from "@/lib/console/sanitize";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import { ringFromCircle, type CircleSpec } from "@/lib/map/circle";

// ── A PRESET IS NOW THE WHOLE WORKSPACE ─────────────────────────────────────
//
// The word "preset" used to name two unrelated things, and tapping one had
// nothing to do with tapping the other:
//
//   • `lib/monitors.ts` held six MONITORS — curated combinations of core layers
//     and signal layers, rendered under the heading "PRESETS" in the Sources
//     rail. They set map layers and nothing else. No widgets, no board.
//   • This file held the BOARDS — widgets, sizes and a stage — listed as
//     "Profiles" in the ⌘K palette. They carried no layer intent of their own
//     beyond what their cards happened to imply.
//
// They are one concept now. A preset declares the core layers it lights, the
// signal layers it lights, AND the board of cards that reads them, so "apply a
// preset" means the same thing in the Sources rail and in ⌘K. `lib/monitors.ts`
// is deleted; `PresetBar` drives this file.
//
// Switching between presets was already safe and stays safe: `applyPreset` files
// the outgoing board's edits under its own id and restores the incoming board's
// saved edits, so a preset tap never destroys an arrangement someone made.
export interface ConsolePreset {
  id: string;
  title: string;
  icon: string;
  /** Short "who it's for" tag, surfaced beside the title in ⌘K and as the
   *  Sources-rail tile's tooltip. */
  blurb: string;
  /**
   * Core world layers this preset lights — cameras / planes / satellites /
   * webcams. Every core layer NOT listed here (and not implied by a card) is
   * switched off, so a previous preset's planes cannot linger under this one.
   *
   * This is `mapCore` renamed. It was documented as an escape hatch for boards
   * whose cards could not imply a layer; merging the monitors in makes it the
   * primary statement of what the board is about, which is what it always
   * really was.
   */
  layers?: LayerKey[];
  /**
   * Signal layers this preset lights, by registry id. Same rule: anything not
   * listed and not implied by a `signal:<id>` card goes off.
   *
   * MUST be an id in `MAP_SIGNALS`, never merely in `SIGNALS`. A `dataOnly`
   * source has no map layer at all, so naming one here asks for a layer that
   * cannot exist. The Country Instability Index is the only one today, and it
   * appears on the Intel board as a WIDGET for exactly this reason.
   */
  signals?: string[];
  /** `shell` is the workspace box the board is composed against. Defaults to
   *  DEFAULT_SHELL so tests and any off-DOM caller still get a real board. */
  build(shell?: { w: number; h: number }): ShellLayout;
}

/** The workspace box a board is composed against when nobody measured one — an
 *  off-DOM caller, a unit test, SSR. Matches `rowBudget.ts`'s own fallback, and
 *  the two are the same measurement of the same element. */
const DEFAULT_SHELL = { w: 1440, h: 820 };

/** The board a fresh visitor lands on (ConsoleShell first-run seed + "Reset to default"). */
export const DEFAULT_PRESET_ID = "overview";

// ── WEIGHTS ─────────────────────────────────────────────────────────────────
//
// A weight is a claim about attention, not about size:
//
//   3 — the card this board exists for. First thing the eye should land on.
//   2 — a card that is read.
//   1 — a card that is checked. Lands at the floor: a header and a line. That is
//       the right size for a feed that is usually empty or key-gated (ReliefWeb,
//       ENTSO-E grid load), and it is deliberate — a dormant feed used to hold a
//       full card to say "Nothing.", on the best slot of the board.
//
// What a weight BUYS depends on the rail it is spent in, because a rail's cards
// are sized along that rail's own main axis:
//
//   left / right   vertical column   →  weight buys HEIGHT out of shell.h
//   bottom         horizontal strip  →  weight buys WIDTH  out of shell.w
//
// Both go through the same `splitSpan`, with the same exact-total guarantee and
// the same absorb-the-drift-into-the-largest-card rule. Only the extent and the
// floor differ.

let seed = 0;
const id = () => `p${(seed += 1).toString(36)}`;

interface CardSpec {
  type: string;
  weight: number;
  /** Seed config for this card, so a board can open pre-filled rather than
   *  placing empty widgets. */
  config?: Record<string, unknown>;
}

/** One rail's worth of a board: which rail, and the cards in it in priority order. */
interface RailSpec {
  rail: SegmentId;
  cards: CardSpec[];
}

/** A side rail's width, in px. Matches `createDefaultLayout`, so a built-in board
 *  and a board built by hand from an empty console agree. */
const RAIL_PX = 320;

/** The bottom strip's HEIGHT. Tall enough for a card header plus three or four
 *  rows of a list — below about 180 a strip is a row of headers with nothing
 *  under them, which reads as broken rather than as compact. */
const BOTTOM_PX = 220;

/** The map dock's width on a wall board, when it is open. Wider than RAIL_PX
 *  because it holds a MAP with its own search, zoom and scope controls. */
const WALL_DOCK_PX = 400;

/** The gutter between two cards in a rail. Mirrors `--tnx-gap` in globals.css,
 *  which is the source of truth — this is only used to stop a strip's opening
 *  sizes overshooting, and the CSS absorbs any drift if the two ever disagree. */
const RAIL_GAP_PX = 8;

// ── THE ROOM A RAIL ACTUALLY GETS, WHICH IS NOT THE WINDOW ──────────────────
//
// `visibleShell()` returns the workspace band's `clientWidth` / `clientHeight`,
// and `client*` INCLUDES that element's own padding — so the band always reports
// more room than any rail inside it has. Measured live in Chrome at 1440x900,
// on the Intel board (a right rail and a bottom strip):
//
//   .tn-cw-shell     1440 x 862   padding-left 26px, for the Sources tab
//   .tn-seg          1414 x 862   padding 8px all round; rows 610 | 0 | 220
//   #tn-rail-right    320 x 610
//   #tn-rail-bottom  1398 x 220
//
// Two separate corrections fall out of that, and both were wrong before:
//
//   WIDTH   26 + 16 = 42px of chrome. A strip that spent the whole 1440 laid
//           1456px of cards into 1398px and pushed its last card off the end.
//   HEIGHT  16px of chrome, AND the strip's own 220px + a gap when the board has
//           one. Intel's right rail allocated 862px of cards (646 + 216) into a
//           610px rail — a 260px overflow, i.e. the second card half out of
//           sight on the board composed to show it.
//
// A side rail scrolls, so the height error was survivable rather than fatal, and
// that is exactly why it would have gone unnoticed.
// WIDTH: 26 (shell padding-left) + 16 (seg padding). The bottom strip spans
// `1 / -1`, so it also absorbs the grid's four COLUMN gaps rather than losing
// them — a spanning item covers the gutters it crosses. Measured: 320 + 0 + 1046
// + 0 + 0 = 1366, plus 4x8 = 1398, which is exactly the strip's width.
const SHELL_CHROME_W = 42;
// HEIGHT: 16 (seg padding) + 16 (the grid's TWO row gaps). The gaps are charged
// even on a board with no strip, because the grid always declares three rows and
// only their sizes go to zero — `610px 0px 220px` with a strip, `830px 0px 0px`
// without. That second 16 is the one that is easy to miss and is why a side rail
// still scrolled by exactly one gap-pair after the first correction.
const SHELL_CHROME_H = 32;

/**
 * How much room a rail's cards have to share, along the axis they are sized on.
 *
 * Pure and exported so the test can assert it against the same three windows the
 * boards are composed for, rather than re-deriving the arithmetic and agreeing
 * with itself.
 */
export function railExtent(
  rail: SegmentId,
  shell: { w: number; h: number },
  cardCount: number,
  hasBottomRail: boolean,
): number {
  const gaps = Math.max(0, cardCount - 1) * RAIL_GAP_PX;
  if (rail === "bottom") return shell.w - SHELL_CHROME_W - gaps;
  // A side rail on a board with a strip stops where the strip starts. The gap
  // between the two is already counted in SHELL_CHROME_H — the grid charges its
  // row gaps whether or not the strip has any height — so adding one here would
  // take it twice.
  const strip = hasBottomRail ? BOTTOM_PX : 0;
  return shell.h - SHELL_CHROME_H - strip - gaps;
}

/** No card in a SIDE rail is composed shorter than this. A card below it is a
 *  header and a clipped first row. */
const MIN_CARD_PX = 120;

/** No card in the BOTTOM strip is composed narrower than this. The floor is
 *  wider than the side rails' is tall because the thing that gets clipped is
 *  different: a short card loses rows, a narrow card truncates every row's text
 *  to an ellipsis, which costs the card its whole content rather than its tail. */
const MIN_CARD_W = 240;

/** How many cards a single rail may open holding.
 *
 *  Not a hard limit — a rail scrolls, so exceeding it is survivable rather than
 *  fatal. It is the point at which a board should SPREAD to a second rail
 *  instead, and `tests/unit/console-presets.test.ts` holds every built-in board
 *  to it at three window sizes. Four cards in an 820px column is ~200px each
 *  before weighting; five puts the smallest on the 120px floor and starts the
 *  rail scrolling, which hides a card on a board whose whole job is being
 *  glanceable in one look. */
export const MAX_CARDS_PER_RAIL = 4;

/**
 * Build a board across one or more rails.
 *
 * Cards are authored in priority order within each rail; the rails themselves
 * are declared in the order they should be filled. A board that needs more than
 * `MAX_CARDS_PER_RAIL` in one place spreads to a second rail rather than
 * scrolling — see the Infrastructure and Intel boards below.
 *
 * The rails NOT named here keep size 0, and `ConsoleWorkspace` does not render a
 * rail with no size at all — so a one-rail board costs exactly what it did
 * before this function learned to take more than one.
 */
function compose(stage: StageId, shell: { w: number; h: number }, rails: RailSpec[]): ShellLayout {
  let l = setStage(createDefaultLayout(), stage);

  for (const { rail, cards } of rails) {
    for (const c of cards) {
      l = addWidget(l, c.type, id(), { segment: rail, ...(c.config ? { config: c.config } : {}) });
    }
    // A side rail is sized by WIDTH and its cards by height; the bottom strip is
    // the other way round. `setSegmentSize` takes the rail's cross-axis extent in
    // both cases, which is why left/right get RAIL_PX and bottom gets BOTTOM_PX.
    l = setSegmentSize(l, rail, rail === "bottom" ? BOTTOM_PX : RAIL_PX);
  }

  // Size every card along its own rail's main axis. Done in a second pass, per
  // rail, because `splitSpan` divides ONE extent among the cards competing for
  // it — mixing two rails' cards into a single call would have them fighting
  // over a budget they do not share.
  // Does this board have a strip along the bottom? A side rail on such a board
  // is SHORTER by the strip's height, and sizing its cards against the whole
  // window is the difference between a board that opens whole and one that opens
  // needing a scroll.
  const hasBottom = rails.some((r) => r.rail === "bottom" && r.cards.length > 0);

  for (const { rail, cards } of rails) {
    if (cards.length === 0) continue;
    const horizontal = rail === "bottom";
    const floor = horizontal ? MIN_CARD_W : MIN_CARD_PX;
    const sizes = splitSpan(
      cards.map((c) => c.weight),
      railExtent(rail, shell, cards.length, hasBottom),
      floor,
    );
    const inRail = l.widgets.filter((w) => w.segment === rail).sort((a, b) => a.order - b.order);
    inRail.forEach((w, i) => { l = setWidgetHeight(l, w.id, sizes[i]); });
  }

  return l;
}

/**
 * A CAMERA WALL board — `mode: "wall"`, and the only shape that uses it.
 *
 * The tiles are laid out by `arrangeWall` on the twelve-column grid and the map
 * moves into a dock that opens closed. WEIGHTS DO NOTHING HERE and are left
 * equal to say so: `arrangeWall` tiles uniform 4-column cards and takes no
 * weights at all. A board that wants a hero tile gets one by the user dragging
 * it, which is the entire point of the mode.
 *
 * ── THE MEASUREMENTS THIS HAS TO RESPECT ───────────────────────────────────
 * Measured at 1400px, `arrangeHouse`'s old hardcoded 4-of-12-column rail gave
 * camera cards aspect ratios from 2.68 to 6.30 — nowhere near the 16:9 a camera
 * frame is, so a board whose whole purpose is showing pictures showed
 * letterboxed slivers. That is why a wall tile is 4 columns wide and three
 * across, and why this is a grid rather than a wider rail.
 *
 * The camslot overlay needs a stage of at least 300x170 CSS px for its full
 * two-row readout, 240x135 for the compact one, and hides itself below 90px. A
 * 4-column tile on a 1440px board is ~355px wide and 6 rows is 144px, so the
 * OPENING size clears the compact threshold and a user who wants the full
 * readout drags the tile bigger.
 */
function composeWall(
  stage: StageId,
  shell: { w: number; h: number },
  cards: CardSpec[],
  area?: CircleSpec,
): ShellLayout {
  let l: ShellLayout = { ...setStage(createDefaultLayout(), stage), mode: "wall" };

  // `mode` is set BEFORE the widgets go in, and that ordering is load-bearing:
  // `addWidget` mints a rect only on a wall, so seeding first and flipping the
  // mode afterwards would produce tiles with no rects — mounted, holding their
  // configs, drawing nothing.
  for (const c of cards) {
    l = addWidget(l, c.type, id(), { segment: "left", ...(c.config ? { config: c.config } : {}) });
  }

  l = arrangeBoard(l, Math.floor(shell.h / (ROW_PX + GAP_PX)));

  // THE DOCK OPENS UNCOLLAPSED NOW, and that is the whole first-run change. With
  // no tiles on the board `dockSize` gives the map the full width (see
  // lib/terminal/rails.ts), so "open" and "empty" together ARE the prompt state.
  // A collapsed dock would open this board on a blank grid instead.
  //
  // This replaces "the dock opens closed, and its width is remembered anyway".
  // That reasoning was sound while a wall always ARRIVED with cards on it — the
  // dock was then competing with tiles for width. A wall that opens empty is the
  // opposite case: there is nothing for the dock to crowd, and the map IS the
  // first screen. `size` is still set, so the remembered-width behaviour that
  // note was protecting is unchanged once tiles exist.
  l = setSegmentSize(l, "right", WALL_DOCK_PX);
  l = setSegmentCollapsed(l, "right", false);

  if (area) {
    const ring = ringFromCircle(area);
    if (ring.length >= 3) l = { ...l, watch: { ring } };
  }
  return l;
}

/**
 * Where Streets opens.
 *
 * MEASURED, not chosen for the name. Only four host families in
 * `lib/proxy/hls-allowlist.ts` serve playable video — Caltrans, SCDOT and two
 * Serbian networks — so a board that promises live cameras can only open on one
 * of those networks. Fetched from the upstream feeds on 2026-09-07: SCDOT is
 * 771/771 live, Caltrans D11 (San Diego) 235/324, D12 (Orange County) 249/385.
 * The densest 5 km circle of live cameras measured was San Diego at 44, on I-8
 * just east of the 163.
 *
 * KNOWN GAP, stated rather than hidden: districts 3, 4, 6, 7 and 8 all returned
 * HTTP 500 under what looked like throttling, so LOS ANGELES (D7) and the BAY
 * AREA (D4) were never measured and either could be denser. This is the densest
 * area measured, not the densest that exists. If those are read later and win,
 * this constant is the only thing that changes.
 *
 * The three webcam ids this replaced — Trafalgar Square, Plaza Canalejas,
 * Wenceslas Square — had ZERO live cameras between them. They were Windy stills,
 * and TfL's JamCams are presented as stills too (see lib/cameras/classify.ts).
 */
export const STREETS_DEFAULT_AREA: CircleSpec = { lat: 32.7641, lon: -117.1577, radiusKm: 5 };

// ── THE LINEUP ──────────────────────────────────────────────────────────────
//
// SEVEN presets, up from two boards and six layer-only tiles.
//
// ── ON THE SHAPES ──────────────────────────────────────────────────────────
// Every board opens against a different edge of the map, so the set does not
// read as one template stamped seven times. All three rails are drawn by
// `ConsoleWorkspace` today; until this change only the LEFT one had ever been
// used, because `compose` hardcoded it. The right and bottom rails rendered
// correctly and were simply never given a card.
//
// There is no board that puts cards in the MIDDLE. The map keeps the centre
// everywhere except Streets, which is the pre-existing camera wall and is
// untouched by this change.
//
// ── ON THE NAMES ───────────────────────────────────────────────────────────
// GROUND and CALM are retired rather than given boards. Both were subtractive
// layer states rather than workspaces — "cameras and webcams" and "cameras
// only" — and both meant the thing STREETS already is. A preset that differs
// from another only by having fewer layers on is a button, not a workspace.
//
// The ids are NOT renamed. They are pinned by `?c=` share links, the first-run
// seed and the saved-board archive; changing one would silently orphan every
// layout anyone has saved under it. Only what the user reads changes.
export const BUILTIN_PRESETS: ConsolePreset[] = [
  // ── Globe — the landing board, and deliberately empty ─────────────────────
  //
  // WHY AN EMPTY BOARD RATHER THAN A DELETED ONE. It is still a real preset
  // because "Reset to default" and the first-run seed both resolve through
  // DEFAULT_PRESET_ID, and because ⌘K has to be able to put you back here after
  // you have dragged widgets onto the board yourself. An empty board is a
  // destination; no board is a crash.
  //
  // THE STAGE IS map3d, and this one line is what makes /app open on the globe.
  // Not lib/shell/viewMode.ts — StageHost.tsx has a mount effect that sets
  // viewModeStore from the board's stage, so whatever viewMode hydrates to is
  // overwritten by the literal below before the map is built. Editing
  // DEFAULT_VIEW_MODE alone changes nothing on screen.
  //
  // NO layers AND NO signals, deliberately. The globe opens on the basemap and
  // borders alone; every layer is one switch away in the Sources rail, which is
  // where that choice belongs now the board is not making it for you.
  //
  // Returning visitors are NOT migrated. `stage` is part of the persisted shell
  // layout, so anyone with a saved board keeps the stage they had.
  { id: "overview", title: "Globe", icon: "🌍", blurb: "the world, and nothing in front of it",
    build: (shell = DEFAULT_SHELL) => compose("map3d", shell, []) },

  // ── World — LEFT + BOTTOM ────────────────────────────────────────────────
  // The general brief, and the first board that needed two rails: the three
  // cards you read down the side, plus a strip along the bottom that captions
  // what is actually lit on the map. Six cards in one column would have put the
  // last two below the fold on a 1280x620 laptop.
  { id: "world", title: "World", icon: "🌐", blurb: "a bit of everything, and what is moving today",
    layers: ["cameras", "planes", "satellites"],
    signals: ["earthquakes", "wildfires", "conflict"],
    build: (shell = DEFAULT_SHELL) => compose("map3d", shell, [
      { rail: "left", cards: [
        { type: "anomaly", weight: 3 },
        { type: "events", weight: 2 },
        { type: "headlines", weight: 2 },
      ] },
      { rail: "bottom", cards: [
        { type: "signal:conflict", weight: 1 },
        { type: "signal:earthquakes", weight: 1 },
        { type: "signal:wildfires", weight: 1 },
      ] },
    ]) },

  // ── Nature — BOTTOM ──────────────────────────────────────────────────────
  // Natural hazards, and the board that most wants the map at full width: every
  // question here is "where", so nothing should take a column out of the map.
  //
  // The signal list is longer than the card list on purpose. Volcanoes, floods,
  // cyclones and GDACS alerts are worth having ON THE MAP without spending a
  // card each — the cards are the captions, the map is the picture.
  { id: "nature", title: "Nature", icon: "🌋", blurb: "quakes, fires, storms and floods",
    signals: ["earthquakes", "wildfires", "volcanoes", "severeStorms", "floods", "tropical-cyclones", "gdacs"],
    build: (shell = DEFAULT_SHELL) => compose("map2d", shell, [
      { rail: "bottom", cards: [
        { type: "events", weight: 3 },
        { type: "signal:earthquakes", weight: 2 },
        { type: "signal:wildfires", weight: 2 },
        { type: "signal:severeStorms", weight: 1 },
      ] },
    ]) },

  // ── Skywatch — RIGHT ─────────────────────────────────────────────────────
  // Air and space. Cards on the right leave the globe's left limb clear, which
  // is the edge the eye follows on a rotating sphere.
  { id: "skywatch", title: "Skywatch", icon: "🛰", blurb: "everything above the ground",
    layers: ["planes", "satellites"],
    signals: ["launches", "aurora", "space-weather", "military-air"],
    build: (shell = DEFAULT_SHELL) => compose("map3d", shell, [
      { rail: "right", cards: [
        { type: "aviation", weight: 3 },
        { type: "satellites", weight: 2 },
        { type: "signal:launches", weight: 1 },
        { type: "signal:aurora", weight: 1 },
      ] },
    ]) },

  // ── Infrastructure — LEFT + RIGHT ────────────────────────────────────────
  // Six cards and no natural hero among them: cables, outages and jamming are
  // read together rather than in a ranking. Flanking gives each one room; one
  // column of six would put every card on the 120px floor.
  //
  // `grid-load` is lit on the map but has no card, and that is deliberate — the
  // ENTSO-E feed is key-gated and returns empty today, so a card for it would be
  // a header over nothing.
  { id: "infrastructure", title: "Infrastructure", icon: "🔌", blurb: "the cables, grids and chokepoints underneath",
    signals: ["cables", "cable-landings", "nuclear", "airports", "ports", "gpsJamming", "internet-outages", "grid-load"],
    build: (shell = DEFAULT_SHELL) => compose("map2d", shell, [
      { rail: "left", cards: [
        { type: "signal:internet-outages", weight: 3 },
        { type: "signal:cables", weight: 2 },
        { type: "signal:cable-landings", weight: 1 },
      ] },
      { rail: "right", cards: [
        { type: "signal:gpsJamming", weight: 2 },
        { type: "signal:nuclear", weight: 1 },
        { type: "signal:ports", weight: 1 },
      ] },
    ]) },

  // ── Intel — RIGHT + BOTTOM ───────────────────────────────────────────────
  // Headlines gets the tall slot it needs on the right; the four coverage feeds
  // run as a strip rather than four squeezed cards under it.
  //
  // `signal:instability` IS A WIDGET AND MUST NOT BE A SIGNAL. The Country
  // Instability Index is the one `dataOnly` source in the registry — registered
  // and fetchable, but not a map layer — so it is legal here as a card and
  // illegal in the `signals` list above. It also cannot exceed 82/100 since
  // ACLED was removed (the conflict factor is GDELT article volume alone, whose
  // ramp caps at 0.55) and reads near 32 on the live feed, so it sits at weight
  // 1 rather than leading the board.
  //
  // ReliefWeb is key-gated and empty today, which is exactly what weight 1 is
  // for: a header and a line, not a full card announcing nothing.
  { id: "intel", title: "Intel", icon: "📰", blurb: "who is reporting what, and from where",
    signals: ["conflict", "protests", "displacement", "reliefweb"],
    build: (shell = DEFAULT_SHELL) => compose("map2d", shell, [
      { rail: "right", cards: [
        { type: "headlines", weight: 3 },
        { type: "signal:instability", weight: 1 },
      ] },
      { rail: "bottom", cards: [
        { type: "signal:conflict", weight: 1 },
        { type: "signal:protests", weight: 1 },
        { type: "signal:displacement", weight: 1 },
        { type: "signal:reliefweb", weight: 1 },
      ] },
    ]) },

  // ── Streets — the camera wall, UNCHANGED ─────────────────────────────────
  // Built for a user request: "custom dashboards so I can see images from major
  // cities' high pedestrian zones throughout the day."
  //
  // Not called "Cameras": that word already names a widget, a widget category, a
  // ⌘K palette section and a map layer key, and a fifth meaning would make the
  // palette ambiguous.
  //
  // THE ONLY `mode: "wall"` BOARD, and the only board this change does not
  // touch. Everything else on the console is on rails.
  //
  // `layers` is REQUIRED. presetLayers hard-resets cameras/webcams to false on
  // every board switch and only maps a handful of widget types back on; without
  // this the board would open with a map showing no camera pins at all.
  //
  // THE SEEDS ROT AND THAT IS EXPECTED. These are real Windy ids, verified live
  // on 2026-08-15, but the webcam layer is an unranked sample of a third-party
  // catalogue and any of them can be unpublished without notice. A dead id
  // renders an honest "no longer published" tile (see camslot.tsx /
  // CameraImage), which is why seeding is safe at all. The fourth slot is
  // deliberately empty: it is the affordance that teaches the board is yours to
  // fill.
  //
  // `name` IS RENDERED — do not drop it. The registry's `titleOf` (see
  // camslotTitle in camslot.tsx) reads it, which is what stops all four tiles
  // carrying the identical header "CAMERA WALL".
  // STREETS OPENS EMPTY, AND THAT IS THE FEATURE. It is the only wall board, and
  // it arrives with no cards at all plus an area already set: an empty wall makes
  // `dockSize` hand the map the entire width, so the board opens as a full-bleed
  // map carrying the prompt to draw a circle. The nine tiles are dealt from the
  // cameras inside whatever the user draws (camslot.fanout.ts), so seeding cards
  // here would put strangers' cameras on a board about to be replaced.
  //
  // THE THREE SEEDED WEBCAMS THIS REPLACES — Trafalgar Square, Plaza Canalejas,
  // Wenceslas Square — had ZERO live video between them. They were Windy stills
  // on a board whose whole promise is live cameras. `STREETS_DEFAULT_AREA` above
  // records where the area starts and what was measured to choose it.
  { id: "streets", title: "Streets", icon: "📷", blurb: "city squares and crossings, live",
    layers: ["cameras", "webcams"],
    build: (shell = DEFAULT_SHELL) => composeWall("map2d", shell, [], STREETS_DEFAULT_AREA) },
];

/** Look up a preset by id. */
export function presetById(presetId: string): ConsolePreset | undefined {
  return BUILTIN_PRESETS.find((p) => p.id === presetId);
}

/**
 * The map state a preset implies — its own `layers` / `signals` PLUS the ones
 * its cards imply — without building or replacing the board.
 *
 * THIS EXISTS FOR ONE CALLER, AND IT IS NOT AN OPTIMISATION. The Sources rail
 * can be pointed at a drawn AREA rather than at the globe, and while it is,
 * every tick in it writes to that area. `applyPreset` deliberately writes to
 * WORLD (see `layersStore.applyWorld`) because a board is a property of the
 * globe — so routing a preset tap through it while an area is being edited
 * would do two wrong things at once: change the globe the user is not looking
 * at, and replace the board out from under an area edit in progress.
 *
 * So the rail splits: pointed at the globe it applies the whole preset, and
 * pointed at an area it applies just this — the layer set — to that area. That
 * is the reading the old monitor tiles already had ("give this area the Nature
 * set"), and it is the half of a preset that means anything for an area, which
 * has a layer set but no board of its own.
 */
export function presetMapState(presetId: string): { core: LayerState; signals: SignalState } | null {
  const p = presetById(presetId);
  if (!p) return null;
  return layersForLayout(p.build(visibleShell()), p.signals ?? [], p.layers ?? []);
}

const KEY = "tn.console.presets.v1";
const VERSION = 1;
interface CustomPreset { id: string; title: string; layout: ShellLayout }

function loadCustom(): CustomPreset[] { return loadPersisted<CustomPreset[]>(KEY, VERSION) ?? []; }

/**
 * The board a given id renders when it has never been edited.
 *
 * Built at the CURRENT shell size, not the default one. Comparing a live board
 * against a template built at DEFAULT_SHELL compares two different windows: every
 * card's height differs, every board looks edited the moment you glance at it,
 * and the "customised" dot lights on boards nobody has touched.
 */
function templateFor(presetId: string): ShellLayout | null {
  const built = presetById(presetId);
  if (built) return built.build(visibleShell());
  return loadCustom().find((p) => p.id === presetId)?.layout ?? null;
}

/**
 * ONE-TIME MIGRATION, and nothing more.
 *
 * Ordinary edits need no help: `shellLayoutStore` files every change under the
 * open board as it happens, so by the time anyone switches away the slot already
 * exists. The single case this covers is a user who customised a board BEFORE
 * per-board storage shipped — their work is sitting in the old single slot with
 * no board slot to its name, and without this it would be destroyed by their
 * first tab click.
 *
 * Both guards matter. Skipping boards that already have a slot keeps this off
 * the hot path. Comparing against the template is what stops merely LOOKING at a
 * board from filing its template as "the user's edits".
 */
function migrateOutgoing(presetId: string): void {
  if (isBoardEdited(presetId)) return;
  const template = templateFor(presetId);
  if (!template) return;
  const live = shellLayoutStore.get();
  // Sanitise the template before comparing: the live layout has been through
  // `sanitizeLayout`, and comparing a settled board against an unsettled one
  // would report a difference the sanitiser introduced.
  const clean = sanitizeLayout(template) ?? template;
  if (layoutSignature(clean) === layoutSignature(live)) return;
  writeBoardLayout(presetId, live);
}

/**
 * Open a preset: its board, its core layers and its signal layers together.
 *
 * The order of the first three steps is load-bearing:
 *
 *  1. Rescue the outgoing board if it predates per-board storage (see above).
 *  2. Set the active id BEFORE the layout lands. `shellLayoutStore` files every
 *     change under whatever board is current, so replacing the layout first
 *     would write the INCOMING board's cards into the OUTGOING board's slot.
 *  3. Saved edits beat the template. `reset: true` is the one caller that wants
 *     the template back, and it is what makes "Reset this board" a real action.
 */
export function applyPreset(presetId: string, opts: { reset?: boolean } = {}): void {
  const built = presetById(presetId);
  const custom = built ? undefined : loadCustom().find((p) => p.id === presetId);
  if (!built && !custom) return;

  const outgoing = activePresetStore.get();
  if (outgoing && outgoing !== presetId) migrateOutgoing(outgoing);

  activePresetStore.set(presetId);

  if (opts.reset) forgetBoardLayout(presetId);
  const saved = opts.reset ? null : readBoardLayout(presetId);
  // Only the TEMPLATE is fitted to the window. A saved layout is the user's own
  // arrangement and is restored verbatim — re-flowing someone's board because
  // they unplugged a monitor is how a workspace loses trust.
  const layout = saved ?? (built ? built.build(visibleShell()) : custom!.layout);
  // `archive: false` — opening a board is not editing it. See store.ts's emit().
  shellLayoutStore.replace(layout, { archive: Boolean(saved) });
  // Drive the map to match. The board's widgets imply layers, and the preset's
  // own `layers` / `signals` add the ones no card implies; everything else is
  // switched off so a previous preset cannot linger under this one.
  const { core, signals } = layersForLayout(layout, built?.signals ?? [], built?.layers ?? []);
  layersStore.applyWorld(core);
  signalsStore.applyWorld(signals);
}

/**
 * Throw away a board's edits and put its authored default back.
 *
 * Deliberately NOT "reset the workspace": resetting has to be per-board now that
 * saving is, or the escape hatch is more destructive than the thing it rescues
 * you from. Falls back to the landing board when nothing is open, so the command
 * is never a silent no-op.
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
