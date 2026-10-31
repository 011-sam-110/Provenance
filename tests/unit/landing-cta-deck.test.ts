import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CTA_DOORS,
  CTA_TOPICS,
  deckFor,
  FIRST_HREF,
  FIRST_WORDS,
  HOME_CONTINENT,
  MAX_WORDS,
  readVisitor,
  SAVED_BOARD_KEY,
} from "@/lib/marketing/ctaDeck";
import { CTA_PLACES } from "@/lib/marketing/cta-places.data";
import { DEFAULT_PLACE, EYE_CITIES, EYE_PLACES, parseEyeLink, placeById } from "@/lib/eye/places";
import { presetById } from "@/lib/console/presets";
import { MAP_SIGNALS } from "@/lib/signals/registry";
import { ACTIVE_LAYERS } from "@/lib/layers";
import { PERSIST_KEY } from "@/lib/variants/store";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
/** A fixed "random", so an order is the same on every run. */
const seeded = () => {
  let s = 7;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
};
const deck = (zone: string, lang = "en-GB", savedBoard = false) =>
  deckFor(readVisitor(zone, lang), { random: seeded(), savedBoard });

describe("every door on the button goes somewhere real", () => {
  it("offers loads of them, none twice", () => {
    expect(CTA_DOORS.length).toBeGreaterThanOrEqual(80);
    expect(new Set(CTA_DOORS.map((d) => d.words)).size).toBe(CTA_DOORS.length);
  });

  it("keeps every phrase short enough for the button", () => {
    for (const d of CTA_DOORS) expect(d.words.length, d.words).toBeLessThanOrEqual(MAX_WORDS);
  });

  it("types no count into a phrase, and calls nothing live", () => {
    for (const d of CTA_DOORS) {
      expect(d.words, d.words).not.toMatch(/\b\d+\b(?!D)/);
      expect(d.words, d.words).not.toMatch(/\blive\b/i);
    }
  });

  it("starts with the words the page is served with", () => {
    const landing = read("app", "(site)", "page.tsx");
    expect(landing).toContain(`const EYE_WORDS = "${FIRST_WORDS}";`);
    expect(landing).toContain(`const EYE_HREF = "${FIRST_HREF}";`);
  });

  it("opens every place by name, not as a bare position", () => {
    for (const d of CTA_DOORS.filter((x) => x.kind === "place" && x.href !== FIRST_HREF)) {
      const params = new URLSearchParams(d.href.split("?")[1]);
      expect(d.href.startsWith("/eye?place="), d.words).toBe(true);
      const target = parseEyeLink(params, false);
      expect(target.kind, d.words).toBe("place");
      expect(placeById(params.get("place")), d.words).toBeDefined();
    }
  });

  it("names only signal layers the map can draw", () => {
    const ids = new Set(MAP_SIGNALS.map((s) => s.id));
    for (const d of CTA_TOPICS) {
      for (const id of d.needs ?? []) expect(ids.has(id), `${d.words}: ${id}`).toBe(true);
    }
  });

  it("names only core layers that exist, and says so when it writes them", () => {
    const layers = new Set<string>(ACTIVE_LAYERS);
    for (const d of CTA_TOPICS.filter((x) => x.writesLayers)) {
      const named = new URLSearchParams(d.href.split("?")[1]).get("layers")!;
      for (const k of named.split(",")) expect(layers.has(k), `${d.words}: ${k}`).toBe(true);
    }
    for (const d of CTA_TOPICS.filter((x) => !x.writesLayers)) {
      expect(d.href, d.words).not.toContain("layers=");
    }
  });

  it("opens only boards that exist", () => {
    const boards = CTA_TOPICS.filter((d) => d.kind === "board");
    expect(boards.length).toBeGreaterThanOrEqual(2);
    for (const d of boards) {
      const id = new URLSearchParams(d.href.split("?")[1]).get("preset");
      expect(presetById(id!), d.words).toBeDefined();
    }
  });

  it("gives every city a frame the view can open, in its limits", () => {
    expect(new Set(CTA_PLACES.map(([id]) => id))).toEqual(new Set(EYE_CITIES.map((c) => c.id)));
    for (const c of EYE_CITIES) {
      expect(c.wide.zoom, c.id).toBeGreaterThanOrEqual(14.5);
      expect(c.tall.zoom, c.id).toBeGreaterThanOrEqual(14.5);
      expect(Math.abs(c.wide.lat), c.id).toBeLessThanOrEqual(85);
      expect(c.wide.heading, c.id).toBeGreaterThanOrEqual(0);
      expect(c.wide.heading, c.id).toBeLessThan(360);
    }
  });

  it("does not grow the HUD's own place list, and a city never replaces the default", () => {
    expect(EYE_PLACES.map((p) => p.id)).toEqual(["westminster", "tower-bridge", "piccadilly"]);
    expect(DEFAULT_PLACE.id).toBe("westminster");
  });

  it("has a continent for every home a door names", () => {
    for (const d of CTA_DOORS) {
      for (const h of d.homes) expect(HOME_CONTINENT[h], `${d.words}: ${h}`).toBeDefined();
    }
  });

  it("holds the saved-board key equal to the spine's own", () => {
    expect(SAVED_BOARD_KEY).toBe(PERSIST_KEY);
  });

  it("keeps the console and the signal registry out of the landing page's bundle", () => {
    for (const file of [
      read("lib", "marketing", "ctaDeck.ts"),
      read("lib", "marketing", "ctaTurn.ts"),
      read("components", "marketing", "CtaRotor.tsx"),
    ]) {
      const imports = [...file.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
      for (const i of imports) {
        expect(i).not.toMatch(/signals|console|variants|eye\/|layers|maplibre/);
      }
    }
  });

  it("makes no call and adds no scroll listener", () => {
    const src = read("components", "marketing", "CtaRotor.tsx");
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/addEventListener\("scroll"/);
    expect(src).not.toMatch(/requestAnimationFrame/);
  });
});

describe("who sees what first", () => {
  const firstPlaces = (zone: string, n: number) =>
    deck(zone)
      .filter((d) => d.kind === "place")
      .slice(0, n)
      .map((d) => d.words);

  it("leads with the visitor's own place", () => {
    expect(deck("Europe/London")[0].words).toBe("See London in 3D");
    expect(deck("Europe/Madrid", "es-ES")[0].words).toBe("See Madrid in 3D");
    expect(deck("America/New_York", "en-US")[0].words).toBe("See Manhattan in 3D");
    expect(deck("Asia/Tokyo", "ja-JP")[0].words).toBe("See Tokyo in 3D");
  });

  it("offers a region's best-known places before its smaller ones", () => {
    const home = deck("America/New_York", "en-US").filter((d) => d.homes.includes("us-east") && d.kind === "place");
    const fames = home.map((d) => d.fame);
    expect(fames.slice(1)).toEqual([...fames.slice(1)].sort((a, b) => b - a));
    expect(fames[1]).toBe(3);
  });

  it("tells one American time zone from another", () => {
    expect(deck("America/Chicago", "en-US")[0].words).toBe("See Chicago in 3D");
    expect(deck("America/Los_Angeles", "en-US")[0].words).toBe("See Los Angeles in 3D");
  });

  it("offers North Carolina on the east coast, and not to everyone", () => {
    const words = (zone: string) => deck(zone).map((d) => d.words);
    expect(words("America/New_York")).toContain("See North Carolina in 3D");
    expect(words("Asia/Tokyo")).not.toContain("See North Carolina in 3D");
  });

  it("brings a topic about the visitor's own patch forward", () => {
    const gb = deck("Europe/London").map((d) => d.words);
    expect(gb).toContain("See ships in the Channel");
    expect(deck("Asia/Tokyo").map((d) => d.words)).not.toContain("See ships in the Channel");
  });

  it("offers a topic or a board early, not only places", () => {
    for (const zone of ["Europe/London", "America/New_York", "Africa/Accra", "UTC"]) {
      expect(
        deck(zone)
          .slice(0, 4)
          .some((d) => d.kind !== "place"),
        zone,
      ).toBe(true);
    }
  });

  it("shows only the famous from far away", () => {
    const far = deck("Asia/Tokyo").filter(
      (d) => d.kind === "place" && !d.homes.some((h) => HOME_CONTINENT[h] === "as"),
    );
    expect(far.length).toBeGreaterThan(5);
    for (const d of far) expect(d.fame, d.words).toBe(3);
  });

  it("still fills the list for a visitor with no region and a useless time zone", () => {
    const d = deck("UTC", "en");
    expect(d.length).toBeGreaterThan(30);
    expect(d[0]).toBeDefined();
  });

  it("uses the language's country when the time zone says UTC", () => {
    expect(readVisitor("UTC", "pt-BR").home).toBe("br");
    expect(readVisitor("UTC", "zh-Hant-HK").home).toBe("hk");
    expect(readVisitor(undefined, "en-AU").home).toBe("au");
  });

  it("knows a continent from a zone with no row of its own", () => {
    expect(readVisitor("Africa/Accra", "en").continent).toBe("af");
    expect(readVisitor("Australia/Perth", "en").home).toBe("au");
    expect(readVisitor("Nonsense/Zone", "xx").home).toBeNull();
  });

  it("never repeats a phrase in one visitor's list", () => {
    for (const zone of ["Europe/London", "America/New_York", "Asia/Dubai", "UTC"]) {
      const words = deck(zone).map((d) => d.words);
      expect(new Set(words).size, zone).toBe(words.length);
    }
  });

  it("does not offer a saved board a link that would write over its layers", () => {
    const fresh = deck("Europe/London");
    expect(fresh.some((d) => d.writesLayers)).toBe(true);
    const saved = deck("Europe/London", "en-GB", true);
    expect(saved.some((d) => d.writesLayers)).toBe(false);
    expect(saved.some((d) => d.kind === "topic")).toBe(true);
  });

  it("keeps London's own places near the front for a Londoner", () => {
    const places = firstPlaces("Europe/London", 6);
    expect(places).toContain("See London in 3D");
    expect(places.filter((w) => /Tower Bridge|Westminster|Piccadilly|Canary Wharf|Square Mile/.test(w)).length).toBeGreaterThan(0);
  });
});
