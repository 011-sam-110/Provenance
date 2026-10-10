import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MARK_LENS } from "@/lib/marketing/sphereIntro";
import { markImage } from "@/components/brand/Mark";
import saved from "@/lib/brand/sphereMark.json";

/**
 * The Provenance mark is a filtered screenshot of the camera sphere (scripts/gen-sphere-mark.mjs
 * from scripts/assets/sphere-source.png). It is drawn by three consumers, the app, the icon
 * script and the intro's landing spot, from one generated list, so what is pinned here is that
 * the list and its files agree and that every consumer reads it.
 */

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe("the mark", () => {
  it("is filtered from a committed screenshot of the sphere", () => {
    expect(saved.source).toBe("scripts/assets/sphere-source.png");
    const [w, h] = pngSize(join(root, saved.source));
    expect(w).toBe(h);
  });

  it("has every size it lists, each the size its name says", () => {
    const entries = Object.entries(saved.files);
    expect(entries.length).toBeGreaterThanOrEqual(3);
    for (const [px, url] of entries) {
      const file = join(root, "public", url);
      expect(existsSync(file)).toBe(true);
      expect(pngSize(file)).toEqual([Number(px), Number(px)]);
    }
  });

  it("serves each screen density an image close to the pixels it fills", () => {
    expect(markImage(30)).toBe(
      `image-set(url(${saved.files["32"]}) 1x, url(${saved.files["64"]}) 2x, url(${saved.files["96"]}) 3x)`,
    );
    expect(markImage(2000)).toContain(saved.files["512"]);
  });

  it("is the one source for the app, the icons and the intro's landing spot", () => {
    expect(read("components/brand/Mark.tsx")).toContain('from "@/lib/brand/sphereMark.json"');
    const icons = read("scripts/gen-icons.mjs");
    expect(icons).toContain('"sphereMark.json"');
    expect(icons).not.toContain("markPaths.json");
    expect(MARK_LENS).toEqual(saved.orb);
    expect(saved.orb.cx).toBe(64);
    expect(saved.orb.cy).toBe(64);
  });
});
