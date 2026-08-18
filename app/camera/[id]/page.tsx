import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCameraPage } from "@/lib/seo/registrySnapshot";
import { isLiveStreamUrl } from "@/lib/proxy/hls-allowlist";
import { CameraImage } from "@/components/CameraImage";
import { CameraVideo } from "@/components/CameraVideo";
import {
  CAMERAS_ROOT,
  cameraDescription,
  cameraPath,
  cameraTitle,
  countryName,
  countryPath,
  describeCadence,
  placeLabel,
  regionPath,
} from "@/lib/seo/paths";

/**
 * Was `force-dynamic`, which meant this page was recomputed from the registry on
 * every single request and could never be cached at the edge.
 *
 * It is safe to cache: the only genuinely live thing on the page is the frame, and
 * that is fetched by a CLIENT component straight from the image proxy on its own
 * refresh interval. Everything the server renders - name, place, operator, cadence,
 * neighbours - changes at the speed of the registry, not the speed of traffic.
 */
export const revalidate = 300; // = REGISTRY_TTL_MS. Must stay equal to CAMERA_TTL_SECONDS
// in lib/seo/registrySnapshot.ts; a `revalidate` export has to be a literal Next can read
// statically, so it cannot import the constant. tests/unit/seo-page-caching.test.ts pins
// the three together.

/**
 * Returns NO paths, and that empty array is the entire point.
 *
 * From the Next.js docs on on-demand static generation: "To statically render all
 * paths the first time they're visited, return an empty array from
 * generateStaticParams... It is important to note that you must return an array from
 * generateStaticParams, even if it's empty. Otherwise, THE ROUTE WILL BE DYNAMICALLY
 * RENDERED instead of statically."
 *
 * That is the second half of why this page never honoured its `revalidate`, and it is
 * separate from the uncached-fetch problem `lib/seo/registrySnapshot.ts` solves.
 * Measured across two builds of this tree: caching the data alone moved `/cameras`
 * from dynamic to static, but left `/camera/[id]` on `f (Dynamic)` - because a route
 * with a dynamic segment and no `generateStaticParams` at all is dynamic regardless of
 * how well its data is cached. Both were needed.
 *
 * Deliberately empty rather than the full id list: there are 18,766 crawlable camera
 * URLs, and prerendering them would trade a runtime problem for a build-time one on a
 * build we pay for. `dynamicParams` defaults to true, so each page is rendered the
 * first time it is asked for and then served from the cache for `revalidate`.
 *
 * Do NOT reach for `dynamic = "force-static"` as a shortcut here. It flips
 * `dynamicParams` to false, which would 404 every camera page that had not already
 * been generated.
 */
export async function generateStaticParams() {
  return [];
}

async function load(idParam: string) {
  return getCameraPage(decodeURIComponent(idParam));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const hit = await load(id);
  if (!hit) return { title: "Camera not found" };

  const cam = hit.camera;
  const title = cameraTitle(cam);
  const description = cameraDescription(cam);

  return {
    title,
    description,
    // Next serves this page for both the percent-encoded id and the raw-colon form.
    // Naming one canonical stops the two being read as duplicate pages.
    alternates: { canonical: cameraPath(cam.id) },
    openGraph: { title, description, url: cameraPath(cam.id), type: "article" },
    twitter: { title, description },
  };
}

export default async function CameraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hit = await load(id);
  if (!hit) notFound();

  const { camera: cam, nearby } = hit;
  const live = isLiveStreamUrl(cam.streamUrl);
  const country = countryName(cam.country);

  // Breadcrumbs, in markup a search engine reads and as links a person can use. The
  // page was previously an orphan with one link back to the globe; this is what
  // connects it to the directory above it.
  const trail = [
    { name: "Cameras", href: CAMERAS_ROOT },
    { name: country, href: countryPath(cam.country) },
    ...(cam.region ? [{ name: cam.region, href: regionPath(cam.country, cam.region) }] : []),
  ];

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: crumb.href,
    })),
  };

  return (
    <main className="camera-detail">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />

      <nav className="tn-dir-crumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        {trail.map((crumb) => (
          <span key={crumb.href}>
            {" "}
            <span aria-hidden="true">/</span> <Link href={crumb.href}>{crumb.name}</Link>
          </span>
        ))}
      </nav>

      <h1>{cam.name}</h1>

      <p className="tn-dir-lede">
        Live traffic camera in {placeLabel(cam)}. The image refreshes{" "}
        {describeCadence(cam.refreshSeconds)}, direct from {cam.attribution}.
      </p>

      {live ? (
        <CameraVideo
          id={cam.id} alt={cam.name}
          attribution={cam.attribution} license={cam.license}
          refreshSeconds={cam.refreshSeconds}
        />
      ) : (
        <CameraImage
          id={cam.id} alt={cam.name}
          attribution={cam.attribution} license={cam.license}
          refreshSeconds={cam.refreshSeconds}
        />
      )}
      <dl>
        <dt>Source</dt><dd>{cam.source}</dd>
        <dt>Location</dt><dd>{placeLabel(cam)}</dd>
        <dt>Coordinates</dt><dd>{cam.lat.toFixed(4)}, {cam.lon.toFixed(4)}</dd>
        <dt>Status</dt><dd>{cam.available ? "available" : "not answering at the last check"}</dd>
        <dt>Refresh</dt><dd>{describeCadence(cam.refreshSeconds)}</dd>
        <dt>Licence</dt><dd>{cam.license}</dd>
      </dl>

      <section>
        <h2>Nearby cameras</h2>
        <ul>
          {nearby.map((n) => (
            <li key={n.id}>
              <Link href={cameraPath(n.id)}>
                {n.name} &middot; {n.km.toFixed(2)} km
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <p className="tn-dir-note">
        {cam.region && (
          <>
            <Link href={regionPath(cam.country, cam.region)}>
              All cameras in {cam.region}
            </Link>{" "}
            &middot;{" "}
          </>
        )}
        <Link href={countryPath(cam.country)}>All cameras in {country}</Link> &middot;{" "}
        <Link href="/app">Open the console</Link>
      </p>
    </main>
  );
}
