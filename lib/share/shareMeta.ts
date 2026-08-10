// Pure derivation of social-share metadata (page <title>, og/twitter title +
// description, and the OG-card query) from a decoded deep-link ViewState. Kept
// pure + dependency-light (only the static variant registry + brand constant) so
// it round-trips in the node vitest env, exactly like lib/share/url.ts. The impure
// wiring (generateMetadata reading request searchParams, the ImageResponse route)
// consumes this.
//
// Why derive from the view: every shared/deep link already encodes which board the
// viewer is looking at (?v=aviation …). Turning that into "Live flight tracking"
// instead of a generic title is what makes a pasted link unfurl into something
// worth clicking. An explicit event headline (from the future auto-poster) can
// still override this by passing t=/s= straight to /api/og.

import type { ViewState } from "@/lib/share/url";
import { BUILTIN_BY_ID } from "@/lib/variants/builtins";
import { BRAND } from "@/lib/brand";

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

/** Derive share metadata from a decoded view. Never throws; always returns a card. */
export function viewToShareMeta(view: ViewState): ShareMeta {
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
