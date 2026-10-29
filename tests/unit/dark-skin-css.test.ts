import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SKIN_ATTR } from "@/lib/terminal/skin";

/**
 * Guards for the DARK SKIN block in app/globals.css, so it cannot rot.
 *
 * tests/unit/terminal-tokens.test.ts holds the dark palette to the light one's contrast
 * floors, and tests/unit/terminal-skin.test.ts holds the store. What neither can see is
 * the thing that made the OLD dark mode embarrassing: rules that paint a LITERAL light
 * colour (white text on an accent fill) which no token swap reaches. Those are found by
 * reading the stylesheet, so that is what this file does.
 */

const CSS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

const DARK_ROOT = `:root[${SKIN_ATTR}="dark"]`;

/** Every rule with declarations, with its selector list. A brace walk, because @media nests. */
function rules(): { selectors: string[]; decls: string[] }[] {
  const out: { selectors: string[]; decls: string[] }[] = [];
  const stack: { sel: string; decls: string[] }[] = [];
  let buf = "";
  for (const c of BARE) {
    if (c === "{") {
      stack.push({ sel: buf.trim(), decls: [] });
      buf = "";
    } else if (c === "}") {
      const top = stack.pop();
      if (top) {
        if (buf.trim()) top.decls.push(buf.trim());
        if (!top.sel.startsWith("@")) out.push({ selectors: splitSelectors(top.sel), decls: top.decls });
      }
      buf = "";
    } else if (c === ";") {
      if (stack.length) stack[stack.length - 1].decls.push(buf.trim());
      buf = "";
    } else {
      buf += c;
    }
  }
  return out;
}

/** Split a selector list on its top-level commas, whitespace collapsed. */
function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of list) {
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** The selectors inside the dark block's on-accent `:is( … ) { color: var(--tnx-on-accent) }`. */
function onAccentGroup(): Set<string> {
  const head = `${DARK_ROOT} .tn-terminal :is(`;
  const at = BARE.indexOf(head);
  expect(at, "the dark block's on-accent :is(…) group is missing").toBeGreaterThan(-1);
  let depth = 1;
  let i = at + head.length;
  const start = i;
  for (; i < BARE.length && depth > 0; i++) {
    if (BARE[i] === "(") depth++;
    if (BARE[i] === ")") depth--;
  }
  const inner = BARE.slice(start, i - 1);
  // The group must actually set the on-accent colour, or listing a selector in it proves nothing.
  expect(BARE.slice(i, i + 80)).toMatch(/^\s*\{\s*color:\s*var\(--tnx-on-accent\)/);
  return new Set(splitSelectors(inner));
}

const WHITE = /^color\s*:\s*(#fff|#ffffff|white)\s*(!important)?$/i;
// `var(--tn-accent, #0e7d97)` carries a fallback, so the closing paren is not guaranteed.
const ACCENT_FILL = /^(background|background-color)\s*:.*var\(--(tn-accent[\w-]*|tnx-accent|tn-live)\s*[,)]/i;

describe("the dark skin block", () => {
  it("puts every white-on-accent rule in the on-accent group", () => {
    // A literal #fff on a sage fill (#c9d1a6) is 2.29:1, and nothing about the token swap
    // changes a literal. A NEW rule that pairs white text with the accent fails here until
    // its selector is added to the :is(…) group in the dark block.
    const group = onAccentGroup();
    const offenders: string[] = [];
    for (const r of rules()) {
      if (!r.decls.some((d) => WHITE.test(d)) || !r.decls.some((d) => ACCENT_FILL.test(d))) continue;
      for (const sel of r.selectors) if (!group.has(sel)) offenders.push(sel);
    }
    expect(offenders, `white-on-accent rules missing from the dark block:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("finds the white-on-accent rules at all, so the guard above cannot go quiet", () => {
    // If the parser stopped matching, the test above would pass over an empty list.
    const found = rules().filter(
      (r) => r.decls.some((d) => WHITE.test(d)) && r.decls.some((d) => ACCENT_FILL.test(d)),
    );
    expect(found.length).toBeGreaterThanOrEqual(15);
  });

  it("is keyed on the attribute lib/terminal/skin.ts writes", () => {
    // The store and the stylesheet agree on the attribute by spelling only. Rename one
    // and the console stops going dark with nothing failing.
    expect(SKIN_ATTR).toBe("data-tnx-skin");
    expect(BARE).toContain(`\n${DARK_ROOT} .tn-terminal {`);
    expect(BARE).toContain(`${DARK_ROOT} { color-scheme: dark; }`);
  });

  it("asks neither the OS nor a theme: no prefers-color-scheme and no [data-theme in the stylesheet", () => {
    // 0 of each with comments stripped (the prose comments name both on purpose).
    // Light is the default for everyone and the choice is the person's, in this browser;
    // a [data-theme] rule would be reset by lib/variants/store.ts on every board switch.
    expect(BARE).not.toContain("prefers-color-scheme");
    expect(BARE).not.toContain("[data-theme");
  });

  it("defines --tnx-on-accent in the light block and redefines it in the dark one", () => {
    const light = /\n\.tn-terminal \{[\s\S]*?\n\}/.exec(BARE)?.[0] ?? "";
    expect(light, "light .tn-terminal block not found").toContain("--tnx-on-accent:");
    const at = BARE.indexOf(`\n${DARK_ROOT} .tn-terminal {`);
    const dark = BARE.slice(at, BARE.indexOf("\n}", at));
    expect(dark).toContain("--tnx-on-accent:");
    const pick = (b: string) => /--tnx-on-accent:\s*(#[0-9a-f]{6})/i.exec(b)?.[1]?.toLowerCase();
    expect(pick(light)).toBe("#ffffff");
    expect(pick(dark)).not.toBe(pick(light));
  });
});
