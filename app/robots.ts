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
  // production for the same queries as duplicate content.
  //
  // SITE_ENV EXISTS BECAUSE THE OLD REASONING STOPPED BEING TRUE. This used to read
  // VERCEL_ENV alone, justified by "absent outside Vercel (local dev), where the file
  // is not served to anyone anyway". Self-hosted that is false: the preview box serves
  // this file to whoever asks, VERCEL_ENV is absent there too, and the guard written to
  // keep previews out of the index would have waved them straight in.
  //
  // VERCEL_ENV is still honoured, because the Vercel project stays alive to redirect
  // the old subdomain and should keep behaving correctly while it does.
  //
  // The default stays "allow" on purpose. Defaulting to noindex would mean one missing
  // variable silently deindexes production, which is far worse than the failure it
  // prevents - so a preview MUST set SITE_ENV=preview, and this file is generated at
  // BUILD time, so it has to be set for the build and not on the running box.
  const siteEnv = process.env.SITE_ENV || process.env.VERCEL_ENV;
  if (siteEnv && siteEnv !== "production") {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      // TWO CRAWLERS THAT COST MORE THAN EVERY SEARCH ENGINE COMBINED, MEASURED.
      // Over the 3.5 days the Caddy log holds (2026-09-08..11) the box answered:
      //
      //   meta-webindexer/1.1   36,525 requests, ~1.2 GB, nearly all in one run on 09-10
      //   SemrushBot/7~bl       15,211 requests, still going at ~6,800/day
      //   bingbot                  857
      //   Googlebot                 67
      //
      // Neither of the top two sends a visitor. Blocking them is not an AI-policy
      // decision — that one is already made, and Cloudflare's managed block list
      // injects it above this file's rules (Amazonbot, Bytespider, CCBot, ClaudeBot,
      // GPTBot, Google-Extended, meta-externalagent). It is a crawl-budget decision
      // on a 2 vCPU box, and it is here rather than there because neither name is on
      // Cloudflare's list.
      //
      // meta-webindexer IS NOT meta-externalagent. The blocked one is Meta's AI
      // training fetcher; this is its indexing crawler, a separate token, and
      // blocking one does nothing to the other. It also arrives wearing an ordinary
      // Chrome User-Agent with its own name appended in the comment field, which is
      // why it read as human traffic until the full string was looked at.
      //
      // THIS IS A REQUEST, NOT A CONTROL. Both publish that they honour robots.txt,
      // and a crawler that stops honouring it needs a Cloudflare WAF rule instead —
      // robots.txt has never been able to enforce anything. Re-measure from the
      // access log before assuming it worked.
      { userAgent: "meta-webindexer", disallow: "/" },
      { userAgent: "SemrushBot", disallow: "/" },
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
