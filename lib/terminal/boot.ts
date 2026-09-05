// The Terminal's launch sequence — its timeline, and the gate that decides
// whether a visitor sees it at all.
//
// WHY THE TIMELINE LIVES HERE AND NOT IN CSS. The previous sequence was ~1.5s of
// React state plus a mark animation whose real duration was three `animation-delay`
// values buried in globals.css. Nobody could read "how long is the boot?" off any
// one place, and changing it meant editing two files and hoping they still agreed.
// Here BOOT_MS is the answer, every beat is an absolute offset inside it, and the
// component publishes both numbers to CSS as custom properties (--tnx-boot-ms,
// --tnx-boot-fade) so the sheet has no duration of its own to drift from.
//
// Everything in this file is pure and DOM-free — vitest runs in the node
// environment in this repo, so a timeline expressed as CSS could not be asserted at
// all, and this one is (tests/unit/terminal-boot.test.ts).

import { loadPersisted, savePersisted } from "@/lib/shell/persist";

/** The CEILING. The plate is never up for longer than this, however slow the map
 *  is — so a bad connection cannot make the launch sequence worse than it used to
 *  be. It is also the length the sequence ran at unconditionally before it learned
 *  to end when the map was ready, which is why the unscaled timeline below still
 *  fits it exactly. */
export const BOOT_MS = 5000;

/** The FLOOR: the whole sequence, mount to gone, when the map is ready first.
 *
 *  The plate used to hold for a flat five seconds while the map behind it had
 *  finished at 4.2 s — measured on desktop, and ~70% of sessions see the boot, so
 *  it was the gate on the first visit rather than the network. Compressing to this
 *  is a VISIBLE change: the sequence still plays in full, at
 *  `timelineScale(BOOT_MIN_MS)` of its designed speed. It is one constant, and it
 *  is a design call — raise it and the animation slows back down.
 *
 *  2600 → 2000 on 2026-09-05, because at 2600 THE FLOOR WAS STILL THE GATE. Measured
 *  against two Vercel previews of the same build system, cold cache, desktop, with
 *  the plate's own clock taken from the frame it first appears on:
 *
 *                          map first idle    plate gone    floor binding by
 *    origin/main                 2201 ms       2639 ms          438 ms
 *    perf/map-smooth             1938 ms       2602 ms          664 ms
 *
 *  Both plates left at BOOT_MIN_MS + the fade, not when the map was ready — so the
 *  660 ms the terrain, spin and preconnect work had just taken off the map's load
 *  was being handed straight back to a full-screen overlay. Every millisecond a
 *  faster map earns is invisible until this number moves with it.
 *
 *  WHAT IT COSTS, SAID PLAINLY. The sequence is scaled to fit, so it now plays at
 *  ≈0.28 of its designed speed rather than ≈0.43, and the six subsystem checks land
 *  about 67 ms apart instead of 112 ms. It reads as fast. It is one constant and one
 *  test line to put back, and 2300 is the middle setting (≈0.36, checks ~94 ms
 *  apart, plate gone ~300 ms earlier than today rather than ~600 ms). The floor only
 *  binds where the map is ready first: on a slow connection `bootEndMs` still tracks
 *  the map and the 5 s ceiling is unchanged. */
export const BOOT_MIN_MS = 2000;

/** The dissolve, taken out of the tail. The handoff starts BOOT_FADE_MS before the
 *  end and the overlay is unmounted at the end exactly. */
export const BOOT_FADE_MS = 420;

/** How long TERMINAL READY stays legible before the dissolve begins. Reserved out
 *  of the total by `timelineScale`, so the last beat can never be squeezed into
 *  zero frames by lowering BOOT_MIN_MS. */
export const BOOT_READY_HOLD_MS = 400;

/** The mark's own assemble timeline in app/globals.css, measured from the moment
 *  the `assemble` beat sets `is-playing`. Longest chain: `.mk-book`, 700ms delay +
 *  480ms.
 *
 *  IT IS A DURATION IN CSS AND A NUMBER HERE, WHICH IS THE ONE COUPLING THIS FILE
 *  EXISTS TO AVOID — so it is scaled by the same factor as the beats (via
 *  `--tn-mark-scale`, published by BootSequence) and pinned by
 *  tests/unit/mark-timeline.test.ts, which reads the stylesheet. Without the
 *  scaling, compressing the sequence would set `identify` while the mark was still
 *  drawing, and the logo would visibly snap to its finished state mid-animation. */
export const MARK_ASSEMBLE_MS = 1180;

/** prefers-reduced-motion: one static final frame, then out. Not zero — a hard cut
 *  from a full-screen plate to the terminal is its own kind of jolt — but short
 *  enough that it reads as a page load rather than an animation. */
export const BOOT_REDUCED_MS = 260;

/** Bumping this replays the sequence once for everyone who has already seen it.
 *  A redesign is worth showing again, a bug fix is not. */
export const BOOT_VERSION = 1;

export const BOOT_PERSIST_KEY = "tn.terminal.boot.v1";
export const BOOT_PERSIST_VERSION = 1;
export interface BootPersisted {
  seenVersion: number;
}

/**
 * The stages, in order. The component emits a class per stage REACHED (not just
 * the current one), so a CSS rule can hang an entry animation off the moment its
 * stage lands and then stay put. Order is load-bearing: `stageIndex` compares by
 * position in this array.
 */
export const BOOT_STAGES = ["power", "assemble", "identify", "checks", "sweep", "ready"] as const;
export type BootStage = (typeof BOOT_STAGES)[number];

export function stageIndex(stage: BootStage): number {
  return BOOT_STAGES.indexOf(stage);
}

/** One subsystem checking in. Three columns: what it is, what it is made of, and a
 *  generic state word — never a live figure the boot has not actually measured. */
export interface BootCheck {
  label: string;
  detail: string;
  state: string;
}

export interface BootBeat {
  /** ms from mount. */
  at: number;
  stage: BootStage;
  check?: BootCheck;
}

/** The only two live numbers on screen, and both are read off the registries by the
 *  caller (SIGNALS.length, CAMERA_FEED_COUNT) rather than typed here. A boot
 *  sequence inventing "19,328 cameras online" would be fabricated data on the very
 *  first frame of the product. */
export interface BootCounts {
  layers: number;
  feeds: number;
}

/**
 * The sequence, as data, at its designed speed.
 *
 * Read down the `at` column to see the shape: a dark instrument powers up (0), the
 * mark draws itself (240 — its own CSS timeline runs MARK_ASSEMBLE_MS from there),
 * the identity resolves (1460, just after the mark lands), six subsystems check in
 * one every 260ms (2000–3300), a scan sweep lights the 12-column grid the workspace
 * is actually built on (3620), and the terminal reports ready (4180) with
 * BOOT_READY_HOLD_MS to read it before the dissolve begins.
 *
 * These are the SOURCE offsets. Nothing schedules them directly — `bootTimeline`
 * scales them to whatever total the boot is running at, and at BOOT_MS the scale
 * is exactly 1, so this table is still literally what a five-second boot plays.
 */
function unscaledBeats(counts: BootCounts): BootBeat[] {
  return [
    { at: 0, stage: "power" },
    { at: 240, stage: "assemble" },
    { at: 1460, stage: "identify" },

    { at: 2000, stage: "checks", check: { label: "RENDERER", detail: "MAPLIBRE GL · GLOBE", state: "MOUNTED" } },
    { at: 2260, stage: "checks", check: { label: "SIGNAL LAYERS", detail: `${counts.layers} REGISTERED`, state: "READY" } },
    { at: 2520, stage: "checks", check: { label: "CAMERA FEEDS", detail: `${counts.feeds} ADAPTERS`, state: "READY" } },
    // "12-COLUMN" is the workspace grid's own spec (lib/terminal/layoutGrid.ts's
    // COLS), quoted rather than imported: that module is the layout engine, and a
    // decorative overlay taking a hard dependency on it buys a compile break for a
    // string. It is a design constant, not a measurement.
    { at: 2780, stage: "checks", check: { label: "WIDGET GRID", detail: "12-COLUMN SEGMENTS", state: "MOUNTED" } },
    { at: 3040, stage: "checks", check: { label: "TIME BASE", detail: "UTC", state: "LOCKED" } },
    { at: 3300, stage: "checks", check: { label: "UPLINK", detail: "KEYLESS · DORMANT-SAFE", state: "OK" } },

    { at: 3620, stage: "sweep" },
    { at: 4180, stage: "ready" },
  ];
}

/** The last beat of the unscaled sequence, derived rather than typed — the counts
 *  do not move any offset, so any BootCounts gives the same answer. */
const UNSCALED_END_MS = (() => {
  const b = unscaledBeats({ layers: 0, feeds: 0 });
  return b[b.length - 1].at;
})();

/**
 * How fast to play the sequence to fit `totalMs`, dissolve and read-time included.
 *
 * Reserving BOOT_FADE_MS and BOOT_READY_HOLD_MS out of the total is what stops a
 * smaller BOOT_MIN_MS silently squeezing TERMINAL READY into zero frames — the
 * exact rot tests/unit/terminal-boot.test.ts was written to catch. Capped at 1:
 * a longer total holds the finished plate for longer, it never plays SLOWER than
 * the design.
 */
export function timelineScale(totalMs: number): number {
  const room = totalMs - BOOT_FADE_MS - BOOT_READY_HOLD_MS;
  return Math.min(1, Math.max(0.1, room / UNSCALED_END_MS));
}

/**
 * The sequence, scaled to the total it is running at. `totalMs` defaults to the
 * floor because that is what the component schedules: the boot cannot know at mount
 * how long the map will take, so it always plays at the compressed speed and then
 * waits at the finished frame if the map is still coming.
 *
 * The mark's own CSS is scaled by the same factor (`--tn-mark-scale`), so the
 * relationship the sequence depends on — the mark finishes drawing before the
 * identity resolves — holds at every speed rather than only at 1.
 */
export function bootTimeline(counts: BootCounts, totalMs: number = BOOT_MIN_MS): BootBeat[] {
  const scale = timelineScale(totalMs);
  if (scale === 1) return unscaledBeats(counts);
  return unscaledBeats(counts).map((b) => ({ ...b, at: Math.round(b.at * scale) }));
}

/**
 * When the plate should go, in ms from the boot's own mount.
 *
 * `mapIdleMs` is the map's first `idle` on the same clock, or null if it has not
 * happened. NULL MEANS THE CEILING, not the floor: a page with no map, a WebGL
 * context that never comes up, or a map that simply has not finished must all
 * behave exactly as the boot did before it learned to listen — five seconds and
 * out. Ending early on silence would turn a broken map into a shorter animation.
 */
export function bootEndMs({
  minMs = BOOT_MIN_MS,
  maxMs = BOOT_MS,
  mapIdleMs,
}: {
  minMs?: number;
  maxMs?: number;
  mapIdleMs: number | null;
}): number {
  if (mapIdleMs == null || !Number.isFinite(mapIdleMs)) return maxMs;
  return Math.min(maxMs, Math.max(minMs, mapIdleMs));
}

/** The stage in force at `t` ms. Used to paint the single static frame that
 *  reduced-motion gets: `stageAt(beats, BOOT_MS)` is the end of the sequence. */
export function stageAt(beats: readonly BootBeat[], t: number): BootStage {
  let stage: BootStage = "power";
  for (const b of beats) {
    if (b.at > t) break;
    stage = b.stage;
  }
  return stage;
}

/** Every subsystem that has checked in by `t` ms, in order. */
export function checksAt(beats: readonly BootBeat[], t: number): BootCheck[] {
  const out: BootCheck[] = [];
  for (const b of beats) {
    if (b.at > t) break;
    if (b.check) out.push(b.check);
  }
  return out;
}

/** `?boot=1` replays the sequence on demand, `?boot=0` declines it. Neither is a
 *  feature for visitors: it is how the sequence is reviewable (and screenshottable)
 *  without hand-clearing localStorage between every reload. */
export type BootOverride = "force" | "skip" | null;

export function bootOverrideFromSearch(search: string): BootOverride {
  let value: string | null = null;
  try {
    value = new URLSearchParams(search).get("boot");
  } catch {
    return null;
  }
  if (value === null) return null;
  const v = value.toLowerCase();
  if (v === "1" || v === "replay" || v === "on") return "force";
  if (v === "0" || v === "off" || v === "skip") return "skip";
  return null;
}

/**
 * Once per visitor, not once per session.
 *
 * A five-second sequence is a first-impression, and a first impression shown on
 * every reload is a toll. `seenVersion` is the persisted flag; null means it has
 * never run here.
 */
export function shouldPlayBoot(seenVersion: number | null, override: BootOverride = null): boolean {
  if (override === "force") return true;
  if (override === "skip") return false;
  return seenVersion === null || seenVersion < BOOT_VERSION;
}

/** Read the persisted flag. Returns null on the server, in private mode, or on a
 *  version bump — all of which correctly mean "has not seen this sequence". */
export function loadBootSeen(): number | null {
  return loadPersisted<BootPersisted>(BOOT_PERSIST_KEY, BOOT_PERSIST_VERSION)?.seenVersion ?? null;
}

/** Written the moment the sequence STARTS, not when it ends: someone who reloads
 *  two seconds in has seen it, and replaying it would be the nag this flag exists
 *  to prevent. */
export function markBootSeen(): void {
  savePersisted<BootPersisted>(BOOT_PERSIST_KEY, BOOT_PERSIST_VERSION, { seenVersion: BOOT_VERSION });
}
