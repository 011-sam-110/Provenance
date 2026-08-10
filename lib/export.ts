// Pure CSV / GeoJSON serializers + a browser download helper. The serializers are
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
