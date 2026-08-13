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

/** The one number. Every beat below is an absolute offset inside it, and the
 *  dissolve is carved out of the end rather than added after — so this is the
 *  whole cost of the sequence, mount to gone. */
export const BOOT_MS = 5000;

/** The dissolve, taken out of BOOT_MS's tail. The handoff starts at
 *  BOOT_MS - BOOT_FADE_MS and the overlay is unmounted at BOOT_MS exactly. */
export const BOOT_FADE_MS = 420;

/** prefers-reduced-motion: one static final frame, then out. Not zero — a hard cut
 *  from a full-screen plate to the terminal is its own kind of jolt — but short
 *  enough that it reads as a page load rather than an animation. */
export const BOOT_REDUCED_MS = 260;

/** Bumping this replays the sequence once for everyone who has already seen it.
 *  Same idea as TOUR_VERSION: a redesign is worth showing again, a bug fix is not. */
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
 * The sequence, as data.
 *
 * Read down the `at` column to see the shape: a dark instrument powers up (0), the
 * mark draws itself (240 — its own CSS timeline runs ~1180ms from there), the
 * identity resolves (1460), six subsystems check in one every 260ms (2000–3300),
 * a scan sweep lights the 12-column grid the workspace is actually built on
 * (3620), and the terminal reports ready (4180) with ~400ms to read it before the
 * dissolve begins at BOOT_MS - BOOT_FADE_MS.
 */
export function bootTimeline(counts: BootCounts): BootBeat[] {
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
