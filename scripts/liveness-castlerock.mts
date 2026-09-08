/**
 * Stage B result: probe every Castle Rock system's video backend and queue what is live.
 *
 *   node --import ./scripts/ts-alias-hook.mjs scripts/liveness-castlerock.mts --inventory
 *   node --import ./scripts/ts-alias-hook.mjs scripts/liveness-castlerock.mts --probe
 *   node --import ./scripts/ts-alias-hook.mjs scripts/liveness-castlerock.mts --probe --seed --limit=40
 *
 * Two phases, two files, because probing is twenty minutes of mostly sleeping and a kill
 * partway through used to throw away a finished inventory. `--probe` resumes.
 *
 * WHY THIS EXISTS, AND WHAT IT CORRECTS. Stage A concluded that castlerock publishes 97
 * stream URLs, all on the Divas vendor stack, all answering 401 — and therefore that the
 * feed was a refusal. That conclusion was drawn from TWO of the feed's ten systems, which
 * the write-up said plainly was a sample rather than a census. The census disagrees with
 * the sample, and the sample was the optimistic-sounding half:
 *
 *   fl511.com          dis-seNN.divas.cloud            401  Basic realm="XEngine"
 *   511pa.com          pa-seN.arcadis-ivds.com         401  Basic realm="XEngine"
 *   511ga.org          sfs-msc-pub-lq-01...dot.ga.gov  401  nginx, no challenge header
 *   511ny.org          sNN.nysdot.skyvdn.com           200  rolling, sequence advances
 *   www.nvroads.com    dNwseN.its.nv.gov               200  rolling, sequence advances
 *   511la.org          ITSStreaming*.dotd.la.gov       200  playlist served
 *   www.drivenc.gov    cf[amst]seNN.services.ncdot.gov  measured here
 *
 * So Castle Rock is not one backend behind one wall. It is a portal platform in front of
 * whatever streaming stack each agency happens to run, and the agency-owned ones are
 * frequently open. Divas and Arcadis IVDS both answer `Basic realm="XEngine"`, which
 * makes XEngine — not Divas — the vendor family to recognise and skip.
 *
 * WHAT THIS SCRIPT WILL NOT DO. It probes one representative camera per HOST, not per
 * camera: about forty requests to answer a question about several thousand cameras. It
 * never sends credentials, and it never retries a 401 with a forged Referer — a 401 is
 * recorded as `refused` and the unblock is a permission request to the agency, which is
 * a person's job and not a script's. Nothing here admits a camera to the map: `--seed`
 * writes the REVIEW QUEUE, and every camera still has to be watched by a human in
 * /admin/live before the serving gate will pass it.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { QUEUE_PATH, type LiveQueue, type QueueCamera } from "@/lib/liveness/queue";
import { judgeHlsPair, parsePlaylist, readGapMs } from "@/lib/liveness/playlist";
import { classifyStreamUrl, isPlayableKind } from "@/lib/liveness/scan";

const UA = "TrafficNerd/2.0 liveness (+https://github.com/011-sam-110/Provenance)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const SEED = flag("seed");
const ONLY_PROBE = flag("probe");
const ONLY_INVENTORY = flag("inventory");
const FRESH = flag("fresh");
const LIMIT = Number(opt("limit") ?? 40);

const OUT_DIR = join(process.cwd(), "data", "liveness");

/**
 * The ten systems the production adapter reads.
 *
 * COPIED from CASTLEROCK_SYSTEMS in lib/sources/castlerock.ts rather than imported, for
 * the reason liveness-seed-queue.mts already ran into: Node executes TypeScript by
 * stripping types, not by understanding them, and that module's line 1 imports `Camera`
 * without the `type` keyword — so importing anything from it fails at runtime with
 * "does not provide an export named 'Camera'". Rewriting a production adapter that other
 * sessions are working in, to suit a measurement script, is the tail wagging the dog.
 *
 * The duplication is real and worth naming: if a system is added there and not here, this
 * script measures a stale list. It reports every system it read, so the divergence is
 * visible in the output rather than silent.
 */
const ADAPTER_SYSTEMS = [
  { system: "fl", site: "fl511.com", country: "US", region: "Florida", agency: "Florida DOT (FL511)" },
  { system: "ga", site: "511ga.org", country: "US", region: "Georgia", agency: "Georgia DOT (511GA)" },
  { system: "ny", site: "511ny.org", country: "US", region: "New York", agency: "NYSDOT (511NY)" },
  { system: "id", site: "511.idaho.gov", country: "US", region: "Idaho", agency: "Idaho Transportation Dept (511)" },
  { system: "newengland", site: "newengland511.org", country: "US", region: "New England", agency: "New England 511 (ME/NH/VT)" },
  { system: "la", site: "511la.org", country: "US", region: "Louisiana", agency: "Louisiana DOTD (511LA)" },
  { system: "on", site: "511on.ca", country: "CA", region: "Ontario", agency: "Ontario MTO (511ON)" },
  { system: "ab", site: "511.alberta.ca", country: "CA", region: "Alberta", agency: "Alberta 511" },
  { system: "ns", site: "511.novascotia.ca", country: "CA", region: "Nova Scotia", agency: "Nova Scotia 511" },
  { system: "nb", site: "511.gnb.ca", country: "CA", region: "New Brunswick", agency: "New Brunswick 511" },
];

/**
 * Systems this sweep found that the production adapter does not yet read.
 *
 * Discovered by sending the adapter's own `POST /List/GetData/Cameras` to public state
 * traveller portals: a Castle Rock site answers with a DataTables envelope carrying
 * `recordsTotal`, and nothing else does. They are kept HERE rather than added to
 * CASTLEROCK_SYSTEMS because adding a system to that table changes what the product
 * serves, and that is a reviewed change with a camera count attached — not a side effect
 * of a measurement script.
 */
const DISCOVERED_SYSTEMS = [
  { system: "nv", site: "www.nvroads.com", country: "US", region: "Nevada", agency: "Nevada DOT (NVRoads)" },
  { system: "nc", site: "www.drivenc.gov", country: "US", region: "North Carolina", agency: "NCDOT (DriveNC)" },
  { system: "pa", site: "511pa.com", country: "US", region: "Pennsylvania", agency: "PennDOT (511PA)" },
  { system: "az", site: "az511.com", country: "US", region: "Arizona", agency: "Arizona DOT (AZ511)" },
  { system: "ct", site: "ctroads.org", country: "US", region: "Connecticut", agency: "Connecticut DOT (CTroads)" },
  { system: "ak", site: "511.alaska.gov", country: "US", region: "Alaska", agency: "Alaska DOT&PF (511)" },
];

type System = { system: string; site: string; country: string; region: string; agency: string };
const SYSTEMS: System[] = [...ADAPTER_SYSTEMS, ...DISCOVERED_SYSTEMS];

// ---------------------------------------------------------------------------
// Reading a system
// ---------------------------------------------------------------------------

interface Row {
  [k: string]: unknown;
}

async function fetchPage(site: string, start: number, length = 100): Promise<{ rows: Row[]; total: number }> {
  const res = await fetch(`https://${site}/List/GetData/Cameras`, {
    method: "POST", // a GET returns an empty DataTables table
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "User-Agent": UA,
    },
    body: `draw=1&start=${start}&length=${length}`,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${site} @${start}: ${res.status}`);
  const json = (await res.json()) as { data?: Row[]; recordsTotal?: number };
  return { rows: json.data ?? [], total: Number(json.recordsTotal) || 0 };
}

interface VideoRef {
  url: string;
  /**
   * The operator's OWN statement that this stream needs credentials.
   *
   * This field is worth more than any probe, and the probe is what proved it: measured
   * against seven systems it agreed with the measurement every single time — Georgia,
   * Pennsylvania and Florida declare `true` and answer 401; Louisiana, Nevada and New
   * York declare `false` and serve a rolling playlist. North Carolina declares `true` on
   * all 92 of its hosts, which is what its 51 "fetch failed" results actually were: not a
   * network fault of ours, but an operator that says up front the stream is not public.
   *
   * So an `authRequired` stream is never probed. Knocking on a door somebody has labelled
   * "locked" is not measurement, it is just traffic — and reporting the resulting timeout
   * as `unreachable` would file the operator's clear "no" under our own failures.
   */
  authRequired: boolean;
  /** The operator marking a camera off — distinct from it being locked. */
  disabled: boolean;
}

/**
 * Every video reference on a Castle Rock row.
 *
 * Reads the documented `images[]` shape first, because that is where the auth and
 * disabled flags live and a blind walk would collect the URL while dropping the very
 * fields that say whether to use it. The generic walk stays as a fallback for a system
 * that shapes its rows differently, with the flags defaulted to "not stated".
 */
function videoRefs(row: Row): VideoRef[] {
  const out: VideoRef[] = [];
  const seen = new Set<string>();

  const images = (row as Record<string, unknown>).images;
  if (Array.isArray(images)) {
    for (const img of images) {
      if (!img || typeof img !== "object") continue;
      const i = img as Record<string, unknown>;
      const url = typeof i.videoUrl === "string" ? i.videoUrl.trim() : "";
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      out.push({
        url,
        authRequired: i.isVideoAuthRequired === true,
        disabled: i.videoDisabled === true || i.blocked === true || i.disabled === true,
      });
    }
  }
  if (out.length) return out;

  const walk = (o: unknown) => {
    if (Array.isArray(o)) {
      for (const v of o) walk(v);
      return;
    }
    if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (typeof v === "string" && /video/i.test(k) && /^https?:\/\//i.test(v.trim()) && !seen.has(v.trim())) {
          seen.add(v.trim());
          out.push({ url: v.trim(), authRequired: false, disabled: false });
        } else walk(v);
      }
    }
  };
  walk(row);
  return out;
}

// ---------------------------------------------------------------------------
// Probing a host, once
// ---------------------------------------------------------------------------

type HostVerdict =
  | { status: "live"; note: string }
  | { status: "served-not-advancing"; note: string }
  | { status: "refused"; note: string }
  | { status: "unreachable"; note: string };

async function get(url: string, referer: string): Promise<{ ok: boolean; status: number; text: string; auth?: string }> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "*/*", "User-Agent": UA, Referer: referer },
      signal: AbortSignal.timeout(20_000),
    });
    const text = res.ok ? await res.text() : "";
    return { ok: res.ok, status: res.status, text, auth: res.headers.get("www-authenticate") ?? undefined };
  } catch (err) {
    return { ok: false, status: 0, text: "", auth: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Decide one host from one camera, using the same pure logic the rest of the product uses.
 *
 * A 200 and a well-formed playlist is NOT live: a finished recording parses perfectly.
 * Liveness is a pair of reads separated by the playlist's own target duration, judged by
 * lib/liveness/playlist.ts — so a verdict here means the same thing a verdict anywhere
 * else in this codebase means.
 */
async function probeHost(sampleUrl: string, referer: string): Promise<HostVerdict> {
  const first = await get(sampleUrl, referer);
  if (!first.ok) {
    if (first.status === 401 || first.status === 403) {
      return { status: "refused", note: `http ${first.status}${first.auth ? ` ${first.auth}` : ""}` };
    }
    if (first.status === 0) return { status: "unreachable", note: first.auth ?? "connect failed" };
    return { status: "unreachable", note: `http ${first.status}` };
  }

  let url = sampleUrl;
  let facts = parsePlaylist(first.text);
  // One hop from a master playlist to a variant. Two would be a redirect loop dressed up.
  if (facts.isMaster && facts.variantUris[0]) {
    url = new URL(facts.variantUris[0], sampleUrl).toString();
    const variant = await get(url, referer);
    if (!variant.ok) return { status: "unreachable", note: `variant http ${variant.status}` };
    facts = parsePlaylist(variant.text);
  }
  if (!facts.isPlaylist) return { status: "unreachable", note: "not a playlist" };

  const gap = readGapMs(facts);
  await sleep(gap);
  const second = await get(url, referer);
  if (!second.ok) return { status: "unreachable", note: `second read http ${second.status}` };

  const verdict = judgeHlsPair(facts, parsePlaylist(second.text));
  if (verdict.status === "live") return { status: "live", note: `advanced over ${Math.round(gap / 1000)}s` };
  if (verdict.status === "dead") return { status: "served-not-advancing", note: "ENDLIST present (recording)" };
  return { status: "served-not-advancing", note: `no advance over ${Math.round(gap / 1000)}s` };
}

// ---------------------------------------------------------------------------

/**
 * Everything the queue needs from a camera, and nothing else.
 *
 * WHY THE SHAPE MATTERS. The first run of this script held every DataTables row from all
 * sixteen systems — about 17,000 nested objects — and kept a SECOND reference to each in
 * a by-host index. It was killed by the OS partway through probing, on a machine with
 * ~650 MB free. Counts are accumulated as numbers, and only a few example cameras per
 * host are retained, so peak memory is a function of the number of HOSTS (about 60) and
 * not of the number of cameras.
 */
interface CameraLite {
  nativeId: string;
  name: string;
  lat: number;
  lon: number;
  url: string;
  system: System;
}

/** How many example cameras to keep per host. Seeding needs a handful, not thousands. */
const EXAMPLES_PER_HOST = 12;

/**
 * Coordinates, which Castle Rock publishes as WKT rather than as two numbers.
 *
 *   latLng.geography.wellKnownText = "POINT (-119.852401 39.484798)"
 *
 * WKT is longitude-first. Reading it as lat-first silently puts every North American
 * camera in Antarctica or the Indian Ocean, which is the kind of wrong that looks fine in
 * a JSON file and only shows up on a map.
 *
 * The first version of this function looked for `latitude`/`longitude`, found neither,
 * and returned null for every row — so the census probed 99 hosts, found nine live, and
 * queued nothing at all. A seeding step that silently produces an empty queue is worse
 * than one that throws, which is why the caller now reports how many rows it could not
 * place.
 */
function parseWkt(row: Row): { lat: number; lon: number } | null {
  const geo = (row as { latLng?: { geography?: { wellKnownText?: unknown } } }).latLng?.geography?.wellKnownText;
  if (typeof geo !== "string") return null;
  const m = /POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i.exec(geo);
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function toLite(row: Row, url: string, system: System): CameraLite | null {
  const r = row as Record<string, unknown>;
  const nativeId = String(r.id ?? r.cameraId ?? r.DT_RowId ?? "").trim();
  if (!nativeId) return null;

  const point = parseWkt(row) ?? {
    lat: Number(r.latitude ?? r.lat),
    lon: Number(r.longitude ?? r.lng ?? r.lon),
  };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;

  // `location` is often the literal string "N/A" on these rows, so it cannot simply win.
  const candidates = [r.roadway, r.location, r.description].map((v) => String(v ?? "").trim());
  const name = candidates.find((v) => v && v.toUpperCase() !== "N/A") ?? nativeId;
  return { nativeId, name, lat: point.lat, lon: point.lon, url, system };
}


// ---------------------------------------------------------------------------
// Phases, and why this is not one pass
// ---------------------------------------------------------------------------

/**
 * Reading the inventory is cheap and fast; probing is slow and mostly SLEEPING.
 *
 * Deciding one host means two reads separated by the playlist's own target duration, so
 * 104 hosts is about twenty minutes, nearly all of it deliberate waiting. A single pass
 * therefore spends ten minutes building an inventory and then risks all of it on a
 * twenty-minute window staying uninterrupted — and on this machine it did not: two runs
 * were killed by the OS under memory pressure from unrelated processes, and the second
 * threw away a COMPLETE inventory because the probe had not finished.
 *
 * So the phases are separate files on disk, and verdicts are written after EVERY host.
 * A kill now costs at most one host. `--probe` resumes by skipping hosts already decided,
 * which also means a disputed verdict can be re-taken alone rather than by re-running the
 * world. This is the same reasoning as data/liveness/raw/ in Stage A: record before
 * deciding, so an interruption costs time and never evidence.
 */
const HOSTS_PATH = join(OUT_DIR, "castlerock-hosts.json");
const VERDICTS_PATH = join(OUT_DIR, "castlerock-verdicts.json");

interface HostRecord {
  host: string;
  sampleUrl: string;
  referer: string;
  count: number;
  system: System;
  examples: CameraLite[];
  /** Streams the operator marks as needing credentials. These are never probed. */
  authRequired: number;
  /** Streams the operator does not mark. Only these are worth a request. */
  open: number;
  /** Streams the operator has switched off. Not a lock, and not worth queueing either. */
  disabled: number;
}

interface Inventory {
  version: 1;
  ranAt: string;
  systems: Array<{ site: string; total: number; pulled: number; withVideo: number; error?: string }>;
  hosts: HostRecord[];
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Phase 1 — inventory
// ---------------------------------------------------------------------------

async function runInventory(): Promise<Inventory> {
  const perHost = new Map<string, HostRecord>();
  const systems: Inventory["systems"] = [];

  for (const system of SYSTEMS) {
    const referer = `https://${system.site.replace(/^www\./, "")}/`;
    let total = 0;
    let pulled = 0;
    let withVideo = 0;
    // Rows with an open stream we could not place on a map. Reported rather than dropped:
    // an empty queue produced in silence is exactly how the first run failed.
    let unplaceable = 0;

    /** Fold one page in and let it go. Nothing here outlives the loop body. */
    const absorb = (rows: Row[]) => {
      pulled += rows.length;
      for (const row of rows) {
        const refs = videoRefs(row).filter((v) => {
          const k = classifyStreamUrl(v.url);
          return k !== null && isPlayableKind(k);
        });
        if (!refs.length) continue;
        withVideo++;
        for (const ref of refs) {
          let host: string;
          try {
            host = new URL(ref.url).host;
          } catch {
            continue;
          }
          let rec = perHost.get(host);
          if (!rec) {
            rec = { host, sampleUrl: ref.url, referer, count: 0, system, examples: [], authRequired: 0, open: 0, disabled: 0 };
            perHost.set(host, rec);
          }
          rec.count++;
          if (ref.authRequired) rec.authRequired++;
          else rec.open++;
          if (ref.disabled) rec.disabled++;
          // Examples exist to seed the review queue, so only stream the operator says is
          // open and not switched off is worth keeping one of.
          if (!ref.authRequired && !ref.disabled && rec.examples.length < EXAMPLES_PER_HOST) {
            const lite = toLite(row, ref.url, system);
            if (lite) rec.examples.push(lite);
            else unplaceable++;
          }
        }
      }
    };

    try {
      const head = await fetchPage(system.site, 0);
      total = head.total;
      absorb(head.rows);
      for (let s = 100; s < total; s += 100) {
        try {
          absorb((await fetchPage(system.site, s)).rows);
        } catch {
          // One bad page must not cost the system. `pulled` says what was actually read,
          // and it is reported next to `total` so a short read is visible rather than
          // silently becoming a smaller answer.
        }
        await sleep(600);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      systems.push({ site: system.site, total: 0, pulled: 0, withVideo: 0, error: message });
      console.log(`${system.site.padEnd(22)} FAILED  ${message}`);
      continue;
    }

    systems.push({ site: system.site, total, pulled, withVideo });
    console.log(
      `${system.site.padEnd(22)} total=${String(total).padStart(5)} pulled=${String(pulled).padStart(5)} withVideo=${String(withVideo).padStart(5)}` +
        (unplaceable ? `  (${unplaceable} open streams had no usable coordinates)` : ""),
    );
  }

  const inventory: Inventory = { version: 1, ranAt: new Date().toISOString(), systems, hosts: [...perHost.values()] };
  writeJson(HOSTS_PATH, inventory);
  console.log(`\nwrote ${inventory.hosts.length} video hosts -> ${HOSTS_PATH}`);
  return inventory;
}

// ---------------------------------------------------------------------------
// Phase 2 — probe, resumable
// ---------------------------------------------------------------------------

type VerdictFile = { version: 1; verdicts: Record<string, HostVerdict & { at: string; cams: number }> };

async function runProbe(inventory: Inventory): Promise<VerdictFile> {
  const file = readJson<VerdictFile>(VERDICTS_PATH, { version: 1, verdicts: {} });

  // Hosts the operator itself marks as needing credentials are recorded as declared
  // refusals WITHOUT a request. This is the politeness rule that matters most here: the
  // agency has already answered, in its own data, and re-asking 51 NCDOT hosts to
  // rediscover a "no" they published would be noise, not evidence.
  let declared = 0;
  for (const h of inventory.hosts) {
    if (file.verdicts[h.host] || h.open > 0) continue;
    file.verdicts[h.host] = {
      status: "refused",
      note: `operator declares isVideoAuthRequired on all ${h.authRequired} streams (not probed)`,
      at: new Date().toISOString(),
      cams: h.count,
    };
    declared++;
  }
  if (declared) {
    writeJson(VERDICTS_PATH, file);
    console.log(`\n${declared} hosts recorded as refused on the operator's own flag, unprobed`);
  }

  const todo = inventory.hosts.filter((h) => !file.verdicts[h.host]);
  const done = inventory.hosts.length - todo.length;

  console.log(`\n--- probing ${todo.length} hosts (${done} already decided) ---`);
  for (const h of todo) {
    const v = await probeHost(h.sampleUrl, h.referer);
    file.verdicts[h.host] = { ...v, at: new Date().toISOString(), cams: h.count };
    // Written after every host, so an interruption costs one host and not the run.
    writeJson(VERDICTS_PATH, file);
    console.log(`  ${v.status.padEnd(21)} ${h.host.padEnd(44)} ${String(h.count).padStart(5)} cams  ${v.note}`);
    await sleep(400);
  }
  return file;
}

// ---------------------------------------------------------------------------

function report(inventory: Inventory, file: VerdictFile): string[] {
  const liveHosts: string[] = [];
  console.log("\n--- summary ---");
  for (const s of ["live", "served-not-advancing", "refused", "unreachable"] as const) {
    const hosts = inventory.hosts.filter((h) => file.verdicts[h.host]?.status === s);
    const cams = hosts.reduce((n, h) => n + h.count, 0);
    console.log(`${s.padEnd(22)} ${String(hosts.length).padStart(4)} hosts  ${String(cams).padStart(6)} cameras`);
    if (s === "live") liveHosts.push(...hosts.map((h) => h.host));
  }
  const undecided = inventory.hosts.filter((h) => !file.verdicts[h.host]).length;
  if (undecided) console.log(`${"not yet probed".padEnd(22)} ${String(undecided).padStart(4)} hosts   <- run --probe again`);

  // Per-agency, because "how many cameras" is the question a person actually asks, and a
  // host count answers a different one.
  const byAgency = new Map<string, { live: number; total: number }>();
  for (const h of inventory.hosts) {
    const k = h.system.agency;
    const e = byAgency.get(k) ?? { live: 0, total: 0 };
    e.total += h.count;
    if (file.verdicts[h.host]?.status === "live") e.live += h.count;
    byAgency.set(k, e);
  }
  console.log("\n--- cameras with a LIVE-measured stream, by agency ---");
  for (const [agency, e] of [...byAgency].sort((a, b) => b[1].live - a[1].live)) {
    if (e.live > 0) console.log(`  ${String(e.live).padStart(5)} of ${String(e.total).padStart(5)}  ${agency}`);
  }
  return liveHosts;
}

async function main() {
  const wantInventory = !ONLY_PROBE && (!existsSync(HOSTS_PATH) || FRESH);
  const inventory = wantInventory ? await runInventory() : readJson<Inventory>(HOSTS_PATH, { version: 1, ranAt: "", systems: [], hosts: [] });

  if (!inventory.hosts.length) {
    console.error(`No host inventory. Run without --probe first (or delete ${HOSTS_PATH} and rerun).`);
    process.exit(1);
  }

  const file = ONLY_INVENTORY ? readJson<VerdictFile>(VERDICTS_PATH, { version: 1, verdicts: {} }) : await runProbe(inventory);
  const liveHosts = report(inventory, file);

  if (!SEED) {
    console.log("\n(no --seed: nothing written to the review queue)");
    return;
  }

  const queue: QueueCamera[] = [];
  const seenId = new Set<string>();

  /**
   * One camera from each live host in turn, rather than draining hosts in order.
   *
   * Draining put all forty cards on a single NYSDOT host, so a full review session would
   * have exercised one backend and told us nothing about the other two. Round-robin means
   * the deck spreads across every operator and every host that passed, which is what makes
   * a human pass worth more than the probe that preceded it.
   */
  const pools = liveHosts
    .map((host) => inventory.hosts.find((h) => h.host === host))
    .filter((r): r is HostRecord => Boolean(r))
    .map((r) => [...r.examples]);

  const roundRobin: CameraLite[] = [];
  for (let i = 0; pools.some((p) => p.length > i); i++) {
    for (const p of pools) if (p[i]) roundRobin.push(p[i]);
  }

  {
    for (const { nativeId, name, lat, lon, url, system } of roundRobin) {
      if (queue.length >= LIMIT) break;
      const cameraId = `castlerock:${system.system}:${nativeId}`;
      if (seenId.has(cameraId)) continue;
      seenId.add(cameraId);
      const kind = classifyStreamUrl(url);
      if (!kind || !isPlayableKind(kind)) continue;
      queue.push({
        cameraId,
        feed: "castlerock",
        name,
        lat,
        lon,
        country: system.country,
        streamUrl: url,
        kind,
        operator: system.agency,
        license: "Castle Rock 511 terms of use",
        attribution: `Live traffic data (c) ${system.agency}`,
        probe: {
          status: "live",
          reason: `host ${new URL(url).host} measured rolling by scripts/liveness-castlerock.mts`,
          at: new Date().toISOString(),
        },
      });
    }
  }

  const out: LiveQueue = { version: 1, generatedAt: new Date().toISOString(), cameras: queue };
  mkdirSync(dirname(QUEUE_PATH), { recursive: true });
  writeFileSync(QUEUE_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`\nqueued ${queue.length} cameras for human review -> ${QUEUE_PATH}`);
  console.log("Nothing is on the map yet. Run the deck at /admin/live and watch each one.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
