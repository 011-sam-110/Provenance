import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// WHERE THE DISCORD INVITATION IS MOUNTED, AND WHERE IT IS NOT.
//
// The note lived only in the console until 2026-09-14. That day 212 of 213 visitors from
// a Reddit post landed on `/` and only 83 opened /app, so most people never met it. It is
// now mounted on the landing page too, with the SAME persisted state, so a person who
// answered on one surface is not asked again on the other.
//
// There is no React testing library here, so these are source guards. Each one names the
// mistake it exists to catch.

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const LANDING = read("app/(site)/page.tsx");
const CONSOLE = read("components/shell/ConsoleShell.tsx");
const NOTE = read("components/shell/CommunityNote.tsx");
const PV_CSS = read("app/provenance.css");

function filesUnder(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    const p = join(dir, name);
    return statSync(join(ROOT, p)).isDirectory() ? filesUnder(p) : [p];
  });
}

describe("the landing page mounts the invitation", () => {
  test("page.tsx imports the note and renders it as the landing surface", () => {
    expect(LANDING).toContain('import CommunityNote from "@/components/shell/CommunityNote";');
    expect(LANDING).toContain('<CommunityNote surface="landing" />');
  });

  test("page.tsx stays a server component; the note is the client leaf", () => {
    expect(LANDING.trimStart().startsWith('"use client"')).toBe(false);
    expect(NOTE.trimStart().startsWith('"use client"')).toBe(true);
  });
});

describe("the console mount is unchanged", () => {
  test("ConsoleShell renders the note with no surface prop, so it keeps the console default", () => {
    expect(CONSOLE).toContain("<CommunityNote />");
    expect(CONSOLE).not.toMatch(/<CommunityNote\s+surface=/);
  });

  test("the note defaults to the console surface", () => {
    expect(NOTE).toMatch(/surface\s*=\s*"console"/);
  });
});

describe("the landing page is the ONLY new surface", () => {
  test("the site layout does not mount it, or /privacy would get it too", () => {
    expect(read("app/(site)/layout.tsx")).not.toContain("CommunityNote");
  });

  test("/privacy, the camera pages and the camera directory do not mount it", () => {
    const files = [
      ...filesUnder("app/(site)/privacy"),
      ...filesUnder("app/camera"),
      ...filesUnder("app/cameras"),
    ].filter((f) => /\.(tsx?|jsx?)$/.test(f));
    for (const f of files) expect(read(f), f).not.toContain("CommunityNote");
  });
});

describe("the landing styles", () => {
  // `.tn-note` takes its type sizes from `--tnx-fs-*`, which exist only under `.tn-terminal`.
  // On the landing page those resolve to nothing, and the card is drawn with the console's
  // LIGHT `:root` colours on a night page. The landing needs its own scoped rules.
  const landingRules = PV_CSS.split("}")
    .filter((block) => block.includes(".pv-root .tn-note"))
    .join("}");

  test("provenance.css scopes a night version of the card under .pv-root", () => {
    expect(PV_CSS).toContain(".pv-root .tn-note {");
    expect(landingRules).toContain("var(--pv-");
  });

  test("the landing rules do not lean on console-only tokens", () => {
    expect(landingRules).not.toContain("--tnx-");
  });
});
