import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// WHERE THE DISCORD INVITATION IS MOUNTED, AND WHERE IT IS NOT.
//
// It lived only in the console until 2026-09-14. That day 212 of 213 visitors from a Reddit
// post landed on `/` and only 83 opened /app, so most people never met it. It is now mounted
// on the landing page too, with the SAME persisted state, so a person who answered on one
// surface is not asked again on the other. God's eye view does not carry it, by request.
//
// There is no React testing library here, so these are source guards. Each one names the
// mistake it exists to catch.

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const LANDING = read("app/(site)/page.tsx");
const CONSOLE = read("components/shell/ConsoleShell.tsx");
const NOTE = read("components/shell/CommunityNote.tsx");
const EYE = read("components/eye/EyeApp.tsx");
const POPUP_CSS = read("app/community.css");

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

describe("God's eye view does not carry the invitation", () => {
  // Asked for on 2026-10-31: the pop-up belongs on the dashboard, not over this view.
  test("EyeApp neither imports it nor renders it", () => {
    expect(EYE).not.toContain("CommunityNote");
  });

  test("nor does anything else under components/eye or the /eye route", () => {
    const files = [...filesUnder("components/eye"), ...filesUnder("app/(console)/eye")].filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(read(f), f).not.toContain("CommunityNote");
  });
});

describe("the only other surfaces are the ones above", () => {
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

describe("the pop-up's styles", () => {
  // It renders in <body> so that no surface's sheet can restyle it. That only holds while it
  // leans on no surface's tokens: `--tnx-*` exist only under `.tn-terminal`, and `--pv-*`
  // only under `.pv-root`, so either one would draw nothing on the other two surfaces.
  test("it renders through a portal into the body", () => {
    expect(NOTE).toContain("createPortal(");
    expect(NOTE).toContain("document.body");
  });

  test("it reads no surface's own tokens", () => {
    expect(POPUP_CSS).not.toMatch(/var\(--(tnx|pv|lp|tn-(?!font-sans))/);
  });

  test("the old corner card's rules are gone from every sheet", () => {
    for (const sheet of ["app/globals.css", "app/provenance.css", "app/landing.css", "app/console-motion.css"]) {
      expect(read(sheet), sheet).not.toContain("tn-note");
    }
  });

  test("the product's one typeface sets it, and no second font loader is added", () => {
    expect(POPUP_CSS).toContain("var(--tn-font-sans)");
    expect(NOTE).not.toContain("next/font");
  });

  test("everything that moves stops under reduced motion", () => {
    const reduce = POPUP_CSS.slice(POPUP_CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const selector of [".tn-join-veil", ".tn-join-card", ".tn-join-strip", ".tn-join-flash", ".tn-join-ring", ".tn-join-cta::after"]) {
      expect(reduce, selector).toContain(selector);
    }
  });
});

describe("what the pop-up says", () => {
  // The brief, in the words that were asked for. The member count itself is held below.
  test("the link works again, the community is open, the devs are active, feedback is wanted", () => {
    expect(NOTE).toContain("The Discord link works again.");
    expect(NOTE).toContain("The community is open.");
    expect(NOTE).toContain("The devs are active.");
    expect(NOTE).toContain("We would love your feedback.");
  });

  test("no figure is typed: the count comes only from Discord's answer", () => {
    const code = NOTE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).toContain("<CountReel value={members} />");
    expect(code).not.toMatch(/\b(265|members:\s*\d)/);
  });

  test("a dead invite keeps it shut, so it never says the link works when it does not", () => {
    expect(NOTE).toContain('answer.state === "dead" && !FORCED');
  });
});
