import { BRAND } from "@/lib/brand";

/**
 * The curtain: one self-contained HTML document served in place of every gated
 * request. Inline CSS, system fonts. It follows the calm light identity (`--tn-*`
 * tokens in app/globals.css) BY VALUE, because the stylesheet itself lives behind the
 * gate this page is standing in for.
 *
 * THE ONLY SAME-ORIGIN THINGS IT MAY REFERENCE ARE PATHS THE GATE EXEMPTS. The three
 * screenshots live in `public/brand/`, which is exempt so already-shared link cards keep
 * rendering — so they survive the gate and cost no function invocation, the CDN serves
 * them. Point one `src` at anything gated and it 503s inside its own curtain.
 * `tests/unit/gate.test.ts` walks every same-origin URL in this document through
 * `isGatedPath()` and fails if one of them would not load.
 *
 * The screenshots are re-encoded to ~1200px WebP (356 KB for all three, down from
 * 6.2 MB of raw PNG). That is not a nicety: this page is served on EVERY gated
 * request, and the outage exists because bandwidth got expensive. `next.config.ts`
 * gives them a long immutable cache so a repeat view costs nothing.
 *
 * THERE IS DELIBERATELY NO `noindex`. The curtain is served with 503, whose whole
 * purpose is to tell a crawler the absence is temporary so the camera pages keep their
 * place in the index. A noindex asks for the opposite, and if the status ever regressed
 * to 200 it would quietly delete them.
 *
 * The repository link is not decoration: this page is what a network user of an
 * AGPL-3.0 program now sees, and section 13 says they must be offered the source. The
 * console header and the site footer are the only other two places that offer exists,
 * and this page replaces both.
 *
 * EVERY FIGURE IN `STATS` IS A LITERAL, AND EVERY ONE IS PINNED BY A TEST. The curtain
 * cannot import the registries — that would drag ~39 adapters into the edge bundle it is
 * trying to keep cheap — so the numbers are typed here and `tests/unit/gate.test.ts`
 * derives each one from its real source and fails on drift. CLAUDE.md's standing rule is
 * that every count rots; the camera row of that same table was wrong twice before a test
 * watched it. This page is worse than a README, because for a month it is the ONLY page.
 */

/**
 * The five figures the curtain states as fact, measured 2026-09-07.
 *
 * THERE ARE TWO CAMERA SETS AND THIS QUOTES ONE, WHICH IS WHY THE NOTE UNDER THE GRID
 * exists. 70,698 is the committed Windy catalogue in `public/webcams/manifest.json`. It
 * does NOT include the 17 operator networks in `lib/sources/`, which are fetched live and
 * ran to roughly 19,000 more — so the real total is nearer 90,000 and the tile understates
 * the product.
 *
 * The live half is still not printed as a figure, and that is the house rule rather than
 * caution: `/api/coverage` was observed between 12,866 and 19,208 in a SINGLE afternoon,
 * and `readme-counts.test.ts` sets the standard that structural counts get pinned while
 * measured ones get a date and are left alone. A number no test can hold, on the only page
 * the site serves for a month, rots in public. So the note states it as a dated
 * measurement, which is checkable, instead of a headline, which would not be.
 */
const STATS: ReadonlyArray<{ figure: string; label: string }> = [
  { figure: "70,698", label: "webcams catalogued worldwide" },
  { figure: "17", label: "camera networks in 11 countries" },
  { figure: "32", label: "live map layers" },
  { figure: "63", label: "console widgets" },
  { figure: "13", label: "monitor profiles" },
];

/** Discord's own mark, inlined — the only way to make the button read as Discord without loading anything. */
const DISCORD_MARK =
  `<svg class="mark" viewBox="0 0 127.14 96.36" width="20" height="16" aria-hidden="true" focusable="false">` +
  `<path fill="currentColor" d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z"/></svg>`;

/** A cup, drawn in strokes so it inherits the button colour. Same reason: nothing external loads. */
const KOFI_MARK =
  `<svg class="cup" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">` +
  `<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4Z"/>` +
  `<line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>`;

export function maintenanceHtml(opts: {
  next: string;
  denied: boolean;
  /** MAINTENANCE_MODE is armed but MAINTENANCE_PASSWORD is not set. */
  unconfigured?: boolean;
}): string {
  const next = escapeHtml(opts.next);
  const name = escapeHtml(BRAND.name);
  const refused = opts.denied
    ? `<p class="err" role="alert">That code is not right.</p>`
    : "";
  // Fail closed: with no code configured nobody can be let through, so offering a box
  // that cannot open would be a lie. Saying why is what makes it recoverable.
  const entry = opts.unconfigured
    ? `<p class="err" role="alert">There is no access code set on this deployment, so nobody can be let through from here.</p>`
    : `<form method="post" action="/api/gate" autocomplete="off">
          <label for="gate-code">Have an access code?</label>
          <div class="row">
            <input id="gate-code" name="password" type="password" autocomplete="off" required>
            <button type="submit">Enter</button>
          </div>
          <input type="hidden" name="next" value="${next}">
          ${refused}
        </form>`;
  const stats = STATS.map(
    (s) => `<li><b>${escapeHtml(s.figure)}</b><span>${escapeHtml(s.label)}</span></li>`,
  ).join("\n      ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="${BRAND.accent}">
<title>${name} — offline</title>
<style>
  :root {
    color-scheme: light;
    --bg: #e9edf2; --surface: #fff; --surface-2: #f2f5f9;
    --ink: #1f2a37; --muted: #54606d; --faint: #626e7d;
    --line: rgba(15,23,42,.10); --line-2: rgba(15,23,42,.16);
    --accent: ${BRAND.accent}; --accent-2: #0b6175; --warn: #a85907;
    --blurple: #5865f2; --blurple-2: #4752c4;
    --mono: ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    background: var(--bg); color: var(--ink);
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--accent-2); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  h2 { font-size: 19px; letter-spacing: -.014em; margin: 0 0 10px; }

  .bar { border-bottom: 1px solid var(--line); background: rgba(255,255,255,.72); }
  .in { max-width: 1040px; margin: 0 auto; padding-left: 24px; padding-right: 24px; }
  .bar .in { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 15px; padding-bottom: 15px; }
  .word { display: flex; align-items: center; gap: 11px; font-size: 14px; font-weight: 600; letter-spacing: .2em; }
  /* 64px source drawn at 26px, so it stays crisp on a 2x screen and costs 3 KB. */
  .logo { display: block; width: 26px; height: 26px; border-radius: 6px; }
  .state {
    font-family: var(--mono); font-size: 11px; letter-spacing: .1em; text-transform: uppercase;
    color: var(--warn); background: rgba(168,89,7,.10); border-radius: 999px; padding: 4px 11px; white-space: nowrap;
  }

  .hero { display: grid; grid-template-columns: minmax(0,1.35fr) minmax(0,1fr); gap: 46px; align-items: start; padding-top: 56px; padding-bottom: 48px; }
  h1 { font-size: clamp(31px, 4.2vw, 43px); line-height: 1.08; letter-spacing: -.022em; margin: 0 0 20px; max-width: 15ch; }
  .lede p { font-size: 17px; color: var(--muted); margin: 0 0 14px; max-width: 54ch; }

  /* The live pulse. Hidden until real data lands, so a blocked request, a rate limit or
     a browser with no script leaves no empty row and never a stale claim. */
  /* Not flex: a flex gap would space the trailing full stop away from the link. */
  .pulse { font-size: 14px; color: var(--faint); margin: 18px 0 0; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #2f9e44; margin-right: 9px; vertical-align: middle; }
  [hidden] { display: none !important; }

  .discord {
    display: inline-flex; align-items: center; gap: 10px;
    padding: 12px 20px; border-radius: 10px; background: var(--blurple); color: #fff;
    font-weight: 600; font-size: 15px; text-decoration: none;
  }
  .discord:hover { background: var(--blurple-2); }
  /* Discord is the primary action and keeps its brand colour; Ko-fi sits beside it in
     the calm ink so the pair reads as one row with one lead, not two competing pitches. */
  .ctas { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 22px; }

  .key { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 21px; box-shadow: 0 20px 54px -36px rgba(15,23,42,.45); }
  label { display: block; font-family: var(--mono); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--faint); margin-bottom: 9px; }
  .row { display: flex; gap: 8px; }
  input[type=password] {
    flex: 1; min-width: 0; font: inherit; letter-spacing: .14em;
    padding: 10px 12px; border: 1px solid var(--line-2); border-radius: 9px; background: var(--surface-2); color: var(--ink);
  }
  input[type=password]:focus { background: #fff; }
  button {
    font: inherit; font-weight: 600; padding: 10px 17px; border: 1px solid var(--line-2); border-radius: 9px;
    background: var(--surface-2); color: var(--ink); cursor: pointer;
  }
  button:hover { background: #fff; border-color: var(--accent); color: var(--accent-2); }
  .err { color: #a33a2e; font-size: 14px; margin: 12px 0 0; }
  .hint { font-size: 13px; line-height: 1.6; color: var(--faint); margin: 14px 2px 0; }

  section { border-top: 1px solid var(--line); padding-top: 38px; padding-bottom: 34px; }
  .eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--faint); margin: 0 0 20px; }

  .grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 12px; }
  .grid li { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px 15px; }
  .grid b { display: block; font-size: 25px; font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .grid span { display: block; font-size: 12.5px; line-height: 1.45; color: var(--muted); margin-top: 5px; }
  .note { font-size: 13px; line-height: 1.6; color: var(--faint); margin: 16px 0 0; max-width: 74ch; }

  figure { margin: 0; }
  .shot { display: block; width: 100%; height: auto; border-radius: 11px; border: 1px solid var(--line-2); background: var(--surface-2); }
  figcaption { font-size: 13.5px; line-height: 1.5; color: var(--muted); margin-top: 11px; max-width: 62ch; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 30px; }

  .band { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 24px; display: flex; flex-direction: column; }
  .card p { font-size: 15px; color: var(--muted); margin: 0 0 20px; }
  .card .discord, .card .kofi { margin-top: auto; align-self: flex-start; }
  .kofi {
    display: inline-flex; align-items: center; gap: 9px; padding: 12px 20px; border-radius: 10px;
    background: var(--ink); color: #fff; font-weight: 600; font-size: 15px; text-decoration: none;
  }
  .kofi:hover { background: #0b1016; }
  .cup { width: 17px; height: 17px; flex: none; }

  footer { border-top: 1px solid var(--line); }
  .foot { padding-top: 30px; padding-bottom: 46px; }
  .meta { font-size: 12.5px; line-height: 1.7; color: var(--faint); margin: 0; }
  .meta a { color: var(--faint); }

  @media (max-width: 900px) {
    .hero { grid-template-columns: 1fr; gap: 32px; padding-top: 38px; padding-bottom: 32px; }
    .grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
    /* Five tiles in two columns leaves the last one stranded on its own row. Only
       scoped here: at five columns the same selector would stretch it across the lot. */
    .grid li:last-child:nth-child(odd) { grid-column: 1 / -1; }
    .pair, .band { grid-template-columns: 1fr; gap: 22px; }
    .in { padding-left: 18px; padding-right: 18px; }
  }
</style>
</head>
<body>

<div class="bar">
  <div class="in">
    <span class="word"><img class="logo" src="/brand/mark-64.png" width="26" height="26" decoding="async" alt="">${name.toUpperCase()}</span>
    <span class="state">Offline for maintenance</span>
  </div>
</div>

<main class="in">
  <section class="hero" style="border-top:0">
    <div class="lede">
      <h1>${name} is offline</h1>
      <p>A surge in visitors pushed the running cost past what this project can carry, so the site is down for now.</p>
      <p>A lot of feedback came in with those visitors. A new release is planned in about a month, and development updates go to the Discord.</p>
      <p class="pulse" id="pulse" hidden><span class="dot"></span>Still in active development &mdash; last commit <a id="pulse-link" href="${BRAND.repoUrl}/commits" rel="noopener"><span id="pulse-when"></span></a>.</p>
      <div class="ctas">
        <a class="discord" href="${BRAND.discordUrl}" rel="noopener">${DISCORD_MARK}Updates on Discord</a>
        <a class="kofi" href="${BRAND.kofiUrl}" rel="noopener">${KOFI_MARK}Donate on Ko-fi</a>
      </div>
    </div>
    <div>
      <div class="key">${entry}</div>
      <p class="hint">Codes are handed out on the Discord, to anyone with a real use case
        who will send feedback back. Details below.</p>
    </div>
  </section>

  <section>
    <p class="eyebrow">What is behind the curtain</p>
    <ul class="grid">
      ${stats}
    </ul>
    <p class="note">The webcam figure is a committed catalogue. The ${STATS[1].figure} operator networks are
      fetched live on top of it and came to about 19,000 more cameras when last measured, on
      10 August 2026.</p>
  </section>

  <section>
    <p class="eyebrow">What comes back</p>

    <figure>
      <img class="shot" src="/brand/gate-globe.webp" width="1200" height="540" decoding="async"
           alt="The ${name} console: a satellite globe overlaid with submarine cable routes, nuclear plant markers and airport pins, with side panels listing cables, ports, GPS interference cells and nuclear plants.">
      <figcaption>Submarine cables, nuclear plants, GPS interference and airports, drawn on one globe from open data.</figcaption>
    </figure>

    <div class="pair">
      <figure>
        <img class="shot" src="/brand/gate-cameras3d.webp" width="1200" height="568" loading="lazy" decoding="async"
             alt="A 3D city view with live camera thumbnails floating above the buildings they look at.">
        <figcaption>Cameras placed in 3D, where they actually stand.</figcaption>
      </figure>
      <figure>
        <img class="shot" src="/brand/gate-streets.webp" width="1200" height="571" loading="lazy" decoding="async"
             alt="A wall of live street camera views from London, Madrid and Prague beside a map covered in camera pins.">
        <figcaption>Live street views, each labelled with only the ground conditions the nearest station can actually support.</figcaption>
      </figure>
    </div>
  </section>

  <section class="band">
    <div class="card">
      <h2>Getting an access code</h2>
      <p>Codes are handed out on the Discord. Join, say what you would use ${name} for, and if you have a real use case and will send feedback back on the tool, you get one.</p>
      <a class="discord" href="${BRAND.discordUrl}" rel="noopener">${DISCORD_MARK}Join the Discord</a>
    </div>
    <div class="card">
      <h2>Help cover the bill</h2>
      <p>This is a hosting bill and nothing more. A donation goes straight into keeping ${name} up, and brings the day it comes back forward.</p>
      <a class="kofi" href="${BRAND.kofiUrl}" rel="noopener">${KOFI_MARK}Donate on Ko-fi</a>
    </div>
  </section>
</main>

<footer>
  <div class="in foot">
    <p class="meta">
      Source: <a href="${BRAND.repoUrl}" rel="noopener">${escapeHtml(BRAND.repo)}</a> &middot; ${escapeHtml(BRAND.license.short)}<br>
      ${name} will be back.
    </p>
  </div>
</footer>

${pulseScript()}
</body>
</html>
`;
}

/**
 * The one script on the page, and the reasoning is the whole justification for it
 * existing at all — the curtain was script-free before this, deliberately.
 *
 * The page needs to say the project is still being worked on, and a date is the only
 * form of that claim anyone believes. There are three ways to get one, and two of them
 * are wrong here:
 *
 *  - A BUILD-TIME CONSTANT (`VERCEL_GIT_COMMIT_SHA`, a baked timestamp) freezes on the
 *    day the gate is armed. The entire point of the outage is that we stop deploying for
 *    a month, so by week four the page would be advertising a month of silence. That is
 *    worse than saying nothing.
 *  - A SERVER-SIDE FETCH costs an upstream request per view, on the one page that exists
 *    because requests got too expensive, and it would have to be cached at exactly the
 *    layer the curtain sets to `no-store`.
 *  - THE VISITOR'S OWN BROWSER asking GitHub costs this project nothing at all: the
 *    request never touches Vercel, so no invocation and no egress. The repo is public
 *    because the licence requires it, so the call needs no token, and GitHub's
 *    unauthenticated limit of 60/hour is per visitor IP, against one call per page view.
 *
 * So it is a fetch from the client, under three rules the tests hold: nothing external is
 * loaded (this is inline and self-contained — no library, no external script or
 * stylesheet), nothing the reader needs depends on it, and `#pulse` stays `hidden` until
 * a real commit date arrives, so every failure path renders exactly as the page did
 * before this function existed.
 */
function pulseScript(): string {
  const api = `https://api.github.com/repos/${BRAND.repo}/commits?per_page=1`;
  return `<script>
(function () {
  var box = document.getElementById("pulse");
  var when = document.getElementById("pulse-when");
  if (!box || !when || !window.fetch) return;
  function ago(ms) {
    var mins = Math.round(ms / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return mins + " minutes ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs === 1 ? "an hour ago" : hrs + " hours ago";
    var days = Math.round(hrs / 24);
    if (days < 14) return days === 1 ? "yesterday" : days + " days ago";
    return Math.round(days / 7) + " weeks ago";
  }
  fetch(${JSON.stringify(api)}, { headers: { Accept: "application/vnd.github+json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (rows) {
      if (!rows || !rows.length) return;
      var by = rows[0].commit && rows[0].commit.committer;
      var at = by && by.date ? new Date(by.date) : null;
      if (!at || isNaN(at.getTime())) return;
      var gap = Date.now() - at.getTime();
      if (gap < 0) return;
      when.textContent = ago(gap);
      var link = document.getElementById("pulse-link");
      if (link) link.title = at.toISOString().slice(0, 16).replace("T", " ") + " UTC";
      box.hidden = false;
    })
    .catch(function () {});
})();
</script>`;
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
