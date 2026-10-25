import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

// The God's eye view shows public road cameras, vessels and aircraft, each with its
// source. It is a view of open data, and no word in it may say otherwise: not in the
// copy, not in a label, not in a comment someone later turns into copy. This scans
// every file of the view, the page, its routes and its record script.

const ROOT = resolve(__dirname, "../..");
const PLACES = ["components/eye", "lib/eye", "app/(console)/eye", "app/api/eye", "scripts/eye-record.mjs"];

const BANNED: [RegExp, string][] = [
  [/\bspy(ing)?\b/i, "spy"],
  [/surveil/i, "surveillance"],
  [/\bcctv\b/i, "CCTV"],
  [/government[- ]grade/i, "government-grade"],
  [/\bsecret/i, "secret"],
  [/\bhack(ed|ing)?\b/i, "hacked"],
  // Only true of Google's photoreal tiles, which this view does not load.
  [/photo-?real/i, "photorealistic"],
];

function files(path: string): string[] {
  const abs = join(ROOT, path);
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? files(join(path, d.name)) : [join(abs, d.name)],
  );
}

describe("the God's eye view's words", () => {
  const all = PLACES.flatMap(files);

  it("scans the view's own files", () => {
    expect(all.length).toBeGreaterThan(15);
  });

  it("never say spy, surveillance, CCTV, government-grade, secret, hacked or photorealistic", () => {
    const hits: string[] = [];
    for (const f of all) {
      const lines = readFileSync(f, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        for (const [re, word] of BANNED) if (re.test(line)) hits.push(`${f.slice(ROOT.length + 1)}:${i + 1} ${word}: ${line.trim()}`);
      });
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("say Live in one file only, the one that names a playing stream", () => {
    // Comments may explain the rule; only code can put the word on screen.
    const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const sayLive = all
      .filter((f) => /["'`]Live["'`]/.test(code(readFileSync(f, "utf8"))))
      .map((f) => f.slice(ROOT.length + 1).split(sep).join("/"));
    expect(sayLive).toEqual(["lib/eye/cameras.ts"]);
  });
});
