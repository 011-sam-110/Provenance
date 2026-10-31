import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * /eye loads the Sources tray in the browser, and the tray is built from the console's row
 * and section components. Those modules must not pull the console's widget registry, its
 * placement picker, its catalogue or the signal registry along: that is hundreds of KB of
 * widgets the God's eye view never draws. The rows are built on the server
 * (lib/eye/sourceRows.ts) and passed down as plain data. Nothing else notices a stray
 * import: the build is green and the page just gets heavier.
 */

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/** Only `import` and `from` lines, comments stripped, with `import type` left out: a type costs nothing. */
function imports(p: string): string[] {
  const src = read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const out: string[] = [];
  for (const m of src.matchAll(/import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g)) {
    if (m[1]) continue;
    out.push(m[2] ?? m[3]);
  }
  return out;
}

const BROWSER_FILES = [
  "components/eye/EyeSources.tsx",
  "components/shell/sources/SourceRowView.tsx",
  "components/shell/sources/SourceSection.tsx",
  "components/eye/EyeSearch.tsx",
  "components/eye/EyeCompass.tsx",
  "components/eye/EyeFilmFrame.tsx",
  "components/eye/HudIcons.tsx",
  "components/eye/hudHooks.ts",
  "lib/eye/sources.ts",
  "lib/eye/search.ts",
  "lib/eye/compass.ts",
  "lib/eye/skin.ts",
];

const BANNED = [
  "@/lib/console/widgets",
  "@/lib/console/registry",
  "@/lib/console/placement",
  "@/lib/console/sourceWidgets",
  "@/lib/sources/catalog",
  "@/lib/console/sources/railSources",
  "@/lib/console/sources/sections",
  "@/lib/signals/registry",
  "@/lib/sources/useStatus",
  "components/shell/sources/SourceRow",
];

describe("what the Sources tray loads in the browser", () => {
  for (const file of BROWSER_FILES) {
    it(`${file} imports no catalogue, registry, widget or placement module`, () => {
      const found = imports(file);
      for (const banned of BANNED) {
        expect(
          found.filter((i) => i === banned || i.endsWith(`/${banned.split("/").pop()}`) && banned.startsWith("components")),
          `${file} imports ${banned}`,
        ).toEqual([]);
        expect(found).not.toContain(banned);
      }
    });
  }

  it("never reaches for the console's row wrapper (SourceRow) by name", () => {
    for (const file of BROWSER_FILES) {
      expect(read(file), file).not.toMatch(/sources\/SourceRow["']/);
    }
  });

  it("takes the section type from the console and nothing else of it", () => {
    const src = read("lib/eye/sources.ts");
    expect(src).toMatch(/import type \{[^}]*SourceSectionModel[^}]*\} from "@\/lib\/console\/sources\/sections"/);
  });

  it("the console's row wrapper is the one that holds the widget registry, as before", () => {
    const wrapper = imports("components/shell/sources/SourceRow.tsx");
    expect(wrapper).toContain("@/lib/console/widgets");
    expect(wrapper).toContain("@/lib/console/placement");
    // ...and it reaches the drawing through the shared view.
    expect(wrapper).toContain("@/components/shell/sources/SourceRowView");
  });

  it("the page builds the rows on the server and hands them down as data", () => {
    const page = read("app/(console)/eye/page.tsx");
    expect(page).toContain("eyeSourceRows()");
    expect(page).not.toContain('"use client"');
    for (const file of ["components/eye/EyeApp.tsx", "components/eye/EyeHud.tsx", "components/eye/EyeOverlay.tsx"]) {
      expect(imports(file), file).not.toContain("@/lib/eye/sourceRows");
    }
  });
});
