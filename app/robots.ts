import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/brand";

/**
 * There was no robots policy at all: `/robots.txt` returned 404 on production, so
 * nothing pointed a crawler at the sitemap and nothing kept preview deployments out
 * of the index.
 *
 * Route Segment Config note: this is a static file, generated at build time. It
 * therefore reads the environment of the BUILD, which is the correct scope - a
 * preview build should ship a preview robots.txt.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = siteUrl();

  // Every non-production deployment gets a blanket refusal. Preview URLs carry a
  // byte-identical copy of the whole site, and an indexed preview competes with
  // production for the same queries as duplicate content. VERCEL_ENV is absent
  // outside Vercel (local dev), where the file is not served to anyone anyway, so
  // the default has to be "allow" - defaulting to noindex would risk silently
  // deindexing production if the variable ever went missing.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          // The OG card endpoint must stay crawlable or social previews break:
          // Twitterbot and facebookexternalhit obey robots.txt, and a blocked card
          // image renders as an empty box. Google resolves competing rules by
          // longest match, so this beats the "/api/" line below.
          "/api/og",
        ],
        disallow: [
          // Internal JSON handlers. Nothing here is a landing page, and several are
          // expensive to serve.
          "/api/",
          // Deliberate, and not only a crawl-budget decision: /api/proxy and
          // /api/hls re-serve THIRD-PARTY camera imagery that arrives with its own
          // licence and attribution obligations (TfL OGL, Windy, the DOT feeds).
          // Letting a search engine index and redistribute those frames is a claim
          // about redistribution rights we have not established, so we do not make
          // it. The consequence is no image-search presence for camera frames.
          "/api/proxy",
          "/api/hls",
          "/api/webcam-image",
        ],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
