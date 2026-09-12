import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CAMERA_FEED_COUNT } from "@/lib/sources/registry";
import { CAMERA_FACTS } from "@/lib/marketing/camera-facts.data";

/**
 * The landing page's first sentence states three camera figures. Each one is copied
 * into `camera-facts.data.ts` rather than imported (see the docblock there for why),
 * so each one can silently go stale. This recomputes all three from their real owners.
 *
 * A failure here is NOT a broken test. It means the repo now ships a different number
 * than the page claims — fix the data file.
 */

const ROOT = process.cwd();

/** Distinct ISO codes hard-coded by the camera adapters. Same scan as claude-md-counts. */
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

describe("landing camera facts", () => {
  it("states the feed count the registry ships", () => {
    expect(CAMERA_FACTS.feeds).toBe(CAMERA_FEED_COUNT);
  });

  it("states the country count the adapters declare", () => {
    expect(CAMERA_FACTS.countries).toBe(declaredCountries().size);
  });

  it("states the webcam count the committed catalogue holds", () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "public", "webcams", "manifest.json"), "utf8"),
    ) as { harvested: number };
    expect(CAMERA_FACTS.webcams).toBe(manifest.harvested);
  });
});
