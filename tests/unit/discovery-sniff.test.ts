import { describe, it, expect } from "vitest";
import {
  extractRows,
  findRowArrays,
  flattenFeature,
  flattenRow,
  getPath,
  resolveCoordinatePair,
  sniffFormat,
  sniffMapping,
} from "@/lib/discovery/sniff";

/**
 * The fixtures below are the SHAPES of feeds this repo already carries, retyped by
 * hand rather than copied wholesale: Iceland's flat rows with Icelandic column names,
 * a GeoJSON point layer, an ArcGIS FeatureServer query response, and the two ways a
 * sniffer gets a coordinate wrong. If the sniffer cannot recover the mapping a human
 * wrote for `lib/sources/iceland.ts`, it cannot recover an unseen feed either.
 */

/** Iceland-shaped: Icelandic keys, lat in `Breidd`, lon in `Lengd`. */
function icelandRows(n = 12) {
  return Array.from({ length: n }, (_, i) => ({
    Maelist_nr: 4200 + i,
    Myndavel: "Hellisheidi stod " + i,
    Vegheiti: "Sudurlandsvegur",
    Skyring: "Vestur",
    Slod: "https://www.vegagerdin.is/photos/cam" + i + ".jpg",
    Breidd: 63.9 + i * 0.05,
    Lengd: -21.3 - i * 0.07,
  }));
}

/** A DOT-shaped feed with plain English keys and a nested location object. */
function nestedRows(n = 10) {
  return Array.from({ length: n }, (_, i) => ({
    cameraId: "CAM-" + (100 + i),
    displayName: "I-90 at Exit " + (10 + i),
    roadway: "I-90",
    location: { latitude: 47.5 + i * 0.03, longitude: -122.3 + i * 0.04 },
    views: { imageUrl: "https://images.wsdot.wa.gov/nw/" + i + ".jpg" },
  }));
}

describe("getPath", () => {
  it("reads a nested path and returns undefined for every miss", () => {
    const o = { a: { b: { c: 7 } } };
    expect(getPath(o, "a.b.c")).toBe(7);
    expect(getPath(o, "a.b.d")).toBeUndefined();
    expect(getPath(o, "a.x.c")).toBeUndefined();
    expect(getPath(null, "a")).toBeUndefined();
    expect(getPath(o, "")).toBeUndefined();
  });
});

describe("flattenRow", () => {
  it("flattens nested objects to dot-paths and skips arrays entirely", () => {
    const flat = flattenRow({ id: 1, loc: { lat: 5, lon: 6 }, tags: ["a", "b"] });
    expect(flat.get("id")).toBe(1);
    expect(flat.get("loc.lat")).toBe(5);
    expect(flat.get("loc.lon")).toBe(6);
    // An array member has a different cardinality from the row, so no dot-path
    // addresses it and inventing `tags.0` would break on the next row.
    expect([...flat.keys()].some((k) => k.startsWith("tags"))).toBe(false);
  });

  it("stops at the depth limit rather than walking an arbitrarily deep body", () => {
    const flat = flattenRow({ a: { b: { c: { d: 1 } } } }, 2);
    expect([...flat.keys()]).not.toContain("a.b.c.d");
  });
});

describe("sniffFormat", () => {
  it("tells the three body shapes apart", () => {
    expect(sniffFormat(icelandRows())).toBe("json");
    expect(sniffFormat({ features: [{ properties: {}, geometry: { type: "Point", coordinates: [1, 2] } }] })).toBe(
      "geojson",
    );
    expect(sniffFormat({ features: [{ attributes: { OBJECTID: 1 }, geometry: { x: 1, y: 2 } }] })).toBe("arcgis");
    expect(sniffFormat({ nothing: true })).toBe("json");
  });
});

describe("findRowArrays", () => {
  it("returns the empty path when the body IS the array", () => {
    expect(findRowArrays(icelandRows())).toEqual([""]);
  });

  it("finds a wrapped array and prefers the longest", () => {
    const body = { meta: { page: 1 }, small: [{ a: 1 }, { a: 2 }, { a: 3 }], data: { cameras: icelandRows(20) } };
    const found = findRowArrays(body);
    expect(found[0]).toBe("data.cameras");
    expect(found).toContain("small");
  });

  it("ignores arrays that are not rows", () => {
    // An array of coordinate pairs and an array of strings are both arrays and
    // neither is a table.
    const body = { coords: [[1, 2], [3, 4], [5, 6]], names: ["a", "b", "c"] };
    expect(findRowArrays(body)).toEqual([]);
  });
});

describe("sniffMapping", () => {
  it("recovers the Iceland mapping from a feed whose columns are not in English", () => {
    // Not one of these keys says what it holds in a language the patterns know:
    // `Breidd` is "breadth", `Lengd` is "length", `Slod` is "path". The name check
    // scores every one of them zero, so this passing at all is the value-shape and
    // country-fit fallbacks doing the work. There are deliberately NO Icelandic
    // aliases in the pattern table — adding the language of each feed you have already
    // seen produces a sniffer that only ever discovers feeds you have already seen.
    const { mapping, confidence, notes } = sniffMapping(icelandRows(), { country: "IS" });
    expect(mapping.lat).toBe("Breidd");
    expect(mapping.lon).toBe("Lengd");
    expect(mapping.imageUrl).toBe("Slod");
    expect(mapping.id).toBe("Maelist_nr");
    expect(confidence).toBeGreaterThan(0);
    // And it says so, because a column resolved this way is a weaker claim.
    expect(notes.join(" ")).toMatch(/coordinate columns were identified by which assignment/i);
    expect(notes.join(" ")).toMatch(/imageUrl column was identified by its values/i);
  });

  it("leaves the coordinates unassigned when there is no country to break the tie", () => {
    // Same feed, no hint. Two numeric columns both in range and neither named — an
    // axis order picked here would be a coin flip, and a confidently wrong pin is the
    // failure this whole pipeline is built to avoid.
    const { mapping, confidence } = sniffMapping(icelandRows());
    expect(mapping.lat).toBeUndefined();
    expect(mapping.lon).toBeUndefined();
    expect(confidence).toBe(0);
  });

  it("refuses a coordinate pair when the reverse assignment fits just as well", () => {
    // The ambiguity branch is exercised DIRECTLY rather than through `sniffMapping`,
    // because no country box currently in `geo.ts` can produce an ambiguous pair: for
    // both orders to fit, the box's latitude span has to overlap its longitude span,
    // and none of the 28 countries on file does. Countries where it happens are real
    // (Nigeria spans 4-14N and 3-15E; Libya 19-33N and 9-25E), so the branch is not
    // dead code — it is unreachable through the CURRENT table, and that is exactly the
    // kind of guard that quietly stops guarding when a row is added. Passing the box
    // in makes the refusal provable today and keeps working when Nigeria is added.
    const box: [number, number, number, number] = [4.0, 2.7, 14.0, 14.7]; // Nigeria-ish
    const rows = Array.from({ length: 10 }, (_, i) => ({
      a: 6.4 + i * 0.05,
      b: 7.5 + i * 0.05,
    }));
    const flat = rows.map((r) => new Map<string, unknown>(Object.entries(r)));
    const valuesAt = (p: string) => flat.map((f) => f.get(p));
    const paths = new Set(["a", "b"]);
    expect(resolveCoordinatePair(paths, new Set(), valuesAt, box)).toBeNull();

    // And the same helper DOES resolve when only one order fits.
    const gb: [number, number, number, number] = [49.8, -8.7, 61.0, 2.0];
    const ukRows = Array.from({ length: 10 }, (_, i) => ({ a: 51.4 + i * 0.05, b: -0.4 - i * 0.05 }));
    const ukFlat = ukRows.map((r) => new Map<string, unknown>(Object.entries(r)));
    const resolved = resolveCoordinatePair(paths, new Set(), (p) => ukFlat.map((f) => f.get(p)), gb);
    expect(resolved).toEqual({ lat: "a", lon: "b", score: expect.any(Number) });
  });

  it("does not accept a coordinate pair that lands outside the declared country", () => {
    // A Brazilian feed labelled GB: every pin would be in the South Atlantic. The
    // country hint being wrong costs the candidate, never a wrong pin.
    const rows = Array.from({ length: 10 }, (_, i) => ({
      codigo: "C" + i,
      local: "Ponto " + i,
      x1: -23.5 - i * 0.02,
      x2: -46.6 - i * 0.03,
      foto: "https://cet.example.br/" + i + ".jpg",
    }));
    expect(sniffMapping(rows, { country: "GB" }).mapping.lat).toBeUndefined();
    expect(sniffMapping(rows, { country: "BR" }).mapping.lat).toBe("x1");
    expect(sniffMapping(rows, { country: "BR" }).mapping.lon).toBe("x2");
  });

  it("reaches into a nested location object", () => {
    const { mapping } = sniffMapping(nestedRows());
    expect(mapping.lat).toBe("location.latitude");
    expect(mapping.lon).toBe("location.longitude");
    expect(mapping.imageUrl).toBe("views.imageUrl");
    expect(mapping.id).toBe("cameraId");
    expect(mapping.road).toBe("roadway");
  });

  it("refuses a Web Mercator column whose NAME says latitude", () => {
    // The trap that motivates two-axis scoring: `y` is named like a latitude and holds
    // metres. A name-only sniffer assigns it and puts every camera off the planet.
    const rows = Array.from({ length: 10 }, (_, i) => ({
      objectid: i,
      name: "Camera " + i,
      x: -13_600_000 + i * 900,
      y: 6_712_004 + i * 800,
      image: "https://dot.example.gov/c" + i + ".jpg",
    }));
    const { mapping, confidence } = sniffMapping(rows);
    expect(mapping.lat).toBeUndefined();
    expect(mapping.lon).toBeUndefined();
    expect(confidence).toBe(0);
  });

  it("refuses a coordinate column that never varies", () => {
    // A country centroid repeated per row passes every range check and puts the whole
    // network on one pin — fine in a count, broken on a map.
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      name: "Site " + i,
      lat: 54.0,
      lon: -2.0,
      image: "https://ops.example.gov/" + i + ".jpg",
    }));
    const { mapping } = sniffMapping(rows);
    expect(mapping.lat).toBeUndefined();
  });

  it("refuses an all-zero coordinate column", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      name: "Site " + i,
      latitude: 0,
      longitude: 0,
      image: "https://ops.example.gov/" + i + ".jpg",
    }));
    expect(sniffMapping(rows).mapping.lat).toBeUndefined();
  });

  it("never assigns one column to two fields", () => {
    // A feed whose only coordinate key is `y`: without the one-field-per-path rule the
    // same column becomes both lat and lon and every camera lands on the diagonal.
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      name: "Site " + i,
      y: 51.4 + i * 0.02,
      image: "https://ops.example.gov/" + i + ".jpg",
    }));
    const { mapping } = sniffMapping(rows);
    expect(mapping.lat === mapping.lon).toBe(false);
  });

  it("scores zero confidence for a feed with no picture and no stream", () => {
    // A list of places is not a list of cameras.
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      name: "Junction " + i,
      lat: 51.4 + i * 0.02,
      lon: -0.1 - i * 0.01,
    }));
    expect(sniffMapping(rows).confidence).toBe(0);
  });

  it("rejects an id column that repeats", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      site_id: "SAME",
      cam_code: "C" + i,
      name: "Site " + i,
      lat: 51.4 + i * 0.02,
      lon: -0.1 - i * 0.01,
      image: "https://ops.example.gov/" + i + ".jpg",
    }));
    expect(sniffMapping(rows).mapping.id).toBe("cam_code");
  });

  it("returns nothing at all for an empty or non-object row set", () => {
    expect(sniffMapping([]).confidence).toBe(0);
    expect(sniffMapping([null, 1, "x"]).mapping).toEqual({});
  });
});

describe("flattenFeature", () => {
  it("puts GeoJSON coordinates the right way round", () => {
    // [lon, lat] is the single most common way a map ends up with every pin at sea.
    const f = flattenFeature(
      { type: "Feature", properties: { name: "A1" }, geometry: { type: "Point", coordinates: [-1.5, 53.8] } },
      "geojson",
    );
    expect(f?.__lon).toBe(-1.5);
    expect(f?.__lat).toBe(53.8);
    expect(f?.name).toBe("A1");
  });

  it("lifts ArcGIS attributes and geometry into one row", () => {
    const f = flattenFeature({ attributes: { OBJECTID: 3, Name: "US-1" }, geometry: { x: -80.2, y: 25.8 } }, "arcgis");
    expect(f?.OBJECTID).toBe(3);
    expect(f?.__lat).toBe(25.8);
    expect(f?.__lon).toBe(-80.2);
  });

  it("sniffs a GeoJSON layer end to end through the synthetic geometry keys", () => {
    const body = {
      type: "FeatureCollection",
      features: Array.from({ length: 10 }, (_, i) => ({
        type: "Feature",
        id: "cam-" + i,
        properties: { title: "Camera " + i, snapshot: "https://roads.example.gov/" + i + ".jpg" },
        geometry: { type: "Point", coordinates: [-3.1 - i * 0.05, 55.9 + i * 0.03] },
      })),
    };
    const rows = extractRows(body, "geojson");
    const { mapping, confidence } = sniffMapping(rows);
    expect(mapping.lat).toBe("__lat");
    expect(mapping.lon).toBe("__lon");
    expect(mapping.imageUrl).toBe("snapshot");
    expect(confidence).toBeGreaterThan(0.5);
  });
});

describe("extractRows", () => {
  it("reads the same rows the mapping was sniffed against", () => {
    const body = { result: { records: icelandRows(6) } };
    expect(extractRows(body, "json", "result.records")).toHaveLength(6);
    expect(extractRows(icelandRows(6), "json")).toHaveLength(6);
    expect(extractRows({ nope: 1 }, "json", "result.records")).toEqual([]);
    expect(extractRows({ features: "not an array" }, "geojson")).toEqual([]);
  });
});
