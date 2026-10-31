// The God's eye view is ALWAYS the console's dark mode, whatever the console itself is set to.
// Leon's words: "GEV sources list should be dark mode to match, keep UI same."
//
// The console's dark mode is one attribute on <html> (`data-tnx-skin="dark"`, PR #325,
// lib/terminal/skin.ts), and every one of its rules in app/globals.css hangs off it. So
// this view switches that attribute ON for itself, before it paints, and changes none of
// the console's CSS. The console's rows and popovers that this view borrows and every native
// control see it. This view's own frame and its Sources tray (EyeHud.module.css,
// EyeSources.module.css) have their own dark look and sit in no `.tn-terminal` scope.
//
// IT NEVER READS OR WRITES THE CONSOLE'S SAVED CHOICE (`tn.terminal.skin.v2`). The script
// below ignores storage altogether, and nothing under components/eye or app/(console)/eye
// imports the skin store (tests/unit/eye-skin.test.ts). Every way into /eye and out of it
// is a full page load, so the attribute never reaches /app, whose own boot script reads
// the saved choice and decides there.
//
// Run before paint by app/(console)/eye/layout.tsx, so the tray never flashes light.

// THE ATTRIBUTE NAME IS WRITTEN OUT, NOT IMPORTED. lib/terminal/skin.ts is a "use client"
// module, and a server layout that imports a value from one gets a client reference in its
// place: `SKIN_ATTR` came through as `undefined` and the script read `setAttribute(undefined,
// "dark")` (seen on the dev server, 29 Oct 2026). tests/unit/eye-skin.test.ts pins this
// string to `SKIN_ATTR`, so the two cannot drift apart.

export const EYE_SKIN_ATTR = "data-tnx-skin";

export const EYE_SKIN_SCRIPT = `document.documentElement.setAttribute(${JSON.stringify(EYE_SKIN_ATTR)},"dark")`;
