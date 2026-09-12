import { describe, expect, it, afterEach } from "vitest";
import robots from "@/app/robots";

/**
 * `app/robots.ts` had no test. It is a build-time file whose failure modes are all
 * silent — a preview that deindexes production, or a crawl block that quietly stops
 * applying because a rule moved — so the rules worth stating are pinned here.
 *
 * NOTE ON SCOPE: production's `/robots.txt` is this file's output PLUS a managed block
 * Cloudflare injects above it (Amazonbot, Bytespider, CCBot, ClaudeBot, GPTBot,
 * Google-Extended, meta-externalagent, and the Content-Signal header). None of that is
 * in this repo and none of it is asserted here — read the live file to check it.
 */

const ENV_KEYS = ["SITE_ENV", "VERCEL_ENV"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function productionRules() {
  delete process.env.SITE_ENV;
  delete process.env.VERCEL_ENV;
  const r = robots();
  return Array.isArray(r.rules) ? r.rules : [r.rules];
}

function ruleFor(agent: string) {
  return productionRules().find((rule) => rule?.userAgent === agent);
}

describe("robots.txt", () => {
  it("blocks the two crawlers that outspent every search engine combined", () => {
    // Measured over the 3.5 days of Caddy log held on 2026-09-11: meta-webindexer
    // 36,525 requests, SemrushBot 15,211, against Googlebot's 67. Neither sends a
    // visitor. If either line is removed, the box pays for that again.
    expect(ruleFor("meta-webindexer")?.disallow).toBe("/");
    expect(ruleFor("SemrushBot")?.disallow).toBe("/");
  });

  it("does not confuse meta-webindexer with meta-externalagent", () => {
    // Different tokens for different crawlers. meta-externalagent is blocked by
    // Cloudflare's managed list, which says nothing about the indexer, and a rule
    // written against the wrong name looks identical in a diff.
    expect(ruleFor("meta-externalagent")).toBeUndefined();
    expect(ruleFor("meta-webindexer")).toBeDefined();
  });

  it("still lets everything else in, and still points at the sitemap", () => {
    const all = ruleFor("*");
    expect(all?.allow).toContain("/");
    const r = robots();
    expect(r.sitemap).toMatch(/\/sitemap\.xml$/);
  });

  it("keeps /api/og crawlable so social cards render", () => {
    // Google resolves competing rules by LONGEST MATCH, so this allow must survive
    // beside the `/api/` disallow or every shared link loses its preview image.
    const all = ruleFor("*");
    expect(all?.allow).toContain("/api/og");
    expect(all?.disallow).toContain("/api/");
  });

  it("keeps the third-party camera frames out of the index", () => {
    // Not crawl budget: these re-serve imagery whose redistribution rights we have
    // not established. See the comment in app/robots.ts.
    const all = ruleFor("*");
    expect(all?.disallow).toContain("/api/proxy");
    expect(all?.disallow).toContain("/api/hls");
    expect(all?.disallow).toContain("/api/webcam-image");
  });

  it("refuses everything on a non-production build", () => {
    process.env.SITE_ENV = "preview";
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    expect(rules).toHaveLength(1);
    expect(rules[0]?.userAgent).toBe("*");
    expect(rules[0]?.disallow).toBe("/");
    // The crawler blocks are irrelevant here precisely because everything is blocked.
    expect(rules[0]?.allow).toBeUndefined();
  });

  it("defaults to allow when neither environment variable is set", () => {
    // Deliberate: one missing variable must not silently deindex production. A
    // preview has to opt IN to being blocked, at build time.
    expect(ruleFor("*")?.allow).toContain("/");
  });
});
