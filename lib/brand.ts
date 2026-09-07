// Single source of truth for the product's public identity. Anything user-facing
// that names the product, links to it, or describes it should read from here so a
// rename is one edit (not a grep-and-pray across the shell, manifest, OG cards and
// alert copy). NOTE: the upstream-fetch User-Agent strings ("TrafficNerd/2.0 …")
// are deliberately NOT here — they identify the app to third-party APIs and are a
// separate concern from the display name.

export const BRAND = {
  /** Product/display name. The one line to change for a rename. */
  name: "Provenance",
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
  /**
   * The Discord server.
   *
   * A DISCORD INVITE CAN EXPIRE, AND THAT IS THE ONLY DANGEROUS THING ABOUT THIS
   * LINE. Invites are created with an expiry by default (7 days, or a custom one),
   * and an expired invite does not fail loudly — it serves a normal-looking
   * "Invite Invalid" page, so the console, the site footer and every shared link
   * keep pointing at a dead end with nothing in this repo going red. Nothing here
   * can detect it either: no test can reach discord.gg, and a link check would only
   * tell you it was already broken.
   *
   * So the rule is a SETTING on Discord's side, not a check on ours: this must be a
   * "never expire" invite (server → Invites → Edit → Expire After: Never, max uses
   * unlimited).
   *
   * The stakes went UP on 2026-09-07: the maintenance curtain (lib/gate/page.ts) is
   * served in place of every page while the site is down, and this is the only link
   * on it. A dead invite there does not degrade the experience, it IS the experience.
   *
   * Code confirmed live by Sampo on 2026-09-07, replacing H5vB8TsVK.
   */
  discordUrl: "https://discord.gg/q45NU8qWk",
  /** Canonical public repository. */
  repo: "011-sam-110/Provenance",
  repoUrl: "https://github.com/011-sam-110/Provenance",
  /**
   * The licence, and it is load bearing rather than decorative.
   *
   * AGPL-3.0 section 13 says that if users interact with the program REMOTELY over
   * a network — which is the only way anyone uses this — they must be offered the
   * Corresponding Source. A hosted AGPL app that does not link its own source is in
   * breach of its own licence, so `repoUrl` is rendered in the console chrome and in
   * the site footer for legal reasons, not as a portfolio flourish. Do not remove
   * those links without changing the licence.
   */
  license: {
    /** SPDX identifier; matches the `license` field in package.json. */
    spdx: "AGPL-3.0-only",
    name: "GNU Affero General Public License v3.0",
    short: "AGPL-3.0",
    /** The copy in this repo, which is what section 13 points a user at. */
    url: "https://github.com/011-sam-110/Provenance/blob/main/LICENSE",
    /**
     * The copyright holder as it appears in public.
     *
     * This is the GitHub account that authored the work, not a legal name, and that is
     * a deliberate choice rather than an oversight. It is rendered in three places a
     * search engine indexes — the site footer, the /privacy footer, and the "who runs
     * this" paragraph — and the author would rather those carried a handle.
     *
     * It does not weaken anything. Copyright vests in the author whether or not the
     * notice names them; a notice is evidence of a claim, not the source of it, and a
     * pseudonymous one is ordinary in open source. AGPL section 13's obligation is to
     * OFFER the corresponding source, which `repoUrl` does, and that is unaffected.
     *
     * What it does mean is that anyone with a formal reason to know who the controller
     * is — a data-protection request, a legal notice — has to ask through the issue
     * tracker the page names. That is the trade, and it is written down here so the
     * next person changing this line knows what they are changing.
     */
    holder: "011-sam-110",
    year: "2026",
  },
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
      : "https://provenance-online.vercel.app");
  const trimmed = raw.replace(/\/+$/, "");
  // Guarantee a scheme so `new URL(siteUrl())` (used as metadataBase) never throws on
  // a bare host like "opendata.example" set via NEXT_PUBLIC_SITE_URL.
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
