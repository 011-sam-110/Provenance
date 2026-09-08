/**
 * Stage A: do the twelve silent feeds publish live video, and how much?
 *
 *   node --import ./scripts/ts-alias-hook.mjs scripts/liveness-measure.mts
 *   node --import ./scripts/ts-alias-hook.mjs scripts/liveness-measure.mts --replay
 *   node --import ./scripts/ts-alias-hook.mjs scripts/liveness-measure.mts --feeds=drivebc,nzta
 *
 * WHAT THIS IS FOR. Provenance can analyse 1,467 of its 91,086 cameras, because "live"
 * means "the stream URL matches one of four rules in the HLS proxy allowlist". Twelve
 * adapters never parse a stream URL at all. This asks their upstreams directly.
 *
 * THE THREE WAYS A MEASUREMENT LIKE THIS LIES, AND WHAT IS DONE ABOUT EACH:
 *
 * 1. It records a blocked request as an absent stream. `politeFetchJson` in
 *    lib/discovery/run.ts returns null for a 404, a timeout and an unparseable body
 *    alike, which is right for discovery and wrong here. Every outcome below is named,
 *    and a feed that did not answer is `unknown`, never zero.
 *
 * 2. It runs behind a VPN. Mullvad on this machine blackholes some hosts and gets 403s
 *    that read exactly like "no stream here". The run records its exit IP next to every
 *    result and says loudly when it cannot determine one.
 *
 * 3. It believes HTTP 200. BIHAMK and ACT both serve dead cameras as 200, and a
 *    finished recording is a perfectly valid playlist. Liveness is decided by a PAIR of
 *    reads seconds apart — see lib/liveness/playlist.ts.
 *
 * RAW BODIES ARE SAVED BEFORE ANYTHING IS DECIDED. data/liveness/raw/ is the harness:
 * --replay re-runs the whole scan against it with no network, so a disagreement about
 * what a feed publishes is settled by reading a file rather than by re-fetching and
 * hoping for the same answer.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { SILENT_FEEDS, type FeedRequest, type SilentFeed } from "@/lib/liveness/feeds";
import { isPlayableKind, scanJsonForStreams, scanTextForStreams, type StreamHit } from "@/lib/liveness/scan";
import { judgeHlsPair, parsePlaylist, readGapMs } from "@/lib/liveness/playlist";

const OUT_DIR = join(process.cwd(), "data", "liveness");
const RAW_DIR = join(OUT_DIR, "raw");

const UA = "TrafficNerd/2.0 liveness (+https://github.com/011-sam-110/Provenance)";
const REQUEST_TIMEOUT_MS = 25_000;
const HOST_DELAY_MS = 1_000;
const MAX_BODY_BYTES = 24 * 1024 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const REPLAY = flag("replay");
const NO_PROBE = flag("no-probe");
const PROBE_LIMIT = Number(value("probe-limit") ?? 40);
const ONLY = value("feeds")?.split(",").map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------------------
// Network manners. Mirrors lib/discovery/run.ts: this reads other people
// infrastructure, and a tool that hammers a national portal is a tool that gets the
// project blocked, which no amount of better code recovers from.
// ---------------------------------------------------------------------------

const lastHit = new Map<string, number>();

async function polite(url: string): Promise<void> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  const wait = (lastHit.get(host) ?? 0) + HOST_DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

type FetchOutcome =
  | { status: "ok"; body: string; contentType: string; ms: number }
  | { status: "http"; code: number }
  | { status: "timeout" }
  | { status: "error"; message: string };

async function fetchRaw(req: FeedRequest): Promise<FetchOutcome> {
  await polite(req.url);
  const started = Date.now();
  try {
    const res = await fetch(req.url, {
      method: req.method ?? "GET",
      headers: { "User-Agent": UA, ...req.headers },
      body: req.body,
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return { status: "http", code: res.status };
    const body = await res.text();
    if (body.length > MAX_BODY_BYTES) return { status: "error", message: "body over cap" };
    return {
      status: "ok",
      body,
      contentType: res.headers.get("content-type") ?? "",
      ms: Date.now() - started,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // AbortSignal.timeout surfaces as TimeoutError; keeping it distinct from a
    // connection failure matters, because a timeout may be our network and a refusal
    // is more likely to be theirs.
    if (/timeout|aborted/i.test(message)) return { status: "timeout" };
    // A bare "fetch failed" from Node against a host that answers every other client
    // is this project known malformed-header bug: some upstreams (ACT Puerto Rico is
    // the one on record) send a header Node HTTP/1.1 parser rejects outright. Left
    // here it would report "unknown" for a feed that is perfectly readable, so the
    // fallback is a correctness fix rather than a retry. `insecureHTTPParser` is NOT
    // the answer -- it disables the parser safety rather than talking a protocol the
    // server can speak.
    if (/fetch failed/i.test(message)) {
      const viaCurl = curlFetch(req);
      if (viaCurl) return viaCurl;
    }
    return { status: "error", message };
  }
}

/** Last resort for the malformed-header case above. Returns null if curl cannot help. */
function curlFetch(req: FeedRequest): FetchOutcome | null {
  const args = ["-s", "-S", "--max-time", "25", "-w", "\\n%{http_code}"];
  for (const [k, v] of Object.entries({ "User-Agent": UA, ...req.headers })) args.push("-H", `${k}: ${v}`);
  if (req.method === "POST") args.push("-X", "POST");
  if (req.body) args.push("-d", req.body);
  args.push(req.url);
  try {
    const out = execFileSync("curl", args, { encoding: "utf8", maxBuffer: MAX_BODY_BYTES, timeout: 30_000 });
    const cut = out.lastIndexOf("\n");
    const code = Number(out.slice(cut + 1).trim());
    const body = out.slice(0, cut);
    if (!Number.isFinite(code) || code === 0) return null;
    if (code < 200 || code >= 300) return { status: "http", code };
    return { status: "ok", body, contentType: "", ms: 0 };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Where the run is standing. A VPN exit produces 403s indistinguishable from a feed
// that publishes nothing, and this project has already lost time to exactly that.
// ---------------------------------------------------------------------------

async function exitIp(): Promise<string | null> {
  for (const url of ["https://api.ipify.org?format=json", "https://ifconfig.co/json"]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      const j = (await res.json()) as { ip?: string };
      if (j.ip) return j.ip;
    } catch {
      // try the next one
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The probe. Liveness, not a 200.
// ---------------------------------------------------------------------------

interface ProbeResult {
  url: string;
  kind: string;
  status: "live" | "dead" | "unknown" | "unplayable";
  reason: string;
  /** Set only where a bare request failed and a Referer from the same origin fixed it. */
  refererUsed?: string;
  /** Time to the first byte of a real media segment, for choosing the deck timeout. */
  firstByteMs?: number;
}

async function getWithOptionalReferer(
  url: string,
  referer?: string,
): Promise<{ outcome: FetchOutcome; refererUsed?: string }> {
  // Bare first, always. Sending a Referer that is not required is a claim we do not
  // need to make -- the same reasoning already written into lib/proxy/hls-allowlist.ts.
  const bare = await fetchRaw({ url, as: "text", headers: { Accept: "*/*" } });
  if (bare.status !== "http" || (bare.code !== 403 && bare.code !== 401)) return { outcome: bare };
  if (!referer) return { outcome: bare };

  const withRef = await fetchRaw({ url, as: "text", headers: { Accept: "*/*", Referer: referer } });
  if (withRef.status === "ok") return { outcome: withRef, refererUsed: referer };
  return { outcome: bare };
}

async function probeHls(url: string, referer?: string): Promise<ProbeResult> {
  const base: ProbeResult = { url, kind: "hls", status: "unknown", reason: "" };

  const first = await getWithOptionalReferer(url, referer);
  if (first.outcome.status !== "ok") {
    return { ...base, reason: `first read: ${describe(first.outcome)}` };
  }

  let playlistUrl = url;
  let before = parsePlaylist(first.outcome.body);
  let refererUsed = first.refererUsed;

  // A master playlist has no segments of its own. Follow one variant, once -- a
  // deeper chase is a redirect loop waiting to happen.
  const firstJudge = judgeHlsPair(before, before);
  if (firstJudge.status === "follow") {
    playlistUrl = new URL(firstJudge.followUri, url).toString();
    const variant = await getWithOptionalReferer(playlistUrl, referer);
    if (variant.outcome.status !== "ok") {
      return { ...base, reason: `variant read: ${describe(variant.outcome)}`, refererUsed };
    }
    before = parsePlaylist(variant.outcome.body);
    refererUsed = variant.refererUsed ?? refererUsed;
  }

  await sleep(readGapMs(before));

  const second = await getWithOptionalReferer(playlistUrl, referer);
  if (second.outcome.status !== "ok") {
    return { ...base, reason: `second read: ${describe(second.outcome)}`, refererUsed };
  }
  const after = parsePlaylist(second.outcome.body);
  const verdict = judgeHlsPair(before, after);

  if (verdict.status !== "live") {
    return {
      ...base,
      status: verdict.status === "follow" ? "unknown" : verdict.status,
      reason: verdict.reason,
      refererUsed,
    };
  }

  // A playlist that advances is serving. Fetching one segment proves the media itself
  // is reachable, and times it -- the deck needs a dead-stream timeout, and a timeout
  // chosen from a round number rather than from data produces false negatives that
  // silently exclude good cameras under default-deny.
  const segUri = after.segmentUris.at(-1) ?? before.segmentUris.at(-1);
  if (!segUri) return { ...base, status: "unknown", reason: "advanced but listed no segment", refererUsed };

  const segUrl = new URL(segUri, playlistUrl).toString();
  const started = Date.now();
  const seg = await getWithOptionalReferer(segUrl, referer);
  if (seg.outcome.status !== "ok") {
    return { ...base, status: "unknown", reason: `segment: ${describe(seg.outcome)}`, refererUsed };
  }
  if (seg.outcome.body.length === 0) {
    return { ...base, status: "dead", reason: "segment was empty", refererUsed };
  }

  return {
    ...base,
    status: "live",
    reason: verdict.reason,
    refererUsed,
    firstByteMs: Date.now() - started,
  };
}

async function probeMjpeg(url: string, referer?: string): Promise<ProbeResult> {
  const base: ProbeResult = { url, kind: "mjpeg", status: "unknown", reason: "" };
  await polite(url);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "*/*", ...(referer ? { Referer: referer } : {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return { ...base, reason: `HTTP ${res.status}` };

    const ctype = res.headers.get("content-type") ?? "";
    if (!/multipart\/x-mixed-replace/i.test(ctype)) {
      // A .mjpg path serving a single image is a still with a misleading name. Saying
      // so is more useful than calling it dead, because the camera is real.
      return { ...base, status: "dead", reason: `not multipart (content-type: ${ctype || "none"})` };
    }

    // Two DIFFERENT frames. One frame is a still wearing a multipart header.
    const reader = res.body?.getReader();
    if (!reader) return { ...base, reason: "no readable body" };

    const chunks: Uint8Array[] = [];
    let total = 0;
    let firstByteMs: number | undefined;
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline && total < 2_000_000) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      if (chunk) {
        firstByteMs ??= Date.now() - started;
        chunks.push(chunk);
        total += chunk.length;
        if (countJpegStarts(chunks) >= 2) break;
      }
    }
    await reader.cancel().catch(() => {});

    const frames = countJpegStarts(chunks);
    if (frames >= 2) {
      return { ...base, status: "live", reason: `${frames} frames in one connection`, firstByteMs };
    }
    return { ...base, status: "dead", reason: `only ${frames} frame(s) before the deadline` };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ...base, reason: /timeout|aborted/i.test(message) ? "timeout" : message };
  }
}

/** JPEG SOI markers across the buffered chunks. Two means the stream is moving. */
function countJpegStarts(chunks: Uint8Array[]): number {
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  let n = 0;
  for (let i = 0; i + 1 < buf.length; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8) n++;
  }
  return n;
}

function describe(o: FetchOutcome): string {
  switch (o.status) {
    case "ok":
      return "ok";
    case "http":
      return `HTTP ${o.code}`;
    case "timeout":
      return "timeout";
    case "error":
      return o.message;
  }
}

// ---------------------------------------------------------------------------
// Per-feed run
// ---------------------------------------------------------------------------

interface FeedReport {
  key: string;
  label: string;
  note?: string;
  level1: Array<{ url: string; outcome: string; bytes?: number }>;
  level2: Array<{ url: string; outcome: string; bytes?: number }>;
  /** `unknown` when nothing answered -- distinct from a feed that answered with none. */
  streamsFound: number | "unknown";
  playableFound: number;
  hits: StreamHit[];
  probes: ProbeResult[];
}

function rawPath(key: string, i: number, level: 1 | 2): string {
  return join(RAW_DIR, `${key}.L${level}.${i}.txt`);
}

async function readOrReplay(key: string, i: number, level: 1 | 2, req: FeedRequest): Promise<FetchOutcome> {
  const path = rawPath(key, i, level);
  if (REPLAY) {
    if (!existsSync(path)) return { status: "error", message: "no saved body to replay" };
    return { status: "ok", body: readFileSync(path, "utf8"), contentType: "", ms: 0 };
  }
  const outcome = await fetchRaw(req);
  // Saved before anything is decided, so the decision can be re-argued later.
  if (outcome.status === "ok") writeFileSync(path, outcome.body, "utf8");
  return outcome;
}

function scanOutcome(outcome: FetchOutcome, as: "json" | "text"): StreamHit[] {
  if (outcome.status !== "ok") return [];
  if (as === "json") {
    try {
      return scanJsonForStreams(JSON.parse(outcome.body));
    } catch {
      // An endpoint that advertised JSON and served HTML is a real finding, but the
      // body may still contain a player URL, so it is scanned as text rather than lost.
      return scanTextForStreams(outcome.body);
    }
  }
  return scanTextForStreams(outcome.body);
}

async function runFeed(feed: SilentFeed): Promise<FeedReport> {
  const report: FeedReport = {
    key: feed.key,
    label: feed.label,
    note: feed.note,
    level1: [],
    level2: [],
    streamsFound: "unknown",
    playableFound: 0,
    hits: [],
    probes: [],
  };

  const byUrl = new Map<string, StreamHit>();
  // Deliberately tracks LEVEL 1 only. Level 2 is a supplement, and a feed whose real
  // endpoint refused while its marketing page loaded has not been measured -- counting
  // that as zero is the same unknown-recorded-as-zero mistake this whole run is built
  // to avoid, one level up. It cost a wrong "Oregon publishes nothing" on the first run.
  let level1Answered = false;

  for (const [i, req] of feed.requests.entries()) {
    const outcome = await readOrReplay(feed.key, i, 1, req);
    report.level1.push({
      url: req.url,
      outcome: describe(outcome),
      bytes: outcome.status === "ok" ? outcome.body.length : undefined,
    });
    if (outcome.status === "ok") level1Answered = true;
    for (const hit of scanOutcome(outcome, req.as)) byUrl.set(hit.url, hit);
  }

  for (const [i, pageUrl] of feed.pages.entries()) {
    const req: FeedRequest = {
      url: pageUrl,
      as: "text",
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": UA },
    };
    const outcome = await readOrReplay(feed.key, i, 2, req);
    report.level2.push({
      url: pageUrl,
      outcome: describe(outcome),
      bytes: outcome.status === "ok" ? outcome.body.length : undefined,
    });
    for (const hit of scanOutcome(outcome, "text")) byUrl.set(hit.url, hit);
  }

  report.hits = [...byUrl.values()];
  // The distinction the whole run rests on: a feed nothing answered from is unknown.
  // Recording it as zero is how a bad afternoon becomes a permanent wrong answer.
  report.streamsFound = level1Answered ? report.hits.length : "unknown";
  report.playableFound = report.hits.filter((h) => isPlayableKind(h.kind)).length;

  if (!NO_PROBE && !REPLAY) {
    const playable = report.hits.filter((h) => isPlayableKind(h.kind)).slice(0, PROBE_LIMIT);
    for (const hit of playable) {
      const referer = feed.pages[0] ?? new URL(hit.url).origin + "/";
      const result = hit.kind === "mjpeg" ? await probeMjpeg(hit.url, referer) : await probeHls(hit.url, referer);
      report.probes.push(result);
      process.stdout.write(`    ${result.status.padEnd(9)} ${hit.kind.padEnd(5)} ${hit.url}\n`);
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  mkdirSync(RAW_DIR, { recursive: true });

  const ip = REPLAY ? "replay (no network)" : await exitIp();
  if (!REPLAY && !ip) {
    console.warn(
      "\n!! Could not determine this run exit IP. Every 'no stream' below is therefore\n" +
        "!! unattributable: a VPN or a blocked egress produces 403s that read exactly like\n" +
        "!! an operator publishing nothing. Fix the network before trusting a zero.\n",
    );
  } else {
    console.log(`exit IP: ${ip}`);
  }

  const feeds = ONLY ? SILENT_FEEDS.filter((f) => ONLY.includes(f.key)) : SILENT_FEEDS;
  if (ONLY) {
    const missing = ONLY.filter((k) => !SILENT_FEEDS.some((f) => f.key === k));
    if (missing.length) console.warn(`unknown feed keys ignored: ${missing.join(", ")}`);
  }

  const reports: FeedReport[] = [];
  for (const feed of feeds) {
    console.log(`\n== ${feed.key} (${feed.label})`);
    const report = await runFeed(feed);
    reports.push(report);
    const found = report.streamsFound === "unknown" ? "unknown" : String(report.streamsFound);
    console.log(`   urls found: ${found}   playable: ${report.playableFound}`);
  }

  const live = reports.flatMap((r) => r.probes.filter((p) => p.status === "live"));
  const latencies = live.map((p) => p.firstByteMs).filter((n): n is number => typeof n === "number").sort((a, b) => a - b);

  const summary = {
    generatedAt: new Date().toISOString(),
    exitIp: ip,
    replay: REPLAY,
    probed: !NO_PROBE && !REPLAY,
    feeds: reports,
    firstByteMs: latencies.length
      ? {
          samples: latencies.length,
          p50: latencies[Math.floor(latencies.length * 0.5)],
          p95: latencies[Math.floor(latencies.length * 0.95)],
          max: latencies.at(-1),
        }
      : null,
  };

  writeFileSync(join(OUT_DIR, "report.json"), JSON.stringify(summary, null, 2), "utf8");

  console.log("\n" + "-".repeat(78));
  console.log("feed              urls  playable  live  dead  unknown");
  for (const r of reports) {
    const n = (s: string) => r.probes.filter((p) => p.status === s).length;
    const found = r.streamsFound === "unknown" ? "  ??" : String(r.streamsFound).padStart(4);
    console.log(
      `${r.key.padEnd(17)}${found}  ${String(r.playableFound).padStart(8)}  ` +
        `${String(n("live")).padStart(4)}  ${String(n("dead")).padStart(4)}  ${String(n("unknown")).padStart(7)}`,
    );
  }
  console.log("-".repeat(78));
  if (summary.firstByteMs) {
    const f = summary.firstByteMs;
    console.log(`segment first byte: p50 ${f.p50}ms  p95 ${f.p95}ms  max ${f.max}ms  (n=${f.samples})`);
    console.log("^ the deck dead-stream timeout should come from this, not from a round number.");
  }
  console.log(`\nreport: data/liveness/report.json    raw bodies: data/liveness/raw/`);
}

await main();
