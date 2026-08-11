// Pure text builders for the console's screen-reader surfaces.
//
// These live outside the components on purpose: every interesting decision here is
// "what exactly does a screen reader say, and *when does that string change*?" —
// which is precisely the thing a live region gets wrong. A string that churns is
// worse than silence, so the churn-free-ness of each builder is asserted in
// tests/unit/shell-a11y.test.ts rather than eyeballed.
//
// Deliberate omission: NOTHING here formats a count. The top bar's canonical pulse
// line ("18,729 cameras · 3,000 planes · …") re-renders every few seconds, so it is
// left OUT of the live region entirely — see appStatusLine below.

import type { StageId } from "@/lib/console/types";

/* ── Centre stage ─────────────────────────────────────────────────────────── */

/**
 * The accessible heading for the console's centre stage — the skip link's target.
 * The stage is not always the map: a widget can be expanded onto it, and the map
 * itself is either the flat 2D projection or the 3D globe. A static "Map" heading
 * would be a false claim in two of those three states.
 */
export function stageRegionLabel(input: {
  focusedWidgetId: string | null;
  focusedTitle?: string | null;
  stage: StageId;
}): string {
  if (input.focusedWidgetId != null) {
    return input.focusedTitle ? `${input.focusedTitle}, expanded` : "Expanded widget";
  }
  if (input.stage === "map3d") return "Live map, 3D globe";
  if (input.stage === "map2d") return "Live map";
  return "Main stage";
}

/* ── Top-bar status line ──────────────────────────────────────────────────── */

/**
 * The data layers the status line reports on, in reading order. Matches
 * ACTIVE_LAYERS in lib/layers.ts (the keys that have a real map layer); the
 * borders/names reference layer is left out because it is not a data feed.
 */
export const STATUS_LAYERS = ["cameras", "planes", "satellites", "webcams"] as const;
export type StatusLayerKey = (typeof STATUS_LAYERS)[number];

/**
 * The polite status sentence for the top bar.
 *
 * Carries STATE, never counts: which board is loaded and which data layers are on.
 * Both change only as the direct result of a user action (switching a board,
 * toggling a layer), so the live region speaks when — and only when — something a
 * sighted user would have *seen* change actually changed. Feeding it the camera /
 * plane / satellite tallies instead would make a screen reader recite
 * "18,729 cameras" every few seconds, which is worse than saying nothing.
 */
export function appStatusLine(input: {
  boardTitle?: string | null;
  layers: Partial<Record<StatusLayerKey, boolean>>;
}): string {
  const on = STATUS_LAYERS.filter((k) => input.layers[k] === true);
  const off = STATUS_LAYERS.filter((k) => input.layers[k] !== true);
  const board = input.boardTitle ? `${input.boardTitle} board.` : "";
  const layers =
    on.length === 0
      ? "No data layers are on."
      : off.length === 0
        ? "All data layers are on."
        : `Layers on: ${on.join(", ")}. Off: ${off.join(", ")}.`;
  return [board, layers].filter(Boolean).join(" ");
}

/* ── Breaking banner ──────────────────────────────────────────────────────── */

/** The subset of BreakingAlert (lib/alert.ts) this announcement needs. */
export interface AnnounceableAlert {
  key: string;
  kind: "quake" | "news";
  text: string;
  detail: string;
}

/**
 * What the always-mounted polite region under the top bar should be saying.
 *
 * Returns "" when there is nothing to announce — including when the user has
 * already dismissed this exact alert, so re-mounting or re-polling can never
 * re-announce something they have explicitly waved away. The visible banner's tag
 * ("ALERT" / "BREAKING") is spelled out in words because a screen reader reading
 * shouty capitals letter-by-letter is a known failure mode.
 */
export function breakingAnnouncement(
  alert: AnnounceableAlert | null | undefined,
  dismissedKey: string | null,
): string {
  if (!alert) return "";
  if (dismissedKey != null && alert.key === dismissedKey) return "";
  const tag = alert.kind === "quake" ? "Alert" : "Breaking news";
  const detail = alert.detail.trim();
  return detail ? `${tag}: ${alert.text}. ${detail}` : `${tag}: ${alert.text}`;
}
