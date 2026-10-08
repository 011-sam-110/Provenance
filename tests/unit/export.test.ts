import { describe, it, expect } from "vitest";
import { toCsv, toGeoJson, toKml, escapeXml, exportFilename, KML_MIME, type GeoPoint } from "@/lib/export";
import {
  EXPORT_DICTIONARIES,
  NO_DESCRIPTION,
  NO_SOURCE,
  describeColumn,
  toDataDictionary,
} from "@/lib/export/dictionary";

describe("toCsv", () => {
  it("writes a header + rows and quotes values with commas/quotes/newlines", () => {
    const csv = toCsv([
      { sym: "BTC", value: "$60,000", note: 'he said "hi"' },
      { sym: "ETH", value: "$3,000", note: "line1\nline2" },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("sym,value,note");
    expect(lines[1]).toBe('BTC,"$60,000","he said ""hi"""');
    expect(lines[2]).toBe('ETH,"$3,000","line1\nline2"');
  });

  it("respects an explicit column order and empty for missing/null", () => {
    expect(toCsv([{ a: 1, b: null }], ["b", "a"])).toBe("b,a\r\n,1");
    expect(toCsv([])).toBe("");
  });
});

describe("toGeoJson", () => {
  it("builds a FeatureCollection of points and drops invalid coords", () => {
    const gj = JSON.parse(
      toGeoJson([
        { lat: 50.4, lon: 30.5, properties: { name: "Kyiv" } },
        { lat: Number.NaN, lon: 1, properties: { name: "bad" } },
      ]),
    );
    expect(gj.type).toBe("FeatureCollection");
    expect(gj.features).toHaveLength(1);
    expect(gj.features[0].geometry.coordinates).toEqual([30.5, 50.4]); // [lon,lat]
    expect(gj.features[0].properties.name).toBe("Kyiv");
  });
});

describe("exportFilename", () => {
  it("is UTC-stamped and filesystem-safe", () => {
    expect(exportFilename("markets", Date.parse("2026-07-08T04:59:12Z"))).toBe(
      "opendata-markets-2026-07-08T04-59Z",
    );
  });
});

// ── KML ──────────────────────────────────────────────────────────────────────

/**
 * A strict well-formedness check, small enough to read: every tag closes in order,
 * text holds no raw `<` and no `&` that is not one of the five entities, and every
 * attribute value is quoted. The suite runs in Node, which has no XML parser, so
 * this stands in for one inside the gate.
 */
function assertWellFormed(xml: string): { tags: string[] } {
  const body = xml.replace(/^<\?xml [^?]*\?>\s*/, "");
  const stack: string[] = [];
  const tags: string[] = [];
  const token = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|([^<]+)/g;
  let at = 0;
  for (let m = token.exec(body); m; m = token.exec(body)) {
    if (m.index !== at) throw new Error(`not XML at ${at}: ${body.slice(at, at + 40)}`);
    at = token.lastIndex;
    const [, close, name, attrs, selfClose, text] = m;
    const raw = text ?? attrs ?? "";
    if (/&(?!(?:amp|lt|gt|quot|apos);)/.test(raw)) throw new Error(`bare & in: ${raw.slice(0, 60)}`);
    if (text !== undefined) {
      if (text.includes("]]>")) throw new Error("]]> in text");
      continue;
    }
    if (close) {
      const open = stack.pop();
      if (open !== name) throw new Error(`</${name}> closes <${open}>`);
    } else {
      tags.push(name);
      if (!selfClose) stack.push(name);
    }
  }
  if (at !== body.length) throw new Error(`not XML at ${at}: ${body.slice(at, at + 40)}`);
  if (stack.length) throw new Error(`unclosed: ${stack.join(" > ")}`);
  return { tags };
}

/** Undo the five entities: what a parser hands back as the text of an element. */
const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const placemarkNames = (kml: string) =>
  Array.from(kml.matchAll(/<Placemark>\s*<name>([^<]*)<\/name>/g)).map((m) => unescapeXml(m[1]));

describe("the well-formedness check itself", () => {
  // A check that cannot fail proves nothing, so it is shown failing first.
  it.each([
    ["a raw ampersand", "<a>Tom & Jerry</a>"],
    ["a raw angle bracket", "<a>1 < 2</a>"],
    ["a tag that never closes", "<a><b>x</a>"],
    ["an unquoted attribute", "<a b=c>x</a>"],
    ["a quote that ends an attribute early", '<a b="x"y">z</a>'],
    ["the end of a CDATA section", "<a>x]]>y</a>"],
  ])("rejects %s", (_name, xml) => {
    expect(() => assertWellFormed(xml)).toThrow();
  });

  it("accepts a small correct document", () => {
    expect(assertWellFormed('<?xml version="1.0"?>\n<a b="c &amp; d"><e/>x &lt; y</a>').tags).toEqual(["a", "e"]);
  });
});

describe("toKml", () => {
  const kyiv: GeoPoint = { lat: 50.4, lon: 30.5, properties: { name: "Kyiv", magnitude: 4.2 } };

  it("writes longitude before latitude, the KML order", () => {
    const kml = toKml([kyiv]);
    expect(kml).toContain("<Point><coordinates>30.5,50.4</coordinates></Point>");
    expect(kml).not.toContain("50.4,30.5");
  });

  it("keeps the signs of a place in the south-west quarter", () => {
    expect(toKml([{ lat: -54.8019, lon: -68.303 }])).toContain("<coordinates>-68.303,-54.8019</coordinates>");
  });

  it("is a KML 2.2 document: declaration, namespace, one Document", () => {
    const kml = toKml([kyiv], { name: "opendata-events" });
    expect(kml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">')).toBe(true);
    expect(kml.trimEnd().endsWith("</kml>")).toBe(true);
    const { tags } = assertWellFormed(kml);
    expect(tags.filter((t) => t === "Document")).toHaveLength(1);
    expect(tags.filter((t) => t === "Placemark")).toHaveLength(1);
    expect(kml).toContain("<name>opendata-events</name>");
    expect(KML_MIME).toBe("application/vnd.google-earth.kml+xml");
  });

  it("puts ExtendedData before the geometry, the order the KML schema demands", () => {
    const kml = toKml([kyiv]);
    expect(kml.indexOf("<name>Kyiv</name>")).toBeLessThan(kml.indexOf("<ExtendedData>"));
    expect(kml.indexOf("</ExtendedData>")).toBeLessThan(kml.indexOf("<Point>"));
  });

  it("holds the same points as the GeoJSON: the same invalid coordinates are left out", () => {
    const points: GeoPoint[] = [
      kyiv,
      { lat: Number.NaN, lon: 1, properties: { name: "no latitude" } },
      { lat: 1, lon: Number.POSITIVE_INFINITY, properties: { name: "no longitude" } },
      { lat: -33.8568, lon: 151.2153, properties: { name: "Sydney" } },
    ];
    const kml = toKml(points);
    const geojson = JSON.parse(toGeoJson(points));
    expect(placemarkNames(kml)).toEqual(["Kyiv", "Sydney"]);
    expect(placemarkNames(kml)).toHaveLength(geojson.features.length);
  });

  it.each([
    ["an ampersand", "Marks & Spencer"],
    ["an angle bracket", "depth < 10 km > 5 km"],
    ["a tag", "<script>alert(1)</script>"],
    ["double quotes", 'the "Big One"'],
    ["a single quote", "Côte d'Ivoire"],
    ["the end of a CDATA section", "a]]>b"],
    ["an entity that is already written", "AT&amp;T"],
    ["all of them", `<a href="x">'&]]></a>`],
  ])("escapes %s in a name and gives the same text back", (_name, text) => {
    const kml = toKml([{ lat: 1, lon: 2, properties: { name: text, note: text } }]);
    assertWellFormed(kml);
    expect(kml).not.toContain("]]>");
    expect(placemarkNames(kml)).toEqual([text]);
    const value = /<Data name="note"><value>([^<]*)<\/value>/.exec(kml)![1];
    expect(unescapeXml(value)).toBe(text);
  });

  it("escapes the name of a property too, where a quote would end the attribute", () => {
    const kml = toKml([{ lat: 1, lon: 2, properties: { 'a"b<c>&d': "v" } }]);
    assertWellFormed(kml);
    expect(kml).toContain('<Data name="a&quot;b&lt;c&gt;&amp;d"><value>v</value></Data>');
  });

  it("drops the characters that XML forbids and keeps the ones it allows", () => {
    const kml = toKml([{ lat: 1, lon: 2, properties: { name: "a\u0000b\u0008c\u001Fd\tE￿f 🌍 g\uD83Ch" } }]);
    assertWellFormed(kml);
    expect(placemarkNames(kml)).toEqual(["abcd\tEf 🌍 gh"]);
  });

  it("names a placemark from the first naming property it carries", () => {
    const names = placemarkNames(
      toKml([
        { lat: 1, lon: 1, properties: { id: "usgs:1", title: "M 5.1", name: "the name" } },
        { lat: 1, lon: 1, properties: { id: "usgs:2", title: "M 5.2" } },
        { lat: 1, lon: 1, properties: { callsign: "BAW123", id: "plane:1" } },
        { lat: 1, lon: 1, properties: { id: "usgs:3", name: "" } },
      ]),
    );
    expect(names).toEqual(["the name", "M 5.2", "BAW123", "usgs:3"]);
  });

  it("writes a placemark with no name and no ExtendedData for a bare point", () => {
    const kml = toKml([{ lat: 1, lon: 2 }]);
    assertWellFormed(kml);
    expect(kml).toContain("<Placemark>\n      <Point><coordinates>2,1</coordinates></Point>\n    </Placemark>");
  });

  it("writes a number, a boolean and an object as text, and leaves out an empty value", () => {
    const kml = toKml([{ lat: 1, lon: 2, properties: { n: 7, ok: false, nested: { a: [1, "<"] }, gone: null, blank: "" } }]);
    assertWellFormed(kml);
    expect(kml).toContain('<Data name="n"><value>7</value></Data>');
    expect(kml).toContain('<Data name="ok"><value>false</value></Data>');
    expect(kml).toContain('<Data name="nested"><value>{&quot;a&quot;:[1,&quot;&lt;&quot;]}</value></Data>');
    expect(kml).not.toContain('name="gone"');
    expect(kml).not.toContain('name="blank"');
  });

  it("never writes a coordinate as an exponent or as minus zero", () => {
    const kml = toKml([{ lat: 1e-9, lon: -1e-9 }, { lat: 12.123456789, lon: 100 }]);
    expect(kml).toContain("<coordinates>0,0</coordinates>");
    expect(kml).toContain("<coordinates>100,12.1234568</coordinates>");
    expect(kml).not.toMatch(/<coordinates>[^<]*e/);
  });

  it("gives an empty, well-formed document for no points", () => {
    for (const kml of [toKml([]), toKml(undefined as unknown as GeoPoint[])]) {
      const { tags } = assertWellFormed(kml);
      expect(tags).toEqual(["kml", "Document"]);
    }
  });
});

describe("escapeXml", () => {
  it("escapes the ampersand first, so an entity is not escaped twice over", () => {
    expect(escapeXml("<&>")).toBe("&lt;&amp;&gt;");
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
    expect(escapeXml(`"'`)).toBe("&quot;&apos;");
    expect(escapeXml("]]>")).toBe("]]&gt;");
  });
});

// ── Data dictionary ──────────────────────────────────────────────────────────

describe("toDataDictionary", () => {
  const AT = Date.parse("2026-10-08T05:59:12Z");
  const rows = [
    { tier: "S3", type: "quake", title: "M 6.1", place: "Chile", metric: "M 6.1 · 30 km deep", threat: "", lat: -30, lon: -71, occurredAt: "2026-10-08T05:00:00Z" },
    { tier: "S1", type: "cyclone", title: "TS Ana", place: "", metric: "", threat: "", lat: 15, lon: -45, occurredAt: "", extraColumn: 1 },
  ];
  const geo: GeoPoint[] = [
    { lat: -30, lon: -71, properties: { tier: "S3", type: "quake", title: "M 6.1" } },
    { lat: Number.NaN, lon: 0, properties: { onlyOnTheBadPoint: 1 } },
  ];
  const text = toDataDictionary({ name: "events", rows, geo, source: "USGS (U.S. Geological Survey)", at: AT });
  const lines = text.split("\r\n");

  it("gives the time of the export, the source and the files it describes", () => {
    expect(text).toContain("Time of the export:  2026-10-08T05:59:12.000Z (UTC)");
    expect(text).toContain("Source of the data:  USGS (U.S. Geological Survey)");
    expect(text).toContain("Files it describes:  opendata-events-2026-10-08T05-59Z.csv, .geojson, .kml");
    expect(text).toContain("Records:             2 in the CSV, 1 in the GeoJSON and the KML");
  });

  it("names every column of the CSV one time, each with a meaning under it", () => {
    const start = lines.indexOf("COLUMNS OF THE CSV FILE (10)");
    expect(start).toBeGreaterThan(-1);
    const columns = ["tier", "type", "title", "place", "metric", "threat", "lat", "lon", "occurredAt", "extraColumn"];
    const block = lines.slice(start + 2, start + 2 + columns.length * 2);
    expect(block.filter((_, i) => i % 2 === 0)).toEqual(columns);
    for (const meaning of block.filter((_, i) => i % 2 === 1)) expect(meaning).toMatch(/^ {4}\S.*\.$/);
    // The header row of the CSV and the dictionary agree, column for column.
    expect(toCsv(rows).split("\r\n")[0].split(",")).toEqual(columns);
  });

  it("names every property of the GeoJSON and the KML, and only of the points that are written", () => {
    const start = lines.indexOf("PROPERTIES OF THE GEOJSON AND THE KML (3)");
    expect(start).toBeGreaterThan(-1);
    expect([lines[start + 2], lines[start + 4], lines[start + 6]]).toEqual(["tier", "type", "title"]);
    expect(text).not.toContain("onlyOnTheBadPoint");
    expect(text).toContain("GeoJSON writes [longitude, latitude]. KML writes longitude,latitude.");
  });

  it("says so in plain words when it holds no meaning for a column, and invents none", () => {
    const at = lines.indexOf("extraColumn");
    expect(lines[at + 1]).toBe(`    ${NO_DESCRIPTION}`);
    expect(describeColumn("someFieldOfTheSource", "signal")).toBe(NO_DESCRIPTION);
    expect(describeColumn("tier", "a-kind-with-no-dictionary")).toBe(NO_DESCRIPTION);
  });

  it("says so when no source was given", () => {
    for (const source of [undefined, "", "   "]) {
      expect(toDataDictionary({ name: "events", rows, at: AT, source })).toContain(`Source of the data:  ${NO_SOURCE}`);
    }
  });

  it("does not give one meaning to a name that two exports use for two things", () => {
    expect(describeColumn("magnitude", "events")).toContain("unit of the source");
    expect(describeColumn("magnitude", "signal")).toContain("size of the marker");
    expect(describeColumn("lat", "satellites")).toContain("below the object");
    expect(describeColumn("lat", "events")).toBe(describeColumn("lat", "signal"));
  });

  it("uses the name of the export as the dictionary when no kind is given, and lets a view add meanings", () => {
    expect(toDataDictionary({ name: "locate", rows: [{ confidence: 0.4 }], at: AT })).toContain("It is not a measured accuracy.");
    const custom = toDataDictionary({
      name: "ports",
      kind: "directory",
      rows: [{ id: "port:1", name: "Rotterdam", teu: 14.5 }],
      at: AT,
      extra: { teu: "The layer's own measure of the record, in M TEU." },
    });
    expect(custom).toContain("teu\r\n    The layer's own measure of the record, in M TEU.");
    expect(custom).toContain("name\r\n    The short label of the record");
  });

  it("describes only the files that the export has", () => {
    const csvOnly = toDataDictionary({ name: "markets", rows: [{ symbol: "BTC" }], at: AT });
    expect(csvOnly).toContain("Files it describes:  opendata-markets-2026-10-08T05-59Z.csv");
    expect(csvOnly).not.toContain(".geojson");
    expect(csvOnly).not.toContain("PROPERTIES OF THE GEOJSON");
    expect(csvOnly).not.toContain("POSITION IN THE GEOJSON");
    const geoOnly = toDataDictionary({ name: "dossier-signal", kind: "dossier", geo: [{ lat: 1, lon: 2, properties: { kind: "signal" } }], at: AT });
    expect(geoOnly).toContain("Files it describes:  opendata-dossier-signal-2026-10-08T05-59Z.geojson, .kml");
    expect(geoOnly).not.toContain("COLUMNS OF THE CSV FILE");
    expect(toDataDictionary({ name: "events", at: AT })).toContain("Files it describes:  none: the export was empty");
  });

  it("is a pure function of its input: the time comes from the caller", () => {
    expect(toDataDictionary({ name: "events", rows, geo, at: AT })).toBe(toDataDictionary({ name: "events", rows, geo, at: AT }));
    expect(toDataDictionary({ name: "events", rows, at: AT + 3_600_000 })).toContain("2026-10-08T06:59:12.000Z");
  });

  it("every meaning on file is one or more full sentences", () => {
    const kinds = Object.keys(EXPORT_DICTIONARIES);
    expect(kinds).toEqual(
      expect.arrayContaining(["signal", "directory", "forecast", "schedule", "ais", "cables", "aviation", "satellites", "events", "locate", "markets", "dossier"]),
    );
    for (const kind of kinds) {
      for (const [column, meaning] of Object.entries(EXPORT_DICTIONARIES[kind])) {
        expect(meaning.length, `${kind}.${column}`).toBeGreaterThan(15);
        expect(meaning, `${kind}.${column}`).toMatch(/^[A-Z].*\.$/);
      }
    }
  });
});
