import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { CATALOG } from "@/lib/i18n/catalog";

// Hallazgo #26 (bitacora.md, 2026-09-09): the switcher offers Español/Français but the
// catalog only covers ~20 chrome strings — widgets, layers, dossiers stay English. The
// honest fix is not translating everything; it's the switcher saying what it covers.
describe("language selector states what it covers", () => {
  test("catalog carries a non-empty scope note in every language", () => {
    for (const lang of Object.keys(CATALOG) as Array<keyof typeof CATALOG>) {
      expect(CATALOG[lang].langScopeNote.length).toBeGreaterThan(10);
    }
  });

  test("every surface offering the language switch renders the single-source note (no hand-typed copy)", () => {
    const files = [
      "components/shell/LangSwitcher.tsx",
      "components/shell/settings/DisplayTab.tsx",
    ];
    for (const f of files) {
      expect(readFileSync(f, "utf8")).toMatch(/langScopeNote/);
    }
  });
});
