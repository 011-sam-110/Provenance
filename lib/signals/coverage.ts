// lib/signals/coverage.ts
// TRUNCATION HONESTY — the contract that stops a render cap from reading as a
// measurement.
//
// Several signal adapters cannot draw everything upstream offers: a whole-world
// day of VIIRS fire pixels is tens of thousands of points, gpsjam's global H3 grid
// is ~46k cells, and a busy GDELT window covers thousands of places. Each of those
// layers keeps the top N and drops the rest. Before this module the dropped rows
// left NO trace: `/api/signals/fire-active` answered `{count: 1500, …}` and every
// surface downstream — the rail count, the monitor headline, the dossier — printed
// "1,500" as if it were the number of fires burning. It is the number of fires we
// chose to draw. Same class of lie as a frozen feed still saying "live": the digit
// is real, the meaning is not.
//
// The contract is deliberately small and structural, not six ad-hoc strings:
//
//   available    how many candidates existed upstream, BEFORE the cap
//   returned     how many are actually in this payload (always measured, never asserted)
//   capped       true ⇒ `returned` is a ceiling, not a count
//   cap          the ceiling that was applied
//   availableExact  false ⇒ `available` is a LOWER BOUND, because the upstream
//                   request was itself limited (a `limit=` param, or a collector
//                   that stops early), so we cannot see past it
//
// Adapters attach a record with applyCap()/markCoverage(); the API route reads it
// back and publishes it; the pure card projection turns it into a count label a
// capped number cannot hide inside ("1,500 of 41,203", not "1,500").
//
// The side channel is a WeakMap keyed on the returned array rather than a new
// field on SignalSource.fetch(), so `fetch(): Promise<SignalFeature[]>` is
// unchanged and all 35 registered adapters keep compiling — including the ones
// that legitimately declare nothing.
//
// HONESTY NOTE: absence of a coverage record means "this adapter did not declare
// one", NOT "nothing was truncated". Never render "complete" off a missing record.

/** What a signal payload contains, versus what upstream actually had. */
export interface SignalCoverage {
  /** Features in this payload. Measured from the array — never asserted by a caller. */
  returned: number;
  /**
   * Candidates upstream offered before the cap, after the source's own relevance
   * filters (e.g. gpsjam counts cells over the interference threshold, not all 46k).
   * A LOWER BOUND when `availableExact` is false.
   */
  available: number;
  /** False ⇒ `available` is a lower bound: the upstream request was itself limited. */
  availableExact: boolean;
  /** True ⇒ `returned` is a ceiling. The honest headline is "N of M", not "N". */
  capped: boolean;
  /** The local render cap that was applied, when one was. */
  cap?: number;
  /** The upstream request/page limit that was saturated, when one was. */
  upstreamLimit?: number;
  /** Plural noun for the note, e.g. "fire detections". Defaults to "features". */
  noun?: string;
  /** How survivors were chosen, e.g. "highest fire radiative power". */
  rule?: string;
  /** Human sentence — filled by describeCoverage() at the API boundary. */
  note?: string;
}

export interface CapOptions {
  /** Plural noun for the note, e.g. "fire detections". */
  noun?: string;
  /** How the survivors were chosen, e.g. "highest fire radiative power". */
  rule?: string;
  /**
   * The upstream request was itself limited. `count` is how many records the
   * response actually held; when it reaches `limit` the response is saturated and
   * the pre-cap total becomes a lower bound rather than a measurement.
   */
  upstream?: { limit: number; count: number };
}

/** No local render cap — the adapter returns everything it parsed. */
const NO_CAP = Number.POSITIVE_INFINITY;

/**
 * The side channel: a NON-ENUMERABLE property under a GLOBAL-registry symbol.
 *
 * `Symbol.for` rather than a module-local `Symbol()` or a `WeakMap`, because the
 * Next server build duplicates this module across chunks — the first cut of this
 * used a module-level WeakMap and every capped layer came back with no coverage at
 * all in production, while the unit tests passed: the adapter wrote to the WeakMap
 * in one copy of the module and the route read from the WeakMap in another. Two
 * copies of the module, two WeakMaps, zero coverage. The global symbol registry is
 * shared process-wide, so the record survives however the bundler splits us.
 *
 * Non-enumerable + symbol-keyed ⇒ JSON.stringify(features) is byte-identical to
 * before, `for…of` / `.map` / array equality are untouched, and a JSON round-trip
 * drops it (which is why the API publishes the record as a real field instead of
 * relying on this).
 */
const COVERAGE_KEY = Symbol.for("opendata.signals.coverage");

/**
 * Attach a coverage record to a feature array and return that same array.
 * `returned` is always recomputed from the array, so a record cannot claim a
 * count the payload does not contain, and `capped` is forced false when the
 * payload demonstrably holds everything available.
 */
export function withCoverage<T>(features: T[], record: Omit<SignalCoverage, "returned">): T[] {
  const returned = features.length;
  const complete = record.availableExact && returned >= record.available;
  const value: SignalCoverage = {
    ...record,
    returned,
    available: Math.max(record.available, returned),
    capped: record.capped && !complete,
  };
  Object.defineProperty(features, COVERAGE_KEY, {
    value,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return features;
}

/** The coverage an adapter declared for this array, or undefined if it declared none. */
export function readCoverage(features: unknown): SignalCoverage | undefined {
  if (typeof features !== "object" || features === null) return undefined;
  const held = (features as Record<symbol, unknown>)[COVERAGE_KEY];
  return held != null && typeof held === "object" ? (held as SignalCoverage) : undefined;
}

/**
 * Move a coverage record onto a DERIVED array — for adapters that cap one
 * representation (gpsjam's H3 cells, gdelt's ranked places) and then map it into
 * SignalFeatures. `available` survives; `returned` re-measures the new array, so
 * rows lost in the mapping are reflected honestly.
 */
export function carryCoverage<T>(from: unknown, to: T[]): T[] {
  const c = readCoverage(from);
  if (c) withCoverage(to, c);
  return to;
}

/**
 * Pure: keep the first `cap` items and record what that hid. Returns a NEW array
 * (never the caller's) carrying the coverage record.
 *
 * Callers are expected to have SORTED already — the cap keeps a prefix, so `rule`
 * should name the ordering that makes the prefix defensible.
 */
export function applyCap<T>(items: readonly T[], cap: number, opts: CapOptions = {}): T[] {
  const saturated = opts.upstream != null && opts.upstream.count >= opts.upstream.limit;
  const hasCap = Number.isFinite(cap) && cap > 0;
  const localCapped = hasCap && items.length > cap;
  const out = localCapped ? items.slice(0, cap) : items.slice();
  return withCoverage(out, {
    available: items.length,
    availableExact: !saturated,
    capped: localCapped || saturated,
    ...(localCapped ? { cap } : {}),
    ...(saturated ? { upstreamLimit: opts.upstream!.limit } : {}),
    ...(opts.noun ? { noun: opts.noun } : {}),
    ...(opts.rule ? { rule: opts.rule } : {}),
  });
}

/**
 * Declare coverage with NO local render cap — for layers whose only truncation is
 * an upstream `limit=` parameter (EMSC's 500, ReliefWeb's 100). Records a complete
 * payload when that limit was not saturated, which is a real, useful "you are
 * seeing all of it".
 */
export function markCoverage<T>(items: T[], opts: CapOptions = {}): T[] {
  return applyCap(items, NO_CAP, opts);
}

/** Thousands separators, locale-independent so notes are stable across runtimes. */
export function groupDigits(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Pure: the count a UI should print. A capped count never appears bare — it always
 * carries the denominator it was cut from, so "1,500" cannot be read as "all".
 *   uncapped        → "412"
 *   capped, exact   → "1,500 of 41,203"
 *   capped, bounded → "500 of 500+"   (upstream limit saturated: the total is unknown)
 */
export function coverageCountLabel(coverage: SignalCoverage | undefined, count?: number): string {
  // An explicit count wins: the caller can see the array it actually holds.
  const n = count ?? coverage?.returned ?? 0;
  if (!coverage || !coverage.capped) return groupDigits(n);
  if (coverage.availableExact) return `${groupDigits(n)} of ${groupDigits(coverage.available)}`;
  // Lower bound: the best floor we can prove is the saturated upstream page, which
  // may exceed the rows that survived our own filters.
  const floor = Math.max(coverage.available, coverage.upstreamLimit ?? 0);
  return `${groupDigits(n)} of ${groupDigits(floor)}+`;
}

/**
 * Pure: one plain sentence explaining the truncation, or undefined when nothing
 * was truncated. Says what is missing and how the survivors were chosen — a user
 * who reads it knows they are looking at a sample and knows which sample.
 */
export function coverageNote(coverage: SignalCoverage | undefined): string | undefined {
  if (!coverage || !coverage.capped) return undefined;
  const noun = coverage.noun ?? "features";
  const shown = groupDigits(coverage.returned);
  const kept = coverage.rule ? ` Kept: ${coverage.rule}.` : "";

  if (!coverage.availableExact) {
    const limit = groupDigits(coverage.upstreamLimit ?? coverage.available);
    const capPart = coverage.cap != null ? ` and a cap of ${groupDigits(coverage.cap)}` : "";
    return (
      `Showing ${shown} ${noun} — not all of them. The upstream request is limited to ` +
      `${limit}${capPart}, so the real total is higher and unknown.${kept}`
    );
  }

  const hidden = Math.max(0, coverage.available - coverage.returned);
  const capText = coverage.cap != null ? `a cap of ${groupDigits(coverage.cap)}` : "a cap";
  return (
    `Showing ${shown} of ${groupDigits(coverage.available)} ${noun} — ` +
    `${capText} hides ${groupDigits(hidden)}.${kept}`
  );
}

/** Coverage plus its rendered note — what the API publishes. */
export function describeCoverage(coverage: SignalCoverage): SignalCoverage {
  const note = coverageNote(coverage);
  return note ? { ...coverage, note } : coverage;
}
