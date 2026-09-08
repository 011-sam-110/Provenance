// EVERY SENTENCE A NOTIFICATION SENDS IS BUILT HERE, and nothing here touches React,
// the DOM or the network — so every claim the product makes in someone's Telegram is
// decided in one pure, node-testable file. This is deliberately the same arrangement
// as camslot.conditions.ts, and for the same reason.
//
// THE RULE THIS FILE EXISTS TO ENFORCE. A channel message is stripped of every
// on-screen hedge: no tooltip, no provenance panel, no "coverage" label beside the
// layer name. Whatever a source is careful to say on the map has to be said again
// here, in the message itself, or the care is lost exactly where it matters most.

import type { NotifyEvent } from "@/lib/notify/types";

export interface WordingContext {
  areaLabel: string;
  sourceLabel: string;
  /** Title of the row that caused it. Absent for `count` and `quiet`. */
  rowTitle?: string;
  /** Rows inside the ring, for `count`. */
  count?: number;
  /** The rule's level, for `count` and `crosses`. */
  level?: number;
}

/**
 * Per-source qualifiers, appended to the message. Keyed by signal id.
 *
 * These are not decoration. Each one restates on the wire a limit the app already
 * states on screen, because the message travels without the screen.
 */
export const SOURCE_WORDING: Record<string, { suffix?: string; verb?: Partial<Record<NotifyEvent["kind"], string>> }> = {
  // GDELT rows are coded news COVERAGE, not verified incidents. lib/signals/gdelt.ts
  // already refuses to state a CAMEO label as fact; the message must not undo that.
  // One article about a livestream once seeded pins on three cities.
  conflict: {
    suffix: "Reported coverage, not a verified incident.",
    verb: { appears: "was reported in", count: "reports in" },
  },
  protests: {
    suffix: "Reported coverage, not a verified incident.",
    verb: { appears: "was reported in", count: "reports in" },
  },
  // Terrestrial receivers only. A vessel leaving coverage and a vessel switching off
  // its transponder are indistinguishable, so the message must not claim it left.
  ais: {
    verb: { disappears: "stopped being heard in" },
  },
  // Scored per country, so an area rule resolves to the countries the ring touches
  // and cannot be narrower. The score is a conservative floor on most countries.
  instability: {
    suffix: "Scored per country, and a floor where inputs are missing.",
  },
};

const VERB: Record<NotifyEvent["kind"], string> = {
  appears: "appeared in",
  disappears: "disappeared from",
  enters: "entered",
  leaves: "left",
  crosses: "crossed the level in",
  count: "inside",
  state: "changed state in",
  due: "is due in",
  quiet: "has gone quiet for",
};

/** PURE: one event → the sentence that is sent. */
export function wordEvent(event: NotifyEvent, ctx: WordingContext): string {
  const w = SOURCE_WORDING[event.sourceId] ?? {};
  const verb = w.verb?.[event.kind] ?? VERB[event.kind];

  let body: string;
  if (event.kind === "count") {
    body = `${ctx.count ?? 0} ${verb} the area (level ${ctx.level ?? 0})`;
  } else if (event.kind === "quiet") {
    body = `${verb} the configured window`;
  } else if (event.kind === "crosses") {
    body = `${ctx.rowTitle ?? "a row"} ${verb} ${ctx.areaLabel} (level ${ctx.level ?? 0})`;
  } else {
    body = `${ctx.rowTitle ?? "a row"} ${verb} ${ctx.areaLabel}`;
  }

  // G4 — the area ALWAYS leads. Two areas watching planes must never produce two
  // indistinguishable lines.
  const head = `${ctx.areaLabel} · ${ctx.sourceLabel} · `;
  return w.suffix ? `${head}${body}. ${w.suffix}` : `${head}${body}`;
}
