// Pure derivation of social-share metadata (page <title>, og/twitter title +
// description, and the OG-card query). Kept pure + dependency-light (only the
// static variant registry + brand constant) so it round-trips in the node vitest
// env, exactly like lib/share/url.ts.
//
// NOTHING IN THE APP PASSES A BOARD TODAY, AND NOTHING SHOULD. `/app` calls this
// with `{}` at build time and ships one static card for every link. Deriving the
// card from `?v=` is what it used to do, and taking that param in
// `generateMetadata` opted the console into a per-request server render — the same
// defect `/` shipped with for an entire launch. If per-board cards are ever wanted
// back, the route has to be per-board too (`/app/aviation`), so each one can be
// statically rendered; a query param cannot be.
//
// The per-board branch below is therefore reachable only from a caller that knows
// the board by other means. It is kept because the headline table is the only place
// those thirteen strings live, and because /api/og still accepts an explicit
// headline via t=/s= for the auto-poster.

import { BUILTIN_BY_ID } from "@/lib/variants/builtins";
import { BRAND } from "@/lib/brand";

/** What the card is derived from. Not a deep-link ViewState — see the note above. */
export interface ShareView {
  /** Built-in board id, when the caller already knows it. */
  v?: string;
}

// Marketing headline per built-in board. Falls back to the variant's own title,
// then to the brand tagline, so an unknown/absent variant still yields a sane card.
const VARIANT_HEADLINE: Record<string, string> = {
  explore: "Live global situational-awareness map",
  intel: "Live global intelligence map",
  cameras: "Live public cameras worldwide",
  aviation: "Live flight tracking",
  maritime: "Live maritime and chokepoint map",
  orbital: "Live satellites and space weather",
  hazards: "Live natural-hazard map",
  geopolitics: "Live conflict and geopolitics map",
  humanitarian: "Live humanitarian map",
  infrastructure: "Live infrastructure map",
  cyber: "Live cyber and internet-outage map",
  civic: "Live civic-safety map",
  markets: "Live markets and global signals",
};

export interface ShareMeta {
  /** Page <title> and og:title. */
  title: string;
  /** meta description / og:description. */
  description: string;
  /** Hex accent (with leading #) for the OG card. */
  accent: string;
  /** Query string (no leading ?) for /api/og that renders the matching card. */
  ogQuery: string;
}

/** Hex without the leading # if valid 3/6-digit, else the brand accent's. */
function accentHex(hex: string): string {
  const h = hex.replace(/^#/, "");
  return /^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(h) ? h : BRAND.accent.replace(/^#/, "");
}

/** Derive share metadata from a view. Never throws; always returns a card. */
export function viewToShareMeta(view: ShareView): ShareMeta {
  const variant = view.v ? BUILTIN_BY_ID[view.v] : undefined;
  const headline = (variant && (VARIANT_HEADLINE[variant.id] ?? variant.title)) || BRAND.headline;
  const subtitle = variant ? `${variant.title} board` : BRAND.pitch;
  const accent = variant?.accent ?? BRAND.accent;

  // Default (no recognized board): "OpenData · live global …". A board view leads
  // with its headline and trails the brand: "Live flight tracking · OpenData".
  const title = variant ? `${headline} · ${BRAND.name}` : `${BRAND.name} · ${BRAND.tagline}`;

  const og = new URLSearchParams();
  og.set("t", headline);
  og.set("s", subtitle);
  og.set("c", accentHex(accent));

  return { title, description: BRAND.description, accent: `#${accentHex(accent)}`, ogQuery: og.toString() };
}
