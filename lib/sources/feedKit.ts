/**
 * Shared plumbing for the camera adapters added in the source audit of 2026-10-16.
 *
 * Every adapter here still owns its own endpoint, its own pure normaliser and its own
 * tests. What lives in this file is only what they would otherwise copy: the request
 * headers, a fetch that times out and throws on a non-2xx, the coordinate guard, and
 * the frame prober that dates a still by its Last-Modified header without fetching
 * the picture.
 */

export const FEED_UA = "TrafficNerd/2.0 (+https://github.com/011-sam-110/Provenance)";

/**
 * The agent string for hosts that refuse a non-browser User-Agent. It is the standard
 * crawler form and names us; it is not a disguised browser. Measured 2026-10-16:
 *   - webcams.transport.nsw.gov.au answers "TrafficNerd/2.0 (...)", "curl/8" and a bare
 *     "Mozilla/5.0" with a 307-byte HTML "temporarily unavailable" page, and this form
 *     with the picture;
 *   - tdx.transportdata.tw answers our usual agent and curl's with 401 "Valid API Key
 *     Required", and this form with the anonymous list.
 */
export const COMPATIBLE_UA = "Mozilla/5.0 (compatible; Provenance/1.0; +https://provenance-online.com)";

/**
 * How old a still may be and still count as live, unless an adapter says otherwise.
 * The same 60 minutes as cetsp, bihamk and act-pr.
 */
export const DEFAULT_MAX_FRAME_AGE_MS = 60 * 60 * 1000;

export interface FetchOpts {
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Seconds Next may keep the response in its Data Cache. Omit for no-store. */
  revalidate?: number;
}

async function get(url: string, accept: string, opts: FetchOpts): Promise<Response> {
  const res = await fetch(url, {
    headers: { Accept: accept, "User-Agent": FEED_UA, ...opts.headers },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    ...(opts.revalidate ? { next: { revalidate: opts.revalidate } } : { cache: "no-store" as const }),
  });
  if (!res.ok) throw new Error(`${new URL(url).hostname}: HTTP ${res.status}`);
  return res;
}

/** GET JSON or throw. A throw is what lets registry.ts keep the feed's last-good cameras. */
export async function fetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T> {
  return (await get(url, "application/json", opts)).json() as Promise<T>;
}

/** GET text (HTML, XML) or throw. */
export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  return (await get(url, "text/html,application/xml;q=0.9,*/*;q=0.8", opts)).text();
}

/** A finite WGS84 coordinate that is not Null Island. */
export function validLatLon(lat: unknown, lon: unknown): lat is number {
  if (typeof lat !== "number" || typeof lon !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  return !(Math.abs(lat) < 1e-9 && Math.abs(lon) < 1e-9);
}

/** A number from a number or a numeric string, else NaN. */
export function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v.trim());
  return NaN;
}

/** Collapse whitespace; undefined for an empty result. */
export function clean(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim();
  return s || undefined;
}

/** Whether a frame stamped `frameAt` was live when it was looked at. Pure. */
export function frameFresh(
  frameAt: number | null | undefined,
  at: number,
  maxAgeMs: number = DEFAULT_MAX_FRAME_AGE_MS,
): boolean {
  if (frameAt == null || !Number.isFinite(frameAt)) return false;
  // A future-dated stamp is a clock disagreement, not a dead camera.
  return Math.max(0, at - frameAt) <= maxAgeMs;
}

/** One HEAD of one still. */
export interface FrameProbe {
  /** When we asked. */
  at: number;
  /** HTTP status, or 0 for a network failure. */
  status: number;
  /** Last-Modified as epoch ms, when the host sent one. */
  lastModified: number | null;
  /** Content-Length, when the host sent one. */
  bytes: number | null;
}

/**
 * Which items are due a probe: never probed, or probed longer ago than `revisitMs`. Pure.
 */
export function dueForProbe<T extends { id: string }>(
  items: readonly T[],
  memo: ReadonlyMap<string, FrameProbe>,
  now: number,
  revisitMs: number,
): T[] {
  return items.filter((it) => {
    const p = memo.get(it.id);
    return !p || now - p.at >= revisitMs;
  });
}

/**
 * The verdict of a probe on a still: true live, false dead, undefined not known. Pure.
 *
 * A host that answers with a refusal says the camera is gone; a network failure
 * says nothing either way. Age is measured AT THE PROBE, so a frame that was fresh
 * when we looked twenty minutes ago is not marked dead just because we have not
 * looked again yet.
 */
export function probeVerdict(
  p: FrameProbe | undefined,
  maxAgeMs: number = DEFAULT_MAX_FRAME_AGE_MS,
): boolean | undefined {
  if (!p || p.status === 0) return undefined;
  if (p.status < 200 || p.status >= 300) return false;
  if (p.lastModified === null) return undefined;
  return frameFresh(p.lastModified, p.at, maxAgeMs);
}

export interface ProberOptions {
  /** Do not ask about the same still more often than this. */
  revisitMs: number;
  /** Requests in flight at once, per sweep. */
  concurrency: number;
  /** How long one refresh waits for the sweep before it uses what it has. */
  waitMs: number;
  /** Per-request timeout. */
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/**
 * Dates stills by HEAD, a slice per refresh, and remembers what it saw.
 *
 * A big network (DGT has 1,960 stills) cannot be HEADed in full every five minutes
 * without being a nuisance to the operator, and it cannot be HEADed in full inside a
 * ten-second feed budget either. So each refresh asks only about the stills whose
 * last answer is older than `revisitMs`, waits at most `waitMs`, and lets the rest of
 * the sweep finish in the background for the next round. A still that has never
 * been probed has no verdict, and the adapter decides what that means.
 *
 * In-process memory, like the registry's own last-good map.
 */
export class FrameProber {
  readonly memo = new Map<string, FrameProbe>();
  private running: Promise<void> | null = null;

  constructor(private readonly opts: ProberOptions) {}

  private async head(url: string): Promise<FrameProbe> {
    const at = Date.now();
    try {
      const res = await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": FEED_UA, ...this.opts.headers },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 8_000),
        cache: "no-store",
      });
      const lm = Date.parse(res.headers.get("last-modified") ?? "");
      const len = Number(res.headers.get("content-length"));
      return {
        at,
        status: res.status,
        lastModified: Number.isFinite(lm) ? lm : null,
        bytes: Number.isFinite(len) && len > 0 ? len : null,
      };
    } catch {
      return { at, status: 0, lastModified: null, bytes: null };
    }
  }

  /** Probe what is due, wait up to `waitMs`, and return the memory as it then stands. */
  async sweep(items: readonly { id: string; url: string }[]): Promise<ReadonlyMap<string, FrameProbe>> {
    if (!this.running) {
      const queue = dueForProbe(items, this.memo, Date.now(), this.opts.revisitMs);
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const p = await this.head(next.url);
          // Keep the last real answer through a network blip.
          if (p.status !== 0 || !this.memo.has(next.id)) this.memo.set(next.id, p);
        }
      };
      this.running = Promise.all(Array.from({ length: this.opts.concurrency }, worker))
        .then(() => undefined)
        .finally(() => {
          this.running = null;
        });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.running,
      new Promise((r) => {
        timer = setTimeout(r, this.opts.waitMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    return this.memo;
  }
}

/**
 * Whether an optional credential is present. Reads only presence, never prints a
 * value. Matches `hasEnv` in keyRequirements.ts.
 */
export function envValue(name: string): string | undefined {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
