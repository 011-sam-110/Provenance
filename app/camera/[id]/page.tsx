import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCameraPage, getCountryFacets } from "@/lib/seo/registrySnapshot";
import { isLiveStreamUrl } from "@/lib/proxy/hls-allowlist";
import { CameraImage } from "@/components/CameraImage";
import { CameraVideo } from "@/components/CameraVideo";
import { CameraConditions } from "@/components/directory/CameraConditions";
import { NearbyCameras } from "@/components/directory/NearbyCameras";
import { DirectoryFooter } from "@/components/directory/DirectoryFooter";
import { isPageableRoad } from "@/lib/seo/roads";
import { PLACE_RADIUS_KM, placesNear } from "@/lib/seo/places";
import { slugify } from "@/lib/seo/paths";
import {
  CAMERAS_ROOT,
  cameraDescription,
  cameraPath,
  cameraTitle,
  countryName,
  countryPath,
  describeCadence,
  formatCount,
  placeLabel,
  placePath,
  regionPath,
  roadPath,
} from "@/lib/seo/paths";

/**
 * Was `force-dynamic`, which meant this page was recomputed from the registry on
 * every single request and could never be cached at the edge.
 *
 * It is safe to cache: the only genuinely live things on the page are the frame and the
 * conditions grid, and both are fetched by CLIENT components on their own schedule.
 * Everything the server renders - name, place, operator, cadence, neighbours, the
 * cross-links - changes at the speed of the registry, not the speed of traffic.
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
 * Deliberately empty rather than the full id list: there are ~20k crawlable camera
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

  const { camera: cam, nearby, regionCount } = hit;
  const live = isLiveStreamUrl(cam.streamUrl);
  const country = countryName(cam.country);

  // Every cross-link below is resolved against what the directory can ACTUALLY serve.
  // A road row appears only for a road that has its own page, and a place row only for
  // a place that has one — no link on this page points at a 404, and none of them state
  // a count that was not counted. `getCountryFacets` is keyed by country, so all ~20k
  // camera pages in one country share a single cache entry for this.
  const facets = await getCountryFacets(cam.country);
  const roadSlug = isPageableRoad(cam.road) ? slugify((cam.road as string).trim()) : null;
  const roadFacet = roadSlug ? facets.roads.find((r) => r.slug === roadSlug) : undefined;

  // Towns near the camera that are big enough in the registry to have a page of their
  // own. `placesNear` is registry-free, so this costs a lookup in the committed place
  // table rather than a pass over every camera.
  const nearPlaces = placesNear(cam.lat, cam.lon, cam.country)
    .map(({ place, km }) => {
      const facet = facets.places.find((p) => p.slug === slugify(place.name));
      return facet ? { name: facet.label, slug: facet.slug, count: facet.count, km } : null;
    })
    .filter((p): p is { name: string; slug: string; count: number; km: number } => p !== null)
    .slice(0, 4);

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
    <>
      <main className="tn-dir tn-cam">
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

        {/* The heading carries the camera's name, what the page is, and where — the three
            things a search result is scanned for. A colon rather than a dash keeps it one
            readable line without punctuation that has to be guessed at. */}
        <h1>
          {cam.name}: live traffic camera, {placeLabel(cam)}
        </h1>

        <p className="tn-dir-lede">
          Live view from {cam.name}
          {cam.road && isPageableRoad(cam.road) ? ` on ${cam.road}` : ""} in {placeLabel(cam)}. The
          image refreshes {describeCadence(cam.refreshSeconds)}, direct from {cam.attribution}.
        </p>

        <p className="tn-cam-chips">
          <span className={cam.available ? "tn-cam-chip tn-cam-chip-live" : "tn-cam-chip tn-cam-chip-down"}>
            {cam.available ? "Answering at the last check" : "Not answering at the last check"}
          </span>
          <span className="tn-cam-chip">
            {cam.source} · {describeCadence(cam.refreshSeconds)}
          </span>
          <span className="tn-cam-chip tn-cam-chip-mono">
            {cam.lat.toFixed(4)}, {cam.lon.toFixed(4)}
          </span>
        </p>

        <div className="tn-cam-frame">
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
        </div>

        <p className="tn-cam-underframe">
          <span>
            {cam.attribution} · {cam.license}
          </span>
          {/* The console's own deep-link shape (lib/share/url.ts): `obj` is the id of the
              dossier to open and is resolved against the camera layer's rows, `layers`
              narrows the map to the one layer this camera is on. lat/lon/z are sent too
              because they are what makes the link useful even if the id no longer
              resolves — a de-registered camera still lands the reader on the right
              street rather than on the default view. */}
          <Link
            href={`/app?lat=${cam.lat.toFixed(4)}&lon=${cam.lon.toFixed(4)}&z=14&layers=cameras&obj=${encodeURIComponent(cam.id)}`}
          >
            Open in the console
          </Link>
        </p>

        <CameraConditions
          lat={cam.lat}
          lon={cam.lon}
          country={cam.country}
          surface={cam.surface}
        />

        <NearbyCameras
          self={{ id: cam.id, name: cam.name, lat: cam.lat, lon: cam.lon }}
          nearby={nearby}
        />

        <div className="tn-cam-cols">
          <section aria-labelledby="about-heading">
            <h2 id="about-heading">About this feed</h2>
            <dl className="tn-cam-dl">
              <dt>Operator</dt>
              <dd>{cam.attribution}</dd>
              <dt>Feed id</dt>
              <dd className="tn-cam-mono">{cam.id}</dd>
              {cam.road && (
                <>
                  <dt>Road</dt>
                  <dd>
                    {roadFacet ? (
                      <Link href={roadPath(cam.country, roadFacet.label)}>{cam.road}</Link>
                    ) : (
                      cam.road
                    )}
                  </dd>
                </>
              )}
              <dt>Refresh</dt>
              <dd>{describeCadence(cam.refreshSeconds)}</dd>
              <dt>Status</dt>
              <dd>{cam.available ? "answering at the last check" : "not answering at the last check"}</dd>
              <dt>Licence</dt>
              <dd>{cam.license}</dd>
            </dl>
            <p className="tn-dir-note">
              Nothing is stored or re-hosted: each frame is fetched from {cam.attribution} when
              you open this page. Weather and air quality are modelled values for the nearest
              grid point, not instruments at the roadside.
            </p>
          </section>

          <section aria-labelledby="more-heading">
            <h2 id="more-heading">More cameras</h2>
            <ul className="tn-cam-links">
              {roadFacet && (
                <li>
                  <Link href={roadPath(cam.country, roadFacet.label)}>
                    All {formatCount(roadFacet.count)} cameras on {roadFacet.label}
                  </Link>
                </li>
              )}
              {nearPlaces.length > 0 && (
                <li>
                  Cameras near{" "}
                  {nearPlaces.map((p, i) => (
                    <span key={p.slug}>
                      {i > 0 && " · "}
                      <Link href={placePath(cam.country, p.name)}>{p.name}</Link>
                    </span>
                  ))}
                </li>
              )}
              {cam.region && regionCount > 0 && (
                <li>
                  <Link href={regionPath(cam.country, cam.region)}>
                    All {formatCount(regionCount)} cameras in {cam.region}
                  </Link>
                </li>
              )}
              <li>
                <Link href={countryPath(cam.country)}>
                  All {formatCount(facets.total)} cameras in {country}
                </Link>
              </li>
              <li>
                <Link href={CAMERAS_ROOT}>Browse every country</Link>
              </li>
            </ul>
            {nearPlaces.length > 0 && (
              <p className="tn-dir-note">
                A place listing covers everything within {PLACE_RADIUS_KM} km of that town.
              </p>
            )}
          </section>
        </div>
      </main>
      <DirectoryFooter />
    </>
  );
}
