// CelesTrak GP/TLE source. Returns classic 3-line TLEs for the requested group
// (default "visual" = the brightest, recognisable satellites incl. the ISS).
// TLEs drift slowly, so we cache per-group for a couple of hours and serve the
// stale set if CelesTrak is briefly unreachable. No API key.

export interface TleRecord {
  name: string;
  noradId: string;
  line1: string;
  line2: string;
}

const url = (group: string) =>
  `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`;

/** How long a TLE set is held. Exported so /api/satellites derives its edge TTL
 *  from this rather than inventing a second number that can drift out of step. */
export const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const cache = new Map<string, { at: number; records: TleRecord[] }>();

/** Parse classic 3-line TLE text (name / line1 / line2 triplets). Robust to
 *  trailing whitespace and blank lines as emitted by CelesTrak. */
export function parseTle(text: string): TleRecord[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.length > 0);

  const out: TleRecord[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    // Triplets must be aligned; if they aren't, the feed is malformed — stop.
    if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) break;
    out.push({ name: name.trim(), noradId: line1.slice(2, 7).trim(), line1, line2 });
  }
  return out;
}

export async function fetchTLEs(group = "visual"): Promise<TleRecord[]> {
  const hit = cache.get(group);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.records;

  let res: Response;
  try {
    res = await fetch(url(group), { headers: { Accept: "text/plain" } });
  } catch (e) {
    if (hit) return hit.records; // network blip — serve stale
    throw e;
  }
  if (!res.ok) {
    if (hit) return hit.records; // upstream error — serve stale
    throw new Error(`CelesTrak fetch failed: ${res.status}`);
  }

  const records = parseTle(await res.text());
  cache.set(group, { at: now, records });
  return records;
}
