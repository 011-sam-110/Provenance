import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  MAX_ROAD_NAME,
  MIN_ROAD_CAMERAS,
  camerasOnRoad,
  groupByRoad,
  isPageableRoad,
} from "@/lib/seo/roads";
import {
  MIN_PLACE_CAMERAS,
  PLACE_RADIUS_KM,
  assignPlaces,
  camerasInPlace,
  groupByPlace,
  nearestPlace,
  placeSlugCollisions,
  placesNear,
} from "@/lib/seo/places";
import { PLACES } from "@/lib/seo/place.data";
import { reservedSegmentCollisions } from "@/lib/seo/directory";
import { RESERVED_FACET_SEGMENTS, parsePageParam, placePath, roadPath } from "@/lib/seo/paths";
import type { Camera } from "@/lib/types";

function cam(over: Partial<Camera> & { id: string }): Camera {
  return {
    source: "test",
    country: "GB",
    name: over.id,
    lat: 51.5,
    lon: -0.13,
    mediaType: "jpeg",
    refreshSeconds: 300,
    license: "OGL v2",
    attribution: "Test Operator",
    available: true,
    ...over,
  } as Camera;
}

describe("isPageableRoad — the junk guard", () => {
  // Every value below was MEASURED in the live registry on 2026-09-06, with its camera
  // count. They are here so a future feed change that reintroduces one fails loudly
  // rather than minting a page called "N/A".
  const measuredJunk = [
    ["N/A", 83],
    ["CNTY", 236],
    ["City", 103],
    ["CITY", 49],
    ["Local Boise", 129],
    ["NWC_EL", 98],
    ["for City of Tampa cameras", 207],
  ] as const;

  for (const [value, count] of measuredJunk) {
    it(`refuses ${JSON.stringify(value)}, which labelled ${count} cameras`, () => {
      expect(isPageableRoad(value)).toBe(false);
    });
  }

  it("accepts the real roads those junk values sit beside", () => {
    for (const road of ["I-95", "I-75", "Floridas Turnpike", "M8", "SH1", "QEW", "1", "Highway 401"]) {
      expect(isPageableRoad(road)).toBe(true);
    }
  });

  it("is case-insensitive, so a feed changing capitalisation does not reopen the hole", () => {
    expect(isPageableRoad("n/a")).toBe(false);
    expect(isPageableRoad("cnty")).toBe(false);
  });

  it("refuses prose that leaked into the field, by length and by the word 'camera'", () => {
    expect(isPageableRoad("x".repeat(MAX_ROAD_NAME + 1))).toBe(false);
    expect(isPageableRoad("cameras on the bypass")).toBe(false);
  });

  it("refuses a value with no slug rather than minting an empty URL", () => {
    expect(isPageableRoad("///")).toBe(false);
    expect(isPageableRoad("   ")).toBe(false);
    expect(isPageableRoad(undefined)).toBe(false);
  });
});

describe("groupByRoad", () => {
  const cameras = [
    ...Array.from({ length: 4 }, (_, i) => cam({ id: `a${i}`, country: "US", road: "I-95" })),
    // Two spellings of one road. They are one page, and the count has to agree with it.
    cam({ id: "b0", country: "US", road: "SR 20" }),
    cam({ id: "b1", country: "US", road: "SR-20" }),
    cam({ id: "b2", country: "US", road: "SR-20" }),
    // Under the floor.
    cam({ id: "c0", country: "US", road: "I-4" }),
    // Same road name, different country.
    ...Array.from({ length: 3 }, (_, i) => cam({ id: `d${i}`, country: "CA", road: "I-95" })),
    cam({ id: "e0", country: "US", road: "N/A" }),
  ];

  it("keeps only roads at or over the floor", () => {
    const roads = groupByRoad(cameras, "US").map((r) => r.road);
    expect(roads).toContain("I-95");
    expect(roads).not.toContain("I-4"); // 1 camera, under MIN_ROAD_CAMERAS
    expect(roads).not.toContain("N/A");
    expect(MIN_ROAD_CAMERAS).toBe(3);
  });

  it("merges two spellings into one page and one count", () => {
    const sr20 = groupByRoad(cameras, "US").find((r) => r.slug === "sr-20");
    expect(sr20?.count).toBe(3);
    // The spelling that labels more cameras wins the heading.
    expect(sr20?.road).toBe("SR-20");
  });

  it("scopes a road to its country, because road names are not globally unique", () => {
    expect(groupByRoad(cameras, "US").find((r) => r.slug === "i-95")?.count).toBe(4);
    expect(groupByRoad(cameras, "CA").find((r) => r.slug === "i-95")?.count).toBe(3);
  });

  it("orders biggest first, so the cross-links lead with the useful page", () => {
    const counts = groupByRoad(cameras, "US").map((r) => r.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });
});

describe("camerasOnRoad", () => {
  const cameras = [
    ...Array.from({ length: 3 }, (_, i) => cam({ id: `z${2 - i}`, name: `Cam ${2 - i}`, country: "US", road: "I-10" })),
    cam({ id: "solo", country: "US", road: "I-4" }),
  ];

  it("returns the operator's own spelling alongside the rows", () => {
    expect(camerasOnRoad(cameras, "us", "i-10")?.road).toBe("I-10");
  });

  it("sorts stably, so one URL does not reshuffle between crawls", () => {
    const names = camerasOnRoad(cameras, "us", "i-10")!.cameras.map((c) => c.name);
    expect(names).toEqual(["Cam 0", "Cam 1", "Cam 2"]);
  });

  it("404s a road under the floor rather than serving a two-link page", () => {
    expect(camerasOnRoad(cameras, "us", "i-4")).toBeNull();
    expect(camerasOnRoad(cameras, "us", "not-a-road")).toBeNull();
  });
});

describe("assignPlaces", () => {
  const places = [
    { name: "Ealing", country: "GB", lat: 51.51, lon: -0.30, population: 85000 },
    { name: "Windsor", country: "CA", lat: 42.30, lon: -83.03, population: 210000 },
    { name: "Detroit", country: "US", lat: 42.33, lon: -83.05, population: 640000 },
  ];

  it("assigns a camera to the nearest place in its own country", () => {
    const near = cam({ id: "x", country: "GB", lat: 51.52, lon: -0.29 });
    expect(places[assignPlaces([near], places).get("x")!].name).toBe("Ealing");
  });

  it("never assigns across a border, however close the town is", () => {
    // A camera on the Detroit side of the river is ~3 km from Windsor, Ontario.
    // Distance alone would put it in Canada; the country scope is what stops that.
    const detroit = cam({ id: "d", country: "US", lat: 42.32, lon: -83.04 });
    const got = assignPlaces([detroit], places).get("d");
    expect(places[got!].name).toBe("Detroit");
  });

  it("leaves a camera with NO place past the radius, rather than reaching further", () => {
    const remote = cam({ id: "r", country: "GB", lat: 54.0, lon: -2.0 });
    expect(assignPlaces([remote], places).has("r")).toBe(false);
  });

  it("is deterministic when two places are equidistant", () => {
    const tied = [
      { name: "Alpha", country: "GB", lat: 51.6, lon: -0.13, population: 1000 },
      { name: "Beta", country: "GB", lat: 51.4, lon: -0.13, population: 9000 },
    ];
    const middle = cam({ id: "m", country: "GB", lat: 51.5, lon: -0.13 });
    const first = assignPlaces([middle], tied).get("m");
    const second = assignPlaces([middle], tied).get("m");
    expect(first).toBe(second);
    expect(tied[first!].name).toBe("Beta"); // population breaks the tie
  });
});

describe("placesNear / nearestPlace", () => {
  it("answers from the committed table alone, with no registry", () => {
    // The camera page calls this per render; dragging 20k cameras in would be the
    // difference between a lookup and a scan.
    const hits = placesNear(51.53, -0.29, "GB");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].km).toBeLessThanOrEqual(PLACE_RADIUS_KM);
    // Sorted nearest first.
    expect(hits.map((h) => h.km)).toEqual([...hits.map((h) => h.km)].sort((a, b) => a - b));
  });

  it("returns null past the radius rather than the least-far town", () => {
    // Mid-Atlantic.
    expect(nearestPlace(30, -40, "GB")).toBeNull();
  });
});

describe("groupByPlace / camerasInPlace", () => {
  const places = [{ name: "Ealing", country: "GB", lat: 51.51, lon: -0.3, population: 85000 }];
  const cameras = Array.from({ length: 4 }, (_, i) =>
    cam({ id: `e${i}`, name: `Cam ${i}`, country: "GB", lat: 51.51 + i * 0.001, lon: -0.3 }),
  );

  it("groups and counts", () => {
    const groups = groupByPlace(cameras, "GB", places);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ name: "Ealing", slug: "ealing", count: 4 });
  });

  it("404s a place under the floor", () => {
    expect(camerasInPlace(cameras.slice(0, 2), "GB", "ealing", places)).toBeNull();
    expect(MIN_PLACE_CAMERAS).toBe(3);
  });

  it("matches by slug and returns GeoNames' own name for the heading", () => {
    expect(camerasInPlace(cameras, "gb", "ealing", places)?.place.name).toBe("Ealing");
  });
});

describe("the committed place table", () => {
  it("agrees with the generator on the radius", () => {
    // The generator uses this to decide which cities are worth committing; this module
    // uses it to decide which cameras a committed city collects. If they drift, the file
    // either carries cities that can never win a camera or omits cities that could.
    const script = readFileSync("scripts/gen-place-table.mjs", "utf8");
    const declared = /const PLACE_RADIUS_KM = (\d+)/.exec(script)?.[1];
    expect(Number(declared)).toBe(PLACE_RADIUS_KM);
  });

  it("has no two towns in one country fighting over one URL", () => {
    expect(placeSlugCollisions()).toEqual([]);
  });

  it("carries rows with a usable country and coordinate", () => {
    expect(PLACES.length).toBeGreaterThan(0);
    for (const p of PLACES) {
      expect(p.country).toMatch(/^[A-Z]{2}$/);
      expect(Number.isFinite(p.lat) && Number.isFinite(p.lon)).toBe(true);
    }
  });
});

describe("the reserved facet segments", () => {
  it("names exactly the literal segments that sit beside [region]", () => {
    expect([...RESERVED_FACET_SEGMENTS]).toEqual(["road", "place"]);
  });

  it("is quiet for ordinary regions", () => {
    expect(reservedSegmentCollisions([cam({ id: "a", region: "London" })])).toEqual([]);
  });

  it("catches a region that would be swallowed by a facet route", () => {
    // Next resolves the static `road` segment before the dynamic `[region]` one, so
    // this region's listing would silently become the road facet while still
    // returning a valid 200. Nothing else can see that happen.
    const hits = reservedSegmentCollisions([
      cam({ id: "a", country: "GB", region: "Road" }),
      cam({ id: "b", country: "US", region: "Place" }),
    ]);
    expect(hits).toEqual([
      { iso2: "GB", region: "Road" },
      { iso2: "US", region: "Place" },
    ]);
  });
});

describe("facet paths", () => {
  it("puts page 1 at the bare path, so one page is one URL", () => {
    expect(roadPath("US", "I-95")).toBe("/cameras/us/road/i-95");
    expect(roadPath("US", "I-95", 1)).toBe("/cameras/us/road/i-95");
    expect(roadPath("US", "I-95", 2)).toBe("/cameras/us/road/i-95/2");
    expect(placePath("GB", "Ealing")).toBe("/cameras/gb/place/ealing");
    expect(placePath("GB", "Ealing", 3)).toBe("/cameras/gb/place/ealing/3");
  });

  it("folds a road name the same way every other slug is folded", () => {
    expect(roadPath("IS", "Þjóðvegur 1")).toBe("/cameras/is/road/thjodvegur-1");
  });
});

describe("parsePageParam — the shared crawl-space guard", () => {
  it("treats an absent segment as page 1", () => {
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam([])).toBe(1);
  });

  it("refuses anything that is not a plain page number", () => {
    // Serving page 1 at junk URLs would be an infinite crawl space of duplicates.
    for (const bad of [["0"], ["01"], ["-1"], ["1.5"], ["abc"], ["1", "2"], [""]]) {
      expect(parsePageParam(bad)).toBeNull();
    }
  });

  it("reads a real page number", () => {
    expect(parsePageParam(["2"])).toBe(2);
    expect(parsePageParam(["10"])).toBe(10);
  });
});
