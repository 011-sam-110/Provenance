// Pure CSV / GeoJSON / KML serializers + a browser download helper. The serializers are
// isomorphic and unit-tested; download() is the only browser-only piece. Every
// widget/dossier can hand its visible rows here so the data isn't trapped on screen.

/** Pure: rows of plain objects → RFC-4180-ish CSV (CRLF, quoted where needed). */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const cols =
    columns ??
    Array.from(
      rows.reduce((set, r) => {
        Object.keys(r ?? {}).forEach((k) => set.add(k));
        return set;
      }, new Set<string>()),
    );
  const esc = (v: unknown): string => {
    if (v == null) return "";
    const s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map(esc).join(",")];
  for (const r of rows) lines.push(cols.map((c) => esc((r ?? {})[c])).join(","));
  return lines.join("\r\n");
}

export interface GeoPoint {
  lat: number;
  lon: number;
  properties?: Record<string, unknown>;
}

/** Pure: points → a GeoJSON FeatureCollection string (skips invalid coords). */
export function toGeoJson(points: GeoPoint[]): string {
  const features = (points ?? [])
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map((p) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
      properties: p.properties ?? {},
    }));
  return JSON.stringify({ type: "FeatureCollection", features }, null, 2);
}

/** The media type of a KML file. */
export const KML_MIME = "application/vnd.google-earth.kml+xml";

/**
 * Pure: text that is safe inside an XML element or a double-quoted attribute.
 *
 * Every `&`, `<`, `>`, `"` and `'` becomes an entity, so no value can open a tag,
 * close an attribute, or end a CDATA section: `]]>` leaves as `]]&gt;`, and this
 * file writes no CDATA section for it to end. Characters that XML 1.0 forbids (most
 * control characters, a lone surrogate, U+FFFE, U+FFFF) are dropped, because one of
 * them makes the whole file unreadable to a strict parser.
 */
export function escapeXml(value: string): string {
  return value
    // A surrogate pair is kept whole. A surrogate with no partner is dropped.
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (m) => (m.length === 2 ? m : ""))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** A coordinate as plain decimal text: 7 places (about 1 cm), no exponent, no "-0". */
function kmlNumber(n: number): string {
  const fixed = n.toFixed(7).replace(/\.?0+$/, "");
  return fixed === "-0" ? "0" : fixed;
}

/** The property that names a placemark, in order of preference. */
const KML_NAME_KEYS = ["name", "title", "label", "callsign", "cable", "place", "vessel", "mission", "id"];

function kmlText(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
}

/**
 * Pure: points → a KML 2.2 document string, one Placemark for each point.
 *
 * The same points as `toGeoJson` (it skips the same invalid coordinates), so the two
 * files of one export hold the same features. KML writes a coordinate as
 * `longitude,latitude`, the reverse of how people say it. Each property becomes an
 * ExtendedData value, which Google Earth lists in the balloon of the placemark. The
 * placemark is named from the first of name, title, label, … that the point carries.
 */
export function toKml(points: GeoPoint[], opts: { name?: string } = {}): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    "  <Document>",
  ];
  if (opts.name) lines.push(`    <name>${escapeXml(opts.name)}</name>`);
  for (const p of points ?? []) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    const props = p.properties ?? {};
    const nameKey = KML_NAME_KEYS.find((k) => props[k] != null && props[k] !== "");
    lines.push("    <Placemark>");
    if (nameKey) lines.push(`      <name>${escapeXml(kmlText(props[nameKey]))}</name>`);
    const data = Object.entries(props).filter(([, v]) => v != null && v !== "");
    if (data.length > 0) {
      lines.push("      <ExtendedData>");
      for (const [k, v] of data) {
        lines.push(`        <Data name="${escapeXml(k)}"><value>${escapeXml(kmlText(v))}</value></Data>`);
      }
      lines.push("      </ExtendedData>");
    }
    lines.push(`      <Point><coordinates>${kmlNumber(p.lon)},${kmlNumber(p.lat)}</coordinates></Point>`);
    lines.push("    </Placemark>");
  }
  lines.push("  </Document>", "</kml>");
  return lines.join("\n") + "\n";
}

/** A UTC-stamped filename base, e.g. "opendata-markets-2026-07-08T04-59Z".
 *  The prefix is OUR product name — it used to be a competitor's (see the naming
 *  guard in CLAUDE.md) and it shipped on every CSV and GeoJSON a user downloaded. */
export function exportFilename(kind: string, at: number): string {
  const iso = new Date(at).toISOString().slice(0, 16).replace(":", "-");
  return `opendata-${kind.replace(/[^a-z0-9-]+/gi, "-")}-${iso}Z`;
}

/** Browser-only: trigger a download of `text` as `filename`. No-op on the server. */
export function downloadText(filename: string, mime: string, text: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
