import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  severityBand,
  severityColor,
  CRITICAL_AT,
  WARN_AT,
  type SeverityBand,
} from "@/lib/console/severityRamp";

// A working OSINT analyst reviewed the console and read it as "a visual panic
// attack". The measured cause was that --tnx-accent carried seven unrelated
// meanings at once — selection, focus, the clock, AND warn-severity — so a routine
// count looked exactly like a warning and a warning looked exactly like a checked
// button. These tests pin the separation, because it is the kind of thing that gets
// quietly re-merged by anyone reaching for "the orange one".

const CSS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

/** The body of a `{ … }` block whose selector line contains `needle`. */
function blockAfter(needle: string): string {
  const at = CSS.indexOf(needle);
  expect(at, `selector not found: ${needle}`).toBeGreaterThan(-1);
  const open = CSS.indexOf("{", at);
  const close = CSS.indexOf("\n}", open);
  return CSS.slice(open, close);
}

describe("severityBand — the cross-layer ramp", () => {
  it("is neutral at and below the rank floor, so a normal day is grey", () => {
    // rankAnomalies floors at 0.45, so this is the LOWEST value a widget can show.
    expect(severityBand(0.45)).toBe("none");
    expect(severityBand(0)).toBe("none");
    expect(severityBand(WARN_AT - 0.001)).toBe("none");
  });

  it("bands at the two published thresholds, inclusive", () => {
    expect(severityBand(WARN_AT)).toBe("warn");
    expect(severityBand(CRITICAL_AT - 0.001)).toBe("warn");
    expect(severityBand(CRITICAL_AT)).toBe("critical");
    expect(severityBand(1)).toBe("critical");
  });

  it("never goes backwards as severity rises", () => {
    const rank: Record<SeverityBand, number> = { none: 0, warn: 1, critical: 2 };
    let prev = -1;
    for (let s = 0; s <= 1.0001; s += 0.01) {
      const r = rank[severityBand(s)];
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  it("degrades a malformed severity to NOT urgent, never to critical", () => {
    // A monitoring tool that cries wolf on bad upstream data is worse than one
    // that stays quiet, so NaN must not land in the top band.
    expect(severityBand(Number.NaN)).toBe("none");
    expect(severityBand(Number.POSITIVE_INFINITY)).toBe("none");
    expect(severityBand(Number.NEGATIVE_INFINITY)).toBe("none");
  });

  it("returns a token reference, never a literal colour", () => {
    // The two skins are the single source of truth for the actual hexes; a hex
    // here would silently keep the dark value on the light skin.
    for (const s of [0, 0.5, 0.7, 0.9]) {
      expect(severityColor(s)).toMatch(/^var\(--tnx-alert-(none|warn|critical)\)$/);
    }
    expect(severityColor(0.95)).toBe("var(--tnx-alert-critical)");
  });
});

describe("real events land in the band their own community would call them", () => {
  // Each layer declares a metric domain; featureSeverity normalises onto 0..1 with
  // it. These are the mappings the thresholds were actually chosen against — if
  // someone retunes the ramp, this is what tells them what they just re-classified.
  const sev = (v: number, lo: number, hi: number) => (v - lo) / (hi - lo);

  it("earthquakes: domain [2,8] — M7+ critical, M6 warn, M5.5 routine", () => {
    expect(severityBand(sev(7.0, 2, 8))).toBe("critical");
    expect(severityBand(sev(6.0, 2, 8))).toBe("warn");
    expect(severityBand(sev(5.5, 2, 8))).toBe("none");
    expect(severityBand(sev(4.8, 2, 8))).toBe("none");
  });

  it("tropical cyclones: domain [34,160] kt — Cat 5 critical, Cat 3 warn", () => {
    expect(severityBand(sev(140, 34, 160))).toBe("critical"); // Cat 5
    expect(severityBand(sev(110, 34, 160))).toBe("warn"); // Cat 3
    expect(severityBand(sev(60, 34, 160))).toBe("none"); // tropical storm
  });

  it("GDACS: domain [0,3] — a red alert is critical, orange is warn", () => {
    expect(severityBand(sev(3, 0, 3))).toBe("critical");
    expect(severityBand(sev(2, 0, 3))).toBe("warn");
    expect(severityBand(sev(1, 0, 3))).toBe("none");
  });
});

describe("the alert ramp is not the accent (the whole point)", () => {
  // WAS "in BOTH skins". The dark skin is gone and its light values were folded into
  // `.tn-terminal`, so there is one block to check rather than two. The assertion is
  // unchanged in substance: all three alert tokens must exist, or a severity badge
  // falls back to whatever it happens to inherit.
  it("defines all three alert tokens", () => {
    const block = blockAfter("\n.tn-terminal {");
    for (const t of ["--tnx-alert-none", "--tnx-alert-warn", "--tnx-alert-critical"]) {
      expect(block, `the palette is missing ${t}`).toContain(`${t}:`);
    }
  });

  it("no severity rule reads var(--tnx-accent)", () => {
    // This is the regression that shipped: `.tn-sev-warn { background: var(--tnx-accent) }`.
    const offenders = CSS.split("\n").filter(
      (l) => /\.tn-sev-(warn|critical|info)\b/.test(l) && l.includes("var(--tnx-accent)"),
    );
    expect(offenders, `severity rules must not reuse the accent:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no alert token resolves to the same hex as its skin's accent", () => {
    // Pointing at a different token is not enough if the token holds the same
    // colour — that would pass the rule above and change nothing on screen.
    for (const [name, sel] of [["light", "\n.tn-terminal {"]] as const) {
      const block = blockAfter(sel);
      const accent = /--tnx-accent:\s*(#[0-9a-f]{3,8})/i.exec(block)?.[1]?.toLowerCase();
      expect(accent, `${name}: no --tnx-accent hex`).toBeTruthy();
      for (const t of ["none", "warn", "critical"]) {
        const hex = new RegExp(`--tnx-alert-${t}:\\s*(#[0-9a-f]{3,8})`, "i").exec(block)?.[1]?.toLowerCase();
        expect(hex, `${name}: no --tnx-alert-${t} hex`).toBeTruthy();
        expect(hex, `${name}: --tnx-alert-${t} is the accent`).not.toBe(accent);
      }
    }
  });

  it("every alert fill clears 4.5:1 against the text the badge prints on it", () => {
    // .tn-terminal .tn-cw-badge sets `color: var(--tnx-bg)`, so the FILL carries the
    // contrast. This used to run over both skins, because the light one shipped
    // unreadable counts the first time — dark ink on dark panels. One palette now,
    // same requirement.
    const ratio = (a: string, b: string) => {
      const lum = (h: string) => {
        const n = h.replace("#", "");
        const ch = [0, 2, 4].map((i) => {
          const c = parseInt(n.slice(i, i + 2), 16) / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
      };
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };

    for (const sel of ["\n.tn-terminal {"] as const) {
      const block = blockAfter(sel);
      const bg = /--tnx-bg:\s*(#[0-9a-f]{6})/i.exec(block)?.[1] as string;
      expect(bg).toBeTruthy();
      for (const t of ["none", "warn", "critical"]) {
        const hex = new RegExp(`--tnx-alert-${t}:\\s*(#[0-9a-f]{6})`, "i").exec(block)?.[1] as string;
        expect(ratio(hex, bg), `--tnx-alert-${t} (${hex}) on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
