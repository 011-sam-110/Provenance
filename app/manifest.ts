import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

// PWA web app manifest (Next metadata route → /manifest.webmanifest, and Next
// auto-injects the <link rel="manifest">). Calm LIGHT identity: light background,
// brand-teal theme. `display: standalone` makes it installable as a desktop/mobile
// app. Icons are the committed globe marks under public/icons (see scripts/gen-icons.mjs).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name} · live global intelligence`,
    short_name: BRAND.name,
    description: BRAND.description,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#e9edf2",
    theme_color: "#0e7d97",
    categories: ["travel", "navigation", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
