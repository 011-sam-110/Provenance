import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

// The console top bar's presentation (Leon, 2026-10-29): the board tabs centred in the
// bar with no dot, VIDEO and STILLS roomier with a camcorder and a camera, and ONE
// hairline before WEBCAMS. These are source pins, because the things they hold are
// things CSS and markup can quietly undo: a border put back on the tab, a dot that
// returns, a second rule. The rendered numbers (centred to 0.5px, no overflow, no
// hydration error) are measured in a browser, not here.

const ROOT = resolve(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(resolve(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

const header = read("components", "terminal", "TerminalHeader.tsx");
const stats = read("components", "terminal", "CameraStats.tsx");
const glyphs = read("components", "terminal", "StatGlyphs.tsx");
const css = read("app", "globals.css");

/** The body of the first rule whose selector is exactly `selector`. */
function ruleBody(source: string, selector: string): string {
  const at = source.indexOf(`${selector} {`);
  expect(at, `${selector} is in the sheet`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", at);
  return source.slice(open + 1, source.indexOf("}", open));
}

describe("the board tabs", () => {
  test("no dot and no edited class: the state is in the hover text and the accessible name", () => {
    expect(header).not.toContain("tnx-hdr-board-dot");
    expect(header).not.toContain("is-edited");
    expect(header).toMatch(/title=\{`[^`]*\$\{edited \? " · customised" : ""\}`\}/);
    expect(header).toMatch(/<span className="tn-sr-only"> board\{edited \? ", customised" : ""\}<\/span>/);
  });

  test("the edited state is read after hydration, with an empty server snapshot", () => {
    expect(header).toContain("useSyncExternalStore(shellLayoutStore.subscribe, editedSnapshot, noneEdited)");
    expect(header).toMatch(/const noneEdited = \(\) => "";/);
    // `isBoardEdited` hits localStorage: it must not be called in BoardTabs' render.
    const tabs = header.slice(header.indexOf("function BoardTabs()"), header.indexOf("export default function TerminalHeader"));
    expect(tabs).not.toContain("isBoardEdited(");
  });

  test("nothing in any stylesheet still styles the dot", () => {
    const dir = resolve(ROOT, "app");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".css"))) {
      const text = read("app", f);
      expect(text, f).not.toContain("tnx-hdr-board-dot");
      expect(text, f).not.toContain("tn-mo-dot-in");
      expect(text, f).not.toContain(".tnx-hdr-board.is-edited");
    }
  });

  test("the tab keeps its full content box: no border-bottom, an inset shadow marks the active one", () => {
    expect(ruleBody(css, ".tn-terminal .tnx-hdr-board")).not.toContain("border-bottom");
    expect(ruleBody(css, ".tn-terminal .tnx-hdr-board.is-active")).toContain("box-shadow: inset 0 -2px 0 var(--tnx-accent)");
    expect(ruleBody(css, ".tn-terminal .tnx-hdr-board.is-active")).not.toContain("border-bottom");
  });

  test("the travelling marker hands over by removing the shadow, not a border colour", () => {
    const motion = read("app", "console-motion.css");
    expect(motion).toMatch(/\.tnx-hdr-boards\[data-ind="1"\] \.tnx-hdr-board\.is-active \{\s*box-shadow: none;\s*\}/);
  });
});

describe("the camera stats strip", () => {
  const start = css.indexOf("/* ── CAMERA STATS STRIP");
  const end = css.indexOf("/* ── END CAMERA STATS STRIP ── */");
  const block = css.slice(start, end);

  test("one hairline before WEBCAMS, also after RETRY in the error state", () => {
    expect(block).not.toContain("cs-web::after");
    expect(block).not.toContain("cs-web::before");
    expect(block).toContain(":is(.cs-seg, .cs-retry) + .cs-seg::before");
    expect(block).not.toMatch(/\.cs-web \{[^}]*margin-left/);
  });

  test("VIDEO and STILLS are the roomier pair, and the glyph is sized by CSS in an existing token", () => {
    expect(ruleBody(block, ".tn-terminal .cs-seg.is-major")).toContain("padding: 0 12px");
    const glyph = ruleBody(block, ".tn-terminal .cs-glyph");
    expect(glyph).toContain("width: 14px");
    expect(glyph).toContain("height: 14px");
    expect(glyph).toContain("color: var(--tnx-ink-dim)");
    // The colour comes from a token, never a literal, in everything this change added.
    expect(glyph).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  test("the strip marks VIDEO and STILLS as major", () => {
    expect(stats).toMatch(/id === "video" \|\| id === "stills" \? "is-major" : ""/);
  });
});

describe("the two glyphs", () => {
  test("hand-drawn in currentColor, exported by name, with no colour literal", () => {
    expect(glyphs).toContain('stroke: "currentColor"');
    expect(glyphs).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(glyphs).not.toMatch(/\bfill="(?!none)/);
    expect(glyphs).toContain("export function VideoGlyph()");
    expect(glyphs).toContain("export function StillsGlyph()");
    expect(glyphs).toContain('data-glyph="video"');
    expect(glyphs).toContain('data-glyph="stills"');
    expect(glyphs).toContain('"aria-hidden": true');
  });

  test("used in the strip, the phone line, the breakdown heading and the phone sheet", () => {
    const count = (re: RegExp) => (stats.match(re) ?? []).length;
    expect(count(/<VideoGlyph \/>/g)).toBeGreaterThanOrEqual(4);
    expect(count(/<StillsGlyph \/>/g)).toBeGreaterThanOrEqual(4);
  });

  test("the region chart's key keeps its colour squares (they key the bar colours)", () => {
    expect(stats).toContain('<span className="cs-chip v" aria-hidden="true" />');
    expect(stats).toContain('<span className="cs-chip s" aria-hidden="true" />');
  });
});
