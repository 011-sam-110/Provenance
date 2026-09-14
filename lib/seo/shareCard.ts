import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";

/**
 * Share metadata (Open Graph + Twitter card) for the crawlable pages.
 *
 * TWO DEFECTS THIS EXISTS TO STOP, BOTH MEASURED ON PRODUCTION 2026-09-14.
 *
 * 1. NEXT REPLACES A PARENT `openGraph`, IT DOES NOT MERGE IT. The camera and directory
 *    pages each set `openGraph: { title, url }` and nothing else, so the layout's image
 *    was thrown away with the rest of the parent object: every camera page and every
 *    country / region / road / place listing unfurled as a bare text link. One helper
 *    that always returns type + siteName + image means a page cannot half-declare it.
 *
 * 2. THE CARD IMAGE IS `/api/og`, NEVER `/api/proxy`. A camera's current frame would be
 *    the better picture, but robots.txt disallows /api/proxy on purpose (third-party
 *    imagery, redistribution rights not established) and Twitterbot and
 *    facebookexternalhit obey robots.txt, so a proxied og:image renders as an empty box.
 *    /api/og is explicitly allowed and draws the card from text alone.
 *
 * Each distinct (t, s) pair is one Satori render, cached by the route's own headers.
 * Only share-preview fetchers read og:image, so the render cost follows shares, not
 * page count.
 */

export const OG_CARD_WIDTH = 1200;
export const OG_CARD_HEIGHT = 630;

/**
 * Card subtitle for the directory listings. No count: the headline already carries the
 * page's own figure, and the card is cached for a day.
 */
export const DIRECTORY_CARD_SUBTITLE = "live road cameras · operator named on every one";

const BRAND_SUFFIX = ` | ${BRAND.name}`;

/**
 * The card draws the brand in its own header, so a `<title>` that ends in
 * " | Provenance" would print the name twice. Strips that one suffix and nothing else.
 */
export function cardHeadline(title: string): string {
  return title.endsWith(BRAND_SUFFIX) ? title.slice(0, -BRAND_SUFFIX.length) : title;
}

/** Relative `/api/og` URL for a card; `metadataBase` makes it absolute for crawlers. */
export function ogCardPath(headline: string, subtitle: string): string {
  const q = new URLSearchParams();
  q.set("t", headline);
  q.set("s", subtitle);
  q.set("c", BRAND.accent.replace(/^#/, ""));
  return `/api/og?${q.toString()}`;
}

export interface SharePage {
  title: string;
  description?: string;
  /** Site-relative path of THIS page. It becomes og:url, so it must never default to "/". */
  path: string;
  type?: "website" | "article";
  /** Defaults to the plain `/api/og` brand card. */
  image?: string;
  imageAlt?: string;
}

export function shareMetadata(page: SharePage): Pick<Metadata, "openGraph" | "twitter"> {
  const image = page.image ?? "/api/og";
  const description = page.description ? { description: page.description } : {};
  const common = {
    siteName: BRAND.name,
    title: page.title,
    ...description,
    url: page.path,
    images: [{ url: image, width: OG_CARD_WIDTH, height: OG_CARD_HEIGHT, alt: page.imageAlt ?? page.title }],
  };

  return {
    openGraph: page.type === "article" ? { type: "article", ...common } : { type: "website", ...common },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      ...description,
      images: [image],
    },
  };
}
