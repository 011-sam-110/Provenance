import type { SignalMetric } from "@/lib/signals/types";

/**
 * Which of an adapter's `props` the dossier (components/SignalDetail.tsx) may show
 * as a plain "<Key>: <value>" row.
 *
 * `props.magnitude` is the documented radius/ranking proxy — `SignalMetric`'s own
 * doc comment calls it out as "overloaded: a Richter value for quakes but a
 * rescaled radius proxy for GDACS/cyclones/instability". The metric-bar code
 * already refuses to mislabel it (lib/console/signals/signalCard.ts reads the
 * source's declared field, never a bare `magnitude`), but the dossier's raw prop
 * dump did not: it showed GDACS's alert-tier proxy (Green=3/Orange=6/Red=8) under
 * the literal word "Magnitude", in the same panel where GDACS's own `severitydata`
 * states the real figure (e.g. "Magnitude 7.7M") under the unrelated label
 * "Severity". Measured 2026-10-12 (bitacora.md, Carril B C3): GDACS's own `source`
 * field shows "EQ" events are USGS/NEIC data, so the fake proxy sat beside that
 * same earthquake's real magnitude, both captioned by this one word.
 *
 * The rule: show `magnitude` only when the layer's own declared metric names it —
 * i.e. it genuinely IS that layer's real scalar, not a borrowed radius driver.
 */
export function visibleDossierProps(
  props: Record<string, unknown>,
  metric: SignalMetric | undefined,
): [string, unknown][] {
  return Object.entries(props).filter(([k]) => k !== "magnitude" || metric?.field === "magnitude");
}
