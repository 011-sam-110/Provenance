import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fmtLat, fmtLon, fmtSpot } from "@/lib/eye/wording";

/**
 * God's eye view's title on a phone (eye-phone-title, 29 Oct 2026). A title that wraps, a
 * spot's coordinates or a camera's long name, ran under the ledger, which sat at a fixed
 * 80 px. The header and the ledger now stack in the frame's flow, and a spot's title breaks
 * only after its comma. tests/e2e/eye-phone-title.spec.ts measures the boxes in a browser.
 */

const NBSP = " ";
const CSS = readFileSync(resolve(__dirname, "../../components/eye/eye.module.css"), "utf8");

describe("fmtSpot", () => {
  it("holds each figure to its letter, so the comma is the only place to break", () => {
    expect(fmtSpot(51.5072, -0.1268)).toBe(`51.5072°${NBSP}N, 0.1268°${NBSP}W`);
    expect(fmtSpot(-33.8568, 151.2153)).toBe(`33.8568°${NBSP}S, 151.2153°${NBSP}E`);
    for (const [lat, lon] of [
      [51.5072, -0.1268],
      [-33.8568, 151.2153],
      [21.3069, -157.8583],
      [-84.9999, -179.9999],
    ]) {
      expect(fmtSpot(lat, lon).split(" ")).toHaveLength(2);
    }
  });

  it("says the same figures as the footer's readout", () => {
    expect(fmtSpot(51.50134, -0.12182).split(NBSP).join(" ")).toBe(`${fmtLat(51.50134)}, ${fmtLon(-0.12182)}`);
  });

  it("leaves the footer's own readout with a plain space", () => {
    expect(fmtLat(51.5072)).not.toContain(NBSP);
    expect(fmtLon(-0.1268)).not.toContain(NBSP);
  });
});

describe("the phone frame", () => {
  it("puts the ledger after the header, not at a fixed height", () => {
    expect(CSS).not.toMatch(/\.ledger\s*\{[^}]*\btop:\s*80px/);
    expect(CSS).not.toContain("calc(6.5% + 70px)");
    expect(CSS).toMatch(/\.hud\s*\{[^}]*flex-direction:\s*column/);
    expect(CSS).toMatch(/\.top\s*\{[^}]*position:\s*relative/);
    expect(CSS).toMatch(/\.ledger\s*\{[^}]*position:\s*relative/);
  });

  it("leaves no fixed offset on the ledger when the way out is drawn", () => {
    // The row of "Exit to main dashboard" lengthens the header, and the ledger follows it.
    expect(CSS).not.toMatch(/\[data-exit\]\s*\.ledger\s*\{[^}]*\btop:/);
  });
});
