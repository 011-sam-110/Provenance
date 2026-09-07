import { BRAND } from "@/lib/brand";

/**
 * The curtain. One self-contained HTML document, inline CSS, system fonts, no script,
 * no asset requests - it is served by the middleware on every gated request and must
 * cost nothing to render and nothing to fetch. It follows the calm light identity
 * (`--tn-*` tokens in app/globals.css) by value, because the stylesheet itself lives
 * behind the gate it is standing in for. That is also why there is no webfont: the
 * page renders in whatever the visitor's system offers.
 *
 * The repository link is not decoration: this page is now what a network user of an
 * AGPL-3.0 program sees, and section 13 says they must be offered the source. The
 * console header and the site footer are the only other two places that offer exists,
 * and this page replaces both of them.
 *
 * THERE IS DELIBERATELY NO `noindex`. The curtain is served with 503, whose whole
 * purpose is to tell a crawler the absence is temporary so the camera pages keep their
 * place in the index. A noindex asks for the opposite, and if the status ever regressed
 * to 200 it would quietly delete them. `tests/unit/gate.test.ts` pins its absence.
 */
export function maintenanceHtml(opts: {
  next: string;
  denied: boolean;
  /** MAINTENANCE_MODE is armed but MAINTENANCE_PASSWORD is not set. */
  unconfigured?: boolean;
}): string {
  const next = escapeHtml(opts.next);
  const name = escapeHtml(BRAND.name);
  const refused = opts.denied
    ? `<p class="err" role="alert">That code is not right. Check for a space on the end.</p>`
    : "";
  // Fail closed: with no code configured nobody can be let through, so offering a box
  // that cannot open would be a lie. Saying why is what makes it recoverable.
  const entry = opts.unconfigured
    ? `<p class="err" role="alert">There is no access code set on this deployment, so nobody can be let through from here.</p>`
    : `<form method="post" action="/api/gate" autocomplete="off">
    <input type="hidden" name="next" value="${next}">
    <label for="gate-code">Have the access code?</label>
    <div class="row">
      <input id="gate-code" name="password" type="password" autocomplete="off" required autofocus>
      <button type="submit">Enter</button>
    </div>
    ${refused}
  </form>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="${BRAND.accent}">
<title>${name} — offline</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body {
    display: grid; place-items: center; padding: 24px;
    background: #e9edf2; color: #1f2a37;
    font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  main {
    width: min(440px, 100%); background: #fff; border: 1px solid rgba(15,23,42,.10);
    border-radius: 14px; padding: 32px 28px 26px;
    box-shadow: 0 18px 50px -30px rgba(15,23,42,.35);
  }
  .brand { display: flex; align-items: center; gap: 10px; margin: 0 0 18px; }
  .brand b { font-size: 15px; letter-spacing: .01em; }
  .pill {
    font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
    color: ${BRAND.accent}; background: rgba(14,125,151,.10); border-radius: 999px; padding: 3px 9px;
  }
  h1 { font-size: 24px; line-height: 1.2; margin: 0 0 10px; letter-spacing: -.01em; }
  p { margin: 0 0 12px; color: #54606d; }
  .discord {
    display: inline-block; margin: 4px 0 0; padding: 9px 14px; border-radius: 9px;
    border: 1px solid rgba(15,23,42,.16); background: #f2f5f9; color: #0b6175;
    font-size: 14px; font-weight: 600; text-decoration: none;
  }
  .discord:hover { background: #fff; border-color: ${BRAND.accent}; }
  form { margin-top: 22px; padding-top: 18px; border-top: 1px solid rgba(15,23,42,.10); }
  label { display: block; font-size: 13px; font-weight: 600; color: #1f2a37; margin-bottom: 6px; }
  .row { display: flex; gap: 8px; }
  input {
    flex: 1; min-width: 0; font: inherit; letter-spacing: .12em;
    padding: 10px 12px; border: 1px solid rgba(15,23,42,.16); border-radius: 9px; background: #f2f5f9; color: #1f2a37;
  }
  input:focus { outline: 2px solid ${BRAND.accent}; outline-offset: 1px; border-color: transparent; background: #fff; }
  button {
    font: inherit; font-weight: 600; padding: 10px 16px; border: 0; border-radius: 9px; cursor: pointer;
    background: ${BRAND.accent}; color: #fff;
  }
  button:hover { background: #0b6175; }
  .err { color: #a33a2e; font-size: 14px; margin: 10px 0 0; }
  footer { margin-top: 22px; padding-top: 14px; border-top: 1px solid rgba(15,23,42,.10); font-size: 12px; color: #626e7d; }
  footer a { color: inherit; }
</style>
</head>
<body>
<main>
  <p class="brand"><b>${name}</b><span class="pill">Offline</span></p>
  <h1>${name} is offline</h1>
  <p>A surge in visitors pushed the running cost past what this project can carry, so the site is down for now.</p>
  <p>A lot of feedback came in with those visitors. A new release is planned in about a month, and development updates go to the Discord.</p>
  <a class="discord" href="${BRAND.discordUrl}" rel="noopener">Updates on Discord →</a>
  ${entry}
  <footer>Source: <a href="${BRAND.repoUrl}" rel="noopener">${escapeHtml(BRAND.repo)}</a> · ${escapeHtml(BRAND.license.short)}</footer>
</main>
</body>
</html>
`;
}

/** Enough escaping for text nodes and double-quoted attribute values. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
