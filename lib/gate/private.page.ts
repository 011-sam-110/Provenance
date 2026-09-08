import { BRAND } from "@/lib/brand";

/**
 * The unlock form for the private endpoint.
 *
 * Self-contained: inline CSS, system fonts, no same-origin references at all. The
 * maintenance curtain can reference `public/brand/` because the gate exempts it; this
 * page deliberately references nothing, so it cannot acquire a dependency on a path
 * somebody later decides to gate.
 *
 * `noindex` IS CORRECT HERE and is the opposite of the maintenance curtain's choice.
 * That one omits it on purpose, because a 503 tells a crawler the absence is temporary
 * and a noindex would ask it to forget ~20k camera pages instead. Nothing is meant to
 * find this page: it is served at an unlisted path, with 401, and the only way to
 * arrive is to have been given the URL.
 *
 * The repository link is not decoration. This is a network-interactive surface of an
 * AGPL-3.0-only program, so section 13 says whoever reaches it must be offered the
 * Corresponding Source — including someone who never gets past this form. The console
 * behind the gate carries the same link in its header; this covers the door.
 *
 * IT NAMES NOTHING BEHIND IT. No title, no screenshot, no "Streets", no hint of what
 * is unreleased. Someone who guessed the path learns only that a password exists,
 * which is all the page needs to say to be usable by the people who were given it.
 */
export function privateUnlockHtml(opts: { next: string; denied: boolean }): string {
  const { next, denied } = opts;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>Restricted</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #f6f5f2; color: #1b1a17; padding: 24px;
    font: 15px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  main { width: 100%; max-width: 26rem; }
  h1 { font-size: 1rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; margin: 0 0 .5rem; }
  p { margin: 0 0 1.25rem; color: #56534c; }
  form { display: flex; flex-direction: column; gap: .625rem; }
  label { font-size: .8125rem; color: #56534c; }
  input {
    font: inherit; padding: .625rem .75rem; border: 1px solid #cfcbc2;
    border-radius: 6px; background: #fff; color: inherit; width: 100%;
  }
  input:focus-visible { outline: 2px solid #1b1a17; outline-offset: 1px; }
  button {
    font: inherit; padding: .625rem 1rem; border: 1px solid #1b1a17; border-radius: 6px;
    background: #1b1a17; color: #f6f5f2; cursor: pointer;
  }
  button:hover { background: #33302b; }
  .err { color: #a3261d; font-size: .8125rem; margin: 0 0 .75rem; }
  footer { margin-top: 1.75rem; font-size: .75rem; color: #7a766d; }
  footer a { color: inherit; }
</style>
</head>
<body>
<main>
  <h1>Restricted</h1>
  <p>This page needs a password.</p>
  ${denied ? `<p class="err" role="alert">That password was not accepted.</p>` : ""}
  <form method="POST" action="/api/private">
    <input type="hidden" name="next" value="${escapeAttr(next)}">
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
    <button type="submit">Continue</button>
  </form>
  <footer>
    ${escapeHtml(BRAND.name)} is ${escapeHtml(BRAND.license.short)}.
    <a href="${escapeAttr(BRAND.repoUrl)}" rel="noreferrer">Source</a>.
  </footer>
</main>
</body>
</html>`;
}

/** `next` is a same-origin path that has already been through safeNext, but it is
 *  still interpolated into an attribute, so it is escaped here too. Defence in depth
 *  costs one function and removes the need to reason about the caller. */
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
