// Sitemap XML serialisation.
//
// WHY THIS EXISTS AT ALL, since Next has a built-in `app/sitemap.ts` that emits
// sitemap XML for you: it gives you no way to attach an XSL stylesheet. The
// `<?xml-stylesheet?>` processing instruction has to sit above the root element,
// before anything Next's generator writes, and there is no hook for it. So the
// choice is "no stylesheet" or "serialise it ourselves", and serialising it
// ourselves also buys the sitemap INDEX shape we want.
//
// The stylesheet is presentation for humans only. Every crawler ignores
// `<?xml-stylesheet?>` — it is read by browsers, which otherwise render a raw
// sitemap as a collapsed tree under a "this file does not appear to have any style
// information" banner. Nothing here changes what a crawler sees.
//
// Pure module. No Next imports, no fetching, no clock — every function is a
// deterministic string transform, which is what makes the output unit-testable
// rather than something you have to deploy to inspect.

import type { SitemapEntry } from "@/lib/seo/directory";
import { edgeCacheHeaders } from "@/lib/http/cache";

/** Where the browser-facing stylesheet lives (served from `public/`). */
export const SITEMAP_STYLESHEET_PATH = "/sitemap.xsl";

/**
 * Escape text for an XML *text node* or attribute value.
 *
 * This is not decoration. Camera ids carry colons and are percent-encoded into
 * paths, and query strings elsewhere on the site use `&` — an unescaped ampersand
 * makes the whole document ill-formed, and a crawler's parser rejects the FILE, not
 * the one bad line. That failure is silent from our side: the sitemap keeps
 * returning 200 while every URL in it goes unread.
 *
 * `'` is escaped as `&apos;` rather than left raw so the same function is safe for
 * single-quoted attributes too.
 */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * W3C datetime, which is what the sitemap protocol requires for `<lastmod>`.
 *
 * Returns null for an absent or unparseable date so the caller omits the element
 * entirely. Emitting `<lastmod>Invalid Date</lastmod>` would be worse than saying
 * nothing: it is a schema violation, and "we do not know when this changed" is a
 * perfectly honest thing for a sitemap to leave out.
 */
export function w3cDate(value: Date | string | number | undefined): string | null {
  if (value === undefined || value === null) return null;
  const d = value instanceof Date ? value : new Date(value);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return null;
  return d.toISOString();
}

const HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

function stylesheetPI(href: string | null): string {
  return href ? `\n<?xml-stylesheet type="text/xsl" href="${xmlEscape(href)}"?>` : "";
}

/**
 * A `<urlset>` document — one child sitemap's worth of URLs.
 *
 * `priority` is clamped to the protocol's 0.0–1.0 and printed to one decimal so the
 * output is byte-stable between runs; an unclamped value is a schema violation and
 * a drifting float makes every regeneration look like a change.
 */
export function renderUrlset(
  entries: SitemapEntry[],
  opts: { stylesheet?: string | null } = {},
): string {
  const stylesheet = opts.stylesheet === undefined ? SITEMAP_STYLESHEET_PATH : opts.stylesheet;
  const body = entries
    .map((e) => {
      const parts = [`  <url>`, `    <loc>${xmlEscape(e.url)}</loc>`];
      const lastmod = w3cDate(e.lastModified);
      if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`);
      if (e.changeFrequency) parts.push(`    <changefreq>${e.changeFrequency}</changefreq>`);
      if (typeof e.priority === "number" && Number.isFinite(e.priority)) {
        const p = Math.min(1, Math.max(0, e.priority));
        parts.push(`    <priority>${p.toFixed(1)}</priority>`);
      }
      parts.push(`  </url>`);
      return parts.join("\n");
    })
    .join("\n");

  return `${HEADER}${stylesheetPI(stylesheet)}
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

export interface SitemapIndexChild {
  /** Absolute URL of the child sitemap. */
  url: string;
  lastModified?: Date | string | number;
}

/** A `<sitemapindex>` document — the file a crawler is pointed at first. */
export function renderSitemapIndex(
  children: SitemapIndexChild[],
  opts: { stylesheet?: string | null } = {},
): string {
  const stylesheet = opts.stylesheet === undefined ? SITEMAP_STYLESHEET_PATH : opts.stylesheet;
  const body = children
    .map((c) => {
      const parts = [`  <sitemap>`, `    <loc>${xmlEscape(c.url)}</loc>`];
      const lastmod = w3cDate(c.lastModified);
      if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`);
      parts.push(`  </sitemap>`);
      return parts.join("\n");
    })
    .join("\n");

  return `${HEADER}${stylesheetPI(stylesheet)}
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</sitemapindex>
`;
}

/**
 * Response headers for any sitemap document.
 *
 * `s-maxage` matches the daily rebuild so the edge answers repeat crawls without
 * waking a function, and `stale-while-revalidate` means a crawler never waits on a
 * regeneration — it gets yesterday's copy instantly while today's builds behind it.
 * A sitemap is exactly the shape of document that should never block on freshness.
 */
export function sitemapHeaders(): HeadersInit {
  return {
    "Content-Type": "application/xml; charset=utf-8",
    ...edgeCacheHeaders(86_400_000, 604_800_000),
  };
}
