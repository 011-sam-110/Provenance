import type { Metadata } from "next";
import EyeApp from "@/components/eye/EyeApp";
import { BRAND } from "@/lib/brand";
import { railSourceCount } from "@/lib/eye/railCount";
import { eyeLeftOut, eyeSourceRows, leftOutCounts } from "@/lib/eye/sourceRows";

// The God's eye view. Inside app/(console) for the console layout's basemap warm-up,
// and under the same rule as /app: DO NOT TAKE `searchParams` HERE. The link is read
// in the browser after mount (lib/eye/places.ts), so this page renders once at build
// time and no visit runs a server render. tests/unit/console-static.test.ts holds it.

const TITLE = `God's eye view · ${BRAND.name}`;
const DESCRIPTION =
  "A city as a tilted 3D scene over satellite imagery, with its road cameras, vessels and aircraft placed where they are.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/eye" },
  // Next replaces the layout's openGraph rather than merging into it, so the type, the
  // site name and the card image are declared again here.
  openGraph: {
    type: "website",
    siteName: BRAND.name,
    url: "/eye",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/api/og", width: 1200, height: 630, alt: `${BRAND.name} map preview` }],
  },
};

// The Sources tray's rows are built from the console's own rail (lib/eye/sourceRows.ts), and
// its foot counts the rows that rail draws and the ones this view leaves out. All of it is
// read HERE, on the server at build time, and passed down as plain data, so the rail's list
// and the signal registry do not ride into this page's browser bundle (the same rule as
// CAMERA_FEED_COUNT in app/(console)/app/page.tsx).
export default function EyePage() {
  return <EyeApp sourceCount={railSourceCount()} sources={eyeSourceRows()} leftOut={leftOutCounts(eyeLeftOut())} />;
}
