import { BRAND } from "@/lib/brand";

/**
 * WebSite structured data for the home page.
 *
 * WHY. Every Search Console query for provenance-online.com is a brand query
 * ("provenance website" 59 clicks / 200 impressions, "provenance.website" 28 / 52,
 * average position 5.3, 6-11 Sep 2026). "Provenance" is also an ordinary English word
 * and the name of other products, so the name has to be made unambiguous.
 *
 * WHAT IT IS DOCUMENTED TO DO. Google's site-names documentation says it reads `name`
 * and `alternateName` from WebSite structured data on the home page as one signal for
 * the site name it shows in results. That is a naming signal. It is not documented to
 * change ranking, and nothing here claims it does.
 *
 * The alternate host is derived from the origin rather than typed, so a domain change
 * cannot leave a stale name behind. No person is named: this is a public surface.
 */
export function websiteJsonLd(origin: string) {
  const home = new URL("/", origin);
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: BRAND.name,
    alternateName: [`${BRAND.name} Online`, home.host],
    url: home.href,
  };
}

/**
 * JSON for an inline <script type="application/ld+json">. Escapes "<" so a value can
 * never close the script element early.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
