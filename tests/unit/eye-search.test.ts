import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EYE_PLACES, eyePlaceHref, parseEyeLink } from "@/lib/eye/places";
import {
  SEARCH_LIMIT,
  combineResults,
  geocodeResults,
  markResults,
  matchScore,
  presetResults,
  rankResults,
  searchStatus,
  wantsGeocoder,
  type SearchResult,
} from "@/lib/eye/search";
import { NO_MATCHES, SEARCHING_PLACES, SEARCH_DOWN, SEARCH_KIND_WORD } from "@/lib/eye/wording";

/**
 * The God's eye view's search box: what it finds, the order it lists it in, and where the typed
 * text may go. tests/e2e/eye-hud-v2.spec.ts drives the box itself.
 */

const CAMERAS = [
  { id: "cam-1", name: "Westminster Bridge", lat: 51.5, lon: -0.12 },
  { id: "cam-2", name: "Parliament Square", lat: 51.5, lon: -0.127 },
  { id: "cam-3", name: "A4 Tower Hill", lat: 51.51, lon: -0.08 },
];
const VESSELS = [
  { id: "ship-1", name: "THAMES CLIPPER", lat: 51.5, lon: -0.1 },
  { id: "ship-2", name: "Tower Lady", lat: 51.505, lon: -0.07 },
  { id: "ship-3", name: "   ", lat: 51.5, lon: -0.09 },
];
const names = (rows: readonly SearchResult[]) => rows.map((r) => r.name);

describe("a focused empty box", () => {
  it("lists the three framed places, each at its own page's address", () => {
    const rows = presetResults();
    expect(rows.map((r) => r.name)).toEqual(EYE_PLACES.map((p) => p.name));
    expect(rows.map((r) => r.kind === "place" && r.href)).toEqual(EYE_PLACES.map((p) => eyePlaceHref(p.id)));
  });
});

describe("what the scene holds", () => {
  it("becomes results that carry their id and their spot", () => {
    const rows = markResults(CAMERAS, []);
    expect(rows[0]).toEqual({ kind: "camera", key: "camera:cam-1", name: "Westminster Bridge", id: "cam-1", lat: 51.5, lon: -0.12 });
  });

  it("drops a mark with no name, which nobody can search for", () => {
    expect(names(markResults([], VESSELS))).toEqual(["THAMES CLIPPER", "Tower Lady"]);
  });
});

describe("matchScore", () => {
  it("ranks the whole name, then its start, then a word's start, then anywhere", () => {
    const q = "tower";
    expect(matchScore("Tower", q)).toBeGreaterThan(matchScore("Tower Bridge", q));
    expect(matchScore("Tower Bridge", q)).toBeGreaterThan(matchScore("A4 Tower Hill", q));
    expect(matchScore("A4 Tower Hill", q)).toBeGreaterThan(matchScore("Watchtower", q));
    expect(matchScore("Watchtower", q)).toBeGreaterThan(0);
  });

  it("ignores case and the spaces around what was typed", () => {
    expect(matchScore("THAMES CLIPPER", "  thames ")).toBe(3);
  });

  it("finds the words typed in any order, and nothing for an empty box", () => {
    expect(matchScore("Tower Bridge", "bridge tower")).toBeGreaterThan(0);
    expect(matchScore("Tower Bridge", "bridge paris")).toBe(0);
    expect(matchScore("Tower Bridge", "   ")).toBe(0);
  });
});

describe("rankResults", () => {
  const all = [...presetResults(), ...markResults(CAMERAS, VESSELS)];

  it("puts the best match first and leaves out what does not match", () => {
    expect(names(rankResults(all, "tower"))).toEqual(["Tower Bridge", "Tower Lady", "A4 Tower Hill"]);
  });

  it("among equals lists a place, then a camera, then a vessel", () => {
    const same: SearchResult[] = [
      { kind: "vessel", key: "v", name: "Marina", id: "v", lat: 0, lon: 0 },
      { kind: "camera", key: "c", name: "Marina", id: "c", lat: 0, lon: 0 },
      { kind: "place", key: "p", name: "Marina", href: "/eye" },
    ];
    expect(rankResults(same, "marina").map((r) => r.kind)).toEqual(["place", "camera", "vessel"]);
  });

  it("gives nothing for words nothing holds", () => {
    expect(rankResults(all, "qqqq")).toEqual([]);
  });
});

describe("combineResults", () => {
  const local = Array.from({ length: 9 }, (_, i): SearchResult => ({ kind: "camera", key: `c${i}`, name: `Camera ${i}`, id: `c${i}`, lat: 0, lon: 0 }));
  const places = geocodeResults([
    { name: "Paris, France", lat: 48.85, lon: 2.35 },
    { name: "Paris, Texas", lat: 33.66, lon: -95.55 },
    { name: "Paris, Ontario", lat: 43.2, lon: -80.38 },
  ]);

  it("holds the list to its limit and keeps room for the geocoder's places", () => {
    const out = combineResults(local, places);
    expect(out).toHaveLength(SEARCH_LIMIT);
    expect(out.slice(-2).map((r) => r.name)).toEqual(["Paris, France", "Paris, Texas"]);
  });

  it("gives the room back when the geocoder has nothing", () => {
    expect(combineResults(local, [])).toHaveLength(SEARCH_LIMIT);
    expect(combineResults(local, []).every((r) => r.kind === "camera")).toBe(true);
  });

  it("lists a name once, the one in the scene first", () => {
    const here: SearchResult = { kind: "place", key: "p", name: "Paris, France", href: "/eye?place=x" };
    const out = combineResults([here], places);
    expect(out.filter((r) => r.name === "Paris, France")).toEqual([here]);
  });
});

describe("a place from the geocoder", () => {
  it("opens at a spot this page reads back as the same spot", () => {
    const [row] = geocodeResults([{ name: "Lisbon, Portugal", lat: 38.7223, lon: -9.1393 }]);
    expect(row.kind).toBe("place");
    const href = row.kind === "place" ? row.href : "";
    expect(href.startsWith("/eye?")).toBe(true);
    const target = parseEyeLink(new URLSearchParams(href.slice(href.indexOf("?") + 1)), false);
    expect(target.view.lat).toBeCloseTo(38.7223, 3);
    expect(target.view.lon).toBeCloseTo(-9.1393, 3);
  });

  it("drops a row with no usable spot instead of throwing on it", () => {
    const bad = [{ name: "No spot", lat: Number.NaN, lon: 1 }, { name: "No spot either", lat: 1, lon: Number.POSITIVE_INFINITY }];
    expect(geocodeResults(bad)).toEqual([]);
  });
});

describe("what leaves the browser", () => {
  it("is a place search, and only once it is long enough to mean something", () => {
    expect(wantsGeocoder("Lisbon")).toBe(true);
    expect(wantsGeocoder("St. James's Park")).toBe(true);
    expect(wantsGeocoder("Rue de l'Abbaye")).toBe(true);
    expect(wantsGeocoder("a")).toBe(false);
    expect(wantsGeocoder("   ")).toBe(false);
  });

  it("is never a typed IP or domain, which is not a place", () => {
    for (const target of ["8.8.8.8", "2606:4700:4700::1111", "example.com", "bbc.co.uk"]) {
      expect(wantsGeocoder(target), target).toBe(false);
    }
  });

  it("is the page's own route, as /privacy's place search row says", () => {
    const search = readFileSync(resolve(__dirname, "../../components/eye/EyeSearch.tsx"), "utf8");
    expect(search).toContain("/api/geocode?q=");
    expect(search.match(/fetch\(/g)).toHaveLength(1);
    expect(search).toContain("wantsGeocoder(q)");
    const privacy = readFileSync(resolve(__dirname, "../../app/(site)/privacy/page.tsx"), "utf8");
    expect(privacy).toMatch(/Search for a place|place search/i);
  });
});

describe("the line under the results", () => {
  it("says nothing for an empty box, or while there are results", () => {
    expect(searchStatus("", 0, "idle")).toBeNull();
    expect(searchStatus("tower", 3, "done")).toBeNull();
    expect(searchStatus("tower", 3, "pending")).toBeNull();
  });

  it("says the geocoder is being asked only when nothing else is listed", () => {
    expect(searchStatus("lisbon", 0, "pending")).toBe(SEARCHING_PLACES);
  });

  it("says no matches when the answer is in and empty", () => {
    expect(searchStatus("qqqq", 0, "done")).toBe(NO_MATCHES);
    expect(searchStatus("8.8.8.8", 0, "idle")).toBe(NO_MATCHES);
  });

  it("says a failed geocoder, also beside results, so a short list does not read as all there is", () => {
    expect(searchStatus("tower", 2, "failed")).toBe(SEARCH_DOWN);
    expect(searchStatus("qqqq", 0, "failed")).toBe(SEARCH_DOWN);
  });

  it("has a word for each kind of result, and never calls one live", () => {
    expect(Object.keys(SEARCH_KIND_WORD).sort()).toEqual(["camera", "place", "vessel"]);
    for (const w of [...Object.values(SEARCH_KIND_WORD), NO_MATCHES, SEARCHING_PLACES, SEARCH_DOWN]) expect(w).not.toMatch(/\blive\b/i);
  });
});
