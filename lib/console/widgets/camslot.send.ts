"use client";
// ── Sending the basket somewhere ─────────────────────────────────────────────
//
// The basket (camslot.pick.ts) collects cameras without asking where they go. This
// file is the other half: the moment the user finally says "there", and the only
// place in the app that turns a pile of picks into a camera wall.
//
// It is its own module for the same reason camslot.create.ts is — the decision is
// shared. The tray's menu, and anything else that later wants to hand a selection to
// a wall, must agree about what "a camera wall on this board" is, what it is called,
// and what happens when the destination cannot take everything. Two copies of that
// would disagree the first time one of them was edited.
//
// NOTHING HERE THROWS. Every caller is a click handler, and a rejected send owes the
// user a sentence rather than a stack trace — the same contract createCamslot()
// keeps, for the same reason.

import { shellLayoutStore } from "@/lib/console/store";
import { createCamslot, revealWidget } from "@/lib/console/widgets/camslot.create";
import { pickStore, nameForPicks, type PickedCamera } from "@/lib/console/widgets/camslot.pick";
import {
  cadenceCap,
  describeAppend,
  orderByDistanceFrom,
  planAppend,
  FALLBACK_REFRESH_SECONDS,
  type LatLon,
} from "@/lib/console/widgets/camslot.arm";
import { DEFAULT_INTERVAL_MS, sanitizeCamslotConfig, streamKey, type StreamRef } from "@/lib/console/widgets/camslot.model";
import { loadedCamerasStore } from "@/lib/cameras/loaded";
import { scopeStore } from "@/lib/shell/scope";

/** Where a basket is going: a brand new wall, or the id of one already on the board. */
export type SendTarget = "new" | string;

export interface SendResult {
  ok: boolean;
  /** Ready to show the user, on every path. Never empty. */
  message: string;
  /** The wall that received them, when one did. */
  widgetId?: string;
}

/** One row of the "send to" menu. */
export interface CamslotTarget {
  id: string;
  name: string;
  /** Streams the wall holds right now — the number the menu prints. */
  count: number;
}

/** The widget type id this module can send to. */
const CAMSLOT_TYPE = "camslot";

/** Mirrors camslot.tsx:34 and WorldMap.tsx:309 — Windy's image tokens last ~10
 *  minutes and /api/webcam-image is bounded by that. */
const WEBCAM_REFRESH_SECONDS = 600;

/**
 * The cadence of a stream ALREADY in a wall.
 *
 * A mirror of `refreshForRef` in WorldMap.tsx:315-319, and it has to stay one: the
 * cap the tray computes and the cap the map computed must be the same number, or the
 * same wall would report two different limits depending on which gesture filled it.
 * Road cameras are the only kind whose cadence varies, and loadedCamerasStore is the
 * only place the client holds it.
 */
function refreshForRef(ref: StreamRef): number | undefined {
  if (ref.k === "webcam") return WEBCAM_REFRESH_SECONDS;
  if (ref.k === "yt") return undefined; // an embed is not polled; it has no cadence
  return loadedCamerasStore.get().find((c) => c.id === ref.id)?.refreshSeconds;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The middle of the selection — the MEAN of the picked coordinates, not the centre
 * of their bounding box.
 *
 * A bbox centre is equidistant from both extremes by construction, so a basket of
 * forty Soho cameras plus one stray in Croydon puts the stray and the far edge of
 * Soho at exactly the same distance, and the tie is then broken by array order: the
 * cap would drop a camera the user was working on and keep the one they mis-clicked,
 * for arithmetic reasons nobody could see. The mean sits inside whichever cluster the
 * selection actually is, so the stray is the thing that goes.
 *
 * Null when nothing in the basket has usable coordinates. A centre derived from
 * `lat ?? 0` would sit in the Gulf of Guinea and order every camera by its distance
 * from there, which is the arbitrary sample `orderByDistanceFrom` exists to prevent.
 */
function selectionCentre(picks: readonly PickedCamera[]): LatLon | null {
  let lat = 0;
  let lon = 0;
  let n = 0;
  for (const p of picks) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    lat += p.lat;
    lon += p.lon;
    n += 1;
  }
  return n > 0 ? { lat: lat / n, lon: lon / n } : null;
}

/**
 * Board reading order: top row first, then left to right.
 *
 * The grid `rect` is what the user actually sees, so it is what the menu is ordered
 * by — `widgets[]` array order is authoring order and on a board anyone has dragged
 * it bears no relation to where the cards ended up. A widget with no rect has not
 * been through a sanitize pass yet (hand-built layouts, and the window between
 * `add()` and the first layout); those sort last in array order rather than being
 * dropped, because a wall missing from the menu is a wall you cannot send to.
 */
function inReadingOrder<T extends { rect?: { x: number; y: number } }>(rows: readonly T[]): T[] {
  return rows
    .map((w, i) => ({ w, i }))
    .sort((a, b) => {
      const ar = a.w.rect;
      const br = b.w.rect;
      if (!ar && !br) return a.i - b.i;
      if (!ar) return 1;
      if (!br) return -1;
      return ar.y - br.y || ar.x - br.x || a.i - b.i;
    })
    .map((e) => e.w);
}

/**
 * Every camera wall on the open board, in the order they read on screen.
 *
 * The NUMBER in the fallback name is the wall's position in this list, not a count of
 * the unnamed ones. "Camera wall 3" then means the third wall down the board, which
 * is something the user can look at and verify; numbering only the unnamed ones would
 * make "Camera wall 2" the fifth card on screen, and a label that has to be decoded
 * is worse than no label at all.
 */
export function camslotTargets(): CamslotTarget[] {
  const walls = shellLayoutStore.get().widgets.filter((w) => w.type === CAMSLOT_TYPE);
  return inReadingOrder(walls).map((w, i) => {
    const cfg = sanitizeCamslotConfig(w.config);
    return {
      id: w.id,
      name: cfg.name ?? `Camera wall ${i + 1}`,
      count: cfg.streams.length,
    };
  });
}

/**
 * Send the basket to a wall — a new one, or one already on the board.
 *
 * Empties the basket only when something actually landed. An append refused in full
 * has not moved the user's work anywhere, and clearing it there would leave them
 * holding a message that says "use a second wall" with nothing left to send.
 */
export function sendPicksToWall(target: SendTarget): SendResult {
  try {
    const picks = pickStore.get().picks;
    if (picks.length === 0) return { ok: false, message: "Nothing picked yet." };
    return target === "new" ? sendToNew(picks) : sendToExisting(target, picks);
  } catch {
    // A click handler must not take the console down with it. No path here is
    // expected to throw; this is the backstop for the ones nobody predicted.
    return { ok: false, message: "Could not send those to a camera wall." };
  }
}

/**
 * The area's own name, when there is one worth using.
 *
 * BOTH conditions are required and they check different things. `ring` says the picks
 * came from a drawn area at all; the scope still being in `aoi` mode says the label
 * currently in the scope store still describes that area. A scope switched back to
 * World since the ring was drawn is labelled "World", and naming a wall of eight Soho
 * cameras "World" is the kind of confident wrong answer this codebase spends most of
 * its comments avoiding.
 */
function areaLabel(): string | undefined {
  if (!pickStore.get().ring) return undefined;
  const scope = scopeStore.get();
  if (scope.mode !== "aoi") return undefined;
  const label = (scope.label ?? "").trim();
  return label || undefined;
}

/**
 * A NEW wall is capped by cadence too, and this is not symmetry for its own sake.
 *
 * The basket holds up to MAX_PICKS (60), but a slot can only show as many views as
 * its dwell and its fastest member allow: sixty cameras at a 5s dwell take five
 * minutes to come round, so a camera that republishes every 60s would be showing a
 * five-minute-old frame for most of the cycle. `cadenceCap` is the number of views
 * that can still be current, and it is 12 for that example — a fifth of what would
 * otherwise be written.
 *
 * Without this, "send 60 to a new wall" silently built a wall that could not honour
 * its own contents while the identical send to an EXISTING wall refused politely
 * and said why. Two paths, two answers, same request.
 */
function sendToNew(picks: readonly PickedCamera[]): SendResult {
  const name = nameForPicks(picks, areaLabel());

  const cap = cadenceCap(picks.map((p) => p.refreshSeconds), DEFAULT_INTERVAL_MS);
  // Centre-out, so a cap that bites drops the outside of what was chosen rather
  // than whatever happened to be clicked last. Same centre the existing-wall path
  // uses, deliberately — two send paths that ranked differently would drop
  // different cameras from the same basket.
  const centre = selectionCentre(picks);
  const ordered = centre ? orderByDistanceFrom(picks, centre) : [...picks];
  const taken = ordered.slice(0, cap);
  const dropped = picks.length - taken.length;

  const res = createCamslot({ name, streams: taken.map((p) => p.ref) });
  if (!res.ok) return { ok: false, message: res.reason ?? "Could not add a camera wall." };

  pickStore.clear();
  const what = plural(taken.length, "camera");
  const head = name ? `New camera wall "${name}" — ${what}.` : `New camera wall — ${what}.`;
  if (dropped === 0) return { ok: true, widgetId: res.id, message: head };

  return {
    ok: true,
    widgetId: res.id,
    message: `${head} ${plural(dropped, "camera")} left out: a wall this fast can hold ${cap} before the oldest view goes stale. Send the rest to a second wall.`,
  };
}


function sendToExisting(id: string, picks: readonly PickedCamera[]): SendResult {
  const widget = shellLayoutStore.get().widgets.find((w) => w.id === id && w.type === CAMSLOT_TYPE);
  if (!widget) return { ok: false, message: "That camera wall is gone." };

  // Read the playlist from the STORE, never from anything captured when the menu was
  // opened: the picker, another tray send, or a share-link load may have changed it
  // in between, and writing a stale array would silently drop those streams.
  const cfg = sanitizeCamslotConfig(widget.config);

  // The cap is set by the FASTEST-refreshing member of the RESULTING playlist, so the
  // streams already in the wall count too — sending a 60s camera into a wall of 300s
  // ones is exactly the case that moves it, and ignoring the existing members would
  // let the cap drift up on every send. Mirrors appendToArmedSlot in WorldMap.
  const cadences = [...cfg.streams.map(refreshForRef), ...picks.map((p) => p.refreshSeconds)];
  const cap = cadenceCap(cadences, cfg.intervalMs);

  // CENTRE-OUT, and the ordering is what makes the message true rather than a
  // stylistic choice. When the cap bites, describeAppend says "Added the N nearest
  // the centre" — a sentence the user can check against the map. Sending the basket
  // in click order and printing that line would be a claim about a selection nobody
  // made, which is the exact failure `orderByDistanceFrom` was written to stop.
  // A basket with no usable coordinates keeps its own order; there is no centre to be
  // nearest to, and inventing one would be worse than leaving it alone.
  const centre = selectionCentre(picks);
  const ordered = centre ? orderByDistanceFrom(picks, centre) : [...picks];
  const plan = planAppend(cfg.streams, ordered.map((p) => p.ref), cap);

  const resolved = cadences.map((s) =>
    typeof s === "number" && s > 0 ? s : FALLBACK_REFRESH_SECONDS,
  );
  const capSetBySeconds = Math.min(...resolved, FALLBACK_REFRESH_SECONDS);
  const capMixed = new Set(resolved).size > 1;

  if (plan.next) shellLayoutStore.configure(id, { streams: plan.next });
  // Reveal even when nothing was added: "already in this wall" is a claim the user is
  // entitled to check, and they cannot check a card scrolled off the bottom of the
  // board — which on the Streets board is exactly where the walls are.
  revealWidget(id);

  // `available` is deliberately omitted. describeAppend prints "N with a live feed"
  // from it, and the basket does not carry availability — passing picks.length would
  // be asserting every pick is live, which is a coverage claim we cannot make.
  const message = describeAppend(plan, { cap, capSetBySeconds, capMixed });

  if (plan.added === 0) return { ok: false, message, widgetId: id };

  if (plan.refused > 0) {
    // A partial send keeps what the wall would not take. The message it comes with
    // ends "use a second wall" — advice that would be impossible to follow if the
    // basket were emptied of the very cameras it refers to.
    const placed = new Set((plan.next ?? []).map(streamKey));
    pickStore.retain(ordered.filter((p) => !placed.has(p.key)).map((p) => p.key));
  } else {
    pickStore.clear();
  }
  return { ok: true, message, widgetId: id };
}
