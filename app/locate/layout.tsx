import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { ogCardPath, shareMetadata } from "@/lib/seo/shareCard";

// /locate is a "use client" page, and a client page cannot export `metadata`. Without
// this layout the route inherited the site-wide title, had no canonical, and shared
// with og:url pointing at the home page. This layout only carries metadata.

const TITLE = `Photo geolocation: estimate where a photo was taken | ${BRAND.name}`;
const DESCRIPTION =
  "Upload or link a photo and get ranked estimates of where it was taken, read from visual cues such as architecture, signage and vegetation. Results are estimates, not GPS positions.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/locate" },
  ...shareMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: "/locate",
    image: ogCardPath("Where was this photo taken?", "photo geolocation · estimates, not GPS"),
  }),
};

export default function LocateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
