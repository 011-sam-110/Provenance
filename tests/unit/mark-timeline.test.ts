import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MARK_ASSEMBLE_MS } from "@/lib/terminal/boot";

/**
 * The mark's assemble animation lives in CSS and its length lives in TypeScript,
 * and this reads the stylesheet so the two cannot drift.
 *
 * WHY THE COUPLING EXISTS AT ALL. lib/terminal/boot.ts opens by explaining that the
 * previous launch sequence spread its timing across three `animation-delay` values
 * in globals.css and two arrays in the component, so "how long is the boot?" had no
 * single answer. Every duration moved into the timeline — except this one, which
 * cannot: the mark is an SVG whose parts draw themselves, and a stroke-dash draw is
 * a CSS animation or it is nothing.
 *
 * WHAT GOES WRONG WITHOUT THIS. The boot no longer runs at a fixed length: it plays
 * compressed and ends when the map is ready. The beats are scaled in TS; the mark is
 * scaled by the same factor through `--tn-mark-scale`. If a duration here is written
 * bare, or MARK_ASSEMBLE_MS stops matching the longest chain, the `identify` beat
 * lands while the rings are still drawing and the logo snaps to its finished state
 * mid-animation. Nothing fails: no test, no type, no console warning. It is only
 * visible on a first visit, which is the one visit that matters.
 */

const CSS = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8");

/** Every `.tn-mark.is-playing .<part> { … }` rule, by part. */
function playingRules(): Map<string, string> {
  const out = new Map<string, string>();
  const re = /\.tn-mark\.is-playing\s+\.([\w-]+)\s*\{([^}]*)\}/g;
  for (let m = re.exec(CSS); m; m = re.exec(CSS)) out.set(m[1], m[2]);
  return out;
}

/** The scaled millisecond literals inside one rule body, in source order. */
function scaledMs(body: string): number[] {
  const out: number[] = [];
  const re = /calc\(\s*(\d+)ms\s*\*\s*var\(--tn-mark-scale,\s*1\)\s*\)/g;
  for (let m = re.exec(body); m; m = re.exec(body)) out.push(Number(m[1]));
  return out;
}

describe("the mark's assemble timeline", () => {
  const rules = playingRules();

  it("has the four parts the sequence animates", () => {
    expect([...rules.keys()].sort()).toEqual(["mk-book", "mk-dots", "mk-glass", "mk-ring", "mk-ring-2"]);
  });

  it("writes no duration bare — every one is scaled", () => {
    for (const [part, body] of rules) {
      // Strip the scaled forms; anything in ms still standing is unscaled.
      const rest = body.replace(/calc\([^)]*var\(--tn-mark-scale[^)]*\)\s*\)/g, "");
      expect(`${part}: ${rest.match(/\d+m?s\b/g)?.join(", ") ?? "none"}`).toBe(`${part}: none`);
    }
  });

  it("defaults to 1, so nothing outside the boot is affected", () => {
    // The header and the marketing bar render the same mark and pass only `idle`,
    // so they never match these rules — but the default is what guarantees it.
    // Read the defaults out rather than asserting a pattern is absent: a negative
    // lookahead over `\s*` backtracks to zero-width and passes on anything.
    const defaults = new Set<string>();
    const re = /var\(--tn-mark-scale(,\s*([^)]*))?\)/g;
    for (const body of rules.values()) {
      for (let m = re.exec(body); m; m = re.exec(body)) defaults.add((m[2] ?? "").trim());
    }
    expect(defaults.size).toBeGreaterThan(0); // the rules really do read the variable
    expect([...defaults]).toEqual(["1"]); // "" would mean no default: 0s animations
  });

  it("agrees with MARK_ASSEMBLE_MS about the longest chain", () => {
    // Per rule, the animation shorthand's numbers are (duration, delay) — their SUM
    // is when that part lands, whichever order they appear in. `.mk-ring-2` carries
    // only a delay and inherits `.mk-ring`'s duration, so it is the one chain that
    // spans two rules.
    const landing = new Map<string, number>();
    for (const [part, body] of rules) {
      landing.set(part, scaledMs(body).reduce((a, b) => a + b, 0));
    }
    landing.set("mk-ring-2", (landing.get("mk-ring-2") ?? 0) + (landing.get("mk-ring") ?? 0));

    expect(Math.max(...landing.values())).toBe(MARK_ASSEMBLE_MS);
  });
});
