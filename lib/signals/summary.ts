// lib/signals/summary.ts
// A layer's numbers that are not points: a total, a series, a table. PURE, node-testable.
//
// A signal adapter returns features, and every surface that reads a layer reads those
// points. A few layers also own figures that belong to the whole layer and to no single
// point: the War zones layer's held area over 90 days, the claimed-against-documented
// loss table behind the Russian losses layer. Putting those on a fake feature at 0,0
// would draw a pin in the Gulf of Guinea; a second route per layer would double the
// caching rules. So the summary rides on the feature array the way the outcome
// (outcome.ts) and the coverage record (coverage.ts) do: a non-enumerable property under
// a global-registry Symbol, read by /api/signals/<id> and sent as `summary`.
//
// The value must be plain JSON. Each layer that publishes one exports its own type and a
// reader that checks the shape, because the client receives it as `unknown`.

const SUMMARY_KEY = Symbol.for("opendata.signals.summary");

/** Attach a layer summary to a feature array and return that same array. */
export function markSummary<T>(features: T[], summary: unknown): T[] {
  Object.defineProperty(features, SUMMARY_KEY, {
    value: summary,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return features;
}

/** The attached summary, or undefined when the adapter published none. */
export function readSummary(features: unknown): unknown {
  if (!Array.isArray(features)) return undefined;
  return (features as unknown as Record<symbol, unknown>)[SUMMARY_KEY];
}
