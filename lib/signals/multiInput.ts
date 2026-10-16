// One map layer, several upstreams.
//
// The natural-hazard layers (floods, wildfires, volcanoes, severe storms) each merge
// more than one primary source since 2026-10-16: a flood is a GDACS event, an NWS
// warning, a gauge in flood or a Copernicus EMS activation. Each input is read on its
// own, keeps its own last good copy, and fails on its own, so one refusing upstream
// never empties the layer. This module is that bookkeeping, once, so each layer file
// only maps its upstreams.
//
// The outcome rule is the one lib/signals/gdacs.ts `mergeGdacsResults` set: every
// input read → `observed`; some failed → `degradedWith` (the rows we hold, a reason
// naming what failed, stamped with the OLDEST read served); all failed and nothing
// held → `degraded`.

import type { SignalFeature } from "@/lib/signals/types";
import { degraded, degradedWith, observed, readOutcome } from "@/lib/signals/outcome";

/** One upstream's contribution to a layer, resolved — never thrown. */
export interface InputResult {
  /** Short name used in a partial-failure reason, e.g. "NWS alerts". */
  key: string;
  ok: boolean;
  features: SignalFeature[];
  /** Epoch ms these features were read: now on success, the cached read on a fallback. */
  at: number | null;
  reason?: string;
}

/** The User-Agent the NWS asks for (a contact), used by every input here. */
export const HAZARD_UA = "Provenance/1.0 (+https://provenance-online.com; github.com/011-sam-110/TrafficNerd-V2)";

/** An HTTP failure with the status in the message, so `reasonOf` can publish it. */
export class HttpStatusError extends Error {
  constructor(public status: number) {
    super(`http ${status}`);
  }
}

/** Short, operator-facing reason. Never carries a URL or an upstream body. */
export function reasonOf(err: unknown): string {
  if (err instanceof HttpStatusError) return err.message;
  if ((err as Error)?.name === "TimeoutError") return "timeout";
  return "upstream read failed";
}

/** GET a URL and return its body text, or throw HttpStatusError / the fetch error. */
export async function getText(
  url: string,
  timeoutMs = 20_000,
  headers: Record<string, string> = {},
): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": HAZARD_UA, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new HttpStatusError(res.status);
  return res.text();
}

/** GET a URL and parse JSON. A 204 (GDACS's "no more pages") is `null`. */
export async function getJson<T>(
  url: string,
  timeoutMs = 20_000,
  headers: Record<string, string> = {},
): Promise<T | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": HAZARD_UA, Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new HttpStatusError(res.status);
  const text = await res.text();
  return text.trim() ? (JSON.parse(text) as T) : null;
}

const lastGood = new Map<string, { features: SignalFeature[]; at: number }>();

/**
 * Run one input's read. On success its features become that input's last good copy;
 * on failure the last good copy (if any) is served and the failure is reported.
 * `cacheKey` must be unique across layers ("floods:gdacs", not "gdacs").
 */
export async function readInput(
  cacheKey: string,
  key: string,
  read: () => Promise<SignalFeature[]>,
  now: number = Date.now(),
): Promise<InputResult> {
  try {
    const features = await read();
    lastGood.set(cacheKey, { features, at: now });
    return { key, ok: true, features, at: now };
  } catch (err) {
    const hit = lastGood.get(cacheKey);
    return { key, ok: false, features: hit?.features ?? [], at: hit?.at ?? null, reason: reasonOf(err) };
  }
}

/**
 * An input whose reader already declares its own outcome and keeps its own last good
 * copy (lib/signals/eonet.ts `readEonetLayer`). Undeclared reads as a failure.
 */
export function fromOutcome(key: string, features: SignalFeature[]): InputResult {
  const o = readOutcome(features);
  if (!o) return { key, ok: false, features, at: null, reason: "not declared" };
  return { key, ok: o.ok, features, at: o.at, ...(o.ok ? {} : { reason: o.reason ?? "upstream read failed" }) };
}

/**
 * Pure: fold the inputs of one layer into an outcome-tagged array. `features` is the
 * merged, deduplicated list the layer built from the same results.
 */
export function withInputsOutcome(
  results: readonly InputResult[],
  features: SignalFeature[],
  now: number,
): SignalFeature[] {
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return observed(features, now);
  const reason =
    failed.length === results.length
      ? failed[0]!.reason ?? "upstream read failed"
      : `partial: ${failed.map((f) => f.key).join(", ")} failed (${failed[0]!.reason ?? "upstream read failed"})`;
  const ats = results.filter((r) => r.features.length && r.at != null).map((r) => r.at as number);
  if (!features.length || !ats.length) return degraded(reason, now);
  return degradedWith(features, reason, Math.min(...ats));
}

/** Rough great-circle distance in km. For "is this the same place" checks only. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Centroid of a polygon's outer ring ([lon, lat] pairs), or null. */
export function ringCentroid(ring: unknown): { lat: number; lon: number } | null {
  if (!Array.isArray(ring)) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const p of ring) {
    if (Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number") {
      sx += p[0];
      sy += p[1];
      n++;
    }
  }
  return n ? { lon: sx / n, lat: sy / n } : null;
}
