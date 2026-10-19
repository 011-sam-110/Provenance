import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SIGNAL_COMPOSITE_SOURCES } from "@/lib/signals/sourceLink";

describe("instability attribution: no component hand-types a stale source list", () => {
  test("SIGNAL_COMPOSITE_SOURCES.instability (the single source of truth) does not name ACLED", () => {
    // ACLED was removed from the Country Instability Index on 2026-09-05 (lib/signals/instability.ts
    // header). Guards against this table itself regressing.
    expect(SIGNAL_COMPOSITE_SOURCES.instability.map((s) => s.label)).not.toContain("ACLED");
  });

  test("no .tsx/.ts under components/ or app/ names ACLED as a live source outside a comment", () => {
    // InstabilityPanel.tsx kept a hand-typed footer — "ACLED · WFP · UNHCR · IODA" — that drifted
    // twice: once when the index's conflict factor dropped that source, again when the index was
    // rebuilt around UCDP/INFORM/FEWS NET/World Bank WGI. It never read SIGNAL_COMPOSITE_SOURCES, the
    // table the dossier's own "contributing sources" list already uses, so neither rebuild touched it.
    // Code comments legitimately still name that source as history (ConflictPanel.tsx, env var names),
    // so those are stripped before the check — this looks for the word surviving as rendered text/code.
    const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const offenders = ["components", "app"].flatMap((dir) =>
      (readdirSync(dir, { recursive: true }) as string[])
        .filter((f) => /\.tsx?$/.test(f))
        .map((f) => join(dir, f))
        .filter((f) => /\bACLED\b/.test(stripComments(readFileSync(f, "utf8")))),
    );
    expect(offenders).toEqual([]);
  });
});
