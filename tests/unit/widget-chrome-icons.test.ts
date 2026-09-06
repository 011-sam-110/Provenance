// The console's widget chrome is DRAWN, not typed.
//
// It shipped as four fonts. The card header carried `⤢` (Supplemental Arrows-B),
// `🗑` (a colour emoji, resolved to Segoe UI Emoji on Windows) and `⋯` (a text
// ellipsis); the expanded view's masthead added `🔔`, `⬇` and `‹`. Six glyphs from
// four faces, each with its own advance width, optical weight and vertical centre,
// all sitting in one 22px row — which is why they read as unevenly spaced when the
// spacing was in fact identical. Reported as "the icons are spaced weirdly".
//
// A screenshot cannot pin this, because the failure is invisible on the machine that
// happens to have matching fonts installed. What CAN be pinned is the invariant that
// replaced it: every control in the widget chrome renders an <Icon>, so all of them
// come off one 16-unit grid at one stroke width and inherit one colour.
//
// The GEOMETRY is asserted separately and live, in scripts/shoot-widget-anatomy.mjs:
// equal gaps, identical icon boxes, and the control fitting the bar it sits in.
// This file asserts only that nothing has quietly gone back to typing a glyph.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** The element a class name opens, up to the tag that closes it. Comments are
 *  stripped first so the prose ABOVE a control — which necessarily names the old
 *  glyphs, since it explains why they went — cannot satisfy or break the check. */
function controlBody(src: string, cls: string, close = "</button>"): string {
  const bare = src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const at = bare.indexOf(cls);
  expect(at, `${cls} is not rendered any more — update this test with it`).toBeGreaterThan(-1);
  const end = bare.indexOf(close, at);
  expect(end, `${cls} has no ${close}`).toBeGreaterThan(-1);
  return bare.slice(at, end);
}

describe("widget chrome draws its icons", () => {
  const frame = read("components/console/WidgetFrame.tsx");
  const detail = read("components/console/WidgetDetail.tsx");

  it.each([
    ["tn-cw-expand", "expand"],
    ["tn-cw-close", "trash"],
    ["tn-cw-menu\"", "more"],
  ])("card header: %s draws <Icon name=%s>", (cls, name) => {
    expect(controlBody(frame, cls)).toContain(`<Icon name="${name}"`);
  });

  it.each([
    ["tn-detail-back", "back"],
    ["tn-detail-notify", "bell"],
  ])("expanded masthead: %s draws <Icon name=%s>", (cls, name) => {
    expect(controlBody(detail, cls)).toContain(`<Icon name="${name}"`);
  });

  it("expanded masthead: both export buttons draw the download icon", () => {
    const bare = detail.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    const acts = [...bare.matchAll(/tn-detail-act[\s\S]*?<\/button>/g)].map((m) => m[0]);
    expect(acts).toHaveLength(2);
    for (const a of acts) expect(a).toContain('<Icon name="download"');
  });

  it("every name the chrome asks for is a name the set draws", () => {
    const icons = read("components/console/WidgetIcons.tsx");
    const declared = icons.match(/export type IconName = ([^;]+);/)?.[1] ?? "";
    const known = new Set([...declared.matchAll(/"([a-z]+)"/g)].map((m) => m[1]));
    expect(known.size).toBeGreaterThan(0);

    const used = new Set(
      [...(frame + detail).matchAll(/<Icon name="([a-z]+)"/g)].map((m) => m[1]),
    );
    expect(used.size).toBeGreaterThan(0);
    for (const u of used) expect(known, `<Icon name="${u}"> is not in IconName`).toContain(u);

    // Every declared name is reachable in the component, so a branch that is never
    // taken cannot sit there rotting. `IconName` exists to be exhaustive, not aspirational.
    for (const k of known) {
      expect(icons, `IconName declares "${k}" but Icon() has no branch for it`)
        .toMatch(new RegExp(`name === "${k}"|// .*${k}`));
    }
  });
});
