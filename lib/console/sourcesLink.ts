// `sources=open`: a link that opens the console with its Sources rail open.
//
// The landing page has an "All sources" button, which opens the console on the rail
// that lists every source. The rail's open state lives in lib/console/sourcesRail.ts and starts closed, so a
// link needs a way to say "open it".
//
// READ ONCE, IN THE BROWSER, AFTER MOUNT. app/(console)/app/page.tsx must not take
// `searchParams` (tests/unit/console-static.test.ts says why), so ConsoleShell reads
// the flag from window.location in its boot effect and then drops it from the
// address. The flag only opens the rail. It writes no layer, no board and nothing to
// localStorage, so the variant spine (lib/variants) stays the one owner of layer state.
//
// `eye=` IS DROPPED AND NOTHING ELSE. It used to carry God's eye view's own link for a "Back
// to <place>" chip on the map, which was removed on Sam's word (2026-10-31): the person on the
// map (components/console/EyePerson.tsx) is the way in now. /eye no longer sends the param, but
// links kept from before that day carry it, so the address has to shed it, and nothing here
// reads what it holds.

export const SOURCES_PARAM = "sources";
export const SOURCES_OPEN = "open";
/** What an old God's eye view link carried. Dropped from the address, never read. */
export const OLD_EYE_PARAM = "eye";

/** True only for `sources=open`. Any other value, or none, leaves the rail as it is. */
export function wantsSourcesOpen(params: URLSearchParams): boolean {
  return params.get(SOURCES_PARAM) === SOURCES_OPEN;
}

/**
 * The same address without the arrival flags (`sources=` and `eye=`), so a reload or a
 * copied link does not open the rail again or keep a dead param. `search` is
 * `location.search` (with or without its "?").
 */
export function withoutArrivalFlags(pathname: string, search: string, hash = ""): string {
  const params = new URLSearchParams(search);
  params.delete(SOURCES_PARAM);
  params.delete(OLD_EYE_PARAM);
  const qs = params.toString();
  return `${pathname}${qs ? `?${qs}` : ""}${hash}`;
}
