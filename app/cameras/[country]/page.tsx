import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDirectory } from "@/lib/seo/registrySnapshot";
import {
  CAMERAS_ROOT,
  countryName,
  countryPath,
  countryTitle,
  formatCount,
  regionPath,
} from "@/lib/seo/paths";
import { DirectoryFooter } from "@/components/directory/DirectoryFooter";

export const revalidate = 86_400;

/**
 * Pre-renders the country pages at build time. There are only eight of them and they
 * are the hinge of the whole crawl path, so they should not depend on a cold cache
 * being warm when a crawler first arrives.
 */
export async function generateStaticParams() {
  const { groups } = await getDirectory();
  return groups.map((g) => ({ country: g.iso2.toLowerCase() }));
}

async function load(countryParam: string) {
  const { groups } = await getDirectory();
  return groups.find((g) => g.iso2.toLowerCase() === countryParam.toLowerCase()) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ country: string }>;
}): Promise<Metadata> {
  const { country } = await params;
  const group = await load(country);
  if (!group) return { title: "Country not found" };

  const name = countryName(group.iso2);
  return {
    title: countryTitle(group.iso2, group.count),
    description: `Every public road camera in ${name} on one map: ${formatCount(group.count)} cameras across ${group.regions.length} regions, each with a live image and its operator named.`,
    alternates: { canonical: countryPath(group.iso2) },
    openGraph: {
      title: countryTitle(group.iso2, group.count),
      url: countryPath(group.iso2),
    },
  };
}

export default async function CountryPage({ params }: { params: Promise<{ country: string }> }) {
  const { country } = await params;
  const group = await load(country);
  if (!group) notFound();

  return (
    <>
      <main className="tn-dir">
        <nav className="tn-dir-crumbs" aria-label="Breadcrumb">
          <Link href="/">Home</Link> <span aria-hidden="true">/</span>{" "}
          <Link href={CAMERAS_ROOT}>Cameras</Link> <span aria-hidden="true">/</span>{" "}
          <span>{group.name}</span>
        </nav>

        <h1>Live traffic cameras in {group.name}</h1>

        <p className="tn-dir-lede">
          {formatCount(group.count)} public road cameras across {group.regions.length}{" "}
          {group.regions.length === 1 ? "region" : "regions"}. Pick a region to see its cameras.
        </p>

        <ul className="tn-dir-regions">
          {group.regions.map((region) => (
            <li key={region.slug}>
              <Link href={regionPath(group.iso2, region.region)}>{region.region}</Link>
              <span className="tn-dir-dim">
                {formatCount(region.count)} {region.count === 1 ? "camera" : "cameras"}
              </span>
            </li>
          ))}
        </ul>

        <p className="tn-dir-note">
          <Link href={CAMERAS_ROOT}>All countries</Link> &middot;{" "}
          <Link href="/app">Open the console</Link>
        </p>
      </main>
      <DirectoryFooter />
    </>
  );
}
