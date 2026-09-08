/**
 * Stage B: ask operator portals we do NOT already read whether they publish live video.
 *
 *   node --import ./scripts/ts-alias-hook.mjs scripts/liveness-sweep.mts
 *   node --import ./scripts/ts-alias-hook.mjs scripts/liveness-sweep.mts --replay
 *   node --import ./scripts/ts-alias-hook.mjs scripts/liveness-sweep.mts --only=oh-ohgo,ga-511
 *
 * WHAT IS DIFFERENT FROM STAGE A. liveness-measure.mts asked twelve known feeds at the
 * exact endpoints their adapters use. Here there is no adapter to copy an endpoint from,
 * so the sweep starts at the public portal and follows what the page itself references.
 * That is deliberate: a guessed API path that 404s is indistinguishable from an operator
 * with no video, and Stage A already caught itself making that mistake twice.
 *
 * THIS CLOSES STAGE A's BIGGEST STATED LIMIT. Stage A read page HTML but not the
 * JavaScript those pages load, and said so — DriveBC returned a 4 KB app shell, so its
 * zero was weak. Modern 511 portals put player configuration in a bundle, so HTML alone
 * is close to useless. Level 2 here fetches same-origin scripts and JSON the page
 * references. That is what settled New York: myCameraTooltip.min.js contains no video
 * handling of any kind, which is a far stronger "stills only" than its homepage could be.
 *
 * HOW THIS ONE CAN STILL LIE, AND WHAT IS DONE ABOUT EACH:
 *
 * 1. A portal that renders entirely client-side may build stream URLs from parts, so no
 *    string in any asset matches. Such a feed is reported `no-stream-found`, never
 *    `stills-only` — the report never claims an operator lacks video, only that this
 *    sweep did not find any. The words are the finding.
 *
 * 2. A blocked or rate-limited request reads exactly like an absent stream. Every
 *    outcome is named (`ok` / `http` / `timeout` / `error`), and a candidate whose ROOT
 *    never answered is `unreachable`, never zero. This is the flaw Stage A shipped with
 *    and had to fix; it is built in from the start here.
 *
 * 3. It finds a URL on a host the operator does not run — an aggregator, a CDN reseller,
 *    someone's bare IP. Those are inadmissible under the operator-primary policy no
 *    matter how live they are, so scan-time gates in lib/liveness/scan.ts drop bare-IP
 *    and known relay hosts, and the report keeps first-party and third-party hits apart
 *    so nobody reads a Trafficland embed as an operator publishing video.
 *
 * POLITENESS IS PART OF THE DESIGN, not a courtesy bolted on. This walks ~65 public
 * agency sites. Requests are serialised with a per-host delay, assets per candidate are
 * capped, and nothing is fetched twice in a run. Raw bodies are saved before anything is
 * decided so --replay re-runs the whole scan with no network at all.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CANDIDATES, type Candidate } from "@/lib/liveness/candidates";
import { isPlayableKind, scanJsonForStreams, scanTextForStreams, type StreamHit } from "@/lib/liveness/scan";

const OUT_DIR = join(process.cwd(), "data", "liveness");
const RAW_DIR = join(OUT_DIR, "raw", "sweep");

const UA = "TrafficNerd/2.0 liveness (+https://github.com/011-sam-110/Provenance)";
const REQUEST_TIMEOUT_MS = 20_000;
const HOST_DELAY_MS = 1_200;
/**
 * Assets followed per candidate. Deliberately small: the goal is the handful of bundles
 * a camera page loads, not a crawl. A portal whose player config is on the 41st script is
 * a portal this sweep reports honestly as not-found rather than one it hammers to reach.
 */
const MAX_ASSETS = 40;
const MAX_BODY_BYTES = 12 * 1024 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");

const REPLAY = flag("replay");
const ONLY = opt("only")?.split(",").map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------------------
// Fetching. Every outcome is named; nothing collapses into null.
// ---------------------------------------------------------------------------

type Outcome =
  | { status: "ok"; httpStatus: number; contentType: string; body: string; bytes: number }
  | { status: "http"; httpStatus: number; contentType: string }
  | { status: "timeout" }
  | { status: "error"; message: string };

const rawName = (url: string) =>
  url.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);

const lastHitAt = new Map<string, number>();

async function politeFetch(url: string, accept: string): Promise<Outcome> {
  const file = join(RAW_DIR, rawName(url));

  if (REPLAY) {
    if (!existsSync(file)) return { status: "error", message: "not in raw capture" };
    const body = readFileSync(file, "utf8");
    return { status: "ok", httpStatus: 200, contentType: "replay", body, bytes: body.length };
  }

  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return { status: "error", message: "unparseable url" };
  }
  const since = Date.now() - (lastHitAt.get(host) ?? 0);
  if (since < HOST_DELAY_MS) await sleep(HOST_DELAY_MS - since);
  lastHitAt.set(host, Date.now());

  try {
    const res = await fetch(url, {
      headers: {
        // `*/*` in the Accept list on purpose. Stage A sent an HTML-only Accept to
        // TripCheck, got a 406, and logged it as a measured zero — a header WE chose
        // nearly wrote off an entire state.
        Accept: `${accept}, */*`,
        "User-Agent": UA,
        "Accept-Language": "en",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok) return { status: "http", httpStatus: res.status, contentType };

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BODY_BYTES) {
      return { status: "error", message: `body over cap (${buf.byteLength} bytes)` };
    }
    const body = buf.toString("utf8");
    mkdirSync(RAW_DIR, { recursive: true });
    writeFileSync(file, body, "utf8");
    return { status: "ok", httpStatus: res.status, contentType, body, bytes: buf.byteLength };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/timeout|aborted|TimeoutError/i.test(message)) return { status: "timeout" };
    return { status: "error", message };
  }
}

// ---------------------------------------------------------------------------
// Level 2: what a page references that is worth reading.
// ---------------------------------------------------------------------------

/**
 * Video players, detected by name.
 *
 * WHY THIS IS WORTH REPORTING SEPARATELY FROM A STREAM URL. Georgia's 511 portal loads
 * `bundles/videojs` and contains no stream URL anywhere in its homepage or its scripts.
 * Those two facts together are not "no video" — they are "video, whose URLs arrive from
 * an API this sweep has not reached". Without this signal that portal is indistinguishable
 * from a genuinely still-only one, and the honest conclusion for the two is different:
 * one is a dead end and the other is an unfinished search. That distinction is the whole
 * lesson of Stage A, applied one level further out.
 */
const PLAYERS: Array<[name: string, re: RegExp]> = [
  ["video.js", /videojs|video\.js/i],
  ["hls.js", /\bhls\.js|Hls\.isSupported/i],
  ["dash.js", /dashjs|dash\.all/i],
  ["jwplayer", /jwplayer/i],
  ["flowplayer", /flowplayer/i],
  ["clappr", /clappr/i],
  ["wowza", /wowza/i],
  ["shaka", /shaka-player|shakaPlayer/i],
  ["mjpeg-img", /multipart\/x-mixed-replace/i],
];

function playersIn(body: string): string[] {
  return PLAYERS.filter(([, re]) => re.test(body)).map(([n]) => n);
}

/** A URL worth a second hop looks like data, not like a stylesheet or an image. */
const API_ISH = /(camera|cctv|\bcam\b|video|stream|traffic|api|geojson|\.json)/i;
const NOT_WORTH_FETCHING = /\.(png|jpe?g|gif|svg|webp|ico|css|woff2?|ttf|eot|mp4|webm|pdf|zip)(\?|$)/i;

/**
 * Same-origin URLs a body points at that are worth reading.
 *
 * Same-origin is a POLICY rule, not a technical one: this product wants what the operator
 * serves. Following a third-party bundle would start measuring a vendor's CDN and
 * reporting it as the agency's answer.
 *
 * Applied to scripts as well as to pages, which is the hop that matters — a 511 portal
 * names its camera API inside a bundle, never in the HTML.
 */
function assetsFrom(body: string, pageUrl: string): string[] {
  const scored: Array<[url: string, score: number]> = [];
  const seen = new Set<string>();
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [];
  }

  const patterns: Array<[RegExp, number]> = [
    // Data endpoints first: they are what actually carries a stream URL.
    [/["'`]((?:https?:)?\/\/?[a-zA-Z0-9_\-./]*(?:camera|cctv|video|stream|geojson)[a-zA-Z0-9_\-./]*)["'`]/gi, 3],
    [/["'`](\/(?:api|data|list|map)\/[a-zA-Z0-9_\-./]*)["'`]/gi, 2],
    [/<script[^>]+src=["']([^"']+)["']/gi, 1],
    [/<link[^>]+href=["']([^"']+\.json[^"']*)["']/gi, 1],
  ];

  for (const [re, score] of patterns) {
    for (const m of body.matchAll(re)) {
      const raw = m[1];
      if (!raw || raw.startsWith("data:") || NOT_WORTH_FETCHING.test(raw)) continue;
      let abs: string;
      try {
        abs = new URL(raw, pageUrl).toString();
      } catch {
        continue;
      }
      if (!abs.startsWith(origin) || seen.has(abs)) continue;
      seen.add(abs);
      scored.push([abs, score + (API_ISH.test(abs) ? 1 : 0)]);
    }
  }
  // Highest-value first, because the per-candidate budget is small and spending it on
  // analytics bundles is how a portal with video gets reported as having none.
  return scored.sort((a, b) => b[1] - a[1]).map(([u]) => u);
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

function scanBody(body: string, contentType: string, where: string): StreamHit[] {
  const looksJson = /json/i.test(contentType) || /^\s*[[{]/.test(body.slice(0, 200));
  if (looksJson) {
    try {
      const hits = scanJsonForStreams(JSON.parse(body));
      if (hits.length) return hits.map((h) => ({ ...h, path: `${where}:${h.path}` }));
    } catch {
      // Not JSON after all. Fall through to the text scan rather than reporting nothing —
      // a mislabelled content-type must not cost a finding.
    }
  }
  return scanTextForStreams(body).map((h) => ({ ...h, path: `${where}:${h.path}` }));
}

interface CandidateResult {
  key: string;
  label: string;
  country: string;
  region?: string;
  note?: string;
  /**
   * `unreachable` means WE failed, not that the operator has nothing. Kept distinct from
   * `no-stream-found` for the same reason Stage A separates dead from unknown: one is a
   * fact about the camera, the other is a fact about our run.
   */
  verdict: "playable-stream" | "stream-not-playable" | "player-but-no-url" | "no-stream-found" | "unreachable";
  requests: { url: string; outcome: string; bytes?: number }[];
  assetsFetched: number;
  /** Player libraries seen. Evidence of video even when no URL was reached. */
  players: string[];
  /** Hits on a host the operator itself serves. The only kind that can become a source. */
  firstParty: StreamHit[];
  /** Hits on someone else's host — recorded, never counted as the operator publishing. */
  thirdParty: StreamHit[];
}

async function runCandidate(c: Candidate): Promise<CandidateResult> {
  const requests: CandidateResult["requests"] = [];
  const firstParty: StreamHit[] = [];
  const thirdParty: StreamHit[] = [];
  const fetched = new Set<string>();
  let rootAnswered = false;
  let assetsFetched = 0;

  const operatorHosts = new Set(
    c.roots.map((r) => {
      try {
        return new URL(r).hostname.replace(/^www\./, "");
      } catch {
        return "";
      }
    }).filter(Boolean),
  );

  const record = (hits: StreamHit[]) => {
    for (const h of hits) {
      let host = "";
      try {
        host = new URL(h.url, c.roots[0]).hostname.replace(/^www\./, "");
      } catch {
        continue;
      }
      // Registrable-suffix match rather than exact: an agency serving video from
      // cams.example.gov while the portal is example.gov is still the operator.
      const first = [...operatorHosts].some((o) => host === o || host.endsWith(`.${o}`) || o.endsWith(`.${host}`));
      (first ? firstParty : thirdParty).push(h);
    }
  };

  const players = new Set<string>();

  /**
   * Breadth-first to depth 2, because one hop is not enough and three is a crawl.
   *
   * Depth 0 is the portal page; depth 1 is the bundle that names the camera API; depth 2
   * is that API's response, which is where a stream URL actually lives. Georgia is the
   * worked example: the player is at depth 1 and there is no URL anywhere above depth 2.
   */
  const queue: Array<{ url: string; depth: number; accept: string }> = c.roots.map((url) => ({
    url,
    depth: 0,
    accept: "text/html",
  }));

  while (queue.length) {
    const item = queue.shift()!;
    if (fetched.has(item.url)) continue;
    if (item.depth > 0 && assetsFetched >= MAX_ASSETS) continue;
    fetched.add(item.url);

    const res = await politeFetch(item.url, item.accept);
    if (item.depth > 0) assetsFetched++;

    const outcome =
      res.status === "ok"
        ? `ok ${res.httpStatus}`
        : res.status === "http"
          ? `http ${res.httpStatus}`
          : res.status === "timeout"
            ? "timeout"
            : `error: ${res.message}`;
    // Only roots go in `requests`: one line per portal keeps the report readable, and the
    // raw capture holds every asset body anyway.
    if (item.depth === 0) requests.push({ url: item.url, outcome, bytes: res.status === "ok" ? res.bytes : undefined });
    if (res.status !== "ok") continue;
    if (item.depth === 0) rootAnswered = true;

    for (const p of playersIn(res.body)) players.add(p);
    record(scanBody(res.body, res.contentType, item.depth === 0 ? "root" : `d${item.depth}`));

    if (item.depth < 2) {
      for (const next of assetsFrom(res.body, item.url)) {
        if (!fetched.has(next)) {
          queue.push({ url: next, depth: item.depth + 1, accept: "application/json, application/javascript" });
        }
      }
    }
  }

  const playableFirstParty = firstParty.filter((h) => isPlayableKind(h.kind));
  const verdict: CandidateResult["verdict"] = !rootAnswered
    ? "unreachable"
    : playableFirstParty.length > 0
      ? "playable-stream"
      : firstParty.length > 0
        ? "stream-not-playable"
        : players.size > 0
          ? "player-but-no-url"
          : "no-stream-found";

  return {
    key: c.key,
    label: c.label,
    country: c.country,
    region: c.region,
    note: c.note,
    verdict,
    requests,
    assetsFetched,
    players: [...players],
    firstParty,
    thirdParty,
  };
}

// ---------------------------------------------------------------------------

async function exitIp(): Promise<string> {
  // Recorded next to every result because this machine runs a VPN that blackholes some
  // hosts and 403s others, and those read exactly like "no stream here".
  try {
    const res = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return `unknown (http ${res.status})`;
    return ((await res.json()) as { ip?: string }).ip ?? "unknown";
  } catch {
    return "unknown (lookup failed)";
  }
}

async function main() {
  const targets = CANDIDATES.filter((c) => !ONLY || ONLY.includes(c.key));
  if (!targets.length) {
    console.error(`No candidates matched --only=${ONLY?.join(",")}`);
    process.exit(1);
  }

  const ip = REPLAY ? "replay (no network)" : await exitIp();
  console.log(`Stage B sweep: ${targets.length} operator portals, exit IP ${ip}\n`);

  const results: CandidateResult[] = [];
  for (const [i, c] of targets.entries()) {
    process.stdout.write(`[${i + 1}/${targets.length}] ${c.key} ... `);
    const r = await runCandidate(c);
    results.push(r);
    const playable = r.firstParty.filter((h) => isPlayableKind(h.kind)).length;
    console.log(`${r.verdict}${playable ? ` (${playable} playable)` : ""} [${r.assetsFetched} assets]`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const report = { version: 1, ranAt: new Date().toISOString(), exitIp: ip, replay: REPLAY, results };
  writeFileSync(join(OUT_DIR, "sweep.json"), JSON.stringify(report, null, 2) + "\n", "utf8");

  const by = (v: CandidateResult["verdict"]) => results.filter((r) => r.verdict === v);
  console.log("\n--- summary ---");
  console.log(`playable stream found : ${by("playable-stream").length}`);
  console.log(`stream, not playable  : ${by("stream-not-playable").length}`);
  console.log(`player but no URL     : ${by("player-but-no-url").length}   <- video exists, search unfinished`);
  console.log(`no stream found       : ${by("no-stream-found").length}`);
  console.log(`unreachable (our fail): ${by("unreachable").length}`);
  for (const r of by("playable-stream")) {
    const sample = r.firstParty.filter((h) => isPlayableKind(h.kind))[0];
    console.log(`  LIVE ${r.key.padEnd(16)} ${r.firstParty.length} hits  e.g. ${sample?.kind} ${sample?.url.slice(0, 92)}`);
  }
  for (const r of by("player-but-no-url")) {
    console.log(`  PLYR ${r.key.padEnd(16)} ${r.players.join(", ")}`);
  }
  console.log(`\nwrote ${join(OUT_DIR, "sweep.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
