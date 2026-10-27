import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PANEL_REGISTRY } from "@/lib/shell/panelRegistry";
import { BUILTIN_VARIANTS } from "@/lib/variants/builtins";

// docs/superpowers/specs/2026-06-28-ground-truth-console-redesign-design.md:112-115 retired
// IntelColumn/TopEventsPanel/InstabilityPanel/RiskPanel/ConflictPanel in favour of the
// anomaly-ranked feed (lib/console/anomaly/anomaly.ts). The design doc said "replaced";
// the files themselves were never deleted. This pins that they are gone for good —
// unlike VariantSwitcher.tsx, which a DIFFERENT spec (2026-07-10-navbar-opendata-
// overhaul-design.md:39) explicitly says to keep unmounted, never delete.
const RETIRED_PANEL_KEYS = ["instability", "conflict", "topEvents", "risk"] as const;
const RETIRED_COMPONENT_FILES = [
  "components/shell/InstabilityPanel.tsx",
  "components/shell/ConflictPanel.tsx",
  "components/shell/TopEventsPanel.tsx",
  "components/shell/RiskPanel.tsx",
];

describe("retired console-redesign panels stay gone", () => {
  it("the four retired panel component files do not exist", () => {
    const repoRoot = join(__dirname, "..", "..");
    for (const f of RETIRED_COMPONENT_FILES) {
      expect(existsSync(join(repoRoot, f)), `${f} should have been deleted`).toBe(false);
    }
  });

  it("PANEL_REGISTRY no longer has entries for the retired keys", () => {
    for (const key of RETIRED_PANEL_KEYS) {
      expect((PANEL_REGISTRY as Record<string, unknown>)[key]).toBeUndefined();
    }
  });

  it("no built-in variant docks a retired panel", () => {
    for (const v of BUILTIN_VARIANTS) {
      for (const p of v.panels) {
        expect(RETIRED_PANEL_KEYS, `variant "${v.id}" still docks "${p.panel}"`).not.toContain(p.panel);
      }
    }
  });
});
