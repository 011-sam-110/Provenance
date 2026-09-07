import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { BRAND } from "@/lib/brand";
import { GATE_EXEMPT_STARTS, isGatedPath, gateMatcher } from "@/lib/gate/paths";
import {
  GATE_COOKIE,
  GATE_QUERY,
  GATE_DENIED,
  gateToken,
  constantTimeEqual,
  safeNext,
  withDenied,
  gateCookieHeader,
} from "@/lib/gate/token";
import { maintenanceHtml, escapeHtml } from "@/lib/gate/page";
import { CAMERA_FEED_COUNT } from "@/lib/sources/registry";
import { SIGNALS, MAP_SIGNALS } from "@/lib/signals/registry";
import "@/lib/console/widgets";
import { listWidgetTypes } from "@/lib/console/registry";
import { BUILTIN_VARIANTS } from "@/lib/variants/builtins";

const ROOT = process.cwd();

describe("what the gate covers", () => {
  // The exemption list is a principle, not a taste: chrome and crawl signals pass,
  // pages, data and compute are gated. The whole reason the site goes down is cost,
  // and /api/* is where the cost is - 42 handlers, every upstream feed. An earlier
  // draft of this list exempted all of /api so the Telegram and Discord webhooks kept
  // working; that bought working bots and left the expensive half of the site running.
  it("gates the pages", () => {
    for (const p of ["/", "/app", "/locate", "/cameras", "/admin", "/admin/verify"]) {
      expect(isGatedPath(p), p).toBe(true);
    }
  });

  it("gates every API route except the unlock endpoint", () => {
    for (const p of ["/api/coverage", "/api/cameras", "/api/planes", "/api/status", "/api/og"]) {
      expect(isGatedPath(p), p).toBe(true);
    }
    expect(isGatedPath("/api/gate")).toBe(false);
  });

  // `/api/gate` is exempted as a PREFIX, because that is the only shape the Next
  // matcher's negative lookahead can express. So a future route whose name merely
  // starts with "gate" would silently fall outside the gate along with it.
  it("has no other API route that starts with the unlock endpoint's name", () => {
    const dirs = readdirSync(join(ROOT, "app", "api"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(dirs.filter((d) => d.startsWith("gate"))).toEqual(["gate"]);
  });

  it("gates the data under public/, which is the bulk of what is served", () => {
    // public/webcams is 8.4 MB and public/textures 3.4 MB (measured 2026-09-07).
    // Only gated HTML ever asks for them, so legitimate traffic is zero either way -
    // gating means a scraper costs one invocation instead of the egress.
    for (const p of ["/webcams/manifest.json", "/textures/earth.jpg", "/sky/stars.png", "/geo/countries.json"]) {
      expect(isGatedPath(p), p).toBe(true);
    }
  });

  it("gates the sitemap but never robots.txt", () => {
    // A 503 on robots.txt makes Google stop crawling the site entirely, which is
    // louder than a month-long outage warrants. A 503 sitemap is a mild signal it
    // retries, and the sitemap is a render that can fan out to the camera registry.
    expect(isGatedPath("/robots.txt")).toBe(false);
    expect(isGatedPath("/sitemap.xml")).toBe(true);
    expect(isGatedPath("/sitemap/0.xml")).toBe(true);
  });

  it("lets build assets and chrome through without an invocation", () => {
    for (const p of ["/_next/static/chunk.js", "/_vercel/insights/script.js", "/favicon.svg", "/icons/192.png", "/sw.js", "/brand/og.png"]) {
      expect(isGatedPath(p), p).toBe(false);
    }
  });

  // Camera ids carry dots (`tfl:JamCams_00001.01234`), so any "a dot means it is a
  // file" shortcut would leak ~19k camera pages straight through the curtain.
  it("gates a camera page whose id contains dots", () => {
    expect(isGatedPath("/camera/tfl:JamCams_00001.01234")).toBe(true);
  });
});

describe("the middleware matcher stays in step with the list", () => {
  // Next needs config.matcher to be a string LITERAL, so middleware.ts cannot import
  // GATE_EXEMPT_STARTS. Nothing but this test stops the two drifting apart.
  const middleware = readFileSync(join(ROOT, "middleware.ts"), "utf8");

  it("carries exactly the matcher the list derives", () => {
    const m = middleware.match(/matcher:\s*"([^"]+)"/);
    expect(m, "middleware.ts must declare matcher as a double-quoted string literal").toBeTruthy();
    // The capture is raw source, so a backslash in the file is two characters here.
    // Parsing it compares the VALUE Next will receive - and throws if the literal was
    // written `"\."`, which JS silently collapses to a bare dot.
    expect(JSON.parse(`"${m![1]}"`)).toBe(gateMatcher());
  });

  it("escapes dots for real", () => {
    // `"\."` in a JS string literal is just `"."`, so an escape written that way is a
    // no-op and `sw.js` reaches the regex with a dot that matches any character.
    expect(gateMatcher()).toContain("sw\\.js");
    expect(gateMatcher()).not.toContain("|sw.js|");
  });

  it("names every exemption", () => {
    for (const start of GATE_EXEMPT_STARTS) {
      expect(gateMatcher()).toContain(start.replace(/\./g, "\\."));
    }
  });
});

describe("the session", () => {
  it("is deterministic per code, and different codes differ", async () => {
    expect(await gateToken("open-sesame")).toBe(await gateToken("open-sesame"));
    expect(await gateToken("open-sesame")).not.toBe(await gateToken("open-sesamf"));
  });

  it("never contains the code itself", async () => {
    expect(await gateToken("hunter2")).not.toContain("hunter2");
  });

  it("compares without leaking length", async () => {
    expect(await constantTimeEqual("abc", "abc")).toBe(true);
    expect(await constantTimeEqual("abc", "abd")).toBe(false);
    expect(await constantTimeEqual("a", "a-much-longer-string")).toBe(false);
  });

  it("sets a cookie the browser will keep and script cannot read", () => {
    const header = gateCookieHeader("t0ken", true);
    expect(header).toContain(`${GATE_COOKIE}=t0ken`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Secure");
    expect(gateCookieHeader("t0ken", false)).not.toContain("Secure");
  });
});

describe("the redirect back cannot be aimed off-site", () => {
  it("refuses anything that is not a same-origin path", () => {
    for (const hostile of ["//evil.example", "/\\evil.example", "https://evil.example/x", "javascript:alert(1)", 42, null]) {
      expect(safeNext(hostile as unknown), String(hostile)).toBe("/");
    }
  });

  it("keeps a real path and its query", () => {
    expect(safeNext("/app?c=grid")).toBe("/app?c=grid");
  });

  it("strips a previous refusal so a second attempt starts clean", () => {
    expect(safeNext(`/app?${GATE_QUERY}=${GATE_DENIED}`)).toBe("/app");
    expect(withDenied("/app")).toBe(`/app?${GATE_QUERY}=${GATE_DENIED}`);
  });
});

describe("the curtain", () => {
  const html = maintenanceHtml({ next: "/app", denied: false });
  const denied = maintenanceHtml({ next: "/app", denied: true });

  // AGPL-3.0 section 13: a network user must be offered the Corresponding Source. The
  // console header and the site footer are the only two places that offer exists, and
  // the curtain replaces both of them. CLAUDE.md says not to remove those links.
  it("offers the source, as the licence requires", () => {
    expect(html).toContain(BRAND.repoUrl);
    expect(html).toContain(escapeHtml(BRAND.license.short));
  });

  it("links the Discord, which is the only place updates go", () => {
    expect(html).toContain(BRAND.discordUrl);
  });

  // The curtain is the only surface anyone can reach for a month, so the two things a
  // visitor can actually DO have to be on it: ask for a code, and chip in.
  it("offers a way in and a way to help", () => {
    expect(html).toContain(BRAND.kofiUrl);
    expect(html).toMatch(/feedback/i);
  });

  // The whole reason the curtain answers 503 rather than 200 is to keep the camera
  // pages in the index. A noindex directive on the same page asks for the opposite.
  it("carries no directive that would remove pages from the index", () => {
    expect(html).not.toContain("noindex");
    expect(html).not.toContain("nofollow");
  });

  // Its own stylesheet lives behind the gate it is standing in for. The curtain may
  // reference same-origin files, but ONLY ones the gate exempts - point a src at
  // anything gated and it 503s inside its own curtain, silently, with no test to
  // notice. So every same-origin URL in the document goes through the SAME predicate
  // the middleware uses.
  const sameOrigin = [...html.matchAll(/(?:src|href|action)="(\/[^"]*)"/g)].map((m) => m[1]);

  it("only points at paths that survive the gate", () => {
    expect(sameOrigin, "expected at least the unlock form and the screenshots").not.toHaveLength(0);
    for (const url of sameOrigin) {
      expect(isGatedPath(url), `${url} is gated and would 503 inside the curtain`).toBe(false);
    }
  });

  it("ships every image it points at", () => {
    const shots = sameOrigin.filter((u) => /\.(webp|png|jpe?g|svg|avif)$/.test(u));
    expect(shots.length).toBeGreaterThan(0);
    for (const shot of shots) {
      expect(existsSync(join(ROOT, "public", shot)), `${shot} is missing from public/`).toBe(true);
    }
  });

  // This document is served on EVERY gated request, and the outage exists because
  // bandwidth got expensive. Screenshots that drift back towards their 6.2 MB raw
  // originals would make the curtain cost more than the site it replaced.
  it("keeps its images small enough to serve on every request", () => {
    const bytes = sameOrigin
      .filter((u) => /\.(webp|png|jpe?g|svg|avif)$/.test(u))
      .reduce((n, u) => n + statSync(join(ROOT, "public", u)).size, 0);
    expect(bytes, `curtain images total ${Math.round(bytes / 1024)} KB`).toBeLessThan(600 * 1024);
  });

  // This page WAS script-free, and that was worth something. One thing bought the
  // exception: a "last commit" line, read live from GitHub's public API by the
  // VISITOR'S browser. A build-time constant would freeze on the day the gate was armed
  // and then spend a month advertising a month of silence, and a server-side fetch would
  // cost an upstream request per view on the page that exists because requests got
  // expensive. See `pulseScript()` for the full reasoning.
  //
  // These two tests are what keeps that exception honest, and they are the reason the
  // rule could be relaxed without losing what it protected.
  it("loads nothing external, script or stylesheet", () => {
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/i);
    // One inline block, not a habit.
    expect(html.match(/<script/g) ?? []).toHaveLength(1);
  });

  it("reads exactly the same with script disabled", () => {
    const noJs = html.replace(/<script[\s\S]*?<\/script>/g, "");
    // Everything the reader needs is in the served HTML, not assembled by the script.
    expect(noJs).toContain("running cost");
    expect(noJs).toContain("<form");
    expect(noJs).toContain(BRAND.discordUrl);
    expect(noJs).toContain(BRAND.kofiUrl);
    expect(noJs).toContain(BRAND.repoUrl);
    // And the one scripted element ships hidden, so a blocked fetch, a rate limit or a
    // browser with script off leaves no empty row and never a stale claim.
    expect(noJs).toMatch(/id="pulse"[^>]*\shidden/);
    expect(noJs).not.toMatch(/last commit[^<]*\d/);
  });

  // Two things a visitor needs and cannot infer: WHY it is down, and WHEN it returns.
  // The window is stated as a commitment ("within two weeks"), which is the point -
  // if it slips, this test is the thing that makes changing the page a deliberate act
  // rather than something everyone forgets is still on the only page the site serves.
  it("says why the site is down and when it comes back, not just that it is down", () => {
    expect(html).toContain("running cost");
    expect(html).toContain("two weeks");
  });

  it("shows a refusal only when the code was refused", () => {
    expect(html).not.toContain("not right");
    expect(denied).toContain("not right");
  });

  // If MAINTENANCE_MODE is armed and MAINTENANCE_PASSWORD is not set, the gate fails
  // CLOSED - failing open would leave the site up and billing, which is the exact
  // failure it exists to prevent. Saying so beats a code box that can never work.
  it("says when no code is configured, instead of offering a box that cannot open", () => {
    const stuck = maintenanceHtml({ next: "/", denied: false, unconfigured: true });
    expect(stuck).toContain("no access code");
    expect(stuck).not.toContain("<form");
  });

  it("escapes what it interpolates", () => {
    const evil = maintenanceHtml({ next: '"><script>alert(1)</script>', denied: false });
    expect(evil).not.toContain("<script>alert(1)</script>");
  });
});

describe("the invite", () => {
  // Confirmed live by Sampo on 2026-09-07, replacing H5vB8TsVK. Nothing here can check
  // that it still resolves - no test can reach discord.gg - so this only pins WHICH
  // invite ships. The expiry rule is a setting on Discord's side; see lib/brand.ts.
  it("is the one that was confirmed", () => {
    expect(BRAND.discordUrl).toBe("https://discord.gg/q45NU8qWk");
  });
});

describe("the numbers the curtain states as fact", () => {
  const html = maintenanceHtml({ next: "/", denied: false });

  // CLAUDE.md's standing rule: never quote a count from memory, every figure rots, and
  // this table has been wrong twice before a test pinned it. The curtain is worse than
  // a README - it is a PUBLIC page and it is the ONLY page, for a month. It cannot
  // import the registries (that would drag ~39 adapters into the edge bundle), so the
  // figures are literals there and pinned to their real sources here. Same shape as
  // readme-counts.test.ts.
  // Assertions read the RENDERED TEXT, not the markup, so the tiles are free to put the
  // figure in its own element without the pin quietly ceasing to match anything.
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("states the camera networks the registry actually has", () => {
    expect(text).toContain(`${CAMERA_FEED_COUNT} camera networks`);
  });

  // MAP_SIGNALS, not SIGNALS. The curtain says "live map layers", and a dataOnly source
  // is registered and fetchable but never drawn - quoting SIGNALS.length here would put
  // a layer on the page that no visitor can find when the site returns.
  it("states the map layers the signal registry actually draws", () => {
    expect(MAP_SIGNALS.length).toBeLessThan(SIGNALS.length);
    expect(text).toContain(`${MAP_SIGNALS.length} live map layers`);
  });

  it("states the widget and profile counts the registries actually hold", () => {
    expect(text).toContain(`${listWidgetTypes().length} console widgets`);
    expect(text).toContain(`${BUILTIN_VARIANTS.length} monitor profiles`);
  });

  it("states the webcam count the committed manifest actually holds", () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "public", "webcams", "manifest.json"), "utf8"),
    ) as { harvested: number };
    expect(text).toContain(`${manifest.harvested.toLocaleString("en-GB")} webcams`);
  });

  it("counts countries the way CLAUDE.md says they are counted", () => {
    const countries = new Set<string>();
    const dir = join(ROOT, "lib", "sources");
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts")) continue;
      for (const m of readFileSync(join(dir, file), "utf8").matchAll(/country:\s*"([A-Z]{2})"/g)) {
        countries.add(m[1]);
      }
    }
    expect(text).toContain(`${countries.size} countries`);
  });
});
