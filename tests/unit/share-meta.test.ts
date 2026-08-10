/**
 * Pure share-metadata derivation — the titles/cards that make a pasted deep link
 * unfurl into something worth clicking. Node-testable (no DOM, no request).
 */

import { describe, test, expect } from "vitest";
import { viewToShareMeta } from "@/lib/share/shareMeta";
import { BRAND } from "@/lib/brand";
import { BUILTIN_BY_ID } from "@/lib/variants/builtins";

describe("viewToShareMeta", () => {
  test("bare view → brand default title + description", () => {
    const m = viewToShareMeta({});
    expect(m.title).toBe(`${BRAND.name} · ${BRAND.tagline}`);
    expect(m.description).toBe(BRAND.description);
  });

  test("always yields a non-empty OG query carrying a title + colour", () => {
    const q = new URLSearchParams(viewToShareMeta({}).ogQuery);
    expect(q.get("t")).toBeTruthy();
    expect(q.get("c")).toMatch(/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/);
  });

  test("a recognized board leads with its headline and trails the brand", () => {
    const m = viewToShareMeta({ v: "aviation" });
    expect(m.title).toBe(`Live flight tracking · ${BRAND.name}`);
    // accent tracks the variant, not the brand default
    expect(m.accent).toBe(BUILTIN_BY_ID.aviation.accent);
    const q = new URLSearchParams(m.ogQuery);
    expect(q.get("t")).toBe("Live flight tracking");
    expect(q.get("s")).toBe("Aviation board");
  });

  test("every built-in variant produces a headline (no blank cards)", () => {
    for (const id of Object.keys(BUILTIN_BY_ID)) {
      const m = viewToShareMeta({ v: id });
      const t = new URLSearchParams(m.ogQuery).get("t") ?? "";
      expect(t.length).toBeGreaterThan(3);
      expect(m.title).toContain(BRAND.name);
    }
  });

  test("unknown variant id falls back to the brand default", () => {
    const m = viewToShareMeta({ v: "does-not-exist" });
    expect(m.title).toBe(`${BRAND.name} · ${BRAND.tagline}`);
    expect(m.accent).toBe(BRAND.accent);
  });

  test("OG colour is always a bare hex (no leading #, valid digits)", () => {
    const c = new URLSearchParams(viewToShareMeta({ v: "hazards" }).ogQuery).get("c");
    expect(c).toBe(BUILTIN_BY_ID.hazards.accent.replace("#", ""));
  });
});
