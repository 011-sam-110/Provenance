// `sources=open`: a link that opens the console with its Sources rail open.
//
// God's eye view (/eye) has a Sources button, and the landing page has an
// "All sources" button. Both open the console on the rail that lists every source.
// The rail's open state lives in lib/console/sourcesRail.ts and starts closed, so a
// link needs a way to say "open it".
//
// READ ONCE, IN THE BROWSER, AFTER MOUNT. app/(console)/app/page.tsx must not take
// `searchParams` (tests/unit/console-static.test.ts says why), so ConsoleShell reads
// the flag from window.location in its boot effect and then drops it from the
// address. The flag only opens the rail. It writes no layer, no board and nothing to
// localStorage, so the variant spine (lib/variants) stays the one owner of layer
// state.

export const SOURCES_PARAM = "sources";
export const SOURCES_OPEN = "open";

/** True only for `sources=open`. Any other value, or none, leaves the rail as it is. */
export function wantsSourcesOpen(params: URLSearchParams): boolean {
  return params.get(SOURCES_PARAM) === SOURCES_OPEN;
}

/**
 * The same address without the flag, so a reload or a copied link does not open the
 * rail again. `search` is `location.search` (with or without its "?").
 */
export function withoutSourcesFlag(pathname: string, search: string, hash = ""): string {
  const params = new URLSearchParams(search);
  params.delete(SOURCES_PARAM);
  const qs = params.toString();
  return `${pathname}${qs ? `?${qs}` : ""}${hash}`;
}
