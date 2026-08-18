import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getRegionPage } from "@/lib/seo/registrySnapshot";
import {
  CAMERAS_ROOT,
  REGION_PAGE_SIZE,
  cameraPath,
  countryName,
  countryPath,
  formatCount,
  regionPageCount,
  regionPath,
  regionTitle,
} from "@/lib/seo/paths";

export const revalidate = 86_400;

interface RouteParams {
  country: string;
  region: string;
  /** Optional trailing page number: /cameras/us/florida/2. Absent means page 1. */
  paging?: string[];
}

/**
 * Reads the page number out of the optional catch-all.
 *
 * Returns null for anything that is not a plain page number, so the route 404s
 * instead of quietly serving page 1 at an unlimited number of junk URLs - which
 * would be an infinite crawl space pointing at duplicate content.
 */
function parsePage(paging: string[] | undefined): number | null {
  if (!paging || paging.length === 0) return 1;
  if (paging.length > 1) return null;
  const raw = paging[0];
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  return Number(raw);
}

/**
 * Returns NO paths, for the same reason as `/camera/[id]` - see the long note there.
 * Next's docs: "you must return an array from generateStaticParams, even if it's
 * empty. Otherwise, the route will be dynamically rendered instead of statically."
 *
 * Empty rather than the ~60 region/page combinations, so a region that appears when a
 * feed is added is cached on first visit with no build edit and no build cost.
 */
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { country, region, paging } = await params;
  const page = parsePage(paging);
  if (page === null) return { title: "Region not found" };
  const hit = await getRegionPage(country, region, page);
  if (!hit) return { title: "Region not found" };

  const pages = regionPageCount(hit.total);
  const title = regionTitle(country, hit.region, hit.total, page);
  const where = `${hit.region}, ${countryName(country)}`;

  return {
    title,
    description:
      page > 1
        ? `Page ${page} of ${pages}: more public road cameras in ${where}, each with a live image and its operator named.`
        : `Every public road camera in ${where}: ${formatCount(hit.total)} live feeds, each with its own page showing the current image, the operator and how often it refreshes.`,
    alternates: { canonical: regionPath(country, hit.region, page) },
    // Deep pages of a long list are real, useful and crawlable, but they are not
    // what should surface for "cameras in Florida" - page 1 is. Following the links
    // without indexing the tail keeps the crawl path intact and the index clean.
    robots: page > 1 ? { index: false, follow: true } : undefined,
    openGraph: { title, url: regionPath(country, hit.region, page) },
  };
}

export default async function RegionPage({ params }: { params: Promise<RouteParams> }) {
  const { country, region, paging } = await params;
  const page = parsePage(paging);
  if (page === null) notFound();

  // /cameras/us/florida/1 is the same page as /cameras/us/florida. Send it to the
  // canonical one permanently rather than serving identical content at two URLs.
  if (paging && paging.length === 1 && page === 1) permanentRedirect(regionPath(country, region));

  const hit = await getRegionPage(country, region, page);
  if (!hit) notFound();

  const pages = regionPageCount(hit.total);
  if (page > pages) notFound();

  const slice = hit.cameras;
  const first = (page - 1) * REGION_PAGE_SIZE + 1;
  const last = first + slice.length - 1;
  const countryLabel = countryName(country);

  return (
    <main className="tn-dir">
      <nav className="tn-dir-crumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link> <span aria-hidden="true">/</span>{" "}
        <Link href={CAMERAS_ROOT}>Cameras</Link> <span aria-hidden="true">/</span>{" "}
        <Link href={countryPath(country)}>{countryLabel}</Link> <span aria-hidden="true">/</span>{" "}
        <span>{hit.region}</span>
      </nav>

      <h1>
        Live traffic cameras in {hit.region}, {countryLabel}
      </h1>

      <p className="tn-dir-lede">
        {formatCount(hit.total)} public road cameras.{" "}
        {pages > 1 && (
          <>
            Showing {formatCount(first)}&ndash;{formatCount(last)}, page {page} of {pages}.
          </>
        )}
      </p>

      <ul className="tn-dir-cams">
        {slice.map((c) => (
          <li key={c.id}>
            <Link href={cameraPath(c.id)}>{c.name}</Link>
            {c.road && <span className="tn-dir-dim">{c.road}</span>}
            {!c.available && (
              <span className="tn-dir-down" title="This feed was not answering at the last check">
                not answering
              </span>
            )}
          </li>
        ))}
      </ul>

      {pages > 1 && (
        <nav className="tn-dir-pager" aria-label="Pagination">
          {page > 1 && (
            <Link href={regionPath(country, hit.region, page - 1)} rel="prev">
              &larr; Previous
            </Link>
          )}
          <span className="tn-dir-dim">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link href={regionPath(country, hit.region, page + 1)} rel="next">
              Next &rarr;
            </Link>
          )}
        </nav>
      )}

      <p className="tn-dir-note">
        <Link href={countryPath(country)}>All regions in {countryLabel}</Link> &middot;{" "}
        <Link href={CAMERAS_ROOT}>All countries</Link> &middot;{" "}
        <Link href="/app">Open the console</Link>
      </p>
    </main>
  );
}
