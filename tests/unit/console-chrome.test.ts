import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { RAIL_LEAVE_FALLBACK_MS, railPhase } from "@/lib/console/railPresence";

// Console chrome polish (Leon, 2026-10-30): quieter Video and Stills counts, the close
// mark inside a shaded tool strip, and a Sources pane that slides.
//
// vitest here is `environment: "node"`, so these are source pins on the things CSS and
// markup can quietly undo (a colour literal back in the strip, a `:has(> .tn-rail)` that
// forgets a leaving pane and makes the map resize at the END of the slide, a duration
// typed in milliseconds instead of read from the console's motion settings). What the
// pixels do is measured in a browser: tests/e2e/console-chrome.spec.ts.

const ROOT = resolve(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(resolve(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

const css = read("app", "globals.css");
const motion = read("app", "console-motion.css");
const catalog = read("components", "shell", "SourceCatalog.tsx");
const stats = read("components", "terminal", "CameraStats.tsx");

/** The body of the first rule whose selector is exactly `selector`. */
function ruleBody(source: string, selector: string): string {
  const at = source.indexOf(`${selector} {`);
  expect(at, `${selector} is in the sheet`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", at);
  return source.slice(open + 1, source.indexOf("}", open));
}

/** The bodies of EVERY rule whose selector is exactly `selector`, joined. */
function ruleBodies(source: string, selector: string): string {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(`\n${selector} {`, from);
    if (at < 0) break;
    const open = source.indexOf("{", at);
    out.push(source.slice(open + 1, source.indexOf("}", open)));
    from = open;
  }
  expect(out.length, `${selector} is in the sheet`).toBeGreaterThan(0);
  return out.join("\n");
}

describe("railPhase", () => {
  test("open wins, a mounted closed pane is leaving, nothing is closed", () => {
    expect(railPhase(true, true)).toBe("open");
    expect(railPhase(true, false)).toBe("open");
    expect(railPhase(false, true)).toBe("leaving");
    expect(railPhase(false, false)).toBe("closed");
  });

  test("the fallback outlasts the longest slide", () => {
    // 200 ms out, 300 ms in; a leave ends on transitionend and this is only the net.
    expect(RAIL_LEAVE_FALLBACK_MS).toBeGreaterThan(300);
  });
});

describe("the tool strip's shade", () => {
  test("is one token: 7% of the console ink mixed into the panel, no colour literal", () => {
    const panel = ruleBodies(css, ".tn-terminal .tn-cw-shell > .tn-rail");
    const token = panel.match(/--tn-rail-strip-bg:\s*([^;]+);/);
    expect(token, "the token is declared on the pane").not.toBeNull();
    expect(token![1]).toMatch(/^color-mix\(in srgb, var\(--tnx-ink\) 7%, var\(--tnx-panel\)\)$/);
    expect(token![1]).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  test("the toolbar and the close cell both read it, and the dark skin has no line of its own", () => {
    expect(css).toMatch(/\.tn-terminal \.tn-insp-rail \{\s*background: var\(--tn-rail-strip-bg\);/);
    expect(ruleBody(css, ".tn-terminal .tn-rail-close-cell")).toContain("background: var(--tn-rail-strip-bg)");
    expect(css).not.toContain('.tn-terminal .tn-insp-rail { background: rgba(236');
  });

  test("the strip's size tokens reach the close cell too", () => {
    expect(css).toMatch(/\.tn-insp-rail,\s*\.tn-rail-close-cell \{[^}]*--tn-insp-rail-w: 48px;/);
    expect(css).toMatch(/\.tn-insp-rail,\s*\.tn-rail-close-cell \{[^}]*--tn-insp-rail-w: 60px;/);
  });
});

describe("the close tile", () => {
  test("leaves the header for its own cell between the header and the panes, keeping its name", () => {
    const header = catalog.slice(catalog.indexOf('<div className="tn-rail-header">'), catalog.indexOf("THE CLOSE TILE IS THE TOP"));
    expect(header).not.toContain("tn-rail-collapse");
    const at = catalog.indexOf('<div className="tn-rail-close-cell">');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(catalog.indexOf('<div className="tn-rail-main">'));
    const cell = catalog.slice(at, catalog.indexOf('<div className="tn-rail-main">'));
    expect(cell).toContain('className="tn-rail-collapse tn-insp-rail-btn"');
    expect(cell).toContain('aria-label="Close sources"');
    expect(cell).toContain('title="Close sources"');
    expect(cell).toContain('<span className="tn-insp-rail-name" aria-hidden="true">Close</span>');
  });

  test("the pane is a grid: header and close cell on row one, the main row under both", () => {
    const panel = ruleBodies(css, ".tn-terminal .tn-cw-shell > .tn-rail");
    expect(panel).toContain("display: grid");
    expect(panel).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(panel).toContain("grid-template-rows: auto minmax(0, 1fr)");
    expect(ruleBody(css, ".tn-terminal .tn-rail-close-cell")).toMatch(/grid-column: 2;\s*grid-row: 1;/);
    expect(ruleBody(css, ".tn-terminal .tn-rail-main")).toMatch(/grid-column: 1 \/ -1;\s*grid-row: 2;/);
  });

  test("the old sheet grip is hidden in the terminal, because a grid would give it a cell", () => {
    expect(css).toMatch(/\.tn-terminal \.tn-cw-shell > \.tn-rail::before \{\s*display: none;/);
  });
});

describe("the map resizes at the click, not at the end of the slide", () => {
  test("every terminal :has(> .tn-rail) skips a pane that is leaving", () => {
    // The non-terminal shell (`.tn-cw-shell:has(> .tn-rail) { left: 324px }`) has no slide.
    const terminal = css.split("\n").filter((l) => l.includes(":has(> .tn-rail") && l.includes(".tn-terminal"));
    expect(terminal.length).toBeGreaterThanOrEqual(4);
    for (const line of terminal) expect(line, line).toContain(":has(> .tn-rail:not([data-leaving]))");
  });

  test("the component marks the pane leaving and makes it inert, and renders the tab at once", () => {
    expect(catalog).toContain('data-leaving={phase === "leaving" ? "" : undefined}');
    expect(catalog).toContain('inert={phase === "leaving"}');
    expect(catalog).toContain('phase !== "open"');
    expect(catalog).toContain("RAIL_LEAVE_FALLBACK_MS");
    expect(catalog).toContain("if (railOpen && !mounted) setMounted(true);");
  });
});

describe("the slide", () => {
  test("reads the console's motion settings, so reduced motion is handled in one place", () => {
    const at = motion.indexOf("THE SOURCES PANE SLIDES");
    expect(at, "the section is in console-motion.css").toBeGreaterThan(0);
    const section = motion.slice(at, motion.indexOf("THE COLLAPSE ARROW"));
    expect(section).toContain("--tn-mo-travel");
    expect(section).toContain("--tn-mo-slow");
    expect(section).toContain("--tn-mo-base");
    expect(section).toContain("@starting-style");
    // No duration typed as a bare number of milliseconds except the phone's own 260 ms
    // slide-up, which is scaled by --tn-mo.
    const bare = [...section.matchAll(/(?<![\w-])(\d+)ms/g)].map((m) => m[0]);
    expect(bare.every((v) => v === "260ms")).toBe(true);
    expect(section).toContain("calc(260ms * var(--tn-mo))");
  });
});

describe("the collapse arrow", () => {
  test("is a redrawn stroke mark that points where the pane goes: left on a desktop, down on a phone", () => {
    expect(catalog).not.toContain("CloseGlyph");
    const at = catalog.indexOf("function CollapseGlyph()");
    expect(at).toBeGreaterThan(0);
    const glyph = catalog.slice(at, catalog.indexOf("// Built once: the mapping is static"));
    // The strip's own rule (ToolIcons.tsx): currentColor, round caps and joins, 1.8.
    expect(glyph).toContain('stroke="currentColor"');
    expect(glyph).toContain("strokeWidth={1.8}");
    expect(glyph).toContain('strokeLinecap="round"');
    expect(glyph).toContain('strokeLinejoin="round"');
    expect(glyph).toContain("aria-hidden");
    expect(glyph).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // No size prop: the tile's tool-glyph token sizes it, like every other mark in the strip.
    expect(glyph).not.toMatch(/\b(width|height)=/);
    expect(glyph).toContain('className="tn-collapse-left"');
    expect(glyph).toContain('className="tn-collapse-down"');
    expect(glyph).toContain("rotate(-90 12 12)");
  });

  test("CSS shows the left arrow above 900px and the down arrow at and below it, at the tools' own size", () => {
    expect(ruleBody(css, ".tn-terminal .tn-rail-close-cell .tn-collapse-down")).toContain("display: none");
    expect(css).toMatch(
      /@media \(max-width: 900px\) \{[^@]*\.tn-terminal \.tn-rail-close-cell \.tn-collapse-left \{ display: none; \}\s*\.tn-terminal \.tn-rail-close-cell \.tn-collapse-down \{ display: inline; \}/,
    );
    // The arrow takes `.tn-insp-rail-btn svg`'s size; no size of its own.
    expect(css).not.toMatch(/\.tn-rail-close-cell \.tn-rail-collapse svg \{[^}]*(width|height)/);
  });

  test("nudges once on hover and keyboard focus, never loops, and travels only through the motion settings", () => {
    const at = motion.indexOf("THE COLLAPSE ARROW");
    expect(at, "the section is in console-motion.css").toBeGreaterThan(0);
    const section = motion.slice(at);
    expect(section).toContain("@keyframes tn-mo-nudge");
    expect(section).toContain(".tn-rail-collapse:is(:hover, :focus-visible) svg");
    expect(section).toContain("calc(var(--tn-nudge-x) * var(--tn-mo-travel))");
    expect(section).toContain("calc(var(--tn-nudge-y) * var(--tn-mo-travel))");
    expect(section).toContain("--tn-nudge-x: -4px;");
    expect(section).toContain("--tn-nudge-y: 4px;");
    expect(section).toMatch(/animation: tn-mo-nudge calc\(450ms \* var\(--tn-mo\)\) var\(--tn-mo-ease-io\) 1;/);
    expect(section).not.toContain("infinite");
    // Paint-only: nothing in the section may change a box.
    const keyframes = section.slice(section.indexOf("@keyframes tn-mo-nudge"), section.indexOf(".tn-terminal .tn-rail-close-cell"));
    expect(keyframes).toContain("translate:");
    expect(keyframes).not.toMatch(/\b(width|height|margin|padding|top|left)\s*:/);
  });
});

describe("the counts", () => {
  test("the strip's word is its own span, so CSS can hide it for VIDEO and STILLS", () => {
    expect(stats).toContain('<span className="cs-word">{id === "counted" && !stats ? "Counting" : SEGMENT_LABEL[id]}</span>');
  });

  test("VIDEO and STILLS: a 16px mark and a number on one line, the word hidden", () => {
    expect(ruleBody(css, ".tn-terminal .cs-seg.is-major .cs-word")).toContain("display: none");
    const major = ruleBody(css, ".tn-terminal .cs-seg.is-major");
    expect(major).toContain("flex-direction: row");
    expect(major).toContain("padding: 0 14px");
    const glyph = ruleBody(css, ".tn-terminal .cs-seg.is-major .cs-glyph");
    expect(glyph).toContain("width: 16px");
    expect(glyph).toContain("height: 16px");
    // The base glyph stays 14px: the breakdown, the phone line and the sheet use it.
    expect(ruleBody(css, ".tn-terminal .cs-glyph")).toContain("width: 14px");
  });

  test("every number in the strip is 14px / 700", () => {
    const num = ruleBody(css, ".tn-terminal .cs-num");
    expect(num).toContain("font-size: var(--tnx-fs-md)");
    expect(num).toContain("font-weight: 700");
    const minor = ruleBody(css, ".tn-terminal .cs-seg.is-minor .cs-num");
    expect(minor).not.toContain("font-size");
    expect(minor).not.toContain("font-weight");
  });

  test("the phone line is 700 with 12px between the pair", () => {
    expect(ruleBody(css, ".tn-terminal .cs-pline .cs-num")).toContain("font-weight: 700");
    expect(ruleBody(css, ".tn-terminal .cs-pline .cs-gap")).toContain("width: 12px");
  });
});
