import { WebcamSchema, type Webcam } from "@/lib/types";
import { normalizeWindyWebcam, type WindyWebcam } from "@/lib/sources/windy";
import { applyCap, readCoverage, type SignalCoverage } from "@/lib/signals/coverage";

// Batch-resilient mapping for the Windy webcams layer.
//
// WHY THIS FILE EXISTS (live-diagnosed 2026-08-10): /api/webcams was serving 0
// webcams with a valid, accepted API key. Every region request returned HTTP 200
// and ~1,300 rows, but the layer validated the WHOLE batch in one
// `WebcamArray.parse(...)`, which THROWS. Exactly one upstream row in the global
// sample — Windy webcam 1644848004, "Providenciales › South-east: Long Bay
// Beach" — publishes a scheme-less provider link, `www.villaesencia.com/live`.
// `z.string().url()` rejects it, the whole array parse threw, the registry's
// `.catch(() => cache?.webcams ?? [])` swallowed it, and all ~1,180 good webcams
// vanished. One malformed optional field killed a global layer, silently.
//
// The rule here: a bad ROW may only cost that row, and a bad FIELD may only cost
// that field. Nothing an upstream publisher types can empty the layer.

/** How many webcams the merged global sample is allowed to carry. */
export const MAX_WEBCAMS = 2000;

export interface WebcamMapping {
  webcams: Webcam[];
  /** Rows that could not be placed or identified at all (no id / no usable coords). */
  unmappable: number;
  /** Rows dropped because they still failed the Webcam schema after repair. */
  invalid: number;
  /** Rows kept only because a malformed URL field was repaired or discarded. */
  repaired: number;
  /** Repeat webcamIds, expected because the region bboxes overlap. */
  duplicates: number;
  /**
   * Truncation-honesty record from lib/signals/coverage.ts (applyCap), lifted off
   * the `webcams` array as a real field so it survives JSON round-trips. ALWAYS
   * present — applyCap() runs unconditionally below, even over an empty or
   * under-cap list, so this is never "not declared" the way SignalCoverage can be
   * elsewhere; `coverage.capped` is simply false when the pool never reached the
   * cap. See app/api/webcams/route.ts for why this is the SIGNAL "N of M" style
   * and not the camera feeds/answered/stale style.
   */
  coverage: SignalCoverage;
}

function parsesAsUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** A bare host with a dot and a TLD, optionally followed by a path/port/query. */
const HOST_LIKE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.[a-z]{2,}([:/?#]|$)/i;

/**
 * Pure: best-effort repair of one upstream URL field.
 * Returns a URL the Webcam schema will accept, or undefined when the value is
 * unusable (in which case the caller drops the FIELD, never the webcam).
 */
export function repairUrl(raw: string | null | undefined): string | undefined {
  const value = (raw ?? "").trim();
  if (!value) return undefined;
  if (parsesAsUrl(value)) return value;
  // "www.villaesencia.com/live" → "https://www.villaesencia.com/live"
  if (HOST_LIKE.test(value)) {
    const withScheme = `https://${value}`;
    if (parsesAsUrl(withScheme)) return withScheme;
  }
  return undefined;
}

/**
 * Pure: upstream Windy rows → validated Webcams, per-row and per-field resilient.
 * Deduplicates by webcamId (region bboxes overlap), repairs malformed URLs where
 * possible, and validates each webcam on its own so one reject cannot empty the
 * batch. Never throws.
 *
 * TRUNCATION HONESTY. This used to `break` out of the loop the instant `cap`
 * valid webcams had accumulated, which made the true size of the candidate pool
 * unmeasurable — rows past the cap were never even looked at, so unmappable/
 * invalid/duplicate counts silently undercounted too. The loop below now walks
 * every row and builds the FULL deduplicated, validated list; `applyCap()` at the
 * end keeps the first `cap` of them and records what that hid
 * (lib/signals/coverage.ts — the repo's existing truncation-disclosure contract,
 * reused here rather than inventing a parallel one). `available` is therefore a
 * real measurement of everything this batch of rows could validly produce, not a
 * guess extrapolated from a partial scan.
 */
export function toWebcams(rows: readonly WindyWebcam[], cap: number = MAX_WEBCAMS): WebcamMapping {
  const seen = new Set<number>();
  const webcams: Webcam[] = [];
  let unmappable = 0;
  let invalid = 0;
  let repaired = 0;
  let duplicates = 0;

  for (const row of rows) {
    const webcamId = row?.webcamId;
    if (webcamId === undefined || webcamId === null) {
      unmappable++;
      continue;
    }
    if (seen.has(webcamId)) {
      duplicates++;
      continue;
    }
    seen.add(webcamId);

    const mapped = normalizeWindyWebcam(row);
    if (!mapped) {
      unmappable++;
      continue;
    }

    const fixed: Webcam = { ...mapped };
    let touched = false;

    for (const field of ["imageUrl", "thumbnailUrl", "providerUrl"] as const) {
      const before = fixed[field];
      if (before === undefined) continue;
      const after = repairUrl(before);
      if (after === before) continue;
      touched = true;
      if (after === undefined) delete fixed[field];
      else fixed[field] = after;
    }

    // detailUrl is REQUIRED (it is the mandatory Windy attribution link), so a
    // malformed one falls back to the canonical page for this webcam id.
    const detail = repairUrl(fixed.detailUrl) ?? `https://www.windy.com/webcams/${webcamId}`;
    if (detail !== fixed.detailUrl) {
      touched = true;
      fixed.detailUrl = detail;
    }

    const parsed = WebcamSchema.safeParse(fixed);
    if (!parsed.success) {
      invalid++;
      continue;
    }
    if (touched) repaired++;
    webcams.push(parsed.data);
  }

  const capped = applyCap(webcams, cap, {
    noun: "webcams",
    rule: "first valid webcam encountered across the region fan-out (not ranked)",
  });
  // applyCap() always attaches a coverage record (even when nothing was capped),
  // so this read can never come back undefined — see the WebcamMapping doc comment.
  const coverage = readCoverage(capped) as SignalCoverage;

  return { webcams: capped, unmappable, invalid, repaired, duplicates, coverage };
}
