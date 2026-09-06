import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getPlacePage } from "@/lib/seo/registrySnapshot";
import { CameraListing } from "@/components/directory/CameraListing";
import { DirectoryFooter } from "@/components/directory/DirectoryFooter";
import { PLACE_PAGE_SIZE, PLACE_RADIUS_KM } from "@/lib/seo/places";
import {
  CAMERAS_ROOT,
  countryName,
  countryPath,
  parsePageParam,
  placeDescription,
  placePath,
  placeTitle,
  regionPageCount,
} from "@/lib/seo/paths";

export const revalidate = 86_400;

interface RouteParams {
  country: string;
  place: string;
  /** Optional trailing page number: /cameras/gb/place/ealing/2. Absent means page 1. */
  paging?: string[];
}

/** Returns NO paths — see the note on the road listing and in registrySnapshot.ts. */
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { country, place, paging } = await params;
  const page = parsePageParam(paging);
  if (page === null) return { title: "Place not found" };
  const hit = await getPlacePage(country, place, page);
  if (!hit) return { title: "Place not found" };

  const pages = regionPageCount(hit.total);
  const title = placeTitle(country, hit.label, hit.total, page);

  return {
    title,
    description:
      page > 1
        ? `Page ${page} of ${pages}: more live traffic cameras near ${hit.label}, ${countryName(country)}.`
        : placeDescription(country, hit.label, hit.total, PLACE_RADIUS_KM),
    alternates: { canonical: placePath(country, hit.label, page) },
    robots: page > 1 ? { index: false, follow: true } : undefined,
    openGraph: { title, url: placePath(country, hit.label, page) },
  };
}

export default async function PlacePage({ params }: { params: Promise<RouteParams> }) {
  const { country, place, paging } = await params;
  const page = parsePageParam(paging);
  if (page === null) notFound();

  if (paging && paging.length === 1 && page === 1) {
    permanentRedirect(`${countryPath(country)}/place/${place}`);
  }

  const hit = await getPlacePage(country, place, page);
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

        {/* "near", never "in" — the listing is a radius around the town centre, and some
            of these cameras are outside the town. See placeTitle. */}
        <h1>
          Live traffic cameras near {hit.label}, {countryLabel}
        </h1>

        <CameraListing
          cameras={hit.cameras}
          page={page}
          pages={pages}
          pageSize={PLACE_PAGE_SIZE}
          total={hit.total}
          hrefForPage={(p) => placePath(country, hit.label, p)}
        />

        <p className="tn-dir-note">
          Everything within {PLACE_RADIUS_KM} km of {hit.label}. Place names are GeoNames data.{" "}
          <Link href={countryPath(country)}>All cameras in {countryLabel}</Link> &middot;{" "}
          <Link href={CAMERAS_ROOT}>All countries</Link> &middot;{" "}
          <Link href="/app">Open the console</Link>
        </p>
      </main>
      <DirectoryFooter />
    </>
  );
}
