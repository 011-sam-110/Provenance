import { Camera, CameraArray, Source } from "@/lib/types";
import { CETSP_CAMERAS, type CetspCamera } from "@/lib/sources/cetsp.data";

// São Paulo — CET (Companhia de Engenharia de Tráfego), the city's traffic
// authority. Keyless JPEG snapshots of major corridors (Paulista, Faria Lima,
// Nove de Julho, Ibirapuera, Rebouças, Consolação) at
// https://cameras.cetsp.com.br/cams/{pasta}/1.jpg.
//
// THE GOTCHA THAT DEFINES THIS ADAPTER: 205 of the /cams/{id}/ folders on that
// host return HTTP 200 with a valid JPEG, and only ~10 of them are live. The
// rest are abandoned stills whose Last-Modified dates run from 2017 to 2025 —
// the server never stopped serving them, it just stopped updating them. Counting
// HTTP 200s would report "205 São Paulo cameras" and be wrong by ~195.
//
// So availability here is decided by the snapshot's AGE, never by its status
// code, and never by CamerasCentral's own `status` column either — that layer
// marks three of the live cameras INOPERANTE while their images update fine.
//
// The camera list and coordinates are a committed, hand-verified table
// (./cetsp.data.ts) rather than a runtime scrape; see that file for why.

const IMAGE_ORIGIN = "https://cameras.cetsp.com.br/cams";

/**
 * How old a snapshot may be and still count as a live camera.
 *
 * The live cameras were all under a minute old across repeated checks, and the
 * dead ones are months to years stale, so anything in this range separates them
 * cleanly. 60 minutes is deliberately loose: it tolerates a CET-side pause or a
 * slow overnight cycle without flapping the whole layer to unavailable, while
 * still being four orders of magnitude below the staleness it exists to catch.
 */
export const MAX_SNAPSHOT_AGE_MS = 60 * 60 * 1000;

export const CETSP_SOURCE: Source = {
  id: "cetsp",
  name: "CET — Companhia de Engenharia de Tráfego (São Paulo)",
  license: "CET/Prefeitura de São Paulo — public traffic-camera viewer",
  attribution: "Live traffic images © CET — Companhia de Engenharia de Tráfego, Prefeitura de São Paulo",
  refreshSeconds: 120,
  needsKey: false,
};

/** What one freshness probe learned about a camera's snapshot. */
export interface SnapshotProbe {
  pasta: number;
  /** Last-Modified as epoch ms, or null when the probe failed or sent no header. */
  lastModifiedMs: number | null;
}

export function snapshotUrl(pasta: number): string {
  return `${IMAGE_ORIGIN}/${pasta}/1.jpg`;
}

/**
 * Build the camera list from the static table plus this round's freshness probes.
 *
 * Pure, so the availability rule — the whole point of this adapter — is testable
 * without the network. A camera with no usable probe is reported UNAVAILABLE
 * rather than dropped: the registry's coverage denominator should say "11 known,
 * 10 online", not silently shrink to 10 and present that as the whole truth.
 */
export function normalizeCetsp(
  probes: readonly SnapshotProbe[],
  now: number,
  cameras: readonly CetspCamera[] = CETSP_CAMERAS,
  maxAgeMs: number = MAX_SNAPSHOT_AGE_MS,
): Camera[] {
  const byPasta = new Map(probes.map((p) => [p.pasta, p]));
  const out: Camera[] = [];
  for (const cam of cameras) {
    const lm = byPasta.get(cam.pasta)?.lastModifiedMs ?? null;
    // A future-dated header is a clock disagreement, not freshness — clamp the
    // age at 0 so it reads as fresh rather than as a huge negative.
    const ageMs = lm === null ? null : Math.max(0, now - lm);
    const fresh = ageMs !== null && ageMs <= maxAgeMs;
    out.push({
      id: `cetsp:${cam.pasta}`,
      source: "cetsp",
      country: "BR",
      region: "São Paulo",
      name: cam.name,
      lat: cam.lat,
      lon: cam.lon,
      imageUrl: snapshotUrl(cam.pasta),
      mediaType: "jpeg",
      refreshSeconds: CETSP_SOURCE.refreshSeconds,
      license: CETSP_SOURCE.license,
      attribution: CETSP_SOURCE.attribution,
      available: fresh,
      ...(lm !== null ? { lastSampledAt: new Date(lm).toISOString() } : {}),
    });
  }
  return out;
}

/**
 * HEAD each snapshot for its Last-Modified. HEAD rather than GET so a refresh
 * costs headers, not ~11 × 25 KB of JPEG we would immediately discard — the
 * images themselves are fetched by the client through /api/proxy.
 *
 * One camera failing must not fail the round, so every probe resolves.
 */
async function probeSnapshot(pasta: number): Promise<SnapshotProbe> {
  try {
    const res = await fetch(snapshotUrl(pasta), {
      method: "HEAD",
      headers: { "User-Agent": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) return { pasta, lastModifiedMs: null };
    const header = res.headers.get("last-modified");
    if (!header) return { pasta, lastModifiedMs: null };
    const parsed = Date.parse(header);
    return { pasta, lastModifiedMs: Number.isFinite(parsed) ? parsed : null };
  } catch {
    return { pasta, lastModifiedMs: null };
  }
}

export async function fetchRegistry(): Promise<Camera[]> {
  const probes = await Promise.all(CETSP_CAMERAS.map((c) => probeSnapshot(c.pasta)));
  return CameraArray.parse(normalizeCetsp(probes, Date.now()));
}
