import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { legacyRedirect, LEGACY_HOSTS, CANONICAL_HOST } from "@/lib/brand.legacy";

/**
 * The redirect that moves the old Vercel host's search ranking onto the new domain.
 *
 * Measured on 2026-09-07 over the project's whole life: google.com sent 1,551 visitors
 * and the Android search app another 386, against Reddit's 956 + 239. Search was the
 * largest referred channel and every one of those results named the Vercel host. This
 * file is what keeps those links arriving somewhere.
 */
describe("the legacy-host redirect", () => {
  it("moves the old production host, keeping path and query", () => {
    expect(legacyRedirect("provenance-online.vercel.app", "/app?v=osint")).toBe(
      "https://provenance-online.com/app?v=osint",
    );
    expect(legacyRedirect("provenance-online.vercel.app", "/")).toBe("https://provenance-online.com/");
    // Camera deep links are the long tail search actually indexed.
    expect(legacyRedirect("provenance-online.vercel.app", "/camera/tfl:JamCams_00002.00865")).toBe(
      "https://provenance-online.com/camera/tfl:JamCams_00002.00865",
    );
  });

  it("ignores a port on the Host header", () => {
    expect(legacyRedirect("provenance-online.vercel.app:443", "/")).toBe("https://provenance-online.com/");
  });

  it("is case-insensitive, because a Host header need not be lower-case", () => {
    expect(legacyRedirect("Provenance-Online.Vercel.App", "/")).toBe("https://provenance-online.com/");
  });

  it("LEAVES PREVIEW DEPLOYMENTS ALONE — the whole reason this is an exact match", () => {
    // Vercel gives every preview its own *.vercel.app host. A suffix test would bounce
    // each one to production and destroy the review surface entirely.
    for (const h of [
      "traffic-nerd-v2-git-feat-something-011-sam-110s-projects.vercel.app",
      "traffic-nerd-v2-abc123.vercel.app",
      "some-other-project.vercel.app",
      "vercel.app",
    ]) {
      expect(legacyRedirect(h, "/")).toBeNull();
    }
  });

  it("leaves the canonical host and the box alone, so it cannot loop", () => {
    // If this ever returned a URL for the canonical host the site would redirect to
    // itself forever, and the box serves exactly this host.
    expect(legacyRedirect(CANONICAL_HOST, "/")).toBeNull();
    expect(legacyRedirect("www.provenance-online.com", "/")).toBeNull();
    expect(legacyRedirect("127.0.0.1:3000", "/")).toBeNull();
    expect(legacyRedirect(null, "/")).toBeNull();
  });

  it("never lists the canonical host as legacy, which would be an instant loop", () => {
    expect(LEGACY_HOSTS).not.toContain(CANONICAL_HOST);
  });

  it("runs BEFORE the maintenance gate in middleware, or it never fires", () => {
    // next.config's redirects() would be cheaper, but middleware runs first: with the
    // curtain armed on the old project, a routing-layer rule would never be reached and
    // the old host would sit on 503 until search engines dropped it.
    const src = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
    const redirectAt = src.indexOf("legacyRedirect(");
    const gateAt = src.indexOf("isMaintenanceArmed()");
    expect(redirectAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(-1);
    expect(redirectAt).toBeLessThan(gateAt);
  });
});
