import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

/**
 * THE CONSOLE GLOBE DOES NOT ROTATE, and must not start again by accident.
 *
 * `components/WorldMap.tsx` ran an idle rotation for as long as the tab was open: a
 * rAF loop nudging centre longitude every frame while the camera was zoomed out and
 * nothing had been touched. It was the single most expensive thing the console did at
 * rest — 60.8% of the main thread over a 10 s idle window on a desktop, ~101% at a 4x
 * CPU throttle, against 3.4% with the spin neutralised. PR #158 replaced "forever"
 * with an 8 s budget and an ease-out, and prod then measured 7.2% busy with zero map
 * renders once settled. The opening turn was then removed outright.
 *
 * WHY A TEST AND NOT A COMMENT. Nothing else can see this. A reintroduced spin loop
 * type-checks, renders correctly, passes every other test in this suite, and looks
 * *better* in review than the still globe — the cost is invisible until someone
 * profiles a page at rest, which is exactly the thing nobody does routinely. The
 * repo has already been bitten twice by this class of fault: an idle animation nobody
 * noticed (the hero's satellite ticker, gated by neither reduced motion nor the
 * off-screen check) and a loop that re-armed before its own gate so it could never
 * stop. Both were caught by measurement, months late.
 *
 * WHAT THIS DOES NOT CLAIM. `map.flyTo` / `jumpTo` / `easeTo` are deliberate,
 * user-initiated camera moves and are untouched — the assertions below are about a
 * self-driving camera, not about the map being frozen. Nor does this file govern
 * `components/marketing/HeroGlobe.tsx`: the LANDING hero still spins and still
 * settles on the `lib/map/spin.ts` envelope. Only the console is pinned still.
 */

const SRC = resolve(process.cwd(), "components/WorldMap.tsx");

/** Comments describe the removal at length; only real code should be searched. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const raw = readFileSync(SRC, "utf8");
const code = stripComments(raw);

test("the only animation frame in WorldMap is the hover hit-test coalescer", () => {
  // Not a blanket ban on rAF: `hoverRaf` coalesces pointer hit-tests to one per
  // frame and is scheduled BY a mousemove, never by itself, so it costs nothing at
  // rest. A self-rescheduling loop is the thing being excluded. If a second rAF
  // appears here, something is driving frames on its own again.
  const scheduled = [...code.matchAll(/(\w+)\s*=\s*requestAnimationFrame\(/g)].map((m) => m[1]);
  expect(scheduled).toEqual(["hoverRaf"]);
});

test("WorldMap never moves the camera by setCenter", () => {
  // The spin loop's one and only mutation. Deliberate moves go through flyTo /
  // jumpTo / easeTo, which stay allowed.
  expect(code).not.toMatch(/\.setCenter\s*\(/);
});

test("the spin envelope is not imported by the console map", () => {
  // lib/map/spin.ts still exists and still drives the landing hero. If it turns up
  // here again, a console spin has come back with it.
  expect(code).not.toMatch(/lib\/map\/spin/);
  expect(code).not.toMatch(/spinEnvelope/);
});

test("the machinery that existed only to pause the spin is gone", () => {
  // Each of these had exactly one reader — the spin gate. Left behind, they are
  // values written on every fly-to and pointer move that nothing ever reads.
  for (const sym of ["SPIN_MAX_ZOOM", "SPIN_DEG_PER_SEC", "IDLE_RESUME_MS", "interactUntilRef", "isAutoSpinning"]) {
    expect(code, `${sym} should not survive the spin removal`).not.toMatch(new RegExp(sym));
  }
});

test("no pointermove listener is attached to the map container", () => {
  // This one was purely a spin hold: hovering counted as engagement so the globe
  // would not rotate out from under the cursor. A per-move handler on the map is a
  // listener class this app has been bitten by before, so it goes with the spin.
  expect(code).not.toMatch(/addEventListener\(\s*["']pointermove["']/);
});
