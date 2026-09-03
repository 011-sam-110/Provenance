import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { soloStore } from "@/lib/terminal/solo";

beforeEach(() => {
  soloStore.set(false);
});

test("solo is off until someone asks for it", () => {
  expect(soloStore.get()).toBe(false);
});

test("toggle flips, set is idempotent", () => {
  soloStore.toggle();
  expect(soloStore.get()).toBe(true);
  soloStore.toggle();
  expect(soloStore.get()).toBe(false);

  let notified = 0;
  const off = soloStore.subscribe(() => notified++);
  soloStore.set(true);
  expect(notified).toBe(1);
  soloStore.set(true); // already true — no listener should be woken
  expect(notified).toBe(1);
  soloStore.set(false);
  expect(notified).toBe(2);
  off();
});

test("unsubscribing actually stops the notifications", () => {
  let n = 0;
  const off = soloStore.subscribe(() => n++);
  soloStore.set(true);
  off();
  soloStore.set(false);
  expect(n).toBe(1);
});

// ---------------------------------------------------------------------------
// The two guards. Both exist because solo fails SILENTLY when they are broken:
// the widgets simply stay on screen, and nothing errors.
// ---------------------------------------------------------------------------

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

test("the widget slots are hidden by solo, not dropped from the tree", () => {
  const src = read("components", "console", "ConsoleWorkspace.tsx");
  // `hidden` keeps them mounted: dropping them would throw away every widget's
  // fetched rows and scroll position, so returning from solo would repopulate an
  // empty board feed by feed. Verified in the browser: content identical across
  // a solo round trip.
  expect(src).toContain("hidden={solo}");
  // THE SECOND HALF OF THIS TEST MOVED, and it moved because it was the weaker
  // kind of assertion. It used to read the source for `solo ? { x: 0, y: 0, w:
  // COLS ...}` — the literal that gave the map the whole board. That pinned one
  // spelling of one implementation: it would have gone green on a stage that was
  // full-width and still had three rails sitting on top of it, and it went red on
  // a rename that changed nothing.
  //
  // The claim it was making — "the map must actually get the board, or solo is
  // just a widget-hiding button" — is now made behaviourally in
  // terminal-rails.test.ts, by `effectiveRailSize(..., solo) === 0` for all three
  // rails and by the rail vars all collapsing to 0px. That is the same claim
  // against the function that decides it, so it cannot be satisfied by a string.
});

test("`hidden` on a slot cannot be silently defeated by a display rule", () => {
  // `[hidden]{display:none}` is a UA rule and the lowest-specificity thing in the
  // cascade. ANY `display` later added to `.tn-seg-slot` would beat it, leaving
  // the widgets sitting on top of a full-board map with no error anywhere.
  const css = read("app", "globals.css");
  expect(css).toMatch(/\.tn-seg-slot\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test("solo is NOT part of the shared layout — it must not ride a share link", () => {
  // A `?c=` link or a board preset carrying solo would send someone your board
  // with the board hidden, and every preset author would owe an answer to a
  // question they never asked.
  const types = read("lib", "console", "types.ts");
  expect(types).not.toMatch(/\bsolo\b/i);
  const share = read("lib", "console", "share.ts");
  expect(share).not.toMatch(/\bsolo\b/i);
});
