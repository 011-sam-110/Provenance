import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCameraById, nearestTo } from "@/lib/sources/registry";
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
export const revalidate = 3_600;

async function load(idParam: string) {
  return getCameraById(decodeURIComponent(idParam));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const cam = await load(id);
  if (!cam) return { title: "Camera not found" };

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
  const cam = await load(id);
  if (!cam) notFound();

  const nearby = (await nearestTo(cam.lat, cam.lon, 8))
    .filter((n) => n.camera.id !== cam.id)
    .slice(0, 6);
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
            <li key={n.camera.id}>
              <Link href={cameraPath(n.camera.id)}>
                {n.camera.name} &middot; {n.km.toFixed(2)} km
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
