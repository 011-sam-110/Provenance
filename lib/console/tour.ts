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
// eleven camera feeds, thirty-five signal layers, sixty-nine widget types and a
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
 */
export const TOUR_VERSION = 2;

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

const OPEN_SETTINGS: TourAction = { kind: "ensure", want: ".tn-settings", click: ".tn-settings-trigger" };
const SHUT_SETTINGS: TourAction = { kind: "close", want: ".tn-settings", click: ".tn-settings-close" };

// ─────────────────────────────────────────────────────────────────────────────
// The walkthrough.
// ─────────────────────────────────────────────────────────────────────────────

export const TOUR_CHAPTERS: TourChapter[] = [
  // ── 1 ──────────────────────────────────────────────────────────────────────
  {
    id: "orientation",
    title: "The layout",
    summary: "The five bands of the console, and what each one is for",
    icon: "▤",
    steps: [
      {
        id: "orientation-lead",
        target: "",
        title: "Start with the shape of it",
        body:
          `${BRAND.name} is one screen in five horizontal bands. Learn the bands and everything else has an address. Nothing here needs a login, a key or a payment.`,
        placement: "center",
      },
      {
        id: "orientation-header",
        target: ".tnx-hdr-brand",
        title: "Band 1 — the header",
        body:
          "The top strip is navigation and identity: the boards you can switch between, a UTC clock, the layout mode, and the way into the command bar and settings. It never scrolls away.",
        placement: "bottom",
      },
      {
        id: "orientation-health",
        target: [".tnx-feed-counts", ".tnx-feed"],
        title: "Band 2 — feed health",
        body:
          "Every data layer reports whether its last fetch worked. This strip is the running tally: live, lagging, down, locked behind a key, or idle. It is the first place to look when a layer shows nothing.",
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
          "The stage shares a twelve-column grid with the widgets around it. Each widget watches one source and can be moved, resized, duplicated or removed. Chapter 4 takes one apart.",
        placement: "left",
      },
      {
        id: "orientation-footer",
        target: [".tnx-sel", ".tnx-footer"],
        title: "Band 4 — the selection bar",
        body:
          "The answer to \"what did I just click?\". Selecting a pin on the map or a row in a widget writes its name and coordinates here — the map flies, but only this bar says what it flew to. Esc clears it.",
        placement: "top",
      },
      {
        id: "orientation-ticker",
        target: [".tnx-ticker", ".tnx-keys"],
        title: "Band 5 — ticker and keys",
        body:
          "The footer also runs a live ticker of what is arriving, and lists the four single-key shortcuts: W for wall, C for console, / for search, Esc to clear.",
        placement: "top",
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
        title: "The map is a tool, not a backdrop",
        body:
          "It switches between a 3D globe and a flat 2D map, carries four basemaps, geocodes any place on Earth, and explains its own colours. Here is each control.",
        placement: "center",
      },
      {
        id: "map-projection",
        target: ".tnx-stage-proj",
        title: "3D globe ⇄ 2D flat",
        body:
          "The same data, two projections. The globe is better for orbital and long-haul context; flat is better for reading dense regions and for anything you want to compare side by side. The label to the left tells you which you are in.",
        placement: "bottom",
      },
      {
        id: "map-basemaps",
        target: ".tnx-basemaps",
        title: "Basemaps",
        body:
          "Satellite imagery, a calm light map, a topographic map with terrain, and a dark one. Pick by task: imagery to see what a place actually looks like, topographic for elevation, light or dark to let the data layers carry the colour.",
        placement: "bottom",
      },
      {
        id: "map-search",
        target: ".tnx-stage-search",
        title: "Search anywhere",
        body:
          "Type any place name — a city, a street, an airport — and pick a result to fly there and drop a pin. Press / from anywhere in the console to jump into this box.",
        placement: "right",
      },
      {
        id: "map-legend",
        target: ".tnx-stage-legend",
        title: "The legend is derived, not decorative",
        body:
          "It lists the layers that are on right now, in the colours the map is actually painting them. Cameras are coloured by source region, aircraft by type, satellites by category — so a fixed key would be a lie within a week.",
        placement: "left",
      },
      {
        id: "map-cursor",
        target: ".tnx-stage-cursor",
        title: "Cursor coordinates",
        body:
          "Live latitude and longitude under the pointer. It shows a dash until your pointer has actually been over the map, rather than claiming a fake 0.00N 0.00E.",
        placement: "left",
      },
      {
        id: "map-pins",
        target: [".tn-pinnav", ".tnx-stage-foot"],
        title: "Pins and world clocks",
        body:
          "Searching drops a pin, and the pin navigator steps between them, flies back to any one, and clears them. The bar along the bottom of the stage carries local time in several cities so an event has a human hour attached.",
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
    summary: "Six ready-made workspaces, two layout modes, two skins",
    icon: "▦",
    steps: [
      {
        id: "boards-lead",
        target: "",
        title: "Six boards, each a job",
        body:
          "A board is a whole workspace: which widgets are open, where they sit, and which map layers are on. Switching board changes all three at once.",
        placement: "center",
      },
      {
        id: "boards-tabs",
        target: [".tnx-hdr-boards", ".tn-preset-pill"],
        title: "The boards",
        body:
          "Brief (what changed since you last looked) · Conflict (armed events, protest, military movement) · Hazards (quake, fire, flood, storm) · Transit (aircraft, vessels, orbit) · Markets & Cyber (economy, outages, intrusions) · Recon (domain and IP intel, photo geolocation).",
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
        id: "boards-mode",
        target: ".tnx-hdr-mode",
        title: "Console ⇄ Wall",
        body:
          "Console keeps the map dominant with widgets around it. Wall drops the map back and spreads every widget across the grid — the view for a second screen you glance at. Keys C and W do the same thing.",
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
          "Every widget has the same header. Once you know it you know all sixty-nine of them. This chapter opens each control in turn on a real widget.",
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
          "How old this widget's data actually is, ageing in place: live, then \"4m old\", then stale. A feed that quietly freezes shows it here instead of continuing to look healthy — that failure is the single most common complaint about tools like this one.",
        placement: "bottom",
      },
      {
        id: "widgets-help",
        target: ".tn-cw-help",
        title: "? — what am I looking at",
        body:
          "Every widget explains itself. No jargon, no assumption you already know the source.",
        placement: "bottom",
      },
      {
        id: "widgets-help-pop",
        target: ".tn-cw-help-pop",
        title: "The trust card",
        body:
          "It names what the widget shows, which organisation the data comes from, and — this is the part most products skip — how the source knows: measured by an instrument, officially reported, or inferred by a machine. It also says what the layer cannot tell you.",
        placement: "bottom",
        setup: [OPEN_HELP],
        settleMs: 120,
      },
      {
        id: "widgets-bell",
        target: ".tn-cw-bell",
        title: "🔔 — tell me when it changes",
        body: "Arm any widget and it will notify you when something new arrives.",
        placement: "bottom",
        setup: [SHUT_HELP],
      },
      {
        id: "widgets-bell-pop",
        target: ".tn-cw-notify-pop",
        title: "Channels and a threshold",
        body:
          "Browser notifications work immediately. Telegram and Discord light up once you have pasted credentials in Settings. The threshold suppresses everything under a number you choose — a magnitude, a count — so an armed widget stays quiet until it matters.",
        placement: "bottom",
        setup: [OPEN_BELL],
        settleMs: 120,
      },
      {
        id: "widgets-expand",
        target: ".tn-cw-expand",
        title: "⤢ — expand onto the stage",
        body:
          "Throws this widget full-size onto the centre stage, over the map, for when a table needs the room. The map chrome steps aside while it is there.",
        placement: "bottom",
        setup: [SHUT_BELL],
      },
      {
        id: "widgets-menu",
        target: ".tn-cw-menu",
        title: "⋯ — everything else",
        body: "Position, size, duplication, export and removal all live in one menu.",
        placement: "bottom",
      },
      {
        id: "widgets-menu-pop",
        target: ".tn-cw-menu-pop",
        title: "Move, size, duplicate, export, remove",
        body:
          "Arrows nudge the card one cell at a time and the width and height chips snap it to named sizes — both work without a mouse. Below: duplicate the widget, choose whether its alerts sit on top or inline, download what you are looking at as CSV or GeoJSON, or remove it.",
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
          "Eleven camera networks and thirty-five global signal layers, each with a map toggle, a live count, an attribution and its own freshness. This is where you compose what the map shows.",
        placement: "center",
      },
      {
        id: "sources-fab",
        target: ".tn-rail-fab",
        title: "≡ Sources",
        body:
          "The rail starts collapsed so the board gets the screen. One click opens it, and it pushes the grid across rather than covering it.",
        placement: "right",
      },
      {
        id: "sources-search",
        target: ".tn-cat-search",
        title: "Search the catalogue",
        body:
          "Forty-six sources is more than anyone scrolls. Type a word — quake, cyber, camera, cable — and the whole rail filters to matching layers with their groups already expanded.",
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
          "A coloured dot matching the map, the name, who supplies it, and how long ago it last answered. On the right: the live count, a ＋ that puts this source on your board as a widget, and the switch that puts it on the map.",
        placement: "right",
        setup: [OPEN_RAIL],
      },
      {
        id: "sources-widget-toggle",
        target: [".tn-widget-toggle", ".tn-layer-row"],
        title: "＋ — any source becomes a widget",
        body:
          "This is the shortcut worth knowing. ＋ docks that feed onto your workspace as its own live tile; ▦ means it is already there. The counter at the top of the rail tracks how many you have open.",
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
        title: "Camera filters",
        body:
          "Open the Cameras row and you can filter by agency feed, hide whole regions, or show only cameras serving genuine live video rather than a still that refreshes.",
        placement: "right",
        setup: [OPEN_RAIL, { kind: "ensure", want: ".tn-cam-filters", click: ".tn-layer-head" }],
        settleMs: 160,
      },
      {
        id: "sources-signals",
        target: [".tn-signals-header", ".tn-signals"],
        title: "Global signals",
        body:
          "Thirty-five opt-in intelligence layers grouped by theme — hazards, conflict, cyber, maritime, infrastructure, humanitarian — plus a Country Instability Index built from four of them. All off by default; you choose what to look at.",
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
          "The small chip beside a source grades it: measured by an instrument, officially reported, or a machine's interpretation of text. Everything on this map draws the same coloured dot, so without this a seismometer and a news-wire guess would look equally authoritative.",
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
          "Three panels at the foot of the rail. Coverage is the honest map of what we do and do not have, by country. Markets is the economic board. Saved is your watchlist of places worth coming back to.",
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
        title: "The part most of these tools skip",
        body:
          "A wall of live-looking dots is easy. Saying which ones you should actually trust is the hard part, and it is the reason this console is built the way it is.",
        placement: "center",
      },
      {
        id: "trust-health",
        target: [".tnx-feed-counts", ".tnx-feed"],
        title: "Five states, not two",
        body:
          "LIVE means the last fetch worked — including layers that are connected and genuinely have nothing to report. LAG is behind. DOWN failed or has gone quiet for hours. LOCKED needs a key. IDLE is switched off, which is neither a fault nor a clean bill of health.",
        placement: "bottom",
      },
      {
        id: "trust-cells",
        target: [".tnx-feed-cells", ".tnx-feed"],
        title: "Per-layer, not just a total",
        body:
          "Each cell is one layer's current state, so a single dead feed is visible rather than averaged away into a reassuring summary.",
        placement: "bottom",
      },
      {
        id: "trust-counts",
        target: [".tn-layer-count", ".tn-cw-count", ".tn-cw-head"],
        title: "Counts say what they cover",
        body:
          "Where a source only gives us part of the picture, the count says so — \"300 of 470\" rather than a confident 300. A number with no denominator is a claim we cannot support.",
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
        target: ".tnx-hdr-kofi",
        title: "You can check all of this",
        body:
          `The whole console is free software under the ${BRAND.license.name}. SOURCE opens the repository, so every adapter, filter and claim in this tour can be read rather than taken on trust. SUPPORT is optional and changes nothing about what you get.`,
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
          "Everything in the last six chapters has a keyboard route through one search box.",
        placement: "center",
      },
      {
        id: "power-trigger",
        target: ".tn-palette-trigger",
        title: "⌘K — the command bar",
        body:
          "Command-K on a Mac, Ctrl-K everywhere else, from anywhere in the console. This button does the same thing if you would rather click it.",
        placement: "bottom",
      },
      {
        id: "power-palette",
        target: [".tn-palette-root", ".tn-palette-trigger"],
        title: "One box for the whole app",
        body:
          "Type to switch board, add any of the sixty-nine widgets, toggle a map layer, change basemap, jump to a covered region, fly to any place on Earth by name, dive into a live camera, change language or theme — or replay this tour.",
        placement: "center",
        setup: [OPEN_PALETTE],
        settleMs: 160,
      },
      {
        id: "power-workspace",
        target: [".tn-palette-root", ".tn-palette-trigger"],
        title: "Save and share, in the same box",
        body:
          "\"Copy shareable link\" encodes your exact layout into a URL that rebuilds it for whoever you send it to. \"Save layout as preset\" keeps it as your own board alongside the six built-in ones.",
        placement: "center",
        setup: [OPEN_PALETTE],
      },
      {
        id: "power-keys",
        target: ".tnx-keys",
        title: "The single-key shortcuts",
        body:
          "W and C switch layout mode, / jumps to map search, Esc clears your selection. They are ignored while you are typing in a field, so they never eat a keystroke.",
        placement: "top",
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
    cleanup: [SHUT_SETTINGS],
    steps: [
      {
        id: "settings-trigger",
        target: ".tn-settings-trigger",
        title: "⚙ — settings",
        body: "The drawer holding everything that is a preference rather than a view.",
        placement: "bottom",
      },
      {
        id: "settings-panel",
        target: [".tn-settings", ".tn-settings-trigger"],
        title: "Theme, language, alert channels",
        body:
          "Light or dark, English, Spanish or French, and the credentials for the two alert channels — a Telegram bot token and chat id, or a Discord webhook. Both are stored in your browser and sent nowhere else; until one is set, those channels stay greyed out on every widget's 🔔.",
        placement: "left",
        setup: [OPEN_SETTINGS],
        settleMs: 200,
      },
      {
        id: "settings-profile",
        target: [".tn-profile-avatar", ".tnx-hdr-profile"],
        title: "Your profile",
        body:
          "A display name for this browser, and where accounts will live. There is no account today and nothing is uploaded — your boards, pins and keys are stored locally.",
        placement: "bottom",
        setup: [SHUT_SETTINGS],
      },
      {
        id: "settings-done",
        target: "",
        title: "That is the whole console",
        body:
          "Nothing you have seen needs a key or a login. Replay this tour, or any single chapter, from ⌘K → \"Take the tour\". Start with the Brief board if you want the short version of what changed today.",
        placement: "center",
      },
    ],
  },
];

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
