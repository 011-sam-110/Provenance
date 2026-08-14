import type { Metadata } from "next";
import Link from "next/link";
import { getRegistry } from "@/lib/sources/registry";
import { groupByCountry } from "@/lib/seo/directory";
import { CAMERAS_ROOT, countryPath, formatCount, regionPath } from "@/lib/seo/paths";
import { BRAND } from "@/lib/brand";

export const revalidate = 86_400;

export const metadata: Metadata = {
  title: `Live traffic cameras by country | ${BRAND.name}`,
  description:
    "Browse every public road camera on the map by country and region. Each camera has its own page with a live image, its operator, its refresh interval and the cameras nearest to it.",
  alternates: { canonical: CAMERAS_ROOT },
};

export default async function CamerasIndex() {
  const cameras = await getRegistry().catch(() => []);
  const groups = groupByCountry(cameras);
  const available = cameras.filter((c) => c.available).length;
  const regionCount = groups.reduce((n, g) => n + g.regions.length, 0);

  return (
    <main className="tn-dir">
      <nav className="tn-dir-crumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link> <span aria-hidden="true">/</span> <span>Cameras</span>
      </nav>

      <h1>Live traffic cameras by country</h1>

      <p className="tn-dir-lede">
        {formatCount(cameras.length)} public road cameras from {groups.length} countries and{" "}
        {formatCount(regionCount)} regions, read directly from the transport authorities that
        operate them. {formatCount(available)} were answering at the last check.
      </p>

      <p className="tn-dir-note">
        Every camera below has its own page showing the current image, who operates the feed, how
        often it refreshes and the nearest other cameras. Nothing here is stored or re-hosted: each
        frame is fetched from its operator when you open the page.
      </p>

      <ul className="tn-dir-grid">
        {groups.map((country) => (
          <li key={country.iso2} className="tn-dir-card">
            <h2>
              <Link href={countryPath(country.iso2)}>{country.name}</Link>
            </h2>
            <p className="tn-dir-count">
              {formatCount(country.count)} cameras across {country.regions.length}{" "}
              {country.regions.length === 1 ? "region" : "regions"}
            </p>
            <ul className="tn-dir-sub">
              {country.regions.slice(0, 6).map((region) => (
                <li key={region.slug}>
                  <Link href={regionPath(country.iso2, region.region)}>{region.region}</Link>{" "}
                  <span className="tn-dir-dim">{formatCount(region.count)}</span>
                </li>
              ))}
              {country.regions.length > 6 && (
                <li>
                  <Link href={countryPath(country.iso2)}>
                    and {country.regions.length - 6} more
                  </Link>
                </li>
              )}
            </ul>
          </li>
        ))}
      </ul>

      <p className="tn-dir-note">
        Prefer the map? <Link href="/app">Open the console</Link> to see these cameras alongside
        flights, earthquakes and the other live layers.
      </p>
    </main>
  );
}
