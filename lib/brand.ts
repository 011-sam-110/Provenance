// Single source of truth for the product's public identity. Anything user-facing
// that names the product, links to it, or describes it should read from here so a
// rename is one edit (not a grep-and-pray across the shell, manifest, OG cards and
// alert copy). NOTE: the upstream-fetch User-Agent strings ("TrafficNerd/2.0 …")
// are deliberately NOT here — they identify the app to third-party APIs and are a
// separate concern from the display name.

export const BRAND = {
  /** Product/display name. The one line to change for a rename. */
  name: "OpenData",
  /** Lower-case tagline used after the name in <title> and cards. No trailing dot. */
  tagline: "live global situational-awareness map",
  /** Card headline for the default view (no specific board selected). */
  headline: "Live global situational-awareness map",
  /** Default OG-card subtitle: the honest one-line "what's actually on it". */
  pitch: "flights · quakes · outages · markets · news",
  /** One-liner for meta description / og:description / manifest. */
  description:
    "A live map of what's happening on Earth right now: flights, quakes, wildfires, internet outages, markets and news, all from open data. No login, no API keys.",
  /** Brand teal (matches manifest theme_color / OS chrome). */
  accent: "#0e7d97",
  /** Dark ink used as the OG-card background. */
  ink: "#0b1016",
  /** Ko-fi support link (the calm, opt-in "Support" button). */
  kofiUrl: "https://ko-fi.com/opendata",
} as const;

/**
 * Canonical absolute site origin (no trailing slash), used as the metadataBase so
 * relative OG image paths resolve to absolute URLs for crawlers.
 *
 * Resolution order — set NEXT_PUBLIC_SITE_URL once the custom domain is live to pin
 * it; otherwise Vercel's production domain is used automatically; otherwise the
 * current preview URL. So this "just works" today and auto-upgrades when the domain
 * is pointed, with no dead-domain hardcode.
 */
export function siteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "https://traffic-nerd-v2.vercel.app");
  const trimmed = raw.replace(/\/+$/, "");
  // Guarantee a scheme so `new URL(siteUrl())` (used as metadataBase) never throws on
  // a bare host like "worldmonitor.app" set via NEXT_PUBLIC_SITE_URL.
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
