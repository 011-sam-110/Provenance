import type { Metadata } from "next";
import ConsoleShell from "@/components/shell/ConsoleShell";
import { viewToShareMeta } from "@/lib/share/shareMeta";
import { BRAND } from "@/lib/brand";

// The board id (?v=…) is the only shared param the social card derives from, so we
// parse it inline rather than importing the client-oriented deep-link codec
// (lib/share/url.ts). That codec builds Sets over the layer/basemap/signal
// registries at module load, and dragging those into the SSR/RSC graph is both
// unnecessary here and fragile. Pattern kept in sync with url.ts's VARIANT_RE.
const VARIANT_RE = /^[a-z0-9-]{1,32}$/;

// Server component (ConsoleShell is the "use client" boundary) so it can derive
// per-view social metadata from the shared deep-link params. A link to a specific
// board then unfurls as "Live flight tracking · OpenData" with a matching OG card
// instead of the generic default. Reading searchParams makes this route dynamic
// (SSR per request) — intended, so crawlers get the right card.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const raw = sp.v;
  const v = typeof raw === "string" && VARIANT_RE.test(raw) ? raw : undefined;
  const meta = viewToShareMeta({ v });
  const ogImage = `/api/og?${meta.ogQuery}`;
  return {
    title: meta.title,
    description: meta.description,
    openGraph: {
      // Next replaces (not deep-merges) the parent openGraph, so re-declare type +
      // siteName here or the primary shared route drops them.
      type: "website",
      siteName: BRAND.name,
      title: meta.title,
      description: meta.description,
      images: [{ url: ogImage, width: 1200, height: 630, alt: meta.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: [ogImage],
    },
  };
}

// The map lives in the console's centre stage (StageHost), so the page just mounts
// the shell; the heavy client-only canvas is dynamically imported there.
export default function Home() {
  return (
    <main className="tn-shell-main">
      <ConsoleShell />
    </main>
  );
}
