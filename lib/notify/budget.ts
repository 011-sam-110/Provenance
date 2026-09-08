// G3 — a per-area ceiling on immediate delivery, and it NEVER DROPS SILENTLY.
//
// Sampo chose immediate delivery over a digest tier, and the honest objection to a
// cap is that dropping is silent. So this holds rather than drops: held events stay
// visible in the console, and one line goes out naming how many were held. That
// line does not itself consume budget — a storm that silenced its own warning would
// be the failure this exists to prevent.

import type { NotifyEvent } from "@/lib/notify/types";

/** Per area, per rolling hour. */
export const MAX_PER_AREA_HOUR = 20;
export const WINDOW_MS = 60 * 60_000;

/**
 * PURE: split this batch into what is sent and what is held.
 *
 * @param sent epoch-ms timestamps of prior sends for THIS area, any age.
 * @param areaLabel the area's human name. The closing line is the ONE message not
 *   built by wording.ts, so it has to honour G4 on its own: without a label it would
 *   be the only thing the product sends carrying a raw "area:<epoch>" id.
 */
export function applyBudget(
  events: readonly NotifyEvent[],
  sent: readonly number[],
  now: number,
  areaLabel?: string,
): { send: NotifyEvent[]; held: number; nextSent: number[]; closing: string | null } {
  const live = sent.filter((t) => now - t < WINDOW_MS);
  const room = Math.max(0, MAX_PER_AREA_HOUR - live.length);
  const send = events.slice(0, room);
  const held = events.length - send.length;

  const area = areaLabel ?? events[0]?.areaId ?? "";
  return {
    send,
    held,
    nextSent: [...live, ...send.map((e) => e.at)],
    closing: held > 0 ? `${area}: ${held} more held this hour. They are listed in the console.` : null,
  };
}
