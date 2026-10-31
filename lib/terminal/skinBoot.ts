// THE SKIN'S CONSTANTS AND ITS BEFORE-PAINT SCRIPT, with no "use client" on purpose.
//
// lib/terminal/skin.ts is a client module, and a server layout that imports a value from one
// gets a client reference in its place (lib/eye/skin.ts tells how that broke a script on
// 2026-10-29). app/(console)/app/layout.tsx is a server layout, so what it needs lives here,
// as plain strings it can write straight into the page's HTML. skin.ts re-exports all of it,
// and the store is still the only thing that changes the skin after the first paint.

export type TerminalSkin = "light" | "dark";
export const DEFAULT_TERMINAL_SKIN: TerminalSkin = "dark";

export const SKIN_PERSIST_KEY = "tn.terminal.skin.v2";
export const SKIN_PERSIST_VERSION = 1;

/** Set on <html> as `data-tnx-skin="dark"`; REMOVED for light, never set to "light". */
export const SKIN_ATTR = "data-tnx-skin";

/**
 * Runs inline, before the console paints, so a new browser never flashes light and a saved
 * light never flashes dark. Built from the constants above so the default, the key, the
 * version and the attribute have ONE source of truth; tests/unit/terminal-skin.test.ts runs
 * it against fakes and holds it to coerceTerminalSkin.
 *
 * Only the read is inside try/catch, and the attribute is written after it. So a storage that
 * throws (private mode, a sandboxed iframe) or garbage JSON leaves the page on the default,
 * dark, and silent. It is a function because a bare `var` in an inline script is a property
 * of window.
 */
export const SKIN_BOOT_SCRIPT =
  `(function(){var s=${JSON.stringify(DEFAULT_TERMINAL_SKIN)};` +
  `try{var r=localStorage.getItem(${JSON.stringify(SKIN_PERSIST_KEY)});var e=r&&JSON.parse(r);` +
  `if(e&&e.v===${SKIN_PERSIST_VERSION}&&(e.d==="light"||e.d==="dark"))s=e.d}catch(_){}` +
  `if(s==="dark")document.documentElement.setAttribute(${JSON.stringify(SKIN_ATTR)},"dark")})()`;

/**
 * The same script for the root layout's <head>, where it runs only on /app.
 *
 * WHY THE HEAD, AND WHY IT IS NEEDED NOW THAT DARK IS THE DEFAULT. A script inside <body> runs
 * after the page's stylesheet has loaded, because a stylesheet holds up the scripts after it,
 * and the body already exists by then. So the moment the stylesheet arrives the browser may
 * draw a frame of the light ground before the parser gets back to the script. That frame was
 * caught on the dev server (tests/e2e/console-navbar.spec.ts records every one). In the <head>
 * there is no body to draw yet, so no such frame can exist: 12 production loads on three
 * network speeds drew hundreds of frames and none was light. Only the root layout can put a script there, and
 * it has no route of its own to read on a static page, so the script asks the address itself.
 *
 * Every other route pays one string compare. /eye has its own script and the landing page
 * has none, and neither reaches this one's body.
 */
export const SKIN_HEAD_SCRIPT = `if(location.pathname==="/app")${SKIN_BOOT_SCRIPT}`;
