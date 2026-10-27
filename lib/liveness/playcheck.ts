/**
 * The play check: which video cameras played at the last check.
 *
 * WHY THIS EXISTS. Until 2026-10-27 a camera was `live` when its stream URL matched the
 * HLS proxy allowlist. That is a statement about the URL, not about the stream. A check
 * on 27 Oct 2026 (02:15 to 02:25 UTC) pair-read 150 of the 3,187 cameras the map called
 * video, and 111 played: Caltrans 67 of 100 (the rest answered 404), SCDOT 29 of 30 (one
 * 502), Serbia and North Macedonia 15 of 20 (404). So about a quarter of the "video"
 * pins opened a player that never showed a frame.
 *
 * THE RULE NOW. `live` = the stream passes the allowlist AND its last check, at most two
 * cycles old, was `rolling`. Anything else (stalled, error, never checked, too old) is
 * not live, and the camera shows as a still where it has one.
 *
 * WHAT ONE CHECK IS. It reads the playlist as /api/hls would (same fetch, same headers:
 * lib/proxy/hls-upstream.ts), follows a master playlist to its first variant, waits one
 * target duration, reads it again, and asks `judgeHlsPair` whether it moved. A playlist
 * that moved must then hand over its newest segment. Only then is the verdict `rolling`.
 *
 * WHERE THE STATE LIVES. On globalThis, under a Symbol.for key: Next bundles each route
 * on its own, so a module variable would be one copy per route, and /api/cameras would
 * never see what the checker wrote. In memory only: a restart starts with no results and
 * the first pass fills them (playcheck.server.ts says why nothing is written to disk).
 * The server wiring is in playcheck.server.ts, so this file has no Node-only import.
 */

import type { Camera } from "@/lib/types";
import { isHlsAllowed, isLiveStreamUrl } from "@/lib/proxy/hls-allowlist";
import { describeFetchError } from "@/lib/proxy/hls-response";
import { reserveSlot } from "@/lib/http/hostLane";
import { judgeHlsPair, parsePlaylist, readGapMs, type PlaylistFacts } from "@/lib/liveness/playlist";

// ---------------------------------------------------------------------------
// Shapes and constants
// ---------------------------------------------------------------------------

export type PlayVerdict = "rolling" | "stalled" | "error";

export interface PlayResult {
  /** When the check finished, ms since the epoch. */
  checkedAt: number;
  verdict: PlayVerdict;
  /** Why, in a few words: "playlist advanced between reads", "http 404", ... */
  reason: string;
  /**
   * Rolling only. Milliseconds the operator took to hand over the playlist (with its
   * master, if any) plus the response to the newest segment. Measured from the server,
   * so it is the upstream half of a visitor's wait, not the whole of it.
   */
  ttffMs?: number;
  /** The camera's feed key (`Camera.source`), so a summary can group by operator. */
  source: string;
}

/** A camera the checker reads: one whose stream passes the HLS allowlist. */
export interface VideoCamera {
  id: string;
  source: string;
  streamUrl: string;
}

/**
 * A camera is checked again once its last result is this old: about every three hours.
 * How long one full pass over every stream takes on production is not measured yet;
 * scripts/liveness-playcheck.mts runs the same pass once and prints its duration.
 */
export const PLAYCHECK_CYCLE_MS = 3 * 60 * 60 * 1000;

/** A result older than two cycles counts as unknown, and unknown is not live. */
export const PLAYCHECK_FRESH_MS = 2 * PLAYCHECK_CYCLE_MS;

/** Checks in flight at once, across all operators. */
export const PLAYCHECK_CONCURRENCY = 6;

/**
 * Minimum spacing between two request starts to one host. Two requests a second is
 * less than one viewer of each of a handful of cameras; no operator sees a burst.
 */
export const PLAYCHECK_HOST_GAP_MS = 500;

/** Master playlists followed before giving up. Real servers use one level. */
export const PLAYCHECK_MAX_FOLLOW = 2;

/** How often the `save` hook (if one is given) is called during a pass. */
export const PLAYCHECK_SAVE_EVERY_MS = 60_000;

// ---------------------------------------------------------------------------
// The live gate (pure)
// ---------------------------------------------------------------------------

/** A result counts while it is younger than two cycles. */
export function isFreshResult(
  r: PlayResult | undefined,
  now: number,
  freshMs: number = PLAYCHECK_FRESH_MS,
): r is PlayResult {
  return r !== undefined && now - r.checkedAt < freshMs;
}

/** The rule for one camera, given its last result. Pure. */
export function playsNow(streamUrl: string | undefined, r: PlayResult | undefined, now: number): boolean {
  return isLiveStreamUrl(streamUrl) && isFreshResult(r, now) && r.verdict === "rolling";
}

/** The cameras the checker reads: those whose stream passes the allowlist. */
export function videoCameras(cams: readonly Pick<Camera, "id" | "source" | "streamUrl">[]): VideoCamera[] {
  const out: VideoCamera[] = [];
  for (const c of cams) {
    if (c.streamUrl && isLiveStreamUrl(c.streamUrl)) out.push({ id: c.id, source: c.source, streamUrl: c.streamUrl });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Process state, on globalThis
// ---------------------------------------------------------------------------

interface PlayCheckState {
  results: Map<string, PlayResult>;
  /** Bumped on every write, so the live-id memo knows when to look again. */
  version: number;
  live: { version: number; validUntil: number; ids: ReadonlySet<string> } | null;
  /** The background loop, once started. One per process. */
  loop: { stop: () => void } | null;
}

const KEY = Symbol.for("provenance.liveness.playcheck.v1");

function state(): PlayCheckState {
  const g = globalThis as unknown as Record<symbol, PlayCheckState | undefined>;
  let s = g[KEY];
  if (!s) {
    s = { results: new Map(), version: 0, live: null, loop: null };
    g[KEY] = s;
  }
  return s;
}

export function recordPlayResult(id: string, r: PlayResult): void {
  const s = state();
  s.results.set(id, r);
  s.version++;
}

/** Replace every result at once (the `load` hook). */
export function replacePlayResults(results: ReadonlyMap<string, PlayResult>): void {
  const s = state();
  s.results = new Map(results);
  s.version++;
}

export function playResults(): ReadonlyMap<string, PlayResult> {
  return state().results;
}

/** Drop results too old to count. Keeps memory and the saved file bounded. */
export function prunePlayResults(now: number): void {
  const s = state();
  let dropped = false;
  for (const [id, r] of s.results) {
    if (!isFreshResult(r, now)) {
      s.results.delete(id);
      dropped = true;
    }
  }
  if (dropped) s.version++;
}

/**
 * The ids whose last fresh result is `rolling`.
 *
 * THE SET KEEPS ITS IDENTITY WHILE ITS CONTENTS DO NOT CHANGE, and that is the point.
 * lib/cameras/body.ts memoises the 6 MB camera body on the registry array AND this set,
 * by identity. A cycle writes a result every second or so, and most of them repeat the
 * last verdict; a new Set per write would rebuild the body on every request for an hour.
 * So a recompute that finds the same members hands back the old Set.
 *
 * It recomputes on a write, and when the oldest member reaches two cycles of age
 * (`validUntil`), so a camera nobody re-checked drops out on time and not on the next write.
 */
export function liveCameraIds(now: number = Date.now()): ReadonlySet<string> {
  const s = state();
  if (s.live && s.live.version === s.version && now < s.live.validUntil) return s.live.ids;
  const ids = new Set<string>();
  let validUntil = Number.POSITIVE_INFINITY;
  for (const [id, r] of s.results) {
    if (r.verdict !== "rolling" || !isFreshResult(r, now)) continue;
    ids.add(id);
    validUntil = Math.min(validUntil, r.checkedAt + PLAYCHECK_FRESH_MS);
  }
  const prev = s.live?.ids;
  const same = prev !== undefined && prev.size === ids.size && [...ids].every((id) => prev.has(id));
  s.live = { version: s.version, validUntil, ids: same ? prev : ids };
  return s.live.ids;
}

/**
 * Whether the map shows this camera as video. THE one place the rule is applied: the
 * camera list, the camera detail, "near me" and the camera page all call this.
 */
export function isLiveCamera(
  cam: Pick<Camera, "id" | "streamUrl">,
  ids: ReadonlySet<string> = liveCameraIds(),
): boolean {
  return isLiveStreamUrl(cam.streamUrl) && ids.has(cam.id);
}

/** Test seam: forget every result and stop the loop. */
export function __resetPlayCheck(): void {
  const s = state();
  s.loop?.stop();
  s.results = new Map();
  s.version = 0;
  s.live = null;
  s.loop = null;
}

// ---------------------------------------------------------------------------
// The summary for /api/coverage (pure maths, then a wrapper on the state)
// ---------------------------------------------------------------------------

export interface PlayCounts {
  /** Cameras whose stream passes the allowlist: the ones the checker reads. */
  listed: number;
  /** Of those, how many have a result younger than two cycles. */
  checked: number;
  rolling: number;
  stalled: number;
  error: number;
}

export interface PlayCheckSummary extends PlayCounts {
  /** Oldest and newest `checkedAt` among the counted results (ms epoch), or null. */
  windowFrom: number | null;
  windowTo: number | null;
  /** Over rolling results: the median and 90th percentile of `ttffMs`, or null. */
  ttffMedianMs: number | null;
  ttffP90Ms: number | null;
  /** How often each camera is checked, so a reader can say "every 3 h". */
  cycleMs: number;
  /** The same counts per feed key (`Camera.source`). */
  byOperator: Record<string, PlayCounts>;
}

/** The middle value; the mean of the two middle values for an even count. Rounded. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round(s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

/** Nearest-rank percentile: the smallest value with at least p% of values at or below it. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.min(s.length, Math.max(1, Math.ceil((p / 100) * s.length)));
  return Math.round(s[rank - 1]);
}

const zeroCounts = (): PlayCounts => ({ listed: 0, checked: 0, rolling: 0, stalled: 0, error: 0 });

export function summarisePlayCheck(
  cams: readonly VideoCamera[],
  results: ReadonlyMap<string, PlayResult>,
  now: number,
  cycleMs: number = PLAYCHECK_CYCLE_MS,
): PlayCheckSummary {
  const total = zeroCounts();
  const byOperator: Record<string, PlayCounts> = {};
  const ttff: number[] = [];
  let windowFrom: number | null = null;
  let windowTo: number | null = null;

  for (const cam of cams) {
    const op = (byOperator[cam.source] ??= zeroCounts());
    total.listed++;
    op.listed++;
    const r = results.get(cam.id);
    if (!isFreshResult(r, now)) continue;
    total.checked++;
    op.checked++;
    total[r.verdict]++;
    op[r.verdict]++;
    if (r.verdict === "rolling" && typeof r.ttffMs === "number") ttff.push(r.ttffMs);
    windowFrom = windowFrom === null ? r.checkedAt : Math.min(windowFrom, r.checkedAt);
    windowTo = windowTo === null ? r.checkedAt : Math.max(windowTo, r.checkedAt);
  }

  return {
    ...total,
    windowFrom,
    windowTo,
    ttffMedianMs: median(ttff),
    ttffP90Ms: percentile(ttff, 90),
    cycleMs,
    byOperator,
  };
}

/** The summary for the cameras the registry lists now. `/api/coverage` serves it. */
export function getPlayCheckSummary(
  cams: readonly Pick<Camera, "id" | "source" | "streamUrl">[],
  now: number = Date.now(),
): PlayCheckSummary {
  return summarisePlayCheck(videoCameras(cams), playResults(), now);
}

// ---------------------------------------------------------------------------
// One check
// ---------------------------------------------------------------------------

/** The upstream fetch. Production passes `fetchHlsUpstream`, which /api/hls also uses. */
export type HlsFetch = (url: URL, referer: string | undefined) => Promise<Response>;

export interface CheckDeps {
  fetch: HlsFetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Awaited before every upstream request: the per-host spacing. */
  beforeRequest?: (host: string) => Promise<void>;
}

type Read = { ok: true; text: string; ms: number } | { ok: false; reason: string };

/** Ask for one URL as the proxy would. The pacing wait is not counted in `ms`. */
async function request(url: URL, deps: CheckDeps, wantBody: boolean): Promise<Read> {
  const rule = isHlsAllowed(url);
  // The player would get a 403 from /api/hls for this URL, so it cannot play.
  if (!rule.ok) return { ok: false, reason: `host not allowlisted: ${url.host}` };
  await deps.beforeRequest?.(url.hostname);
  const t0 = deps.now();
  let res: Response;
  try {
    res = await deps.fetch(url, rule.referer);
  } catch (err) {
    return { ok: false, reason: `fetch failed: ${describeFetchError(err)}` };
  }
  if (res.status < 200 || res.status >= 300) {
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, reason: `http ${res.status}` };
  }
  if (!wantBody) {
    // A segment: the response proves the bytes are there. Reading a megabyte per camera
    // per cycle would cost gigabytes a day and prove nothing more.
    const ms = deps.now() - t0;
    await res.body?.cancel().catch(() => undefined);
    return { ok: true, text: "", ms };
  }
  try {
    const text = await res.text();
    return { ok: true, text, ms: deps.now() - t0 };
  } catch (err) {
    return { ok: false, reason: `body read failed: ${describeFetchError(err)}` };
  }
}

function resolveUri(uri: string, base: URL): URL | null {
  try {
    return new URL(uri, base);
  } catch {
    return null;
  }
}

/** Check one stream. Never throws: every outcome is a named result. */
export async function checkStream(cam: VideoCamera, deps: CheckDeps): Promise<PlayResult> {
  const done = (verdict: PlayVerdict, reason: string, ttffMs?: number): PlayResult => ({
    checkedAt: deps.now(),
    verdict,
    reason,
    source: cam.source,
    ...(ttffMs !== undefined ? { ttffMs } : {}),
  });

  let url: URL;
  try {
    url = new URL(cam.streamUrl);
  } catch {
    return done("error", "bad stream url");
  }

  // First read, following a master playlist to its first variant as hls.js does.
  let first: PlaylistFacts | null = null;
  let playlistMs = 0;
  for (let hop = 0; hop <= PLAYCHECK_MAX_FOLLOW; hop++) {
    const r = await request(url, deps, true);
    if (!r.ok) return done("error", r.reason);
    playlistMs += r.ms;
    const facts = parsePlaylist(r.text);
    if (!facts.isPlaylist) return done("error", "response was not an HLS playlist");
    if (!facts.isMaster) {
      first = facts;
      break;
    }
    const variant = facts.variantUris[0] ? resolveUri(facts.variantUris[0], url) : null;
    if (!variant) return done("error", "master playlist listed no variants");
    url = variant;
  }
  if (!first) return done("error", "master playlists nested too deep");

  // Second read, one target duration later. A finished recording or a stalled encoder
  // passes the first read; only the pair can tell (lib/liveness/playlist.ts).
  await deps.sleep(readGapMs(first));
  const r2 = await request(url, deps, true);
  if (!r2.ok) return done("error", r2.reason);
  const verdict = judgeHlsPair(first, parsePlaylist(r2.text));
  if (verdict.status === "dead") return done("stalled", verdict.reason);
  if (verdict.status !== "live") return done("error", verdict.reason);

  // The newest segment: what a player at the live edge asks for. A playlist that moves
  // but whose segments 404 still shows a visitor nothing.
  const second = parsePlaylist(r2.text);
  const segment = resolveUri(second.segmentUris[second.segmentUris.length - 1], url);
  if (!segment) return done("error", "segment uri did not parse");
  const seg = await request(segment, deps, false);
  if (!seg.ok) return done("error", `segment ${seg.reason}`);
  return done("rolling", verdict.reason, playlistMs + seg.ms);
}

// ---------------------------------------------------------------------------
// One pass over many cameras: low concurrency, per-host spacing
// ---------------------------------------------------------------------------

export interface RunDeps extends Omit<CheckDeps, "beforeRequest"> {
  concurrency?: number;
  hostGapMs?: number;
  /** Called as each result lands, so the map gains video during the cycle. */
  onResult?: (id: string, r: PlayResult) => void;
}

/**
 * The order of one pass. Cameras with no fresh result go first, taken one host at a
 * time in turn, so the first minutes after a cold start reach every operator rather than
 * all of Caltrans; then the rest, oldest result first. Pure.
 */
export function orderForCycle(
  cams: readonly VideoCamera[],
  results: ReadonlyMap<string, PlayResult>,
  now: number,
): VideoCamera[] {
  const byHost = new Map<string, VideoCamera[]>();
  const known: VideoCamera[] = [];
  for (const cam of cams) {
    if (isFreshResult(results.get(cam.id), now)) {
      known.push(cam);
      continue;
    }
    let host = "";
    try {
      host = new URL(cam.streamUrl).hostname;
    } catch {
      /* checkStream reports it */
    }
    const list = byHost.get(host);
    if (list) list.push(cam);
    else byHost.set(host, [cam]);
  }
  const unknown: VideoCamera[] = [];
  const lanes = [...byHost.values()];
  for (let i = 0; lanes.some((l) => i < l.length); i++) {
    for (const l of lanes) if (i < l.length) unknown.push(l[i]);
  }
  known.sort((a, b) => results.get(a.id)!.checkedAt - results.get(b.id)!.checkedAt);
  return [...unknown, ...known];
}

/** Check every camera once. Resolves with every result; never rejects. */
export async function runPlayCheck(
  cams: readonly VideoCamera[],
  deps: RunDeps,
): Promise<Map<string, PlayResult>> {
  const concurrency = Math.max(1, deps.concurrency ?? PLAYCHECK_CONCURRENCY);
  const gapMs = deps.hostGapMs ?? PLAYCHECK_HOST_GAP_MS;
  const lanes = new Map<string, number>();
  const beforeRequest = async (host: string) => {
    const slot = reserveSlot(lanes.get(host), deps.now(), gapMs);
    lanes.set(host, slot.nextFreeAt);
    if (slot.waitMs > 0) await deps.sleep(slot.waitMs);
  };
  const check: CheckDeps = { fetch: deps.fetch, now: deps.now, sleep: deps.sleep, beforeRequest };

  const out = new Map<string, PlayResult>();
  let next = 0;
  const worker = async () => {
    while (next < cams.length) {
      const cam = cams[next++];
      let r: PlayResult;
      try {
        r = await checkStream(cam, check);
      } catch (err) {
        r = { checkedAt: deps.now(), verdict: "error", reason: `check threw: ${describeFetchError(err)}`, source: cam.source };
      }
      out.set(cam.id, r);
      deps.onResult?.(cam.id, r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, cams.length) }, worker));
  return out;
}

// ---------------------------------------------------------------------------
// The background loop
// ---------------------------------------------------------------------------

export interface LoopDeps extends RunDeps {
  /** The registry, as the route that started the loop sees it. */
  getCameras: () => Promise<readonly Pick<Camera, "id" | "source" | "streamUrl">[]>;
  /**
   * Results kept by an earlier process, or null. Called once, before the first pass.
   * Production passes none (see playcheck.server.ts); the hook keeps that a wiring choice.
   */
  load?: () => ReadonlyMap<string, PlayResult> | null;
  /** Keep the current results. Called during a pass and at its end. Production: none. */
  save?: (results: ReadonlyMap<string, PlayResult>) => void;
  log?: (line: string) => void;
  cycleMs?: number;
  passEveryMs?: number;
  saveEveryMs?: number;
  /** Timer seam; production uses setTimeout with unref. */
  setTimer?: (fn: () => void, ms: number) => { cancel: () => void };
}

function defaultTimer(fn: () => void, ms: number): { cancel: () => void } {
  const t = setTimeout(fn, ms);
  // A background check must never keep a process alive on its own (a CLI, a test).
  (t as { unref?: () => void }).unref?.();
  return { cancel: () => clearTimeout(t) };
}

/**
 * How long the loop rests between passes. A pass checks only the cameras that are DUE,
 * so most passes check nothing; the short rest is what lets a camera the registry did
 * not list at boot be checked within minutes rather than a cycle later. North
 * Macedonia's adapter is the measured case: a cold process answers "the first read of
 * the site list is still running" (seen 2026-10-27), so its cameras join the registry
 * one refresh after the rest.
 */
export const PLAYCHECK_PASS_EVERY_MS = 10 * 60 * 1000;

/** Due: never checked, or checked one cycle ago or more. Pure. */
export function isDue(r: PlayResult | undefined, now: number, cycleMs: number = PLAYCHECK_CYCLE_MS): boolean {
  return r === undefined || now - r.checkedAt >= cycleMs;
}

/**
 * Start the loop if this process has not. Idempotent: every route that reads the live
 * flag may call it, and the first one wins. Loads saved results before it returns, so
 * the response that started it already carries them.
 *
 * THE LOOP. A pass reads the registry, picks the cameras that are due (`isDue`), checks
 * them in `orderForCycle` order with `runPlayCheck`'s pacing, saves, and rests
 * `passEveryMs`. So each camera is checked about once a cycle, and its result is never
 * more than a cycle plus one pass old, well inside the two-cycle freshness window.
 */
export function startPlayCheckLoop(deps: LoopDeps): void {
  const s = state();
  if (s.loop) return;
  let stopped = false;
  let timer: { cancel: () => void } | null = null;
  const setTimer = deps.setTimer ?? defaultTimer;
  const cycleMs = deps.cycleMs ?? PLAYCHECK_CYCLE_MS;
  const passEveryMs = deps.passEveryMs ?? PLAYCHECK_PASS_EVERY_MS;
  const saveEveryMs = deps.saveEveryMs ?? PLAYCHECK_SAVE_EVERY_MS;
  const log = deps.log ?? (() => undefined);
  s.loop = {
    stop: () => {
      stopped = true;
      timer?.cancel();
    },
  };

  try {
    const loaded = deps.load?.();
    if (loaded && loaded.size > 0) {
      replacePlayResults(loaded);
      prunePlayResults(deps.now());
      log(`[playcheck] loaded ${playResults().size} saved results`);
    }
  } catch (err) {
    log(`[playcheck] could not load saved results: ${describeFetchError(err)}`);
  }

  const save = () => {
    try {
      deps.save?.(playResults());
    } catch (err) {
      log(`[playcheck] could not save results: ${describeFetchError(err)}`);
    }
  };

  const pass = async () => {
    if (stopped) return;
    const startedAt = deps.now();
    let cams: VideoCamera[];
    try {
      cams = videoCameras(await deps.getCameras());
    } catch (err) {
      log(`[playcheck] registry unavailable, trying again next pass: ${describeFetchError(err)}`);
      if (!stopped) timer = setTimer(() => void pass(), passEveryMs);
      return;
    }
    prunePlayResults(startedAt);
    const results = playResults();
    const due = cams.filter((c) => isDue(results.get(c.id), startedAt, cycleMs));
    if (due.length > 0) {
      let lastSave = startedAt;
      await runPlayCheck(orderForCycle(due, results, startedAt), {
        ...deps,
        onResult: (id, r) => {
          if (stopped) return;
          recordPlayResult(id, r);
          deps.onResult?.(id, r);
          if (deps.now() - lastSave >= saveEveryMs) {
            lastSave = deps.now();
            save();
          }
        },
      });
      if (stopped) return;
      save();
      const sum = summarisePlayCheck(cams, playResults(), deps.now(), cycleMs);
      const mins = Math.round((deps.now() - startedAt) / 60_000);
      log(
        `[playcheck] checked ${due.length} in ${mins} min; now ${sum.rolling} rolling, ` +
          `${sum.stalled} stalled, ${sum.error} error, of ${sum.listed} listed`,
      );
    }
    if (!stopped) timer = setTimer(() => void pass(), passEveryMs);
  };

  timer = setTimer(() => void pass(), 0);
}

// ---------------------------------------------------------------------------
// The results as a file: the CLI's --out format, and what a `save` hook would write
// ---------------------------------------------------------------------------

/** One row per camera: [checkedAt, verdict, reason, source, ttffMs or null]. */
type Row = [number, PlayVerdict, string, string, number | null];

export interface PlayCheckFile {
  version: 1;
  savedAt: number;
  columns: ["checkedAt", "verdict", "reason", "source", "ttffMs"];
  rows: Record<string, Row>;
}

export function encodePlayResults(results: ReadonlyMap<string, PlayResult>, savedAt: number): string {
  const rows: Record<string, Row> = {};
  for (const [id, r] of results) rows[id] = [r.checkedAt, r.verdict, r.reason, r.source, r.ttffMs ?? null];
  const file: PlayCheckFile = {
    version: 1,
    savedAt,
    columns: ["checkedAt", "verdict", "reason", "source", "ttffMs"],
    rows,
  };
  return JSON.stringify(file);
}

const VERDICTS: ReadonlySet<string> = new Set(["rolling", "stalled", "error"]);

/**
 * Read a saved file. Returns null for anything that is not one; drops rows that are
 * malformed, too old to count, or dated after the file was saved (a clock that jumped).
 */
export function decodePlayResults(
  text: string,
  now: number,
): { savedAt: number; results: Map<string, PlayResult> } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Partial<PlayCheckFile>;
  if (f.version !== 1 || typeof f.savedAt !== "number" || !f.rows || typeof f.rows !== "object") return null;
  const results = new Map<string, PlayResult>();
  for (const [id, row] of Object.entries(f.rows)) {
    if (!Array.isArray(row) || row.length !== 5) continue;
    const [checkedAt, verdict, reason, source, ttffMs] = row as unknown[];
    if (typeof checkedAt !== "number" || !Number.isFinite(checkedAt)) continue;
    if (typeof verdict !== "string" || !VERDICTS.has(verdict)) continue;
    if (typeof reason !== "string" || typeof source !== "string") continue;
    if (checkedAt > f.savedAt) continue;
    const r: PlayResult = {
      checkedAt,
      verdict: verdict as PlayVerdict,
      reason,
      source,
      ...(typeof ttffMs === "number" && Number.isFinite(ttffMs) ? { ttffMs } : {}),
    };
    if (!isFreshResult(r, now)) continue;
    results.set(id, r);
  }
  return { savedAt: f.savedAt, results };
}
