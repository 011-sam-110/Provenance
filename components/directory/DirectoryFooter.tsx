// The footer under every crawlable directory page: /cameras, a country, a region, a
// road, a place, and a single camera.
//
// WHY IT IS NOT THE LANDING PAGE'S FOOTER. `app/(site)/page.tsx` has a `.pv-footer`, and
// it cannot be reused here for two reasons that are both structural rather than
// stylistic. Its `.pv-*` tokens are scoped to `.pv-root` so they do not reach outside the
// marketing route group, and `app/(site)/layout.tsx` loads three marketing typefaces that
// exist only for that page — putting them on ~20k camera pages would download three fonts
// per page to render a footer. This one is `.tn-*` tokens and system type, like the rest
// of the directory.
//
// TWO LINKS IN HERE ARE OBLIGATIONS, NOT NAVIGATION:
//
//   1. The repository. AGPL-3.0 §13 requires that anyone interacting with this program
//      over a network is offered its Corresponding Source. Until now the directory pages
//      offered it nowhere — the console header and the landing footer carried the link
//      and neither is reachable from a camera page a search engine sent someone to.
//      Do not remove it without changing the licence.
//   2. GeoNames. The place names on the "cameras near X" pages come from GeoNames'
//      cities15000 gazetteer, which is CC BY 4.0. The attribution travels with the data.
//
// Server component. No client JavaScript.

import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { CAMERAS_ROOT } from "@/lib/seo/paths";

export function DirectoryFooter() {
  return (
    <footer className="tn-dir-footer">
      <div className="tn-dir-footer-cols">
        <div>
          <h2>Browse</h2>
          <Link href={CAMERAS_ROOT}>All countries</Link>
          <Link href="/app">Open the console</Link>
          <Link href="/">About {BRAND.name}</Link>
          <Link href="/privacy">Privacy</Link>
        </div>

        <div>
          <h2>The code</h2>
          <a href={BRAND.repoUrl} target="_blank" rel="noreferrer noopener">
            Source on GitHub
          </a>
          <a href={BRAND.license.url} target="_blank" rel="noreferrer noopener">
            Licence ({BRAND.license.short})
          </a>
          <a href={BRAND.kofiUrl} target="_blank" rel="noreferrer noopener">
            Support the running costs
          </a>
        </div>

        <div>
          <h2>Where the data comes from</h2>
          <p>
            Every image on these pages is fetched from the agency that operates the camera when
            you open the page. Nothing is stored or re-hosted, and each camera page names its
            operator and their licence.
          </p>
          <p>
            Place names are{" "}
            <a href="https://www.geonames.org/" target="_blank" rel="noreferrer noopener">
              GeoNames
            </a>{" "}
            data, used under{" "}
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer noopener">
              CC BY 4.0
            </a>
            . Weather and air quality are modelled values from{" "}
            <a href="https://open-meteo.com/" target="_blank" rel="noreferrer noopener">
              Open-Meteo
            </a>
            , not roadside instruments.
          </p>
        </div>
      </div>

      <p className="tn-dir-footer-base">
        {BRAND.name} is open source under the {BRAND.license.short}. Traffic camera imagery
        belongs to the agencies that publish it and stays under their own terms.
      </p>
    </footer>
  );
}
