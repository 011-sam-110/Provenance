// What we have ACTUALLY OBSERVED about each credentialed upstream, as opposed to
// what we have configured.
//
// WHY THIS EXISTS. /api/status could say two things about ACLED and it said the
// wrong one. It reported `state: "configured", missingEnv: []` — literally "we hold
// ACLED_EMAIL and ACLED_PASSWORD" — while https://acleddata.com/api/acled/read
// answered HTTP 403 "Access denied" to a token that had just passed ACLED's own
// OAuth password grant. A reader sees "configured" plus an empty missingEnv and
// concludes the layer works. It does not. "We hold the key" and "the key is
// accepted" are different facts and the report only carried the first one.
//
// So this module is the second fact, and it is EVIDENCE, never a hardcoded list of
// known-bad layers. A layer becomes `refused` only because an upstream we send a
// credential to answered 401/402/403 in this process. A layer we have never
// observed stays `configured` — silence is not proof of refusal.
//
// COST. /api/status starts NO upstream request; it reads two in-memory Maps. The
// measurement rides on requests the app was making anyway:
//
//   • installUpstreamObserver() wraps globalThis.fetch once. Per response it does
//     one integer range check and one Map lookup on the URL's hostname, and never
//     touches the body. That is the whole added cost of knowing about a refusal.
//   • instrumentSignalRegistry() wraps each SignalSource.fetch once, recording the
//     completion time and the length of the array the adapter returned. Two clock
//     reads per layer refresh; the array is passed straight through by reference,
//     so the WeakMap coverage record in lib/signals/coverage.ts survives untouched.
//
// HONESTY LIMITS, stated because a status endpoint that overclaims is the exact bug
// being fixed here:
//   • Evidence is PER PROCESS and in memory. A redeploy, a cold start, or a second
//     serverless instance starts from nothing. `null` means "not seen here", never
//     "did not happen" — which is why every published field says `observed` rather
//     than asserting health.
//   • Only HTTP upstreams are observable this way. AISStream is a WebSocket, so a
//     socket that opens and then delivers zero frames produces NO refusal evidence
//     and AIS correctly stays `configured` with `rows: 0` — the honest reading of
//     what we can see. Wiring that up needs a recordCredentialRefusal("ais", …)
//     call from inside the adapter; the function below is exported for it.
//   • A 401/403 is what we saw, not why. The published note says exactly that: this
//     host answered this status to a request carrying our credential. It does not
//     claim to know whether the account is unactivated, geo-blocked or expired.
//
// SECRETS. Nothing here reads, stores or publishes a credential VALUE. It stores a
// hostname, an HTTP status, timestamps and counts.

import type { CredentialVerdict } from "./keyRequirements";

/** HTTP statuses we treat as "the upstream refused the credential we sent". */
export const REFUSAL_STATUSES = new Set([401, 402, 403]);

/**
 * How long a refusal stays current without being re-observed. After this the
 * verdict falls back to `unknown` (so the layer reads `configured` again) rather
 * than asserting a refusal from day-old evidence.
 */
export const REFUSAL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Hosts we send a capability's credential to, keyed by the KEY_REQUIREMENTS id.
 *
 * Attribution is by exact hostname. That is deliberately narrow: a 403 from some
 * other host must never be pinned on a layer whose credential was not involved.
 * tests/unit/sources-status.test.ts checks every host here is one the code really
 * fetches and every id is a real requirement, so the table cannot rot into fiction.
 *
 * Not listed, and why:
 *   ais                — wss://stream.aisstream.io, a WebSocket. Not a fetch.
 *   acled/food-security — removed as layers on 2026-09-05. acleddata.com is the host
 *                        that taught this table its lesson (see below); it is gone from
 *                        the map, not from the reasoning.
 *   ai-brief           — FREELLMAPI_BASE_URL, configured per deployment. No fixed host.
 *   geolocate-vision   — same gateway, same reason.
 */
export const CREDENTIALED_HOSTS: Readonly<Record<string, readonly string[]>> = {
  "air-quality-stations": ["api.openaq.org"],
  "fire-active": ["firms.modaps.eosdis.nasa.gov"],
  "grid-load": ["web-api.tp.entsoe.eu"],
  reliefweb: ["api.reliefweb.int"],
  webcams: ["api.windy.com"],
  "markets-equities": ["finnhub.io"],
  "markets-macro": ["api.stlouisfed.org"],
};

/** Everything this process has seen about one capability. All-null = never seen. */
export interface UpstreamEvidence {
  /** Epoch ms the layer's adapter last finished a server-side fetch (ok or not). */
  lastFetchAt: number | null;
  /** Did that adapter fetch resolve rather than throw? null before the first one. */
  lastFetchOk: boolean | null;
  /** Rows that fetch produced. 0 is a real answer; null means never observed. */
  lastRows: number | null;
  /** Adapter fetches completed since this process started. */
  fetches: number;
  /** Epoch ms a credentialed host for this capability last answered 2xx. */
  lastUpstreamOkAt: number | null;
  /** Epoch ms a credentialed host last answered 401/402/403. */
  lastRefusalAt: number | null;
  lastRefusalStatus: number | null;
  lastRefusalHost: string | null;
  /** Refusals seen since this process started. */
  refusals: number;
}

export function emptyEvidence(): UpstreamEvidence {
  return {
    lastFetchAt: null,
    lastFetchOk: null,
    lastRows: null,
    fetches: 0,
    lastUpstreamOkAt: null,
    lastRefusalAt: null,
    lastRefusalStatus: null,
    lastRefusalHost: null,
    refusals: 0,
  };
}

// --- the ledger -------------------------------------------------------------

const LEDGER = new Map<string, UpstreamEvidence>();
let observingSince: number | null = null;

function entry(id: string): UpstreamEvidence {
  let e = LEDGER.get(id);
  if (!e) {
    e = emptyEvidence();
    LEDGER.set(id, e);
  }
  return e;
}

/** An adapter finished a server-side fetch. `rows` is the length it returned. */
export function recordFetchOutcome(
  id: string,
  outcome: { ok: boolean; rows: number | null },
  at: number = Date.now(),
): void {
  const e = entry(id);
  e.lastFetchAt = at;
  e.lastFetchOk = outcome.ok;
  if (outcome.rows != null) e.lastRows = outcome.rows;
  e.fetches += 1;
}

/** A credentialed host answered 2xx. This is what clears a stale refusal. */
export function recordUpstreamOk(id: string, at: number = Date.now()): void {
  entry(id).lastUpstreamOkAt = at;
}

/**
 * A credentialed host refused. Exported so an adapter that learns of a refusal by
 * a route fetch cannot see — AISStream's socket, say — can report it in one line.
 */
export function recordCredentialRefusal(
  id: string,
  status: number,
  host: string,
  at: number = Date.now(),
): void {
  const e = entry(id);
  e.lastRefusalAt = at;
  e.lastRefusalStatus = status;
  e.lastRefusalHost = host;
  e.refusals += 1;
}

export function readEvidence(id: string): UpstreamEvidence | undefined {
  const e = LEDGER.get(id);
  return e ? { ...e } : undefined;
}

/** A copy of the whole ledger — what /api/status reads, at Map-lookup cost. */
export function snapshotEvidence(): Record<string, UpstreamEvidence> {
  const out: Record<string, UpstreamEvidence> = {};
  for (const [id, e] of LEDGER) out[id] = { ...e };
  return out;
}

/** Epoch ms observation began, or null if nothing has been instrumented yet. */
export function observingSinceMs(): number | null {
  return observingSince;
}

/** Test seam. Drops all evidence and the observation window. */
export function resetEvidence(): void {
  LEDGER.clear();
  observingSince = null;
}

// --- pure attribution + verdict ---------------------------------------------

const HOST_INDEX = new Map<string, string>();
for (const [id, hosts] of Object.entries(CREDENTIALED_HOSTS)) {
  for (const h of hosts) HOST_INDEX.set(h.toLowerCase(), id);
}

/** Pure. Which capability's credential goes to this URL's host, if any. */
export function attributeUpstream(url: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return HOST_INDEX.get(hostname) ?? null;
}

/**
 * Pure. What the evidence supports about the credential we hold.
 *
 * A refusal is current only while it is (a) inside the TTL and (b) not superseded
 * by a later 2xx from the same capability's hosts. Supersession deliberately reads
 * the HTTP channel, not the adapter's return value: ACLED's adapter resolves to []
 * on a 403, so "the fetch completed" would wrongly cancel the refusal it caused.
 */
export function credentialVerdict(
  ev: UpstreamEvidence | undefined,
  now: number,
  ttlMs: number = REFUSAL_TTL_MS,
): CredentialVerdict {
  const refusedAt = ev?.lastRefusalAt ?? null;
  const okAt = ev?.lastUpstreamOkAt ?? null;
  const refusalIsCurrent =
    refusedAt != null && now - refusedAt <= ttlMs && (okAt == null || okAt <= refusedAt);
  if (refusalIsCurrent) return "refused";
  if (okAt != null) return "accepted";
  return "unknown";
}

/** Pure-ish: classify one response and file it. Returns the id it was filed under. */
export function observeUpstreamResponse(
  url: string,
  status: number,
  at: number = Date.now(),
): string | null {
  const id = attributeUpstream(url);
  if (!id) return null;
  if (status >= 200 && status < 300) {
    recordUpstreamOk(id, at);
    return id;
  }
  if (REFUSAL_STATUSES.has(status)) {
    let host = "";
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      host = "";
    }
    recordCredentialRefusal(id, status, host, at);
    return id;
  }
  // 5xx, 429, 404 — an upstream problem, not a statement about our credential.
  return id;
}

// --- installation ------------------------------------------------------------

type FetchFn = typeof globalThis.fetch;

interface ObserverGlobal {
  fetch: FetchFn;
  __tnUpstreamObserverInstalled?: boolean;
}

/**
 * Wrap globalThis.fetch once so credentialed 401/402/403s become evidence.
 *
 * Defensive on purpose: the wrapper delegates first, observes inside a try/catch,
 * never reads or clones the body, and returns the original Response untouched, so
 * a bug in here cannot change what any adapter receives. Own properties of the
 * previous fetch are copied across because Next.js hangs its Data Cache markers off
 * the function object and a wrapper that dropped them would invite a second patch.
 *
 * Returns true if it installed, false if it was already installed.
 */
export function installUpstreamObserver(now: number = Date.now()): boolean {
  const g = globalThis as unknown as ObserverGlobal;
  if (typeof g.fetch !== "function" || g.__tnUpstreamObserverInstalled === true) {
    observingSince ??= now;
    return false;
  }
  const previous = g.fetch;
  const wrapped = (async (...args: Parameters<FetchFn>): Promise<Response> => {
    const res = await previous(...args);
    try {
      const url = urlOf(args[0]);
      if (url) observeUpstreamResponse(url, res.status);
    } catch {
      // Observation must never be able to affect a fetch.
    }
    return res;
  }) as FetchFn;

  const carry = previous as unknown as Record<string, unknown>;
  const target = wrapped as unknown as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(previous)) {
    if (key === "length" || key === "name" || key === "prototype") continue;
    try {
      target[key] = carry[key];
    } catch {
      // Non-writable marker; nothing we can do and nothing that matters.
    }
  }

  g.fetch = wrapped;
  g.__tnUpstreamObserverInstalled = true;
  observingSince ??= now;
  return true;
}

function urlOf(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  const u = (input as { url?: unknown } | null | undefined)?.url;
  return typeof u === "string" ? u : null;
}

/** The minimum a registry entry must expose to be instrumented. */
export interface InstrumentableSource<T> {
  id: string;
  fetch(): Promise<T[]>;
}

const INSTRUMENTED = new WeakSet<object>();

/**
 * Wrap each registry source's fetch() so the row count and completion time of the
 * real server-side fetch land in the ledger. Idempotent per source object.
 *
 * The returned array is passed through BY REFERENCE — lib/signals/coverage.ts keys
 * its truncation records off array identity, so a copy here would silently delete
 * every coverage note in the app.
 *
 * Returns how many sources it newly instrumented.
 */
export function instrumentSignalRegistry<T>(sources: InstrumentableSource<T>[]): number {
  let wrappedCount = 0;
  for (const source of sources) {
    if (INSTRUMENTED.has(source)) continue;
    const original = source.fetch.bind(source);
    source.fetch = async (): Promise<T[]> => {
      try {
        const rows = await original();
        try {
          recordFetchOutcome(source.id, { ok: true, rows: Array.isArray(rows) ? rows.length : 0 });
        } catch {
          // never let bookkeeping break a layer
        }
        return rows;
      } catch (err) {
        try {
          recordFetchOutcome(source.id, { ok: false, rows: null });
        } catch {
          // as above
        }
        throw err;
      }
    };
    INSTRUMENTED.add(source);
    wrappedCount += 1;
  }
  observingSince ??= Date.now();
  return wrappedCount;
}

// --- cross-instance honesty ---------------------------------------------------
//
// WHY THIS EXISTS. The ledger above is per-process module state. In production
// that mostly means "one specific serverless function instance handling one
// specific request", and /api/status and /api/signals/[id] are ordinarily
// different route modules entirely, each scaling to many concurrent instances.
// So a refusal this process's fetch wrapper genuinely observed (ACLED answering
// 403) usually never reaches the instance that later serves GET /api/status.
// Verified in prod 2026-08-11: curl /api/signals/acled forced a live fetch, and
// the immediately-following curl /api/status still read `fetches: 0, observed:
// false` for acled. `observed: false` is the correct, honest reading of what
// THAT instance saw — but read alone, without knowing about serverless
// fragmentation, it invites the wrong conclusion: a reader sees `state:
// "configured"` (not "refused", not "locked") and reasonably assumes the
// credential is fine. It was never checked by the process answering them.
//
// CROSS-INSTANCE PERSISTENCE WAS INVESTIGATED AND REJECTED. Next's Data Cache
// (`unstable_cache`, used deployment-wide by lib/sources/opensky.ts) is a
// get-or-recompute cache keyed by a static key — it has no set()/merge()/
// read-modify-write primitive. The only way to PUSH a write is to invalidate an
// entry (revalidateTag/revalidatePath) and immediately recompute it, but the
// recompute can only return what THIS instance's local ledger holds — it has no
// access to what a previous writer stored. An instance that has observed LESS
// would then silently CLOBBER an instance that observed MORE the next time the
// cache happened to go stale, making a refusal flicker between "refused" and
// "configured" depending on which instance last answered — a fabricated
// recovery, which is worse than today's honest gap and exactly the class of lie
// the product exists to refuse. Forcing that write from inside
// installUpstreamObserver's global fetch wrapper is additionally unsafe on its
// own terms: that wrapper runs inside every fetch the app makes, including ones
// already executing inside ANOTHER adapter's own unstable_cache callback (see
// opensky.ts's fetchGlobalOnce), and Next.js does not support calling
// revalidateTag/revalidatePath from inside a cache computation. No dependency-
// free, race-free write path was found, so none is used.
//
// So instead: the same per-process evidence, published with a caveat a reader
// cannot miss without reading code comments — see EvidenceScope below.

/** True once this snapshot holds a record for at least one capability. */
export function hasAnyEvidence(snapshot: Record<string, UpstreamEvidence>): boolean {
  return Object.keys(snapshot).length > 0;
}

export const CROSS_INSTANCE_CAVEAT =
  "This evidence is per-process, in-memory, and NOT shared across instances. On a " +
  "serverless deployment, the request that actually talked to an upstream (e.g. GET " +
  "/api/signals/acled) and the request reading this report (GET /api/status) are " +
  "usually different processes with separate ledgers, so a credential refusal that " +
  "genuinely happened may never appear here. A 'configured' state means only 'this " +
  "process has not observed a refusal' — never 'this credential was checked and " +
  "works'. anyEvidence:false means nothing has been observed BY THIS PROCESS, never " +
  "that nothing is wrong.";

/** Everything a reader needs to correctly weigh an empty or sparse ledger. Pure. */
export interface EvidenceScope {
  /** Always "process" — see `caveat` for what that means in a serverless deployment. */
  scope: "process";
  /** Epoch ms this process began observing, or null if nothing installed yet. */
  observingSinceMs: number | null;
  /** Age of that window at report time, in ms. Null when observingSinceMs is null. */
  ageMs: number | null;
  /** Has this process recorded anything at all, for any capability? */
  anyEvidence: boolean;
  /** How many capabilities this process holds any record for. */
  capabilitiesObserved: number;
  caveat: string;
}

/** Pure: fold a snapshot + observation window into the honesty caveat block. */
export function describeEvidenceScope(
  snapshot: Record<string, UpstreamEvidence>,
  observingSince: number | null,
  now: number,
): EvidenceScope {
  return {
    scope: "process",
    observingSinceMs: observingSince,
    ageMs: observingSince != null ? Math.max(0, now - observingSince) : null,
    anyEvidence: hasAnyEvidence(snapshot),
    capabilitiesObserved: Object.keys(snapshot).length,
    caveat: CROSS_INSTANCE_CAVEAT,
  };
}
