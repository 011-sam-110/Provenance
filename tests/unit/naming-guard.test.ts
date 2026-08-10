import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// A competitor's product name must never ship inside our UI.
//
// "worldmonitor" is github.com/koala73/worldmonitor — a different product, under
// AGPL-3.0, whose README reserves branding rights. It had leaked into two
// user-visible places and nobody noticed for months: every CSV and GeoJSON a user
// downloaded was named `worldmonitor-*.csv`, and every Discord/Slack alert we
// dispatched announced its source as "World Monitor — Disasters & Events".
//
// Mentioning them in a CODE COMMENT is fine and often necessary (we cite their
// issue numbers as evidence). What is not fine is the string reaching a user.

const ROOTS = ["lib", "components", "app"];
const CODE = /\.(ts|tsx)$/;
const BANNED = /worldmonitor|world\s*monitor/i;

/**
 * Strip block comments and `//` line comments, leaving string literals intact.
 *
 * The naive `/\/\/.*$/` also eats the tail of any line containing a `//` inside a
 * string — including a URL path — which would silently hide a real leak. So a
 * `//` only starts a comment when the text before it has balanced quotes.
 */
function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlocks
    .split(/\r?\n/)
    .map((line) => {
      for (let i = 0; i < line.length - 1; i++) {
        if (line[i] !== "/" || line[i + 1] !== "/") continue;
        const before = line.slice(0, i);
        const balanced = ['"', "'", "`"].every((q) => (before.split(q).length - 1) % 2 === 0);
        if (balanced) return before;
      }
      return line;
    })
    .join("\n");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (CODE.test(name)) out.push(p);
  }
  return out;
}

describe("naming guard", () => {
  it("ships no competitor branding outside comments", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const code = stripComments(readFileSync(file, "utf8"));
        for (const [i, line] of code.split(/\r?\n/).entries()) {
          if (BANNED.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders, `competitor branding in shipped code:\n${offenders.join("\n")}`).toEqual([]);
  });
});
