import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { BRAND, siteUrl } from "@/lib/brand";
import "./globals.css";

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
    <html lang="en" data-theme="light">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
