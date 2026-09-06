// The body of a paginated camera listing, shared by the road and place routes.
//
// The region listing at app/cameras/[country]/[region] predates this and keeps its own
// markup. It is not folded in here on purpose: it is the page the whole directory
// hierarchy hangs off, it is already correct, and rewriting a working crawlable page to
// save a few lines of JSX is a regression risk with no upside for a reader.
//
// Server component. No client JavaScript reaches a listing page.

import Link from "next/link";
import { cameraPath, formatCount } from "@/lib/seo/paths";
import type { RegionCameraRow } from "@/lib/seo/registrySnapshot";

export function CameraListing({
  cameras,
  page,
  pages,
  pageSize,
  total,
  hrefForPage,
}: {
  cameras: RegionCameraRow[];
  page: number;
  pages: number;
  pageSize: number;
  total: number;
  /** Where page N lives. Supplied by the route so this file knows no URL shapes. */
  hrefForPage: (page: number) => string;
}) {
  const first = (page - 1) * pageSize + 1;
  const last = first + cameras.length - 1;

  return (
    <>
      <p className="tn-dir-lede">
        {formatCount(total)} public road {total === 1 ? "camera" : "cameras"}.{" "}
        {pages > 1 && (
          <>
            Showing {formatCount(first)}&ndash;{formatCount(last)}, page {page} of {pages}.
          </>
        )}
      </p>

      <ul className="tn-dir-cams">
        {cameras.map((c) => (
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
            <Link href={hrefForPage(page - 1)} rel="prev">
              &larr; Previous
            </Link>
          )}
          <span className="tn-dir-dim">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link href={hrefForPage(page + 1)} rel="next">
              Next &rarr;
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
