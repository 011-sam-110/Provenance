import type { Metadata } from "next";
import ConsoleShell from "@/components/shell/ConsoleShell";
import { viewToShareMeta } from "@/lib/share/shareMeta";
import { BRAND } from "@/lib/brand";
import { CAMERA_FEED_COUNT } from "@/lib/sources/registry";

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
//
// CAMERA_FEED_COUNT IS READ HERE, ON THE SERVER, AND PASSED DOWN. ConsoleShell is
// the "use client" boundary, so importing the registry from inside it puts every
// camera adapter — and everything they import — into the BROWSER bundle, for the
// sake of one integer on the boot screen. That is not a size worry in the abstract:
// it is what broke the build. `lib/sources/actpr.ts` needs `node:http2` to talk to
// Puerto Rico's HTTP/2-only host, `node:http2` has no browser resolution, and
// production stopped deploying with "Module not found: Can't resolve 'http2'" and
// an import trace ending at ConsoleShell.tsx. Prod served a stale build for two
// merges before anyone noticed, because `tsc --noEmit` and the whole vitest suite
// pass — vitest runs in a node environment, where node:http2 resolves fine. Only
// `next build` sees it.
//
// The same rule is already applied twice elsewhere and written down both times:
// CLAUDE.md states it for the hero globe ("read from SOURCE_CATALOG in the server
// component and passed down as a prop — never imported into the client, or all ~39
// adapters land in the browser bundle"), and components/console/SourceCatalog.tsx
// derives its own count from CAMERA_REGIONS for exactly this reason.
//
// It stays DERIVED. CAMERA_FEED_COUNT is SOURCES.length, and the two pinning tests
// (readme-counts, claude-md-counts) read the code rather than restating it — so a
// hand-typed literal here would satisfy every test today and rot the moment a feed
// is added. `feeds` is a required prop with no default precisely so the number can
// only come from the constant that is already in scope on this line.
export default function Home() {
  return (
    <main className="tn-shell-main">
      <ConsoleShell feeds={CAMERA_FEED_COUNT} />
    </main>
  );
}
