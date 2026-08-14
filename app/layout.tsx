import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { BRAND, siteUrl } from "@/lib/brand";
import "./globals.css";

// The OpenData Terminal's two typefaces, self-hosted by next/font (no runtime
// request to Google, no render-blocking <link>, and a size-matched local fallback
// generated per family so the swap does not reflow the grid).
//
// Neither was loaded before this: `--tn-mono` merely NAMED "JetBrains Mono" third in
// an OS-fallback list, so on Windows it resolved to Consolas and on macOS to SF Mono,
// and "IBM Plex Sans" did not appear anywhere in the repo. The terminal's whole look
// is these two faces at 9–12.5px, so the design does not exist without this.
//
// Weights are exactly the ones the design uses and no more — every extra weight is
// another woff2 on the critical path. Mono: 400 body/rows, 500 emphasis, 700 labels
// and numbers, 800 the SEL badge and mode pills. Sans: 400/500/600 for headline
// titles only.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  variable: "--tn-font-mono",
  display: "swap",
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--tn-font-sans",
  display: "swap",
});

const DEFAULT_TITLE = `${BRAND.name} · ${BRAND.tagline}`;

// Site-wide metadata defaults. Per-view titles + OG cards are supplied by
// app/page.tsx generateMetadata (it reads the shared deep-link params); these are
// the fallbacks for the bare site. metadataBase makes the relative /api/og path
// resolve to an absolute URL for crawlers.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: DEFAULT_TITLE,
  description: BRAND.description,
  applicationName: BRAND.name,
  // Google Search Console ownership proof for the URL-prefix property
  // https://provenance-online.vercel.app/. A *domain* property is not available to
  // us: it needs a DNS TXT record and `vercel.app` is on the Public Suffix List, so
  // we cannot prove ownership of the zone. Removing this tag un-verifies the
  // property and silently drops all indexing telemetry, so leave it in place even
  // after verification succeeds.
  verification: { google: "dzW30K7NcjXkOgxgdARj9YQ6bgR6oIIrMlfUgTu_y1s" },
  // app/manifest.ts is auto-linked by Next; this is the explicit reference.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: "default" },
  openGraph: {
    type: "website",
    siteName: BRAND.name,
    url: "/",
    title: DEFAULT_TITLE,
    description: BRAND.description,
    images: [{ url: "/api/og", width: 1200, height: 630, alt: `${BRAND.name} live map preview` }],
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: BRAND.description,
    images: ["/api/og"],
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

// Calm LIGHT identity: light background, brand-teal browser/OS chrome.
export const viewport: Viewport = {
  themeColor: "#0e7d97",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Calm LIGHT by default; the shell flips data-theme on the client for the
    // optional dark toggle. Setting it here keeps SSR markup matching first paint.
    // data-theme is UNCHANGED on purpose — the Terminal's near-black palette is a
    // scoped `.tn-terminal` token block in globals.css, not a theme, so it cannot
    // fight uiStore or variantStore (which re-asserts a variant's theme on every
    // switch and would yank a global dark default straight back to light).
    //
    // The two font classes only publish `--tn-font-mono` / `--tn-font-sans` on the
    // root; nothing changes typeface until globals.css consumes them.
    <html lang="en" data-theme="light" className={`${jetbrainsMono.variable} ${ibmPlexSans.variable}`}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
