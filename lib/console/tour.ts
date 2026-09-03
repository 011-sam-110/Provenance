// The guided tour — a chaptered walkthrough of the whole console.
//
// This file is the PURE half: the chapter/step data, the actions a step needs run
// before it can point at anything, and the index maths. No DOM, so it is unit
// testable in the repo's node-env vitest (there is no jsdom here). The overlay that
// draws the spotlight lives in components/shell/TourOverlay.tsx; the persisted
// "seen" flag lives in lib/shell/tour.ts.
//
// ── WHY CHAPTERS ─────────────────────────────────────────────────────────────
// The tour this replaces was eight steps long and pointed at six selectors, one of
// which (`.tn-cw-col-left`) had not existed since the Terminal grid replaced the
// three-column shell. resolveTourSteps() drops a step whose target is missing
// SILENTLY, so the product shipped a seven-step tour of a console with six boards,
// a dozen camera feeds, thirty-odd signal layers, seventy widget types and a
// four-button widget header — and nothing failed.
//
// A single forty-step run would be worse than the seven, so the walkthrough is
// eight chapters a visitor can take whole or pick from. Every chapter opens with a
// target-less framing card and then spotlights REAL controls.
//
// ── WHY STEPS CARRY ACTIONS ──────────────────────────────────────────────────
// Most of this console's controls are behind a click: the Source Catalog rail
// mounts collapsed, the widget ?/🔔/⋯ popovers are local state, the palette and
// settings are overlays. A tour that can only point at what is already painted can
// never explain them — which is exactly why the old one explained none of them.
// So a step may carry `setup` actions that open the surface it lives in, and its
// chapter carries `cleanup` actions that put the app back afterwards.
//
// Both action kinds are IDEMPOTENT by construction ("click only if the thing is /
// is not already there"), which is what makes stepping backwards safe: replaying a
// setup that has already run is a no-op rather than a toggle back off.

import { BRAND } from "@/lib/brand";
import { SIGNALS } from "@/lib/signals/registry";
import { BUILTIN_PRESETS } from "@/lib/console/presets";
import { BASEMAPS } from "@/lib/basemaps";

/**
 * Counts are DERIVED, never typed. A tour whose sixth chapter is about not being
 * misled cannot itself claim thirty-five layers while the strip above it says
 * thirty-seven — which is exactly what the first draft did, because the number
 * came from a stale note rather than the registry.
 *
 * The registry is already in the console's client bundle (SourceCatalog pulls
 * `signalsByGroup` from it), so this costs nothing. Do NOT import the camera
 * `SOURCES` registry here for the equivalent figure — that one drags a dozen
 * adapters and zod into the browser.
 */
const SIGNAL_COUNT = SIGNALS.length;

/**
 * The board lineup, derived for the same reason as SIGNAL_COUNT — and this one had
 * already rotted. The chapter below said "Six boards" and then listed six by name
 * while the console shipped seven, with no test behind either. The header rule at
 * the top of this file existed the whole time; the boards just were not covered by
 * it. `presets.ts` is already in the client bundle (the header's board tabs map over
 * it), so this costs nothing.
 */
const BOARD_COUNT = BUILTIN_PRESETS.length;
const BOARD_WORD = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][BOARD_COUNT] ?? String(BOARD_COUNT);
/** "Brief (what changed…) · Conflict (armed events…) · …" — straight from the presets,
 *  so a new board appears in the tour the moment it appears in the switcher. */
const BOARD_LIST = BUILTIN_PRESETS.map((p) => `${p.title} (${p.blurb})`).join(" · ");

/**
 * The basemap count, derived for exactly the reason BOARD_COUNT is. Two steps below
 * used to say "the four basemaps" and then name four of them in prose, which was
 * true until a fifth (Streets, on OpenFreeMap) was added and nothing failed. The
 * registry is already in the client bundle - the stage bar maps over it to draw the
 * buttons - so reading the number from it costs nothing and cannot rot.
 */
const BASEMAP_COUNT = Object.keys(BASEMAPS).length;
const BASEMAP_WORD = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][BASEMAP_COUNT] ?? String(BASEMAP_COUNT);
/** "Dark, Light, Streets, Satellite and Topographic" - straight from the registry. */
const BASEMAP_LIST = (() => {
  const labels = Object.values(BASEMAPS).map((b) => b.label);
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}` : labels[0];
})();

// There is deliberately NO camera-feed constant here. `SOURCES` holds twelve
// adapters and `CAMERA_REGIONS` eleven entries — the São Paulo feed has no region
// — so the app disagrees with itself, and a tour that picks a side is asserting a
// number it cannot support. The rail prints its own live count; the copy says
// "every open road-camera network we carry" and leaves the arithmetic alone.

/**
 * A conditional click. `ensure` opens a surface, `close` puts it back — each a
 * no-op when the surface is already in the wanted state, so they can be replayed.
 *
 * Declarative rather than a callback so the data stays serialisable and this
 * module stays DOM-free; TourOverlay.runAction() is the only thing that touches
 * an element.
 */
export type TourAction =
  | { kind: "ensure"; want: string; click: string }
  | { kind: "close"; want: string; click: string };

export interface TourStep {
  id: string;
  /**
   * CSS selector(s) for the element to spotlight — the FIRST one present wins, so
   * a step can name a preferred hook and a fallback. "" ⇒ a centred framing card
   * with no target.
   */
  target: string | string[];
  /** Short heading for the coach-mark. */
  title: string;
  /** Two or three plain-English sentences: what it is, and why you would use it. */
  body: string;
  /** Preferred placement relative to the target (the overlay clamps to the viewport). */
  placement?: "top" | "bottom" | "left" | "right" | "center";
  /**
   * Keep this step even when its target is nowhere on the page.
   *
   * For a control that comes and goes on its own — the breaking banner arrives
   * when a headline does, the pin navigator when you have dropped a pin. The run
   * is built once, so a reactive control that has not fired yet would drop its
   * step and never come back: a verification walk found the banner step missing
   * from all 58 steps while the banner itself sat above every one of them, which
   * is the same silent-drop failure this rewrite exists to remove.
   *
   * This is NOT an escape hatch for a control the viewport does not render — the
   * 390px case must still drop, or a phone gets told about a keyboard-shortcut
   * strip it does not have. Reactive means "not on screen YET", not "not here".
   */
  reactive?: boolean;
  /** Opened before the step is shown, so the target exists to be spotlit. */
  setup?: TourAction[];
  /** Extra settle time in ms after setup, for a surface that animates open. */
  settleMs?: number;
}

export interface TourChapter {
  id: string;
  /** Shown on the chapter menu and in the coach-mark's progress line. */
  title: string;
  /** One line on the menu — what this chapter covers. */
  summary: string;
  icon: string;
  /** Run when the tour leaves this chapter, to put the app back as it was found. */
  cleanup?: TourAction[];
  steps: TourStep[];
}

/**
 * Bump when the tour changes materially — a higher version re-invites returning
 * visitors exactly once (they have "seen" an older tour, not this one).
 *
 * 1 → 2: the eight-step run became this chaptered walkthrough, and one of its
 * targets had been dead for a while. Everyone deserves the re-invite.
 * 2 → 3: the chrome moved, then most of it was removed. The projection switch, the
 * basemaps, Export and Solo are all in the FEED HEALTH row now; search is centred;
 * the area filter has a name, a home under the key and a step of its own. Three
 * whole bands went — the breaking strip, the 24px footer and the stage's own top
 * bar — taking six steps with them, and CONSOLE/WALL went with its buttons. The
 * console is three bands, not four-plus-one, and a tour that walks someone to a
 * band that is not there is worse than no tour.
 */
export const TOUR_VERSION = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Reusable actions. Named because several chapters need the same surface, and a
// typo in a selector here is a step that silently points at nothing.
// ─────────────────────────────────────────────────────────────────────────────

const OPEN_RAIL: TourAction = { kind: "ensure", want: ".tn-rail", click: ".tn-rail-fab" };
const SHUT_RAIL: TourAction = { kind: "close", want: ".tn-rail", click: ".tn-rail-collapse" };

const OPEN_SIGNALS: TourAction = { kind: "ensure", want: ".tn-signals-body", click: ".tn-signals-header" };

const OPEN_HELP: TourAction = { kind: "ensure", want: ".tn-cw-help-pop", click: ".tn-cw-help" };
const SHUT_HELP: TourAction = { kind: "close", want: ".tn-cw-help-pop", click: ".tn-cw-help-x" };

const OPEN_BELL: TourAction = { kind: "ensure", want: ".tn-cw-notify-pop", click: ".tn-cw-bell" };
const SHUT_BELL: TourAction = { kind: "close", want: ".tn-cw-notify-pop", click: ".tn-cw-bell" };

const OPEN_MENU: TourAction = { kind: "ensure", want: ".tn-cw-menu-pop", click: ".tn-cw-menu" };
const SHUT_MENU: TourAction = { kind: "close", want: ".tn-cw-menu-pop", click: ".tn-cw-menu" };

// The palette has no ✕ — its close affordances are Escape and a backdrop click, and
// the backdrop is the one of those two that is a clickable element.
const OPEN_PALETTE: TourAction = { kind: "ensure", want: ".tn-palette-root", click: ".tn-palette-trigger" };
const SHUT_PALETTE: TourAction = { kind: "close", want: ".tn-palette-root", click: ".tn-palette-backdrop" };

// `.tn-settings-trigger` moved into the profile popover when the header's ⚙ icon
// was removed, so the popover has to be open before the click can land. Two
// actions, in order — every step that opens Settings now carries both.
const OPEN_SETTINGS: TourAction[] = [
  { kind: "ensure", want: ".tn-profile-menu", click: ".tn-profile-avatar" },
  { kind: "ensure", want: ".tn-settings", click: ".tn-settings-trigger" },
];
const SHUT_SETTINGS: TourAction = { kind: "close", want: ".tn-settings", click: ".tn-settings-close" };

// The profile popover toggles from the avatar, so the same control opens and closes it.
const OPEN_PROFILE: TourAction = { kind: "ensure", want: ".tn-profile-menu", click: ".tn-profile-avatar" };
const SHUT_PROFILE: TourAction = { kind: "close", want: ".tn-profile-menu", click: ".tn-profile-avatar" };

// ─────────────────────────────────────────────────────────────────────────────
// The walkthrough.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The chapters as authored. The order they are WALKED in is CHAPTER_ORDER below —
 * kept separate so resequencing the tour is one line rather than moving three
 * hundred lines of copy around and re-reviewing all of it.
 */
const AUTHORED_CHAPTERS: TourChapter[] = [
  // ── 1 ──────────────────────────────────────────────────────────────────────
  {
    id: "orientation",
    title: "The layout",
    summary: "The bands the console is built from, and what each is for",
    icon: "▤",
    steps: [
      {
        id: "orientation-lead",
        target: "",
        title: "Start with the shape of it",
        body:
          `${BRAND.name} is one screen in three horizontal bands. Learn the bands and everything else has an address. There is no login and no payment; most sources are keyless, and the few that need a free API key are labelled as such rather than left looking broken.`,
        placement: "center",
      },
      {
        id: "orientation-header",
        target: ".tnx-hdr-brand",
        title: "Band 1 — the header",
        body:
          "The top strip is navigation and identity: the boards you can switch between, a UTC clock, and — on the right — the skin toggle, the links out, and Shortcuts. It never scrolls away.",
        placement: "bottom",
      },
      {
        id: "orientation-health",
        target: [".tnx-feed-cells", ".tnx-feed"],
        title: "Band 2 — feed health",
        body:
          `One cell per data layer, coloured by whether its last fetch worked. Hover a cell to name the layer and read its state. The right-hand end of this band holds the map's own controls: Solo, the 3D/2D switch, the ${BASEMAP_WORD} basemaps and the two exports. Cells are also switches: clicking one turns that layer on or off, the same as its switch in the Sources rail — so a click here changes the map, it does not just inspect it.`,
        placement: "bottom",
      },
      {
        id: "orientation-stage",
        target: ".tn-cw-stage",
        title: "Band 3 — the stage",
        body:
          "The map. Drag to pan, scroll to zoom, click anything on it to select it. Every layer you switch on paints here, and it is the one panel that is always present.",
        placement: "center",
      },
      {
        id: "orientation-widgets",
        target: [".tn-seg-slot", ".tn-cw"],
        title: "Band 3 also — the widgets",
        body:
          "The stage shares a twelve-column grid with the widgets around it. Most watch a single source; a few combine several. All of them can be moved, resized, duplicated or removed, and a later chapter takes one apart.",
        placement: "left",
      },
    ],
  },

  // ── 2 ──────────────────────────────────────────────────────────────────────
  {
    id: "map",
    title: "The map",
    summary: "Projection, basemaps, search, the legend and pins",
    icon: "◉",
    steps: [
      {
        id: "map-lead",
        target: "",
        title: "Everything on the map is clickable",
        body:
          "Before the controls, the thing worth knowing: click any pin and a dossier slides in from the right with that item's detail, its source and its attribution, plus a ⬇ Export for that one record and an ✕ to close. Click a camera and you get its picture — a live video stream where the agency provides one, otherwise a still that refreshes. Numbered bubbles are clusters; click one to zoom into what it is holding. Whatever you pick is named in the bar along the bottom, and Esc clears it.",
        placement: "center",
      },
      {
        id: "map-projection",
        target: ".tnx-stage-proj",
        title: "3D globe ⇄ 2D flat",
        body:
          "The same data, two projections. The globe is better for orbital and long-haul context; flat is better for reading dense regions and for anything you want to compare side by side. STAGE·GLOBE or STAGE·FLAT, in the corner of the map itself, tells you which you are in.",
        placement: "bottom",
      },
      {
        id: "map-basemaps",
        target: ".tnx-basemaps",
        title: "Basemaps",
        body:
          `${BASEMAP_LIST}. Pick by task: imagery to see what a place actually looks like, topographic for elevation, Streets for named roads and 3D buildings, light or dark to let the data layers carry the colour.`,
        placement: "bottom",
      },
      {
        id: "map-search",
        target: ".tnx-stage-search",
        title: "Search anywhere",
        body:
          "Type any place name — a city, a street, an airport — and pick a result to fly there and drop a pin. Press / from anywhere in the console to jump into this box.",
        placement: "bottom",
      },
      {
        id: "map-legend",
        target: ".tnx-stage-legend",
        title: "The legend",
        body:
          "It lists the layers that are on right now, in the colours the map is actually painting them. Cameras are coloured by source region, aircraft by type, satellites by category, and each signal layer brings its own — so the key is built from what is on screen rather than fixed in advance.",
        placement: "left",
      },
      {
        id: "map-solo",
        target: ".tn-solo-btn",
        title: "Give the board to the map",
        body:
          "First control in the FEED HEALTH band. Solo hides every widget and lets the map fill the workspace; the same button then reads Board and puts them all back exactly as they were. Nothing is closed and nothing is lost — it is a view of the same board, for when the panels around the edge are the thing in your way.",
        placement: "bottom",
      },
      {
        id: "map-area",
        target: ".tn-aoi",
        title: "Restrict results to area",
        body:
          "Under the key: draw a zone on the map and every scoped panel narrows to what is inside it. Click to place each corner, Enter to close the ring once you have three, Esc to abandon it. It filters the FEEDS rather than moving the camera — the map stays where you left it, and the counts in the panels change. Clear brings the whole world back.",
        placement: "left",
      },
      {
        id: "map-pins",
        target: [".tn-pinnav", ".tnx-stage-foot"],
        reactive: true, // the pin navigator exists only once a pin has been dropped
        title: "Pins, zoom and world clocks",
        body:
          "Searching drops a pin, and the pin navigator steps between them, flies back to any one, and clears them. The + and − in the bottom-right corner zoom without a scroll wheel, and the compass under them resets the tilt. The bar along the bottom of the stage carries local time in several cities, so an event has a human hour attached.",
        placement: "top",
      },
      {
        id: "map-grip",
        target: ".tn-stage-grip",
        title: "The map is a panel too",
        body:
          "This grip moves the whole stage around the grid, and the eight edges resize it. The map owns click and scroll for panning and zooming, which is why moving it needs its own handle.",
        placement: "left",
      },
    ],
  },

  // ── 3 ──────────────────────────────────────────────────────────────────────
  {
    id: "boards",
    title: "Boards & modes",
    summary: `${BOARD_COUNT} ready-made workspaces, two layout modes, two skins`,
    icon: "▦",
    steps: [
      {
        id: "boards-lead",
        target: "",
        title: `${BOARD_WORD.charAt(0).toUpperCase()}${BOARD_WORD.slice(1)} boards, each a job`,
        body:
          "A board is a whole workspace: which widgets are open, where they sit, and which map layers are on. Switching board changes all three at once.",
        placement: "center",
      },
      {
        id: "boards-tabs",
        target: [".tnx-hdr-boards", ".tn-preset-pill"],
        title: "The boards",
        body:
          `${BOARD_LIST}.`,
        placement: "bottom",
      },
      {
        id: "boards-edited",
        target: [".tnx-hdr-board-reset", ".tnx-hdr-boards"],
        title: "Your changes survive a switch",
        body:
          "Move or resize anything and that board is marked customised with a dot. Switching away and back brings your arrangement with you — and a ⟲ appears beside the tabs to put the board back to its template when you want the original.",
        placement: "bottom",
      },
      {
        id: "boards-skin",
        target: ".tnx-hdr-skin",
        title: "Dark or light",
        body:
          "The button names the skin you would get, not the one you are in. The basemap follows it — dark chrome pairs with the dark map, light with the light one — unless you have deliberately chosen satellite or topographic, which is left alone.",
        placement: "bottom",
      },
    ],
  },

  // ── 4 ──────────────────────────────────────────────────────────────────────
  {
    id: "widgets",
    title: "A widget, part by part",
    summary: "Every control in a widget header, including the hidden ones",
    icon: "▣",
    cleanup: [SHUT_MENU, SHUT_BELL, SHUT_HELP],
    steps: [
      {
        id: "widgets-lead",
        target: "",
        title: "Four buttons, and what is behind them",
        body:
          "Every widget has the same header, whichever source it watches. Learn it once and it applies to all of them. This chapter opens each control in turn on a real widget.",
        placement: "center",
      },
      {
        id: "widgets-head",
        target: ".tn-cw-head",
        title: "The header",
        body:
          "Left to right: a grip, an icon, the widget's name, how many rows it is holding, an alert badge when something needs attention, a freshness chip, and then the four controls.",
        placement: "bottom",
      },
      {
        id: "widgets-fresh",
        target: [".tn-cw-fresh", ".tn-cw-head"],
        title: "The freshness chip",
        body:
          "How old this widget's data actually is. CONNECTING… while it waits, LIVE once it has answered, then an age as it drifts, then STALE, DOWN when it stops, and DORMANT when the layer needs an API key this deployment does not hold, so nothing was ever fetched. \"LIVE · 7/8\" means only seven of the eight feeds behind it answered. A feed that quietly freezes says so here instead of continuing to look healthy.",
        placement: "bottom",
      },
      {
        id: "widgets-help",
        // The popover first, the ? button as the fallback: if the surface fails to
        // open, ring the control that opens it rather than nothing.
        target: [".tn-cw-help-pop", ".tn-cw-help"],
        title: "? — what am I looking at",
        body:
          "The ? in every widget header opens this. It names what the widget shows, which organisation the data comes from, how that source knows (an instrument measured it, an agency stated it, a model produced it), and what the layer cannot tell you. Some of it gets technical — that is the layer's own method, written down rather than hidden.",
        placement: "bottom",
        setup: [OPEN_HELP],
        settleMs: 140,
      },
      {
        id: "widgets-bell",
        target: [".tn-cw-notify-pop", ".tn-cw-bell"],
        title: "🔔 — tell me when it changes",
        body:
          "Two checkboxes, and both must be on: \"Notify me\" arms this widget, then pick a channel. Browser works straight away; Telegram and Discord stay greyed out until you add credentials in Settings. The threshold suppresses everything under a number you choose — a magnitude, a count — so an armed widget stays quiet until it matters.",
        placement: "bottom",
        setup: [SHUT_HELP, OPEN_BELL],
        settleMs: 140,
      },
      {
        id: "widgets-expand",
        target: ".tn-cw-expand",
        title: "⤢ — expand onto the stage",
        body:
          "Throws this widget full-size onto the centre stage, over the map, for when a table needs the room — often with a richer view than the small card had. The map chrome steps aside while it is there, and \"← Back to map\" in its top-left puts the map back.",
        placement: "bottom",
        setup: [SHUT_BELL],
      },
      {
        id: "widgets-menu-pop",
        target: [".tn-cw-menu-pop", ".tn-cw-menu"],
        title: "⋯ — move, size, duplicate, export, remove",
        body:
          "The ⋯ in the header opens this. Arrows nudge the card one cell at a time, −W +W −H +H grow and shrink it by one, and the width and height chips snap it to named sizes — all of it works without a mouse. Below: duplicate the widget, choose whether its alerts sit on top or inline, and remove it. A widget holding a table of rows adds a CSV download here, and one holding map points adds GeoJSON; a widget with neither simply does not offer them.",
        placement: "left",
        setup: [OPEN_MENU],
        settleMs: 120,
      },
      {
        id: "widgets-grip",
        target: ".tn-cw-grip",
        title: "⠿ — move it",
        body:
          "Drag the grip, or the header, to move a widget anywhere on the grid. With it focused, arrow keys move it a cell at a time and shift with arrows resizes it.",
        placement: "bottom",
        setup: [SHUT_MENU],
      },
      {
        id: "widgets-body",
        target: [".tn-cw-body", ".tn-cw"],
        title: "Inside the card, each widget differs",
        body:
          "Below the header the controls belong to that widget. Common ones: chips that regroup the list (by region, by type, or flat), collapsible group headings, a \"needs attention\" band at the top, thumbnail tiles that open a camera, and — worth knowing — an \"N hidden ✕\" chip meaning rows are being filtered out, whose ✕ brings them back. This tour does not cover every widget's insides; the ? on each one does.",
        placement: "right",
      },
      {
        id: "widgets-resize",
        // `.tn-rz` (the base class), not `.tn-rz-se`: the directional half is built
        // as `tn-rz-${dir}`, so it exists at runtime but never as a literal in the
        // source — which is what the tour's anti-rot test can check against.
        // Scoped to a widget slot so the ring lands on a card's handle, not the
        // stage's, which is the first `.tn-rz` in the DOM.
        target: [".tn-seg-slot .tn-rz", ".tn-seg-slot"],
        title: "Eight edges to resize",
        body:
          "Every corner and edge of a card is a resize handle, snapping to the twelve-column grid. Drag past the fold and the board scrolls rather than squeezing the rows.",
        placement: "top",
      },
    ],
  },

  // ── 5 ──────────────────────────────────────────────────────────────────────
  {
    id: "sources",
    title: "The Source Catalog",
    summary: "Every feed, its map toggle, and turning any of them into a widget",
    icon: "≡",
    // Collapse the camera row before the rail, not after: closing the rail unmounts
    // the row and takes its open state with it, so the explicit close would find
    // nothing to click and the invariant "what a chapter opens, it closes" would be
    // true only by accident.
    cleanup: [
      { kind: "close", want: ".tn-cam-filters", click: ".tn-layer-head" },
      { kind: "close", want: ".tn-signals-body", click: ".tn-signals-header" },
      SHUT_RAIL,
    ],
    steps: [
      {
        id: "sources-lead",
        target: "",
        title: "One rail, every source",
        body:
          `Every open road-camera network we carry, plus ${SIGNAL_COUNT} global signal layers — each with a map toggle, a live count, an attribution and its own freshness. This is where you compose what the map shows.`,
        placement: "center",
      },
      {
        id: "sources-fab",
        target: ".tn-rail-fab",
        title: "≡ Sources",
        body:
          "The rail starts collapsed so the board gets the screen. One click opens it, and it pushes the grid across rather than covering it. The ‹ in its top corner puts it away again.",
        placement: "right",
      },
      {
        id: "sources-search",
        target: ".tn-cat-search",
        title: "Search the catalogue",
        body:
          "There are more sources here than anyone scrolls. Type a word — quake, cyber, camera, cable — and the whole rail filters to matching layers with their groups already expanded.",
        placement: "right",
        setup: [OPEN_RAIL],
        settleMs: 220,
      },
      {
        id: "sources-monitors",
        target: [".tn-monitor-chips", ".tn-monitors"],
        title: "Monitor presets",
        body:
          "One-click scenarios that switch on the handful of layers a given situation needs, instead of hunting for them one at a time.",
        placement: "right",
        setup: [OPEN_RAIL],
      },
      {
        id: "sources-presets",
        target: ".tn-presets",
        title: "Layer presets",
        body:
          "The same idea for the core map layers — quick combinations of cameras, aircraft, satellites and webcams without touching each switch.",
        placement: "right",
        setup: [OPEN_RAIL],
      },
      {
        id: "sources-row",
        target: ".tn-layer-row",
        title: "Reading a source row",
        body:
          "A coloured dot matching the map, the name, who supplies it, and how long ago it last answered. On the right: the live count, a ＋ that puts this source on your board as a widget, and the switch that puts it on the map. A dimmed row with an \"in signals\" pill has no map layer of its own — the pill is a label, not a button, and it tells you the data is further down under Global signals.",
        placement: "right",
        setup: [OPEN_RAIL],
      },
      {
        id: "sources-widget-toggle",
        target: [".tn-widget-toggle", ".tn-layer-row"],
        title: "＋ — any source becomes a widget",
        body:
          "This is the shortcut worth knowing. ＋ docks that feed onto your workspace as its own live tile; ▦ means it is already there. Each signal GROUP heading has one too, which docks a single roll-up tile for the whole theme instead of one per layer. The counter at the top of the rail tracks how many you have open.",
        placement: "right",
        setup: [OPEN_RAIL],
      },
      {
        id: "sources-toggle",
        target: [".tn-toggle", ".tn-layer-row"],
        title: "Off means off",
        body:
          "A layer that is switched off is not fetched at all — no background requests, no quota burned, and nothing pretending to be current. That is also why a hidden layer reports \"off\" rather than a zero.",
        placement: "right",
        setup: [OPEN_RAIL],
      },
      {
        id: "sources-cameras",
        target: [".tn-cam-filters", ".tn-layer-row"],
        title: "Camera filters — and where the cameras are",
        body:
          "Open the Cameras row and you can hide whole regions with the region chips, or show only cameras serving genuine live video rather than a still that refreshes. The two chips under \"Feed\" are labels for those two kinds, not buttons. This region list is also the honest answer to \"which places have cameras?\" — they come from road agencies that publish openly, so London, California, Finland and British Columbia are covered and most of the world is not.",
        placement: "right",
        setup: [OPEN_RAIL, { kind: "ensure", want: ".tn-cam-filters", click: ".tn-layer-head" }],
        settleMs: 160,
      },
      {
        id: "sources-signals",
        target: [".tn-signals-header", ".tn-signals"],
        title: "Global signals",
        body:
          `${SIGNAL_COUNT} intelligence layers grouped by theme — hazards, conflict, cyber, maritime, infrastructure, humanitarian — including a Country Instability Index computed from four of the others. Your board decides which start on: Brief opens with four. To add one, expand its group and flip its switch; the badge beside this header counts how many are on.`,
        placement: "right",
        setup: [OPEN_RAIL],
      },
      {
        id: "sources-timewindow",
        target: [".tn-timewindow-chips", ".tn-signals-body"],
        title: "Time window",
        body:
          "Limits every time-stamped signal to the last hour, six hours, day, week, or everything held. Layers that are monthly aggregates rather than events are deliberately left out of it instead of being filtered to nothing.",
        placement: "right",
        setup: [OPEN_RAIL, OPEN_SIGNALS],
        settleMs: 160,
      },
      {
        id: "sources-provenance",
        target: [".tn-layer-prov", ".tn-signals-body"],
        title: "How each layer knows",
        body:
          "The small chip beside a source grades it, and there are five: MEASURED by an instrument, OFFICIAL from an agency, REPORTED and checked by people, MODELLED by a forecast or index, or DERIVED — computed here from other layers, the most caveated of the five. Everything on this map draws the same coloured dot, so without this a seismometer and a news-wire guess would look equally authoritative.",
        placement: "right",
        setup: [OPEN_RAIL, OPEN_SIGNALS],
      },
      {
        id: "sources-locked",
        target: [".tn-layer-locked", ".tn-signals-body"],
        title: "Locked layers",
        body:
          "A few sources need a free API key this deployment does not hold. They are badged as locked rather than left showing zero, because \"needs a key\" and \"nothing happened\" are different facts with different fixes.",
        placement: "right",
        setup: [OPEN_RAIL, OPEN_SIGNALS],
      },
      {
        id: "sources-panels",
        target: ".tn-coverage-open",
        title: "Coverage · Markets · Saved",
        body:
          "Three panels at the foot of the rail, each closing on its own ✕. Camera coverage is the honest per-feed account of how many cameras each agency is giving us and how many are answering. Markets is the economic board. Saved is your watchlist — \"Save current view\" bookmarks wherever the map is pointing, each saved place gets a row that flies you back to it, and each row has an ✕ to drop it.",
        placement: "right",
        setup: [OPEN_RAIL],
      },
    ],
  },

  // ── 6 ──────────────────────────────────────────────────────────────────────
  {
    id: "trust",
    title: "Knowing what to believe",
    summary: "Freshness, coverage, provenance — and where this data is weak",
    icon: "◈",
    steps: [
      {
        id: "trust-lead",
        target: "",
        title: "How to tell what to trust",
        body:
          "Everything on this map is drawn at the same visual weight, whether an instrument measured it or a machine guessed it from a news wire. These are the four places the console tells you which is which.",
        placement: "center",
      },
      {
        id: "trust-health",
        target: [".tnx-feed-cells", ".tnx-feed"],
        title: "Five states, not two",
        body:
          "Each cell is one of five states, and the colour is the whole readout — there is no numeric tally anywhere, on purpose, because a total is the thing that hides one dead feed among thirty-six healthy ones. LIVE means the last fetch worked, including layers that are connected and genuinely have nothing to report. LAG is behind. DOWN failed, or has gone quiet for hours, or had a credential refused. NEEDS KEY is never fetched at all because this deployment holds no key for it. DORMANT is switched off, which is neither a fault nor a clean bill of health. Hover any cell for that layer's state in words.",
        placement: "bottom",
      },
      {
        id: "trust-cells",
        target: [".tnx-feed-cells", ".tnx-feed"],
        title: "Per-layer, not just a total",
        body:
          "Each cell is one layer's current state, so a single dead feed is visible rather than averaged away into a reassuring summary. Hover for its name and the full wording; click to switch that layer on or off.",
        placement: "bottom",
      },
      {
        id: "trust-counts",
        target: [".tn-layer-count", ".tn-cw-count", ".tn-cw-head"],
        title: "Counts say what they cover",
        body:
          "A widget's number is what it is holding. Where we know we are seeing only part of a source, the freshness chip beside it carries the fraction — \"LIVE · 7/8\" means seven of the eight feeds behind this widget answered. Check that chip before reading the count as the whole picture.",
        placement: "left",
      },
      {
        id: "trust-caveat",
        target: "",
        title: "One caveat worth reading",
        body:
          "The conflict layer is news COVERAGE, not verified incidents. It is machine-coded from wire text, and that coding is sometimes wrong — a story about one city can seed a pin on another. It is labelled as coverage everywhere it appears, and each pin attributes the code rather than asserting it as fact. Useful for attention; not evidence.",
        placement: "center",
      },
      {
        id: "trust-source",
        target: [".tnx-hdr-right", ".tnx-hdr-btn"],
        title: "You can check all of this",
        body:
          `Two links sit together up here. SOURCE opens the repository — the whole console is free software under the ${BRAND.license.name}, so every adapter, filter and claim in this tour can be read rather than taken on trust. SUPPORT, beside it, is an optional tip jar and changes nothing about what you get.`,
        placement: "bottom",
      },
    ],
  },

  // ── 7 ──────────────────────────────────────────────────────────────────────
  {
    id: "power",
    title: "The fast path",
    summary: "The command bar, the keyboard, sharing and saving",
    icon: "⌘",
    cleanup: [SHUT_PALETTE],
    steps: [
      {
        id: "power-lead",
        target: "",
        title: "Once you know your way around",
        body:
          // Not "the last six chapters": chapters are dropped when their controls
          // are not rendered, so at a phone width there are fewer of them and the
          // number would be wrong.
          "Almost everything this tour has shown you also has a keyboard route, through one search box.",
        placement: "center",
      },
      {
        id: "power-palette",
        target: [".tn-palette-root", ".tn-palette-trigger"],
        title: "⌘K — one box for the whole app",
        body:
          "Command-K on a Mac, Ctrl-K everywhere else, or the COMMAND button in the header. Grouped by what it does: switch board, add any widget, jump to an open widget, toggle a map layer, change basemap, choose what the stage shows, apply a themed scenario, fly to any place on Earth by name, dive straight into a live camera, change language or theme — and replay this tour. Arrows move, Enter runs, Esc closes.",
        placement: "center",
        setup: [OPEN_PALETTE],
        settleMs: 200,
      },
      {
        id: "power-workspace",
        target: [".tn-palette-root", ".tn-palette-trigger"],
        title: "Save and share, in the same box",
        body:
          "Under Workspace: \"Copy shareable link\" encodes your exact layout into a URL that rebuilds it for whoever you send it to — Settings has the same thing as a button. \"Save layout as preset\" keeps your arrangement as your own board alongside the built-in ones, and \"Reset board\" puts the current one back to its template.",
        placement: "center",
        setup: [OPEN_PALETTE],
      },
      {
        id: "power-keys",
        target: [".tn-palette-trigger", ".tnx-hdr-right"],
        title: "The single-key shortcuts",
        body:
          "/ jumps straight to map search and Esc clears your selection, from anywhere on the page. Both are ignored while you are typing in a field, so they never eat a keystroke, and Esc goes to whatever dialog is open before it reaches your selection. ⌘K opens this list any time.",
        placement: "bottom",
        setup: [SHUT_PALETTE],
      },
    ],
  },

  // ── 8 ──────────────────────────────────────────────────────────────────────
  {
    id: "settings",
    title: "Settings & finishing up",
    summary: "Theme, language, alert channels and your profile",
    icon: "⚙",
    cleanup: [SHUT_PROFILE, SHUT_SETTINGS],
    steps: [
      {
        id: "settings-trigger",
        target: [".tn-settings-trigger", ".tn-profile-menu"],
        title: "⚙ — settings",
        body:
          "It lives in the profile menu rather than as its own header icon: one door to a room, not two. Open the avatar and it is the last item. Behind it is the drawer holding everything that is a preference rather than a view.",
        placement: "bottom",
        // The trigger is INSIDE the popover now, so the popover has to be open
        // before there is anything to spotlight. A step whose target is missing is
        // dropped silently, which is how this would have failed.
        setup: [OPEN_PROFILE],
        settleMs: 140,
      },
      {
        id: "settings-panel",
        target: [".tn-settings", ".tn-settings-trigger"],
        title: "Theme, language, boards, sharing, alerts",
        body:
          "Scroll it — there is more below the fold than above. Appearance and Language; Load a board; Share, which copies a link rebuilding your current view for whoever you send it to; a Telegram section with its own send-a-test button; and Notifications, holding a master switch that silences every armed widget at once, the Discord webhook, and the list of rules you have armed. Credentials are stored in this browser and sent nowhere else.",
        placement: "left",
        setup: [...OPEN_SETTINGS],
        settleMs: 200,
      },
      {
        id: "settings-profile",
        target: [".tn-profile-menu", ".tn-profile-avatar", ".tnx-hdr-profile"],
        title: "Your profile",
        body:
          "Set a display name for this browser, and replay this tour from here — 🧭 Take the tour is the second way in, alongside ⌘K. The Sign in button is a placeholder for accounts that do not exist yet: it opens a form that cannot be submitted. Nothing is uploaded — your boards, pins, watchlist and alert credentials all live in this browser only.",
        placement: "bottom",
        setup: [SHUT_SETTINGS, OPEN_PROFILE],
        settleMs: 140,
      },
      {
        id: "settings-done",
        target: "",
        title: "That is the whole console",
        body:
          "No login, no payment, and nothing you have to configure to start. Replay this tour, or any single chapter, from ⌘K → \"Take the tour\" or the profile menu. Start with the Brief board if you want the short version of what changed today.",
        placement: "center",
      },
    ],
  },
];

/**
 * The order the chapters are walked in.
 *
 * Not the order they were written. A reviewer taking the tour cold made the case
 * that the original sequence dissected a widget header before the visitor had any
 * reason to care which widgets were on screen: boards are the concept that makes
 * the rest useful ("pick the board matching your job and the whole screen
 * reconfigures"), and the rail's ＋ is how widgets get onto a board in the first
 * place. So: shape of the screen → boards → the map → where data comes from →
 * what a widget is → how much to trust it → going faster → preferences.
 */
const CHAPTER_ORDER = [
  "orientation",
  "boards",
  "map",
  "sources",
  "widgets",
  "trust",
  "power",
  "settings",
] as const;

export const TOUR_CHAPTERS: TourChapter[] = CHAPTER_ORDER.map((id) => {
  const chapter = AUTHORED_CHAPTERS.find((c) => c.id === id);
  // A typo here would silently shorten the tour, which is the whole class of bug
  // this rewrite exists to remove. Fail loudly at module load instead.
  if (!chapter) throw new Error(`CHAPTER_ORDER names "${id}", which is not an authored chapter`);
  return chapter;
});

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers. Everything below is DOM-free so the run can be reasoned about
// (and tested) without a browser.
// ─────────────────────────────────────────────────────────────────────────────

/** A step's targets as an array — "" (a framing card) yields an empty list. */
export function targetsOf(step: TourStep): string[] {
  if (Array.isArray(step.target)) return step.target.filter((t) => t !== "");
  return step.target === "" ? [] : [step.target];
}

/** True when a step is a centred framing card rather than a spotlight. */
export function isFramingStep(step: TourStep): boolean {
  return targetsOf(step).length === 0;
}

/**
 * The first of a step's targets that is actually on the page, or null. Lets a step
 * name a precise hook and fall back to the surface containing it, so a spotlight
 * lands on something real instead of the step being dropped.
 */
export function firstPresentTarget(step: TourStep, hasTarget: (sel: string) => boolean): string | null {
  for (const t of targetsOf(step)) if (hasTarget(t)) return t;
  return null;
}

/** True when a step's setup opens a surface, and so can bring its own target into being. */
export function opensSomething(step: TourStep): boolean {
  return (step.setup ?? []).some((a) => a.kind === "ensure");
}

/** A step flattened out of its chapter, carrying the progress it needs to render. */
export interface FlatStep {
  step: TourStep;
  chapterId: string;
  chapterTitle: string;
  chapterIcon: string;
  /** 1-based position of this chapter within the run. */
  chapterNumber: number;
  /** How many chapters the run holds. */
  chapterCount: number;
  /** 1-based position of this step within its chapter. */
  stepNumber: number;
  /** How many steps this chapter holds. */
  stepCount: number;
}

/**
 * Build the run: drop steps whose targets are all absent, drop chapters left with
 * nothing to point at, then number what survives.
 *
 * `hasTarget` is injected rather than read from the DOM so this stays pure. A
 * chapter whose only survivors are framing cards is dropped entirely — a chapter
 * of prose about controls that are not on screen is worse than no chapter, and at
 * a phone width several of them genuinely are not.
 *
 * `only` restricts the run to one chapter (the menu's per-chapter buttons);
 * null/undefined runs the lot.
 */
export function buildRun(
  chapters: TourChapter[],
  hasTarget: (selector: string) => boolean,
  only?: string | null,
): FlatStep[] {
  const scoped = only ? chapters.filter((c) => c.id === only) : chapters;

  const kept = scoped
    .map((chapter) => ({
      chapter,
      steps: chapter.steps.filter(
        (s) =>
          isFramingStep(s) ||
          // A control that has not appeared YET is not a control that is absent.
          s.reactive === true ||
          // A step that OPENS its own surface cannot be judged by what is on
          // screen right now — its target does not exist until setup has run.
          // Only an `ensure` earns that exemption: a `close`-only setup (several
          // steps just tidy away the previous step's popover) creates nothing, so
          // letting it stand in kept steps for controls the viewport does not
          // render — which is how a 390px phone was told about the keyboard-shortcut
          // strip that is `display: none` at that width.
          opensSomething(s) ||
          firstPresentTarget(s, hasTarget) !== null,
      ),
    }))
    // A chapter earns its place only if something real survived in it.
    .filter(({ steps }) => steps.some((s) => !isFramingStep(s)));

  const out: FlatStep[] = [];
  kept.forEach(({ chapter, steps }, ci) => {
    steps.forEach((step, si) => {
      out.push({
        step,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterIcon: chapter.icon,
        chapterNumber: ci + 1,
        chapterCount: kept.length,
        stepNumber: si + 1,
        stepCount: steps.length,
      });
    });
  });
  return out;
}

/** The chapters a run actually contains, in order, for the menu's "you are here". */
export function chaptersInRun(run: FlatStep[]): string[] {
  const seen: string[] = [];
  for (const f of run) if (!seen.includes(f.chapterId)) seen.push(f.chapterId);
  return seen;
}

/**
 * The cleanup for every chapter the run is LEAVING when it moves from index
 * `from` to index `to` — including the case where it is ending (`to` past the end).
 * Stepping backwards within a chapter cleans up nothing.
 */
export function cleanupBetween(
  chapters: TourChapter[],
  run: FlatStep[],
  from: number,
  to: number,
): TourAction[] {
  const leaving = run[from]?.chapterId;
  const arriving = run[to]?.chapterId ?? null;
  if (leaving == null || leaving === arriving) return [];
  return chapters.find((c) => c.id === leaving)?.cleanup ?? [];
}

/** Every cleanup action in the tour — run when it closes, whatever the exit route. */
export function allCleanup(chapters: TourChapter[]): TourAction[] {
  return chapters.flatMap((c) => c.cleanup ?? []);
}

/**
 * True when a visitor should be auto-invited: they have never completed the tour,
 * or they last saw an older version. `seenVersion` is null on a first-ever visit.
 */
export function shouldAutoRunTour(seenVersion: number | null, current: number = TOUR_VERSION): boolean {
  return seenVersion == null || seenVersion < current;
}

/** Clamp an index into [0, len-1]; 0 for an empty run. */
export function clampStep(index: number, len: number): number {
  if (len <= 0) return 0;
  return Math.min(Math.max(index, 0), len - 1);
}

/** True when `index` is the final step of a `len`-length run (the "Done" affordance). */
export function isLastStep(index: number, len: number): boolean {
  return len > 0 && index >= len - 1;
}

/** Index of the first step of the next chapter, or run.length when there is none. */
export function nextChapterStart(run: FlatStep[], index: number): number {
  const here = run[index]?.chapterId;
  if (here == null) return run.length;
  for (let i = index + 1; i < run.length; i++) if (run[i].chapterId !== here) return i;
  return run.length;
}

/** Index of the first step of the chapter `index` sits in — the "restart chapter" target. */
export function chapterStart(run: FlatStep[], index: number): number {
  const here = run[index]?.chapterId;
  if (here == null) return 0;
  let i = index;
  while (i > 0 && run[i - 1].chapterId === here) i--;
  return i;
}

/**
 * Flat list of every step, unfiltered — the shape the coverage test walks to
 * assert that no console control goes unexplained.
 */
export const TOUR_STEPS: TourStep[] = TOUR_CHAPTERS.flatMap((c) => c.steps);

/** Every selector the tour can spotlight, deduped. Used by the coverage test. */
export function allTourTargets(chapters: TourChapter[] = TOUR_CHAPTERS): string[] {
  const out = new Set<string>();
  for (const c of chapters) for (const s of c.steps) for (const t of targetsOf(s)) out.add(t);
  return [...out];
}
