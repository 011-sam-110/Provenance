/**
 * CARS census — the second vendor stack, after Castle Rock.
 *
 * WHAT CARS IS. `carsprogram.org` hosts the Condition Acquisition and Reporting System,
 * a pooled-fund 511 platform several state DOTs run their public map on. Like Castle Rock
 * it is a PORTAL in front of each agency's own streaming stack, so the portal tells you
 * which cameras exist and the agency's own host serves the video. That split is the whole
 * reason this is worth a census: the streams are on agency-owned domains
 * (`video.dot.state.mn.us`, `publicstreamer*.cotrip.org`), not on a reseller's CDN.
 *
 * HOW IT WAS FOUND, so the next person can repeat it rather than re-derive it:
 *   1. cotrip.org is a Vite SPA. Its bundle names `https://511.cotrip.org/configs/main.json`.
 *   2. That config's `layers[]` carries, per layer, an `api` base and a `collection`.
 *      The cameras layer points at `https://api-511x-co.carsprogram.org/cameras`.
 *   3. That base returns `{"healthy":true}` — it is a service root, not the data. The
 *      bundle builds two routes off it: `.api + "/hash"` (a cheap change-detector the app
 *      polls) and `.api + "/map-features"` (the GeoJSON). `/map-features` is the one.
 *   4. Sweeping `api-511x-<state>.carsprogram.org/cameras/hash` across all 50 states found
 *      exactly two live: `co` and `mn`. Other CARS states, if any, use different naming.
 *
 * The `/hash` route is why the state sweep is cheap and polite: it is the endpoint the
 * operator's own app polls, it returns ~75 bytes, and a 200 from it is proof the service
 * exists without pulling anyone's full camera catalogue to find out.
 *
 * WHY THE VERDICT IS PER HOST, NOT PER STATE. Colorado's catalogue is served from
 * cotrip.org and its VIDEO from four separate `publicstreamer*.cotrip.org` hosts, which
 * answer the portal fine and refuse TCP on 443 from outside the US. A state-level verdict
 * would have to call Colorado either "live" or "dead" and both are wrong.
 *
 *   npx tsx scripts/liveness-cars.mts --inventory   # catalogue -> cars-hosts.json
 *   npx tsx scripts/liveness-cars.mts --probe       # pair-read  -> cars-verdicts.json
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "data", "liveness");
const HOSTS_PATH = join(OUT_DIR, "cars-hosts.json");
const VERDICTS_PATH = join(OUT_DIR, "cars-verdicts.json");

const UA = "Provenance/2.0 (+https://github.com/011-sam-110/Provenance)";
const TIMEOUT_MS = 20_000;
/** Segments run ~10s, so two reads must straddle more than one segment to prove nothing. */
const PAIR_GAP_MS = 16_000;
/** Enough to put a percentage on a host without hammering an agency's video origin. */
const SAMPLE_PER_HOST = 40;
const EXAMPLES_PER_HOST = 40;
/** Consecutive dead reads after which a host is called unreachable rather than probed out. */
const UNREACHABLE_AFTER = 5;

interface CarsSystem {
  system: string;
  site: string;
  country: string;
  region: string;
  agency: string;
  apiBase: string;
}

/**
 * Found by sweeping `/cameras/hash` across all 50 two-letter state codes. Deliberately a
 * literal list and not a live sweep at run time: a census should read the same catalogue
 * twice, and re-discovering the members on every run would make the output drift for
 * reasons that have nothing to do with the cameras.
 */
const CARS_SYSTEMS: readonly CarsSystem[] = [
  {
    system: "co",
    site: "cotrip.org",
    country: "US",
    region: "Colorado",
    agency: "Colorado DOT (COtrip)",
    apiBase: "https://api-511x-co.carsprogram.org/cameras",
  },
  {
    system: "mn",
    site: "511mn.org",
    country: "US",
    region: "Minnesota",
    agency: "Minnesota DOT (511mn)",
    apiBase: "https://api-511x-mn.carsprogram.org/cameras",
  },
];

interface CameraView {
  name?: string;
  type?: string;
  url?: string;
  broken?: boolean;
  imageTimestamp?: number;
}

interface HostRow {
  host: string;
  sampleUrl: string;
  count: number;
  system: Omit<CarsSystem, "apiBase">;
  examples: string[];
  /** The operator's own `broken` flag. Their claim about their cameras, not our measurement. */
  operatorBroken: number;
  owners: Record<string, number>;
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json,application/vnd.apple.mpegurl,*/*" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ---------------------------------------------------------------- inventory

async function inventory(): Promise<void> {
  const byHost = new Map<string, HostRow>();
  const systems: Array<Record<string, unknown>> = [];

  for (const sys of CARS_SYSTEMS) {
    const { apiBase, ...meta } = sys;
    let cameras = 0;
    let withVideo = 0;
    let unplaceable = 0;
    try {
      const raw = await getText(`${apiBase}/map-features`);
      const parsed = JSON.parse(raw) as { features?: unknown };
      const feats = Array.isArray(parsed.features) ? parsed.features : [];
      cameras = feats.length;

      for (const f of feats as Array<Record<string, any>>) {
        const props = f?.properties ?? {};
        const coords = f?.geometry?.coordinates;
        // GeoJSON is [lon, lat]. A camera we cannot place is counted, never defaulted to
        // 0,0 — the Gulf of Guinea is where every un-geocoded row goes to be believed.
        if (!Array.isArray(coords) || coords.length < 2 || !Number.isFinite(coords[0])) unplaceable++;

        for (const v of (props.views ?? []) as CameraView[]) {
          const url = typeof v?.url === "string" ? v.url : "";
          if (!url.includes(".m3u8")) continue;
          withVideo++;
          let host: string;
          try {
            host = new URL(url).host;
          } catch {
            continue;
          }
          let row = byHost.get(host);
          if (!row) {
            row = {
              host,
              sampleUrl: url,
              count: 0,
              system: meta,
              examples: [],
              operatorBroken: 0,
              owners: {},
            };
            byHost.set(host, row);
          }
          row.count++;
          if (v.broken) row.operatorBroken++;
          const owner = String(props.cameraOwner ?? "unknown");
          row.owners[owner] = (row.owners[owner] ?? 0) + 1;
          if (row.examples.length < EXAMPLES_PER_HOST) row.examples.push(url);
        }
      }
      systems.push({ ...meta, cameras, withVideo, unplaceable, outcome: "ok" });
      console.log(`${sys.system}: ${cameras} cameras, ${withVideo} HLS views, ${unplaceable} unplaceable`);
    } catch (err) {
      systems.push({ ...meta, cameras, withVideo, unplaceable, outcome: `failed: ${String(err)}` });
      console.log(`${sys.system}: FAILED ${String(err)}`);
    }
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const hosts = [...byHost.values()].sort((a, b) => b.count - a.count);
  writeFileSync(
    HOSTS_PATH,
    JSON.stringify({ version: 1, ranAt: new Date().toISOString(), systems, hosts }, null, 2),
  );
  console.log(`\n${hosts.length} video hosts -> ${HOSTS_PATH}`);
}

// -------------------------------------------------------------------- probe

interface Snapshot {
  status: "ok" | "vod" | "no-variant" | string;
  seq: number | null;
}

/**
 * One read: master playlist -> first variant -> media sequence.
 *
 * These are Wowza-style masters that name a `chunklist_*.m3u8` whose token changes between
 * sessions, so the variant has to be resolved on every read rather than cached.
 */
async function snapshot(url: string): Promise<Snapshot> {
  try {
    const master = await getText(url);
    const variant = master
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#"));
    if (!variant) return { status: "no-variant", seq: null };
    const base = url.slice(0, url.lastIndexOf("/"));
    const body = await getText(variant.startsWith("http") ? variant : `${base}/${variant}`);
    let seq: number | null = null;
    for (const line of body.split("\n")) {
      if (line.startsWith("#EXT-X-MEDIA-SEQUENCE")) seq = Number(line.split(":")[1]);
    }
    // ENDLIST means a finished recording. A file is not a live camera.
    return { status: body.includes("#EXT-X-ENDLIST") ? "vod" : "ok", seq };
  } catch (err) {
    const m = /HTTP (\d+)/.exec(String(err));
    return { status: m ? `http${m[1]}` : "neterr", seq: null };
  }
}

async function probe(): Promise<void> {
  const { hosts } = JSON.parse(readFileSync(HOSTS_PATH, "utf8")) as { hosts: HostRow[] };
  const verdicts: Array<Record<string, unknown>> = [];

  for (const h of hosts) {
    const urls = h.examples.slice(0, SAMPLE_PER_HOST);
    console.log(`\n${h.host} (${h.count} streams) — sampling ${urls.length}`);

    const first = new Map<string, Snapshot>();
    for (const u of urls) {
      first.set(u, await snapshot(u));
      // Bail early on a host that is answering nothing. An unreachable host costs a full
      // timeout per read, so probing all 40 to learn what the first 5 already said turns a
      // 10-minute census into an hour of waiting on TCP.
      if (first.size >= UNREACHABLE_AFTER && ![...first.values()].some((s) => s.status === "ok")) break;
    }

    const reachable = [...first.values()].filter((s) => s.status === "ok").length;
    if (reachable === 0) {
      // The distinction this whole script exists to preserve. Colorado's portal answers
      // and its video host does not, from here. "Unreachable from this network" is NOT
      // "refused" and NOT "dead" — scoring it as either would put a wrong number in the
      // census, and the fix is to re-probe from an exit the operator serves.
      const statuses = [...new Set([...first.values()].map((s) => s.status))];
      verdicts.push({
        host: h.host,
        system: h.system,
        count: h.count,
        sampled: first.size,
        verdict: "unreachable-from-this-network",
        statuses,
        note: "portal served the catalogue; this video host answered no read. Not scored live or dead — re-probe from an exit the operator serves.",
      });
      console.log(`  unreachable: ${statuses.join(", ")}`);
      continue;
    }

    await new Promise((r) => setTimeout(r, PAIR_GAP_MS));

    let rolling = 0;
    let stalled = 0;
    for (const u of urls) {
      const a = first.get(u)!;
      if (a.status !== "ok" || a.seq === null) continue;
      const b = await snapshot(u);
      if (b.status !== "ok" || b.seq === null) continue;
      if (b.seq > a.seq) rolling++;
      else if (b.seq === a.seq) stalled++;
    }

    const rate = rolling / urls.length;
    verdicts.push({
      host: h.host,
      system: h.system,
      count: h.count,
      sampled: urls.length,
      reachable,
      rolling,
      stalled,
      rollingRate: Number(rate.toFixed(3)),
      // Reported as an estimate with its sample size attached, never as a count of
      // individually verified cameras — 40 reads cannot certify 1,246 streams.
      estimatedLive: Math.round(rate * h.count),
      verdict: rolling > 0 ? "live" : "no-rolling-stream",
    });
    console.log(`  rolling ${rolling}/${urls.length} (${(rate * 100).toFixed(1)}%) -> ~${Math.round(rate * h.count)} of ${h.count}`);
    writeFileSync(VERDICTS_PATH, JSON.stringify({ version: 1, ranAt: new Date().toISOString(), verdicts }, null, 2));
  }

  writeFileSync(VERDICTS_PATH, JSON.stringify({ version: 1, ranAt: new Date().toISOString(), verdicts }, null, 2));
  console.log(`\n-> ${VERDICTS_PATH}`);
}

const mode = process.argv.includes("--probe") ? "probe" : "inventory";
await (mode === "probe" ? probe() : inventory());
