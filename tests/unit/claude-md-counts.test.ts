import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CAMERA_FEED_COUNT } from "@/lib/sources/registry";

// CLAUDE.md states a camera-feed count in two places, and it has been wrong
// twice: it said "11 adapters, 7 countries" against a tree that already held 12
// and 8 (cetsp landed Brazil without the doc moving), and the Serbia feeds took
// the real figures to 14 and 9. Nobody noticed either time, because nothing
// checks a sentence.
//
// That table's own rule is "Never quote a count from memory - every figure below
// was measured, and each rots. Re-measure before putting a number in a README, a
// CV or a PR description." Sampo's CV and the YC application draw on it, so this
// is not a doc nit. The repo already solved this shape once for the console
// boards (console-presets + tour-board-copy pin that row); this does the same
// for the camera row so the third person to notice never has to raise it.

const ROOT = process.cwd();
const CLAUDE_MD = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");

/** Distinct ISO codes hard-coded by the camera adapters. */
function declaredCountries(): Set<string> {
  const dir = join(ROOT, "lib", "sources");
  const out = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts")) continue;
    const src = readFileSync(join(dir, file), "utf8");
    for (const m of src.matchAll(/country:\s*"([A-Z]{2})"/g)) out.add(m[1]);
  }
  return out;
}

describe("CLAUDE.md camera counts", () => {
  it("states the feed count the registry actually ships", () => {
    // Both places the number appears: the Shape bullet and the Numbers table.
    const bullet = CLAUDE_MD.match(/merged in `registry\.ts` \((\d+) feeds\)/);
    // "adapters" OR "feeds": once a network could be admitted as DATA rather than as a
    // module, "15 adapters" became a false word for a true number. The row is allowed to
    // say what it is; the count is still pinned.
    const table = CLAUDE_MD.match(/\|\s*Camera feeds\s*\|\s*(\d+) (?:adapters|feeds)/);
    expect(bullet, "the `lib/sources/*` bullet no longer states a feed count").not.toBeNull();
    expect(table, "the Camera feeds row no longer states an adapter count").not.toBeNull();
    expect(Number(bullet![1])).toBe(CAMERA_FEED_COUNT);
    expect(Number(table![1])).toBe(CAMERA_FEED_COUNT);
  });

  // Read this before "fixing" a failure here. The scan sees LITERAL `country:
  // "XX"` assignments, which is every camera adapter today (castlerock's US/CA
  // come from its own literal system table). An adapter that DERIVES a country
  // from upstream data would be invisible to it and this test would then be
  // asserting the wrong number, not catching a wrong one. So a red here means
  // "go and re-measure", not automatically "the doc is wrong".
  it("states the country count the adapters actually declare", () => {
    const table = CLAUDE_MD.match(/\|\s*Camera feeds\s*\|[^|]*?(\d+) countries/);
    expect(table, "the Camera feeds row no longer states a country count").not.toBeNull();
    expect(Number(table![1])).toBe(declaredCountries().size);
  });

  it("still carries the warning that makes the rest of that table trustworthy", () => {
    expect(CLAUDE_MD).toContain("Never quote a count from memory");
  });
});
