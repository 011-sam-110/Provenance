// Read the KML inside a KMZ, and the polygons inside a KML.
//
// NOAA NHC publishes its forecast cones and its Tropical Weather Outlook areas as KMZ:
// a ZIP holding one .kml (and sometimes icon PNGs). The ZIP is read through its
// central directory, because a member's local header can carry a zero size (a
// streamed archive; see zipMemberExtent in lib/signals/gdelt.ts for what slicing to
// the end of the file did in production). Inflate uses DecompressionStream, a web API
// that Node 20.18+ also has, so this module stays importable from the client bundle
// the registry is part of.
//
// The KML reader is deliberately small: it reads Placemarks with a Polygon (outer
// ring only), their <name>, and their ExtendedData <Data name><value> pairs. That is
// everything the two NHC products carry.

/** Pure: the central-directory entries of a ZIP. */
export function zipEntries(buf: ArrayBuffer): { name: string; method: number; size: number; offset: number }[] {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // End of central directory: signature PK\x05\x06, within the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out: { name: string; method: number; size: number; offset: number }[] = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("bad zip directory");
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    out.push({ name: dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)), method, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** The text of the first member whose name matches, or null when there is none. */
export async function zipText(buf: ArrayBuffer, match: (name: string) => boolean): Promise<string | null> {
  const entry = zipEntries(buf).find((e) => match(e.name));
  if (!entry) return null;
  const view = new DataView(buf);
  if (view.getUint32(entry.offset, true) !== 0x04034b50) throw new Error("bad zip member");
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  const data = new Uint8Array(buf, start, entry.size);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error(`zip method ${entry.method}`);
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

/** The KML of a KMZ: its first `.kml` member. */
export function kmzToKml(buf: ArrayBuffer): Promise<string | null> {
  return zipText(buf, (n) => n.toLowerCase().endsWith(".kml"));
}

export interface KmlPolygon {
  name?: string;
  /** Outer ring, [lon, lat], closed. */
  ring: [number, number][];
  data: Record<string, string>;
}

const decodeXml = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

/** Pure: every Placemark of a KML that carries a Polygon. */
export function kmlPolygons(kml: string): KmlPolygon[] {
  const out: KmlPolygon[] = [];
  for (const pm of kml.split(/<Placemark[\s>]/).slice(1)) {
    const body = pm.split("</Placemark>")[0] ?? "";
    const outer = /<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/.exec(body);
    if (!outer) continue;
    const ring: [number, number][] = [];
    for (const tuple of outer[1]!.trim().split(/\s+/)) {
      const [lon, lat] = tuple.split(",").map(Number);
      if (Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat!) <= 90 && Math.abs(lon!) <= 180) ring.push([lon!, lat!]);
    }
    if (ring.length < 4) continue;
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
    const data: Record<string, string> = {};
    for (const m of body.matchAll(/<Data name="([^"]+)">\s*<value>([\s\S]*?)<\/value>/g)) data[m[1]!] = decodeXml(m[2]!);
    const name = /<name>([\s\S]*?)<\/name>/.exec(body)?.[1];
    out.push({ ring, data, ...(name ? { name: decodeXml(name) } : {}) });
  }
  return out;
}

/** Pure: a ring's vertex mean, an anchor inside a convex-ish area (cones and outlook blobs are). */
export function ringAnchor(ring: [number, number][]): { lat: number; lon: number } {
  const pts = ring.length > 1 ? ring.slice(0, -1) : ring;
  let lat = 0;
  let lon = 0;
  for (const [x, y] of pts) {
    lon += x;
    lat += y;
  }
  return { lat: Math.round((lat / pts.length) * 1000) / 1000, lon: Math.round((lon / pts.length) * 1000) / 1000 };
}
