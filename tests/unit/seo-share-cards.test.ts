import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND } from "@/lib/brand";
import {
  DIRECTORY_CARD_SUBTITLE,
  OG_CARD_HEIGHT,
  OG_CARD_WIDTH,
  cardHeadline,
  ogCardPath,
  shareMetadata,
} from "@/lib/seo/shareCard";
import { serializeJsonLd, websiteJsonLd } from "@/lib/seo/structuredData";

// Guards the share and crawl metadata measured wrong on production 2026-09-14:
//   - /cameras, /privacy and /locate all published og:url = the home page, because the
//     root layout's openGraph carried `url: "/"` and every page inherited it;
//   - camera and directory pages set `openGraph: { title, url }` only, and Next REPLACES
//     the parent openGraph, so they unfurled with no image;
//   - /app had no canonical; `/` had no link into the camera directory.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Loose = any;

function source(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), "utf8");
}

/** Code only: block comments, JSX comment expressions and line comments removed. */
function stripComments(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("cardHeadline", () => {
  it("drops the brand suffix the card already draws", () => {
    expect(cardHeadline(`Live traffic cameras in Florida (4,838) | ${BRAND.name}`)).toBe(
      "Live traffic cameras in Florida (4,838)",
    );
  });

  it("leaves a title without that exact suffix alone", () => {
    expect(cardHeadline("A1 | Archway")).toBe("A1 | Archway");
    expect(cardHeadline(`${BRAND.name} · live map`)).toBe(`${BRAND.name} · live map`);
  });
});

describe("ogCardPath", () => {
  it("encodes the headline, subtitle and brand accent as the /api/og route reads them", () => {
    const path = ogCardPath("A1 Archway Rd/Bakers Ln & more", DIRECTORY_CARD_SUBTITLE);
    expect(path.startsWith("/api/og?")).toBe(true);
    const q = new URLSearchParams(path.slice("/api/og?".length));
    expect(q.get("t")).toBe("A1 Archway Rd/Bakers Ln & more");
    expect(q.get("s")).toBe(DIRECTORY_CARD_SUBTITLE);
    expect(q.get("c")).toBe(BRAND.accent.replace("#", ""));
    expect(q.get("c")).toMatch(/^[0-9a-fA-F]{6}$/);
  });
});

describe("shareMetadata", () => {
  it("always returns type, siteName, this page's url and a sized image", () => {
    const meta = shareMetadata({ title: "T", description: "D", path: "/cameras/gb" });
    const og = meta.openGraph as Loose;
    expect(og.type).toBe("website");
    expect(og.siteName).toBe(BRAND.name);
    expect(og.url).toBe("/cameras/gb");
    expect(og.description).toBe("D");
    expect(og.images).toEqual([{ url: "/api/og", width: OG_CARD_WIDTH, height: OG_CARD_HEIGHT, alt: "T" }]);
    const tw = meta.twitter as Loose;
    expect(tw.card).toBe("summary_large_image");
    expect(tw.images).toEqual(["/api/og"]);
  });

  it("uses the same card for Open Graph and Twitter, and marks articles", () => {
    const image = ogCardPath("A1", "London");
    const meta = shareMetadata({ title: "T", path: "/camera/x", type: "article", image });
    const og = meta.openGraph as Loose;
    expect(og.type).toBe("article");
    expect(og.images[0].url).toBe(image);
    expect((meta.twitter as Loose).images).toEqual([image]);
    expect(og).not.toHaveProperty("description");
  });
});

describe("websiteJsonLd", () => {
  it("names the site and its alternate names at the home URL", () => {
    const ld = websiteJsonLd("https://provenance-online.com");
    expect(ld["@type"]).toBe("WebSite");
    expect(ld.name).toBe(BRAND.name);
    expect(ld.url).toBe("https://provenance-online.com/");
    expect(ld.alternateName).toContain("provenance-online.com");
  });

  it("serialises so a value cannot close the script element", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out)).toEqual({ name: "</script><script>alert(1)</script>" });
  });
});

describe("page metadata wiring", () => {
  it("the root layout's openGraph does not claim the home page URL for every page", () => {
    const src = stripComments(source("app", "layout.tsx"));
    const start = src.indexOf("openGraph: {");
    const end = src.indexOf("twitter: {", start);
    expect(start).toBeGreaterThan(-1);
    // The image entry carries its own `url`; only a page-level og:url is the defect.
    const block = src.slice(start, end).replace(/images:\s*\[[\s\S]*?\]\s*,/, "");
    expect(block).not.toMatch(/\burl\s*:/);
  });

  it("the home page states its own og:url, links the camera directory and carries WebSite JSON-LD", () => {
    const src = stripComments(source("app", "(site)", "page.tsx"));
    expect(src).toMatch(/shareMetadata\(\{[\s\S]*?path: "\/"/);
    expect(src).toContain('href="/cameras"');
    expect(src).toContain("websiteJsonLd(siteUrl())");
  });

  it("/app names itself canonical", () => {
    const src = stripComments(source("app", "(console)", "app", "page.tsx"));
    expect(src).toContain('canonical: "/app"');
    expect(src).toContain('url: "/app"');
  });

  it("/locate has its own canonical", () => {
    expect(stripComments(source("app", "locate", "layout.tsx"))).toContain('canonical: "/locate"');
  });

  const SHARED = [
    ["app", "cameras", "page.tsx"],
    ["app", "camera", "[id]", "page.tsx"],
    ["app", "cameras", "[country]", "page.tsx"],
    ["app", "cameras", "[country]", "[region]", "[[...paging]]", "page.tsx"],
    ["app", "cameras", "[country]", "road", "[road]", "[[...paging]]", "page.tsx"],
    ["app", "cameras", "[country]", "place", "[place]", "[[...paging]]", "page.tsx"],
    ["app", "locate", "layout.tsx"],
  ];

  it.each(SHARED.map((p) => [p.join("/"), p]))(
    "%s builds its share metadata through shareMetadata, never a partial openGraph",
    (_name, parts) => {
      const src = stripComments(source(...(parts as string[])));
      expect(src).toContain("...shareMetadata(");
      expect(src).not.toMatch(/\bopenGraph\s*:/);
      expect(src).not.toContain("/api/proxy");
    },
  );
});
