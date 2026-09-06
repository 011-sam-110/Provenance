import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getRoadPage } from "@/lib/seo/registrySnapshot";
import { CameraListing } from "@/components/directory/CameraListing";
import { DirectoryFooter } from "@/components/directory/DirectoryFooter";
import { ROAD_PAGE_SIZE } from "@/lib/seo/roads";
import {
  CAMERAS_ROOT,
  countryName,
  countryPath,
  parsePageParam,
  regionPageCount,
  roadDescription,
  roadHeading,
  roadPath,
  roadTitle,
} from "@/lib/seo/paths";

export const revalidate = 86_400;

interface RouteParams {
  country: string;
  road: string;
  /** Optional trailing page number: /cameras/us/road/i-95/2. Absent means page 1. */
  paging?: string[];
}

/**
 * Returns NO paths, for the same reason as `/camera/[id]` and the region listing — see
 * the long note in lib/seo/registrySnapshot.ts. Next's docs: "you must return an array
 * from generateStaticParams, even if it's empty. Otherwise, the route will be
 * dynamically rendered instead of statically."
 */
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { country, road, paging } = await params;
  const page = parsePageParam(paging);
  if (page === null) return { title: "Road not found" };
  const hit = await getRoadPage(country, road, page);
  if (!hit) return { title: "Road not found" };

  const pages = regionPageCount(hit.total);
  const title = roadTitle(country, hit.label, hit.total, page);

  return {
    title,
    description:
      page > 1
        ? `Page ${page} of ${pages}: more live traffic cameras on ${hit.label} in ${countryName(country)}.`
        : roadDescription(country, hit.label, hit.total),
    alternates: { canonical: roadPath(country, hit.label, page) },
    // Deep pages of a long list are real and crawlable but are not what should surface
    // for "I-95 cameras" — page 1 is. Same call as the region listing.
    robots: page > 1 ? { index: false, follow: true } : undefined,
    openGraph: { title, url: roadPath(country, hit.label, page) },
  };
}

export default async function RoadPage({ params }: { params: Promise<RouteParams> }) {
  const { country, road, paging } = await params;
  const page = parsePageParam(paging);
  if (page === null) notFound();

  // /cameras/us/road/i-95/1 is the same page as /cameras/us/road/i-95. Send it to the
  // canonical one permanently rather than serving identical content at two URLs.
  if (paging && paging.length === 1 && page === 1) permanentRedirect(`${countryPath(country)}/road/${road}`);

  const hit = await getRoadPage(country, road, page);
  if (!hit) notFound();

  const pages = regionPageCount(hit.total);
  if (page > pages) notFound();

  const countryLabel = countryName(country);

  return (
    <>
      <main className="tn-dir">
        <nav className="tn-dir-crumbs" aria-label="Breadcrumb">
          <Link href="/">Home</Link> <span aria-hidden="true">/</span>{" "}
          <Link href={CAMERAS_ROOT}>Cameras</Link> <span aria-hidden="true">/</span>{" "}
          <Link href={countryPath(country)}>{countryLabel}</Link> <span aria-hidden="true">/</span>{" "}
          <span>{hit.label}</span>
        </nav>

        <h1>
          {roadHeading(hit.label)}, {countryLabel}
        </h1>

        <CameraListing
          cameras={hit.cameras}
          page={page}
          pages={pages}
          pageSize={ROAD_PAGE_SIZE}
          total={hit.total}
          hrefForPage={(p) => roadPath(country, hit.label, p)}
        />

        <p className="tn-dir-note">
          <Link href={countryPath(country)}>All cameras in {countryLabel}</Link> &middot;{" "}
          <Link href={CAMERAS_ROOT}>All countries</Link> &middot;{" "}
          <Link href="/app">Open the console</Link>
        </p>
      </main>
      <DirectoryFooter />
    </>
  );
}
