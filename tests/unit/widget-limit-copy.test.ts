import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MAX_WIDGETS, WIDGET_LIMIT_MESSAGE } from "@/lib/console/types";

/**
 * The widget-cap toast said "50-widget limit" in FOUR call sites while MAX_WIDGETS
 * was already 200, so anyone who hit the cap was told a number four times too small.
 * The copy is now derived from the constant. This guard exists so the next person to
 * change the cap cannot leave a stale number behind in a string literal.
 */
const ROOTS = ["lib", "components", "app"];
const SKIP = new Set(["node_modules", ".next", "__snapshots__"]);
const SEP = String.fromCharCode(92); // avoids a literal backslash in this file
const norm = (p: string) => p.split(SEP).join("/");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

describe("widget-limit copy", () => {
  it("states the real cap", () => {
    expect(WIDGET_LIMIT_MESSAGE).toContain(String(MAX_WIDGETS));
  });

  it("is not hardcoded with a stale number anywhere in the app", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const src = readFileSync(file, "utf8");
        for (const line of src.split("\n")) {
          // A literal "<n>-widget limit" in code. The definition's own explanatory
          // comment is allowed to quote the historical wrong number.
          const m = line.match(/(\d+)-widget limit/);
          if (!m) continue;
          if (norm(file).endsWith("lib/console/types.ts") && line.trimStart().startsWith("*")) continue;
          if (m[1] !== String(MAX_WIDGETS)) offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
