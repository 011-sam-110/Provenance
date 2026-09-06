import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  browserAndEdgeHeaders,
  edgeCacheControl,
  edgeCacheHeaders,
  frameCacheHeaders,
  toSeconds,
  MIN_TTL_SECONDS,
} from "@/lib/http/cache";

describe("toSeconds", () => {
  it("floors milliseconds to whole seconds", () => {
    expect(toSeconds(60_000)).toBe(60);
    expect(toSeconds(1_999)).toBe(1);
    expect(toSeconds(240_000)).toBe(240);
  });

  it("never returns less than the floor, however small the input", () => {
    expect(toSeconds(0)).toBe(MIN_TTL_SECONDS);
    expect(toSeconds(-5)).toBe(MIN_TTL_SECONDS);
    expect(toSeconds(10)).toBe(MIN_TTL_SECONDS);
  });

  it("treats non-finite input as the floor rather than emitting NaN into a header", () => {
    expect(toSeconds(Number.NaN)).toBe(MIN_TTL_SECONDS);
    expect(toSeconds(Number.POSITIVE_INFINITY)).toBe(MIN_TTL_SECONDS);
  });
});

describe("edgeCacheControl", () => {
  it("emits a shared-cache directive at the interval it was given", () => {
    expect(edgeCacheControl(60_000)).toBe(
      "public, s-maxage=60, stale-while-revalidate=60",
    );
  });

  it("defaults the stale window to the TTL, so the worst case is two intervals old", () => {
    expect(edgeCacheControl(30_000)).toBe(
      "public, s-maxage=30, stale-while-revalidate=30",
    );
  });

  it("accepts an explicit stale window", () => {
    expect(edgeCacheControl(20_000, 60_000)).toBe(
      "public, s-maxage=20, stale-while-revalidate=60",
    );
  });

  it("uses s-maxage, not max-age, so a browser tab still revalidates", () => {
    const header = edgeCacheControl(60_000);
    expect(header).toContain("s-maxage=");
    expect(header).not.toMatch(/(^|[^-])max-age=/);
  });

  it("never emits a zero or negative TTL", () => {
    expect(edgeCacheControl(0)).toBe(
      `public, s-maxage=${MIN_TTL_SECONDS}, stale-while-revalidate=${MIN_TTL_SECONDS}`,
    );
  });
});

/**
 * MEASURED DEFECT, 2026-09-06. Every read route already asked the CDN to cache, and
 * the CDN never did. Against production:
 *
 *   /api/proxy   code sends `public, max-age=300, s-maxage=300`
 *                wire returns `public, max-age=300`          <- s-maxage gone
 *   /api/signals code sends `public, s-maxage=60, stale-while-revalidate=60`
 *                wire returns `public`                       <- both gone
 *
 * `max-age` survives and the SHARED-cache directives do not, on all five routes
 * checked, every one of them `dynamic = "force-dynamic"`. So `X-Vercel-Cache: MISS`
 * on 100% of requests and every poll from every open tab was a cold invocation.
 *
 * The fix does not depend on pinning which layer strips them: `Vercel-CDN-Cache-Control`
 * is read by the Vercel CDN directly and is not rewritten, so the TTL sent under that
 * name arrives. These tests exist so the pair can never drift apart again.
 */
describe("edgeCacheHeaders", () => {
  it("sends the SAME policy twice — once for any CDN, once under the name Vercel reads", () => {
    const headers = edgeCacheHeaders(60_000);
    expect(headers["Cache-Control"]).toBe("public, s-maxage=60, stale-while-revalidate=60");
    expect(headers["Vercel-CDN-Cache-Control"]).toBe(headers["Cache-Control"]);
  });

  it("carries an explicit stale window into both headers", () => {
    const headers = edgeCacheHeaders(20_000, 60_000);
    expect(headers["Vercel-CDN-Cache-Control"]).toBe(
      "public, s-maxage=20, stale-while-revalidate=60",
    );
  });

  it("never invents a TTL — it is edgeCacheControl's value, unchanged", () => {
    for (const ttl of [1_000, 20_000, 300_000, 86_400_000]) {
      expect(edgeCacheHeaders(ttl)["Vercel-CDN-Cache-Control"]).toBe(edgeCacheControl(ttl));
    }
  });
});

describe("frameCacheHeaders", () => {
  it("keeps the browser max-age a camera frame needs AND reaches the CDN", () => {
    const headers = frameCacheHeaders(300);
    expect(headers["Cache-Control"]).toBe("public, max-age=300, s-maxage=300");
    expect(headers["Vercel-CDN-Cache-Control"]).toBe("public, s-maxage=300");
  });

  it("floors a zero or fractional cadence rather than emitting max-age=0", () => {
    expect(frameCacheHeaders(0)["Cache-Control"]).toBe(
      `public, max-age=${MIN_TTL_SECONDS}, s-maxage=${MIN_TTL_SECONDS}`,
    );
    expect(frameCacheHeaders(2.7)["Cache-Control"]).toBe("public, max-age=2, s-maxage=2");
  });

  it("lets the CDN hold a rasterised card longer than the visitor's own tab", () => {
    const headers = browserAndEdgeHeaders(86_400, 604_800);
    expect(headers["Cache-Control"]).toBe("public, max-age=86400, s-maxage=604800");
    expect(headers["Vercel-CDN-Cache-Control"]).toBe("public, s-maxage=604800");
  });
});

describe("no route may hand-roll a shared-cache directive", () => {
  // Synchronous on purpose: this walks every .ts/.tsx under app/ and lib/, and the
  // promise-based version timed out at 5s when the full suite ran it under load —
  // a guard that fails only when the machine is busy is worse than no guard.
  it("keeps every s-maxage in the codebase behind lib/http/cache.ts", () => {
    function walk(dir: string): string[] {
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
      }
      return out;
    }

    const files = [...walk("app"), ...walk("lib")];
    const offenders: string[] = [];

    for (const file of files) {
      if (file.endsWith(join("lib", "http", "cache.ts"))) continue;
      // Strip comments — several files DISCUSS s-maxage, which is fine.
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      if (code.includes("s-maxage")) offenders.push(file);
    }

    // A route that writes its own s-maxage writes it into the ONE header production
    // strips, which is exactly how this defect shipped and stayed invisible.
    expect(offenders).toEqual([]);
  });
});
