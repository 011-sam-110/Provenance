// Every word the God's eye view puts on screen, as pure functions, so one test file
// (tests/unit/eye-wording.test.ts) can hold the product's honesty rules over all of
// them: a still is never called live, a speed is never invented, and each count
// names who measured it.

/** "51.5013° N". Four decimals is about 10 m, the precision a street view can show. */
export function fmtLat(lat: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}`;
}

/** "0.1218° W". */
export function fmtLon(lon: number): string {
  return `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? "E" : "W"}`;
}

/**
 * The title of a view with no place name: "51.5072° N, 0.1268° W". A no-break space holds each
 * figure to its letter, so a narrow screen breaks the title only after the comma, never before
 * the "W" (seen at 390 px, 29 Oct 2026). fmtLat and fmtLon keep a plain space: the footer's
 * readout does not wrap, and the vessel panel's Position row reads them as they are.
 */
export function fmtSpot(lat: number, lon: number): string {
  return `${fmtLat(lat).replace(" ", "\u00A0")}, ${fmtLon(lon).replace(" ", "\u00A0")}`;
}

/** A compass heading as three digits, "032". */
export function fmtHeading(deg: number): string {
  const d = Math.round(((deg % 360) + 360) % 360) % 360;
  return String(d).padStart(3, "0");
}

/**
 * "22:42:52", in UTC: the HUD clock names its zone beside it. A recording shows the
 * minute only ("22:42"): it is filmed frame by frame, slower than it plays, so a
 * seconds hand would race.
 */
export function fmtClockUtc(ms: number, seconds = true): string {
  return new Date(ms).toISOString().slice(11, seconds ? 19 : 16);
}

/**
 * The credits line, from the text of MapLibre's own attribution control (which keeps
 * it to the sources in use): one entry per source, each once, the ground first (the
 * imagery, then the map data the buildings come from), then the feeds in the
 * control's order.
 */
export function creditsFromAttribution(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split("|")) {
    const c = raw.replace(/\s+/g, " ").trim();
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  const rank = (c: string) => (/imagery/i.test(c) ? 0 : /openstreetmap|openmaptiles|openfreemap/i.test(c) ? 1 : 2);
  return out.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c);
}

/** The line under the ledger: "Vessels and aircraft refreshed 12 s ago". */
export function refreshedText(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "Vessels and aircraft refreshed just now";
  if (s < 120) return `Vessels and aircraft refreshed ${s} s ago`;
  return `Vessels and aircraft refreshed ${Math.round(s / 60)} min ago`;
}

/** "1 vessel", "2 vessels". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * "of 24 nearby", or nothing when every one nearby is already counted. A ledger count
 * is what carries words on screen (a card, a tag), so a reader can check it by eye;
 * this says how many more the view fetched around it.
 */
export function ofNearby(count: number, nearby: number): string[] {
  return nearby > count ? [`of ${nearby} nearby`] : [];
}

/** What one ledger row counts. Each kind has its own colour in the view. */
export type LedgerKind = "cam" | "ship" | "plane" | "road" | "speed" | "signal";

/**
 * One row of the ledger: what the view shows, how many, and who measured it.
 * `count` is null for a row that states an absence ("no open speed feed").
 */
export interface LedgerRow {
  kind: LedgerKind;
  count: number | null;
  /** Wide screens: the noun after the count. */
  label: string;
  /** Wide screens: the source and its cadence, in the faint ink. */
  detail: string;
  /** Phone: the label under the count. */
  short: string;
  /** A console layer's own colour (kind "signal"), for the dot; the other kinds have theirs in the CSS. */
  color?: string;
  /** Kind "signal": the layer's id, since there is a row for each console layer that is on. */
  id?: string;
}

// ── The sidebar, the Sources tray and the search ─────────────────────────────────────
//
// The sidebar is components/rail/SideRail.tsx; these are its rows in this view. "Sources &
// layers" opens the Sources tray beside it (components/eye/EyeSources.tsx).

/** The sidebar's accessible name, and the word beside its three bars when it is open. */
export const RAIL_NAME = "Map tools";
export const RAIL_MENU_WORD = "Provenance";

export const AUTO_TURN_LABEL = "Auto-turn";
export const CONTROLS_LABEL = "Controls";

/** The sidebar's row, and the tray's name. */
export function sourcesName(): string {
  return "Sources & layers";
}

/**
 * The way out of this view to the console, at the foot of the sidebar (EyeHud.tsx): the console
 * at the spot on screen, with its rail as the visitor left it.
 */
export const EXIT_LABEL = "Exit to dashboard";

/** The way to the landing page, in the credits pop-up, for a visitor who came from a reel. */
export const HOME_LABEL = "About Provenance";

export const CREDITS_LABEL = "© Credits";

export const EYE_SEARCH_PLACEHOLDER = "Search places, cameras, vessels";
export const EYE_SEARCH_NAME = "Search places, cameras and vessels";
export const CLEAR_SEARCH = "Clear search";
export const SEARCH_RESULTS_NAME = "Search results";
export const NO_MATCHES = "No matches";
export const SEARCHING_PLACES = "Searching places";
export const SEARCH_DOWN = "Place search is not answering";
/** The word at the end of a result's row. */
export const SEARCH_KIND_WORD: Readonly<Record<"place" | "camera" | "vessel", string>> = {
  place: "Place",
  camera: "Camera",
  vessel: "Vessel",
};

/** The first section of the tray: this view's own seven. */
export const THIS_VIEW = "This view";

/**
 * The sections of the console's rail by their short names, for the tray's strip. Keyed by
 * the rail's section id (lib/console/sources/sections.ts); the full titles are the rail's
 * own and Show all uses those. A section id this map lacks falls back to its full title.
 */
export const SECTION_SHORT: Readonly<Record<string, string>> = {
  ground: "Ground",
  "air-space": "Air & space",
  hazards: "Hazards",
  infrastructure: "Infrastructure",
  security: "Security",
  human: "Air quality",
};

/** How precisely a layer places what it shows, in words (lib/signals/types.ts, SignalPrecision). */
export function precisionWords(precision: "exact" | "facility" | "area" | "country"): string {
  switch (precision) {
    case "exact":
      return "exact points";
    case "facility":
      return "named sites";
    case "area":
      return "areas, not exact points";
    case "country":
      return "country figures";
  }
}

/** The row's popover, second line: how the layer is drawn. */
export function drawnAsText(precision: "exact" | "facility" | "area" | "country" | null): string {
  return precision ? `Drawn as ${precisionWords(precision)}` : "Drawn on the map";
}

/** The road rows' switch and popover outside London, where TfL has nothing to say. */
export const LONDON_ONLY = "London only in this view";

/** The line when the sidebar has no room for another pin. */
export function pinCapText(cap: number): string {
  return `The sidebar holds ${cap}. Unpin one first.`;
}

/** The tray's search found nothing. */
export function noMatchText(query: string): string {
  return `No source here is called \u201c${query}\u201d.`;
}

/** The tray's foot: what this view leaves out, by reason, and where it is. Null when nothing is. */
export function leftOutText(left: { country: number; widget: number }): string | null {
  const parts = [...(left.country > 0 ? ["country-wide layers"] : []), ...(left.widget > 0 ? ["the headlines"] : [])];
  return parts.length > 0 ? `Not drawn here: ${parts.join(" and ")}. The dashboard has them.` : null;
}

/**
 * The ledger row of a console layer that is on in this view: how many of its marks are
 * on screen, whose they are, and how precisely they place what they show. A layer with
 * no marks to count (the borders, the satellites) passes `count: null` and states what
 * it is instead.
 */
export function signalLedgerRow(
  row: { id: string; label: string; credit: string; precision: "exact" | "facility" | "area" | "country" | null; color: string },
  count: number | null,
): LedgerRow {
  const where = count == null ? "drawn on the map" : count === 0 ? "none in view" : "in view";
  const detail = [where, row.credit, row.precision ? precisionWords(row.precision) : ""].filter(Boolean).join(", ");
  return { kind: "signal", id: row.id, count, label: row.label, detail, short: row.label, color: row.color };
}

// ── Pins in the sidebar, said aloud ─────────────────────────────────────────────────

/** The tray's section strip and its two views. */
export const SECTIONS_TAB = "Sections";
export const SHOW_ALL_TAB = "Show all";
export const SEARCH_PLACEHOLDER = "Search sources\u2026";
export const CLOSE_SOURCES = "Close sources";

export function pinName(label: string, pinned: boolean): string {
  return pinned ? `Unpin ${label} from the sidebar` : `Pin ${label} to the sidebar`;
}

export function switchName(label: string): string {
  return `Show ${label} in this view`;
}

export function pinnedText(label: string): string {
  return `Pinned ${label} to the sidebar.`;
}

export function unpinnedText(label: string): string {
  return `Unpinned ${label}.`;
}
