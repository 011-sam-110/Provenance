import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EYE_SKIN_ATTR, EYE_SKIN_SCRIPT } from "@/lib/eye/skin";
import { SKIN_ATTR, SKIN_PERSIST_KEY } from "@/lib/terminal/skin";

/**
 * The God's eye view is ALWAYS the console's dark mode, whatever the console is set to (Leon,
 * 29 Oct 2026). It is the console's own attribute on <html>, switched on before paint by /eye's
 * own layout. These pin the things that fail SILENTLY: a script that reads the console's saved
 * choice, a layout that goes dynamic, the skin store imported into the view, and a `.tn-terminal`
 * scope that brings the console's skin onto the view's own frame.
 */

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** <html>, and a localStorage that must never be asked. */
function run(script: string, stored: Record<string, string>) {
  const attrs = new Map<string, string>();
  const reads: string[] = [];
  const documentElement = { setAttribute: (k: string, v: string) => void attrs.set(k, v) };
  const localStorage = {
    getItem: (k: string) => {
      reads.push(k);
      return stored[k] ?? null;
    },
  };
  new Function("document", "localStorage", script)({ documentElement }, localStorage);
  return { attrs, reads };
}

describe("EYE_SKIN_SCRIPT", () => {
  it("names the console's own attribute (written out, pinned here to the console's constant)", () => {
    expect(EYE_SKIN_ATTR).toBe(SKIN_ATTR);
    expect(EYE_SKIN_SCRIPT).toContain(JSON.stringify(SKIN_ATTR));
  });

  it("sets dark with nothing saved", () => {
    expect(run(EYE_SKIN_SCRIPT, {}).attrs.get(SKIN_ATTR)).toBe("dark");
  });

  it("sets dark with a LIGHT choice saved, and never reads it", () => {
    const { attrs, reads } = run(EYE_SKIN_SCRIPT, { [SKIN_PERSIST_KEY]: JSON.stringify({ v: 1, d: "light" }) });
    expect(attrs.get(SKIN_ATTR)).toBe("dark");
    expect(reads).toEqual([]);
  });

  it("does not so much as mention the console's saved choice", () => {
    expect(EYE_SKIN_SCRIPT).not.toContain("tn.terminal.skin");
    expect(EYE_SKIN_SCRIPT).not.toContain(SKIN_PERSIST_KEY);
    expect(EYE_SKIN_SCRIPT).not.toMatch(/localStorage|setItem|removeItem/);
  });
});

describe("app/(console)/eye/layout.tsx", () => {
  const layout = "app/(console)/eye/layout.tsx";

  it("renders the script in a <script> before the children", () => {
    const src = code(layout);
    expect(src).toMatch(/<script\s+dangerouslySetInnerHTML=\{\{\s*__html:\s*EYE_SKIN_SCRIPT\s*\}\}\s*\/>/);
    expect(src.indexOf("<script")).toBeLessThan(src.indexOf("{children}"));
  });

  it("takes no searchParams, so the route stays static", () => {
    expect(code(layout)).not.toContain("searchParams");
  });
});

describe("the view never touches the console's skin", () => {
  function files(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...files(full));
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }
  const eyeFiles = [...files(resolve(ROOT, "components/eye")), ...files(resolve(ROOT, "app/(console)/eye")), ...files(resolve(ROOT, "lib/eye"))];

  it("imports no skin store, boot script or storage key", () => {
    for (const f of eyeFiles) {
      const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      for (const word of ["terminalSkinStore", "SKIN_BOOT_SCRIPT", "SKIN_PERSIST_KEY", "tn.terminal.skin", "applySkin", "@/lib/terminal/skin"]) {
        expect(src.includes(word), `${f} mentions ${word}`).toBe(false);
      }
    }
  });

  it("puts `tn-terminal` nowhere: the frame and the tray have the HUD's own look", () => {
    const hits: string[] = [];
    for (const f of eyeFiles) {
      const src = code(f.slice(ROOT.length + 1));
      if (/tn-terminal/.test(src)) hits.push(f.slice(ROOT.length + 1));
    }
    expect(hits).toEqual([]);
  });
});
