// Did the adapter's own upstream fetch succeed, and when did it actually read?
//
// THE BUG THIS EXISTS TO FIX. Every adapter in lib/signals/ swallows its own
// failure and returns `[]` — 53 such sites across 24 files. Downstream, nothing can
// tell "the world is quiet" from "the upstream is gone", because both arrive as an
// empty array. The most visible consequence is on the PUBLIC landing page:
// components/marketing/HonestLedger.tsx renders a dead USGS exactly like a calm
// hour, in the section whose own docstring calls itself "the section no competitor
// will copy: what is empty right now, and why" and warns against "precisely the
// class of comfortable lie this whole page argues against". A `down` state and a
// "no answer" label are already written there and are currently unreachable.
//
// THE ABSENCE RULE, which is the whole design. A missing outcome means NOT
// DECLARED — never healthy. This is the same asymmetry lib/signals/coverage.ts:34-35
// already documents for coverage records, and it matters more here: if absence read
// as "fine", every adapter not yet converted would silently report success, and
// partial adoption would look like a green board. A registry-wide test fails the
// build when a registered adapter does not declare an outcome, so that state cannot
// ship.
//
// WHY A SYMBOL SIDE-CHANNEL rather than a wrapper object: adapters return
// SignalFeature[] and the whole pipeline — registry, route, cache, callers — is
// typed on that array. Changing the return type would touch every adapter, every
// caller and every test at once. Attaching non-enumerably to the array keeps
// JSON.stringify byte-identical, leaves `.map` / `for…of` / array equality
// untouched, and lets the conversion proceed one adapter at a time.
//
// Symbol.for (the GLOBAL registry), not a module-local WeakMap. coverage.ts:95
// records why in blood: a module-local WeakMap silently lost every record in
// production when the bundler duplicated the module. Do not "simplify" this.

/** What an adapter reports about its own upstream read. */
export interface SignalOutcome {
  /** Did the adapter's upstream fetch succeed? False means degraded, not quiet. */
  ok: boolean;
  /**
   * ABSOLUTE epoch ms of the upstream read — not the moment the request was served.
   *
   * This is the difference between reporting the age of the DATA and the age of the
   * RESPONSE. A cached body stamped at request time looks perpetually fresh no
   * matter how old the reading behind it is, which is exactly the failure a
   * freshness claim is supposed to prevent.
   */
  at: number;
  /** Short machine-ish reason when ok is false, e.g. "http 503", "timeout". */
  reason?: string;
  /**
   * WHERE these rows came from, which is a different question from whether a read
   * succeeded — and conflating the two puts a false claim on the public page.
   *
   * "live"     — fetched from an upstream on this call, or cached from one.
   * "compiled" — a curated or snapshotted dataset that HAS no live upstream by
   *              design. Nothing failed; there was simply nothing to call.
   *
   * Without this axis a static layer has no honest representation. `degraded` would
   * say a complete, correct dataset is broken (ports.ts publishes a full curated
   * world and would have rendered "no answer" forever). `observed` would assert an
   * upstream read that never happened, and the freshness classifier would then call
   * it stale for eternity. Both are lies; the missing fact was never `ok` at all.
   *
   * Defaults to "live", so every existing call site keeps its current meaning.
   */
  basis?: "live" | "compiled";
}

const OUTCOME_KEY = Symbol.for("opendata.signals.outcome");

/** Attach an outcome to a feature array and return that same array. */
export function markOutcome<T>(features: T[], outcome: SignalOutcome): T[] {
  Object.defineProperty(features, OUTCOME_KEY, {
    value: { ...outcome },
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return features;
}

/** Read an attached outcome. Undefined means NOT DECLARED — never assume healthy. */
export function readOutcome(features: unknown): SignalOutcome | undefined {
  if (!Array.isArray(features)) return undefined;
  const value = (features as unknown as Record<symbol, unknown>)[OUTCOME_KEY];
  if (!value || typeof value !== "object") return undefined;
  const o = value as Partial<SignalOutcome>;
  if (typeof o.ok !== "boolean" || typeof o.at !== "number") return undefined;
  // Rebuilt field by field rather than spread, so a malformed record cannot smuggle
  // arbitrary keys through. That means EVERY field has to be listed here — `basis`
  // was added to the interface and silently dropped on the way out, which made every
  // compiled layer read as live. If you add a field above, add it here too.
  return {
    ok: o.ok,
    at: o.at,
    reason: o.reason,
    basis: o.basis === "compiled" ? "compiled" : "live",
  };
}

/**
 * The success path: "I reached upstream, and this is what it said."
 *
 * Orthogonal to how many features came back. `observed([])` is the honest way to
 * say "the upstream answered and there is genuinely nothing right now" — the exact
 * state the old code could not express.
 */
export function observed<T>(features: T[], at: number = Date.now()): T[] {
  return markOutcome(features, { ok: true, at });
}

/**
 * The failure path, replacing a bare `return []` in an adapter.
 *
 * Returns an EMPTY array carrying the failure, so the call site stays a one-liner
 * and the shape the pipeline expects is unchanged:
 *
 *     if (!res.ok) return degraded(`http ${res.status}`);
 *
 * `reason` is for operators, so keep it short and factual — it is surfaced in the
 * API envelope and may be shown to a visitor. It must never carry a URL, a key, or
 * a raw upstream error body.
 */
export function degraded<T>(reason: string, at: number = Date.now()): T[] {
  return markOutcome([] as T[], { ok: false, at, reason });
}

/**
 * A failure that still has last-good data to serve.
 *
 * Several adapters keep a cached copy and fall back to it when the upstream blips
 * — `registry.ts` does the same for camera feeds, and the repo treats that
 * last-good behaviour as a feature, not an accident: a feed that fails keeps its
 * region on the map instead of silently deleting it.
 *
 * `degraded()` cannot express that, because it returns an empty array. Using it on
 * a last-good path would trade one honesty problem for a worse availability one —
 * a single blip would empty a layer that had perfectly serviceable data. Marking
 * the cached rows `ok: true` is the other wrong answer: it asserts a read that did
 * not happen.
 *
 * So: keep the rows, declare the failure, and stamp `at` with when the data was
 * ACTUALLY read (not now). The consumer then has everything it needs to say
 * "showing you the last good copy, from N minutes ago, because the upstream is
 * refusing" — which is the true statement neither other helper can make.
 */
export function degradedWith<T>(features: T[], reason: string, at: number = Date.now()): T[] {
  return markOutcome(features, { ok: false, at, reason });
}

/**
 * A layer with NO live upstream: a curated list, a compiled snapshot.
 *
 * `ok: true` because nothing failed — there was nothing to call. `basis: "compiled"`
 * because the consumer must not present it as a live reading. `at` is when the data
 * was compiled or snapshotted, NOT now, so "compiled 12 Aug" is sayable and true.
 *
 * Use this only where a live feed genuinely does not exist. A layer that HAS an
 * upstream and is falling back to a cached copy is `degradedWith` — that one really
 * did fail, and flattening the two would hide real outages behind a reassuring word.
 */
export function compiled<T>(features: T[], at: number): T[] {
  return markOutcome(features, { ok: true, at, basis: "compiled" });
}

/**
 * Fold an outcome into what the API should publish.
 *
 * Undeclared is reported as `ok: false` with reason "not declared". Deliberate, and
 * the conservative direction: an adapter that has not been converted must not be
 * able to assert health it never measured. The build-time registry test is what
 * stops that state reaching production, but the runtime default has to agree with
 * it, or the two disagree the moment someone adds an adapter and skips the test.
 */
export function publishOutcome(
  features: unknown,
  now: number = Date.now(),
): { ok: boolean; observedAt: number; basis: "live" | "compiled"; degradedReason?: string } {
  const outcome = readOutcome(features);
  if (!outcome) {
    return { ok: false, observedAt: now, basis: "live", degradedReason: "not declared" };
  }
  return {
    ok: outcome.ok,
    observedAt: outcome.at,
    // Always published, like `ok`, so a consumer never has to infer it. A missing
    // field would send it back to guessing, and the guess is always "live".
    basis: outcome.basis ?? "live",
    ...(outcome.ok ? {} : { degradedReason: outcome.reason ?? "upstream failed" }),
  };
}
