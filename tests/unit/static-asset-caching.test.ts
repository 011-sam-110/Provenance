import { describe, expect, it } from "vitest";
import { readdir } from "node:fs/promises";
import nextConfig from "../../next.config";

/**
 * Guards the `public/` cache policy added on 2026-09-06.
 *
 * MEASURED over one production day: 1,083,357 static-asset requests against 8,717
 * `/app` loads — 124 per load, 78% of all traffic to the site, because Vercel serves
 * `public/` with `max-age=0, must-revalidate` and every browser re-asks every time.
 * No bytes move on a 304, so this never looked like a bandwidth problem; it is a
 * request-count problem, and request count is what observability events are billed on.
 *
 * These tests exist because the failure is INVISIBLE from inside the app: a missing
 * rule costs nothing that a page-load timing or a test suite can see, it just quietly
 * turns every returning visitor back into a billed round trip per asset.
 */

async function headerRules() {
  const rules = await nextConfig.headers!();
  return rules.map((rule) => ({
    source: rule.source,
    cacheControl: rule.headers.find((h) => h.key === "Cache-Control")?.value ?? "",
  }));
}

/** Top-level entries of `public/`, which is what the rules have to cover. */
async function publicEntries() {
  return readdir("public", { withFileTypes: true });
}

describe("public/ cache policy", () => {
  it("gives every served directory a lifetime a browser will actually honour", async () => {
    const rules = await headerRules();
    const dirs = (await publicEntries()).filter((e) => e.isDirectory()).map((e) => e.name);

    for (const dir of dirs) {
      const rule = rules.find((r) => r.source.startsWith(`/${dir}/`));
      expect(rule, `public/${dir}/ has no Cache-Control rule in next.config.ts`).toBeDefined();

      const maxAge = Number(/max-age=(\d+)/.exec(rule!.cacheControl)?.[1] ?? 0);
      expect(maxAge, `public/${dir}/ is cached for ${maxAge}s — a browser re-asks every load`)
        .toBeGreaterThan(0);
    }
  });

  it("never pins a file it cannot later correct", async () => {
    // Nothing under public/ is content-hashed: /webcams/t/r01332311.json keeps its
    // name across a re-harvest. `immutable` on a stable filename is unrecallable.
    for (const rule of await headerRules()) {
      expect(rule.cacheControl, `${rule.source} is immutable but its URL is not versioned`)
        .not.toContain("immutable");
    }
  });

  it("leaves the service worker revalidating on every load", async () => {
    // A service worker the browser will not re-check cannot be updated, and this one
    // owns the offline shell (public/sw.js).
    for (const rule of await headerRules()) {
      expect(rule.source).not.toMatch(/^\/sw\.js/);
      expect(rule.source).not.toBe("/:path*");
      expect(rule.source).not.toBe("/(.*)");
    }
  });

  it("gives harvested data a shorter leash than branding", async () => {
    const rules = await headerRules();
    const ageOf = (prefix: string) =>
      Number(/max-age=(\d+)/.exec(rules.find((r) => r.source.startsWith(prefix))!.cacheControl)![1]);

    // A stale icon is cosmetic; a stale webcam tile is wrong data.
    expect(ageOf("/webcams/")).toBeLessThan(ageOf("/icons/"));
  });
});
