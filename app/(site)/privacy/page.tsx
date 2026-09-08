import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";

const REPO_URL = BRAND.repoUrl;
const ISSUES_URL = `${REPO_URL}/issues`;

/**
 * /privacy — the honest one.
 *
 * EVERY sentence on this page was checked against the deployed code before it was
 * written, and the file:line evidence is recorded in the PR that added it. A
 * privacy policy describing behaviour the software does not have is a false public
 * statement, not a formality, so the rule for editing this page is the same as the
 * rule for writing it: verify first, then write, and if you cannot verify it either
 * leave it out or say plainly that you do not know.
 *
 * WHAT CHANGED ON 2026-09-08:
 *   - The CARTO card was narrowed AGAIN, to fonts only, and the OpenFreeMap card grew
 *     the front page. components/marketing/HeroGlobe.tsx now reads DARK_STYLE_URL
 *     (tiles.openfreemap.org/styles/dark) instead of the inline CARTO Dark Matter
 *     style, so basemaps.cartocdn.com is no longer contacted by a landing-page visit.
 *     The move was forced: CARTO began watermarking unauthenticated tiles.
 *   - "CARTO sees you whether or not you open the console" was TRUE when written and
 *     is now false, which is the whole reason this header exists. A visitor who only
 *     ever sees the front page now reaches OpenFreeMap and not CARTO, and both cards
 *     say so. CARTO is still contacted from the console, for label fonts only.
 *   - Checked, not assumed: the landing-page and hero credit lines said CARTO and were
 *     correct until this commit. They are updated here in the same change rather than
 *     left for later, because a credit line naming a host we no longer contact is the
 *     same class of false statement as a privacy card naming one.
 *
 * WHAT CHANGED ON 2026-09-03:
 *   - A new third-party card, OpenFreeMap, because the default basemap stopped being
 *     CARTO's. tiles.openfreemap.org now serves the Light and Streets maps, their
 *     fonts and sprites, and the building geometry the 3D buildings are extruded
 *     from. That is a new host seeing a visitor's IP on almost every console visit,
 *     which is exactly the kind of change this section exists to record.
 *   - The CARTO card was NARROWED rather than deleted. CARTO still serves the Dark
 *     basemap and still serves the label fonts for all three raster styles, and the
 *     front-page globe is still CARTO Dark Matter (components/marketing/HeroGlobe.tsx
 *     reads BASEMAPS.dark) - so "CARTO sees you whether or not you open the console"
 *     is still true and stays. Only "serves the default map tiles" became false.
 *     (SUPERSEDED 2026-09-08 - see above. The hero left CARTO, so that sentence is
 *     now false too and has gone. Note the file:line cited here had already rotted:
 *     HeroGlobe stopped reading BASEMAPS.dark when Dark left the registry.)
 *   - Checked, not assumed: the landing page and hero credit lines still say CARTO
 *     and are still correct for the same reason. They were left alone deliberately.
 *
 * WHAT CHANGED ON 2026-08-20, and why each sentence moved:
 *   - The "who runs this" paragraph no longer states a legal name. It names the GitHub
 *     account instead and says in as many words that this is a handle, that the work is
 *     attributable through it, and how to get the legal identity if you have a reason
 *     to need it. Removing the name without saying that had happened would have been a
 *     quieter page and a less honest one.
 *   - "The application code writes no files" became "nothing this site serves writes a
 *     file", because the repository gained a camera-review tool that does. The page now
 *     names it, points at /admin as a 404 the reader can check for themselves, and says
 *     a test enforces the gate. A sentence that is nearly true is the thing this file
 *     exists to prevent; the fix is to narrow it, never to leave it.
 *   - And then narrowed AGAIN, same day, for the same reason. The page briefly said
 *     "every one of its routes returns 404 here", which is false for a verb no route
 *     implements: Next answers an unimplemented method with 405 before any handler runs,
 *     so a POST to a GET-only admin route says 405 and not 404. Nothing is reachable
 *     either way. The claim is now "every request that tool makes", which is exactly
 *     true and is still something a reader can check. Chasing verb parity would have
 *     meant forty-odd stub exports across six routes to protect a sentence that was
 *     simply worded too widely.
 *   - Nothing about COLLECTION changed. The curation tooling reads open-data catalogues
 *     and camera pictures; it never sees a visitor, and it is not deployed.
 *
 * The load-bearing checks behind the copy below, all re-run against 2cf8797:
 *   • analytics — THERE ARE NOW TWO COUNTERS, and this bullet used to say there were
 *     none. The warning the old version left here ("IF AN EXTERNAL COUNTER IS EVER
 *     ADDED, THIS SECTION AND THE THREE PLACES BELOW THAT SAY no analytics HAVE TO MOVE
 *     WITH IT") is why neither edit was a one-line change: it named four places, and all
 *     four moved — twice, because the two counters landed a day apart on separate
 *     branches and each had to re-state what the other had already rewritten.
 *
 *     FIRST-PARTY, added 2026-09-07: `/api/presence` + lib/presence/store.ts, which count
 *     how many browsers have the site open in a three-minute window so the console header
 *     can show "N online". It holds a random per-tab string and a timestamp IN MEMORY,
 *     evicts after three minutes, writes nothing to disk, records no IP, user agent,
 *     referrer or route, and answers `null` below a threshold so a small number never
 *     leaves the server. There is no history, so there is nothing to query — it can say
 *     how many browsers are here and literally nothing else. ANY CHANGE THAT GIVES IT A
 *     DISK, A LOG LINE, OR A SECOND FIELD MAKES THAT PARAGRAPH FALSE.
 *
 *     THIRD-PARTY, added 2026-09-08: a cookieless PostHog beacon
 *     (components/analytics/Beacon.tsx, configured by lib/analytics/beacon.ts). What it is
 *     NOT is the thing the page previously ruled out: `persistence: "sessionStorage"` sets
 *     no cookie and keeps nothing past the tab, `disable_session_recording` is on, and
 *     there is no ad pixel and no cross-site identifier. tests/unit/beacon-config.test.ts
 *     pins each of those three, including the trap that the most private setting
 *     ("memory") would have made bounce rate read ~100% forever. It is DORMANT-SAFE: with
 *     NEXT_PUBLIC_POSTHOG_KEY unset, posthog-js is never fetched, so a self-hoster's
 *     deployment really does count nothing.
 *
 *     DO NOT COLLAPSE THE TWO INTO ONE SENTENCE. One is ours, in memory, and forgets in
 *     three minutes; the other is a third party's, on their servers, and keeps what it
 *     collects. Any copy that says "the counter" is now wrong whichever one it means —
 *     which is exactly the fault that produced this paragraph.
 *   • processors — CLOUDFLARE IS NOW IN FRONT OF THE SITE, which is a change this page
 *     has to carry whatever the app does. It terminates TLS, so it necessarily sees
 *     every visitor's full IP address before we do. What reaches our log is masked; what
 *     reaches Cloudflare is not, and no wording on our side changes that.
 *   • persistence — package.json ships ten runtime deps and not one is a database
 *     client. The guard in tests/unit/discovery-admin-gate.test.ts is now TWO checks and
 *     the difference matters to the copy below.
 *
 *     WRITING: a grep for writeFileSync|appendFileSync|writeFile\(|createWriteStream|
 *     renameSync|mkdirSync|rmSync|unlinkSync|truncateSync|copyFileSync over app/ lib/
 *     components/ returns exactly TWO files, lib/discovery/store.ts and
 *     app/api/admin/promote/route.ts, both belonging to the dev-only camera-review tool
 *     and both behind a production 404. So "nothing this site serves writes a file"
 *     stays true.
 *
 *     READING: `node:fs` returns a THIRD, lib/analytics/rollupRead.ts, which reads the
 *     access-log rollups for /admin/analytics and is held to reading by the write check
 *     above. A further check fails if anything under app/, lib/ or components/ imports
 *     from scripts/, which is where the code that WRITES the rollups lives — outside
 *     what Next bundles, so a route cannot reach it even by accident.
 *
 *     ROLLUPS, added 2026-09-08: scripts/rollup-access-log.mts folds the access log into
 *     one aggregate per day under /srv/provenance/shared/analytics, and those aggregates
 *     are KEPT INDEFINITELY while the log itself rotates away in about three and a half
 *     days. That is a real change to what persists and the logs section says so. They
 *     hold counts only — paths, referrer hostnames, country codes, device classes,
 *     statuses, byte totals — and no addresses at any resolution. The one per-visitor
 *     structure is a set of salted truncated hashes of (masked address, user agent) used
 *     to size a day's visitor count, and it is DELETED when the day is finalised.
 *     ANY CHANGE THAT KEEPS THOSE HASHES, OR ADDS A FIELD DERIVED FROM AN ADDRESS,
 *     MAKES THE LOGS SECTION FALSE.
 *   • identity — `next/headers|cookies\(\)|x-forwarded-for|x-real-ip|req(uest)?\.ip`
 *     over app/ lib/ components/ returns exactly ONE hit, app/api/feedback/route.ts:63,
 *     and the page names it rather than rounding it down to "we read nothing". That
 *     sentence USED to say no route reads an address; #113 made it false, which is
 *     the failure mode this file exists to avoid. Re-run the grep before editing.
 *   • the feedback payload — lib/shell/feedback.ts formatFeedbackMessage() sends
 *     rating, occupation, useful, email and trigger. The bucket hash is NOT in it,
 *     so "not attached to the submission" is read off the formatter, not assumed.
 *   • proxying — app/api/proxy, /api/hls and /api/webcam-image fetch upstream imagery
 *     server-side, which is why an operator sees this deployment and not the viewer.
 *     YouTube-backed streams are the exception and the page says so.
 *   • the photo tool — app/api/geolocate + lib/geolocate/llm.ts POST the uploaded
 *     image to the FREELLMAPI gateway. Probed on prod 2026-08-18: it answers with
 *     method "vision-ai", so that path is the configured one there.
 *
 * The feedback section describes the SHIPPED behaviour, not the dormant state. The
 * route is inert until FEEDBACK_TELEGRAM_BOT_TOKEN and FEEDBACK_TELEGRAM_CHAT_ID are
 * set (route.ts:87-91), but those can be set at any moment without a code change, so
 * a page that said "this does not happen" would rot into a false statement silently.
 *
 * Visually this page is the landing page's own stylesheet and nothing new: .pv-doc
 * grid, .pv-block sections, .pv-ledger tables. It renders on the ink ground because
 * (site)/layout.tsx server-renders `.pv-night` and no ScrollGround runs here to lift
 * `--pv-g` off 1 — so `.pv-ground` is mandatory, not decorative. Without it the
 * night foreground tokens paint light type onto the globals.css light body.
 */

export const metadata: Metadata = {
  title: `Privacy · ${BRAND.name}`,
  description:
    "What Provenance collects, what it does not, and which third parties your browser talks to. No account, no database, one analytics tool.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <>
      <div className="pv-ground" aria-hidden="true" />

      <div className="pv-doc">
        <header className="pv-block" id="top">
          <div>
            <p className="pv-eyebrow">
              <span>Privacy</span>
              <span>
                Last updated <time dateTime="2026-09-03">3 September 2026</time>
              </span>
            </p>
            <h1 className="pv-h2">What this site knows about you.</h1>
            <p className="pv-lede">
              Almost nothing, and there is no database for it to go into. This page describes the
              code deployed right now, not an intention. Where something does leave your browser, it
              is named.
            </p>
          </div>
          <div className="pv-cols">
            <div className="pv-card">
              <h2 className="pv-h3">No account</h2>
              <p>
                There is no sign-up, no login and no password. Browsing the map is not tied to any
                identity.
              </p>
            </div>
            <div className="pv-card">
              <h2 className="pv-h3">No database</h2>
              <p>
                No database, no key-value store, and nothing this site serves writes a file. There
                is nowhere for the server to put anything about you.
              </p>
            </div>
            <div className="pv-card">
              <h2 className="pv-h3">Settings stay local</h2>
              <p>
                Boards, layouts, themes, pins and watchlists are saved in your own browser. They are
                never uploaded.
              </p>
            </div>
            <div className="pv-card">
              <h2 className="pv-h3">Two counters, no cookies</h2>
              <p>
                Two counters, and neither sets a cookie. One is ours and lives three minutes:
                how many browsers have the site open right now. The other counts page views and
                clicks, on PostHog&rsquo;s European servers. No Google Analytics, no ad pixel, no
                session recording, and nothing that links this visit to your next one.
              </p>
            </div>
          </div>
        </header>

        {/* ── who ──────────────────────────────────────────────────────────── */}
        <section className="pv-block">
          <div>
            <p className="pv-eyebrow">
              <span>Who is responsible</span>
              <span>UK</span>
            </p>
            <h2 className="pv-h2">Who runs this, and how to reach them.</h2>
          </div>
          <div className="pv-prose">
            <p>
              {BRAND.name} is built and run by one person in the United Kingdom, publishing as{" "}
              <a href={`https://github.com/${BRAND.license.holder}`} target="_blank" rel="noreferrer noopener">
                {BRAND.license.holder}
              </a>
              . Under UK GDPR that person is the controller for whatever personal data this site
              processes, which the rest of this page sets out and which is very close to none.
            </p>
            <p>
              That is a handle rather than a legal name, and it is worth being straight about what
              that does and does not mean. It is the account that authored every commit in the
              repository below, so the work is attributable and the person is reachable. If you have
              a formal reason to know who they are, such as a data-protection request or a legal
              notice, open an issue asking and you will be told. Nothing here is anonymous. It is
              pseudonymous, which is not the same thing.
            </p>
            <p>
              The whole application is open source under the {BRAND.license.short}, so every claim
              on this page can be checked rather than trusted. If a sentence here does not match the
              code, the code is the truth and the sentence is a bug.{" "}
              <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
                Read the source
              </a>
              .
            </p>
            <p>
              <strong>Contact.</strong> There is no support address published for this project. The
              route that exists is{" "}
              <a href={ISSUES_URL} target="_blank" rel="noreferrer noopener">
                an issue on the repository
              </a>
              . That tracker is public, so do not put anything private in it.
            </p>
          </div>
        </section>

        {/* ── no database ──────────────────────────────────────────────────── */}
        <section className="pv-block" id="no-database">
          <div>
            <p className="pv-eyebrow">
              <span>Storage</span>
              <span>Server side</span>
            </p>
            <h2 className="pv-h2">There is no database.</h2>
          </div>
          <div className="pv-prose">
            <p>
              This is the strongest thing on the page, so it is the one worth checking. The app has
              ten runtime dependencies and not one of them is a database client. There is no
              key-value store, no object store and no cloud storage account. Nothing this site
              serves writes a file.
            </p>
            <p>
              That last sentence used to say &ldquo;the application code writes no files&rdquo;, and
              it stopped being exactly true in August 2026, so it has been narrowed rather than
              left to rot. The repository now contains a camera-review tool that does write files:
              it records which cameras a person looked at before their pictures were allowed onto
              the map. It runs on a laptop, against a local development server, and it is not
              deployed here at all. You can check that.{" "}
              <a href="/admin" rel="nofollow">
                /admin
              </a>{" "}
              is a 404 on this deployment, and so is every request that tool makes. A test in the
              repository fails the build if a new route is added under it without that guard. Two
              files in the whole tree can write to disk, both belong to that tool, and a second
              test fails if a third appears.
            </p>
            <p>
              No route reads a cookie or a session. There is nothing in the code that could.
            </p>
            <p>
              Exactly one route reads your IP address, and it is worth naming rather than burying.
              The feedback endpoint takes the forwarded address, hashes it, and uses the hash to
              count how many submissions have come from one place in the last hour. The address
              itself is not written down, not logged and not sent on, and neither the address nor
              the hash is attached to what you wrote. The hash lives in ordinary server memory and
              disappears when that instance recycles.
            </p>
            <p>
              The hash is salted with a random value generated when the server instance starts. That
              matters, because a plain hash of an address would not protect it: there are only about
              four billion possible addresses, so anyone could hash all of them and look yours up.
              The salt makes that impossible. It never leaves memory, it is not in the source code,
              and it dies with the instance that made it.
            </p>
            <p>
              Be clear about what it is for. It stops the same person submitting fifty times. It is
              a counter, and it is the only thing in this application that touches your address at
              all.
            </p>
            <p>
              Some routes hold what you typed in ordinary server memory for a few minutes so a
              repeated request does not hit an upstream service twice. That is listed below. It also
              lives in RAM on one serverless instance and is gone when the instance recycles.
            </p>
          </div>
        </section>

        {/* ── browser storage ──────────────────────────────────────────────── */}
        <section className="pv-block" id="your-browser">
          <div>
            <p className="pv-eyebrow">
              <span>Storage</span>
              <span>Your browser</span>
            </p>
            <h2 className="pv-h2">What your own browser keeps.</h2>
          </div>
          <div className="pv-prose">
            <p>
              The console remembers how you set it up. It does that in your browser, under 30 keys
              prefixed <span className="pv-num">tn.</span> in local storage, plus one IndexedDB
              database and one service-worker cache. Almost none of it is ever sent to us, and the
              table says which parts are the exception.
            </p>
          </div>
          <div className="pv-ledger">
            <table>
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">Where</th>
                  <th scope="col">Does it leave your browser?</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Console layout, boards, presets, saved monitor profiles</td>
                  <td>Local storage</td>
                  <td>No</td>
                </tr>
                <tr>
                  <td>Theme, skin, language, view mode, which map layers are on</td>
                  <td>Local storage</td>
                  <td>No</td>
                </tr>
                <tr>
                  <td>Watchlists, dropped pins, tracked aircraft, market alerts</td>
                  <td>Local storage</td>
                  <td>No</td>
                </tr>
                <tr>
                  <td>
                    A random string, so the live &ldquo;online&rdquo; count does not count this tab
                    twice
                  </td>
                  <td>Session storage &mdash; erased when you close the tab</td>
                  <td>
                    Yes, every 45 seconds, to us. It is all that counter gets, and it means nothing
                    else
                  </td>
                </tr>
                <tr>
                  <td>
                    A second random string, so the page-view counter can tell that page 2 was the
                    same visit as page 1
                  </td>
                  <td>Session storage &mdash; erased when you close the tab</td>
                  <td>
                    Yes, to PostHog. This is the identifier that would have been a cookie in a
                    normal analytics install; it is deliberately not one
                  </td>
                </tr>
                <tr>
                  <td>A display name, if you type one into settings</td>
                  <td>Local storage</td>
                  <td>No. There is no account for it to belong to</td>
                </tr>
                <tr>
                  <td>Locations you add as assets to watch, with a name and a radius</td>
                  <td>Local storage</td>
                  <td>No</td>
                </tr>
                <tr>
                  <td>Which headlines you have already been shown, and sparkline history</td>
                  <td>Local storage</td>
                  <td>No</td>
                </tr>
                <tr>
                  <td>
                    How many times you have visited and how long the tab has been visible, used to
                    decide whether to show the feedback prompt
                  </td>
                  <td>Local storage</td>
                  <td>No. The decision is made in your browser</td>
                </tr>
                <tr>
                  <td>
                    Your coordinates, if you press &ldquo;near me&rdquo; and allow the browser
                    prompt
                  </td>
                  <td>Local storage</td>
                  <td>Only to find nearby cameras, see the next section</td>
                </tr>
                <tr>
                  <td>A Telegram bot token or a Discord webhook, if you set one up</td>
                  <td>Local storage, in plain text</td>
                  <td>Only when you send an alert, see the next section</td>
                </tr>
                <tr>
                  <td>Camera frames your browser has already loaded, for the day strip</td>
                  <td>
                    IndexedDB <span className="pv-num">tn.camslot.history</span>, capped at 8 MB
                  </td>
                  <td>No</td>
                </tr>
                <tr>
                  <td>The shell, the manifest and two icons, so the app opens offline</td>
                  <td>
                    Service worker cache <span className="pv-num">tn-v1-shell</span>
                  </td>
                  <td>No. API responses and anything cross-origin are never cached</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="pv-note">
            Clearing site data in your browser deletes all of it. There is no copy anywhere else, so
            there is nothing to ask us to delete. Note that a bot token or webhook you paste in is
            stored in plain text, like any other browser setting, so treat a shared computer
            accordingly.
          </p>
        </section>

        {/* ── what the server receives ─────────────────────────────────────── */}
        <section className="pv-block" id="server">
          <div>
            <p className="pv-eyebrow">
              <span>The server</span>
              <span>35 API routes</span>
            </p>
            <h2 className="pv-h2">What reaches our server, and where it goes.</h2>
          </div>
          <div className="pv-prose">
            <p>
              Most of the API takes no input from you at all: it fetches public feeds on a schedule
              and hands them to the map. These are the routes that receive something you supplied.
            </p>
          </div>
          <div className="pv-ledger">
            <table>
              <thead>
                <tr>
                  <th scope="col">When you</th>
                  <th scope="col">What reaches us</th>
                  <th scope="col">Where it goes next</th>
                  <th scope="col">Kept?</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Search for a place</td>
                  <td>The text you type, and your map centre if the search is biased to it</td>
                  <td>Photon, the open geocoder at photon.komoot.io</td>
                  <td>In memory for 5 minutes, then dropped</td>
                </tr>
                <tr>
                  <td>Ask for cameras near you</td>
                  <td>The coordinates your browser hands over</td>
                  <td>
                    Nowhere. The nearest cameras are worked out on our server from data already
                    loaded
                  </td>
                  <td>No</td>
                </tr>
                <tr>
                  <td>Open a camera still or a live stream</td>
                  <td>The camera id</td>
                  <td>We fetch the image or the video from the operator and pass it back to you</td>
                  <td>No</td>
                </tr>
                <tr>
                  <td>Look up a domain or an IP in the recon widgets</td>
                  <td>The domain or IP you typed</td>
                  <td>
                    Cloudflare DNS, crt.sh, rdap.org and the registry it redirects to, RIPEstat,
                    Shodan InternetDB
                  </td>
                  <td>Cached against that target for 5 minutes</td>
                </tr>
                <tr>
                  <td>Upload a photo to the location tool</td>
                  <td>The image</td>
                  <td>A third-party AI gateway, which is the next section</td>
                  <td>No</td>
                </tr>
                <tr>
                  <td>Ask for a news summary</td>
                  <td>The article link</td>
                  <td>The publisher&rsquo;s own site, then the same AI gateway</td>
                  <td>The summary is cached in memory against that link</td>
                </tr>
                <tr>
                  <td>Send a Telegram or Discord alert</td>
                  <td>Your own bot token or webhook URL, and the message text</td>
                  <td>api.telegram.org or discord.com</td>
                  <td>No. It is used for that one request and dropped</td>
                </tr>
                <tr>
                  <td>Answer the feedback prompt</td>
                  <td>
                    Your answers, and your IP address in the request, which is hashed for rate
                    limiting only
                  </td>
                  <td>A private Telegram chat belonging to the person who builds this</td>
                  <td>Not by us. The hash is held in memory for an hour</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="pv-note">
            With the single exception of the feedback endpoint described above, none of these routes
            reads your IP address, your cookies or your user agent, because the code contains no way
            to. Every request we make on your behalf goes out with a fixed user agent naming this
            project, not yours.
          </p>
        </section>

        {/* ── the photo tool ───────────────────────────────────────────────── */}
        <section className="pv-block" id="photo-geolocation">
          <div>
            <p className="pv-eyebrow">
              <span>Photo geolocation</span>
              <span>Read this one</span>
            </p>
            <h2 className="pv-h2">A photo you upload leaves our server.</h2>
          </div>
          <div className="pv-prose">
            <p>
              The photo location tool estimates where a picture was taken. To do that it sends the
              image from our server to an AI gateway, which passes it to a vision model. That is the
              whole point of the feature, and there is no version of it that keeps your image on one
              machine.
            </p>
            <p>
              Checked against production on 18 August 2026: uploads take the vision-AI gateway path.
              The alternative backend, a self-hosted geo-embedding model, is not enabled there.
            </p>
            <p>
              We do not store the image. What the gateway and the model provider behind it do with
              it is governed by those services, not by this code, and we cannot make a promise on
              their behalf.
            </p>
            <p>
              <strong>
                So do not upload a photo you would not be willing to hand to a third party.
              </strong>{" "}
              Photos carry faces, number plates, and often a GPS location in their metadata.
            </p>
          </div>
        </section>

        {/* ── the feedback prompt ──────────────────────────────────────────── */}
        <section className="pv-block" id="feedback">
          <div>
            <p className="pv-eyebrow">
              <span>The feedback prompt</span>
              <span>Four questions</span>
            </p>
            <h2 className="pv-h2">The box that asks what you do.</h2>
          </div>
          <div className="pv-prose">
            <p>
              After you have used the console for a while, it may ask you four things: what you do,
              what you find useful here, a rating out of ten, and an email address. Only the email is
              optional. Leaving it blank sends the rest normally.
            </p>
            <p>
              What you write is relayed straight to a private Telegram chat belonging to the person
              who builds this. Nothing is written to a database, because there is not one. If you
              give an email it goes in that same message, it is read as you being open to a short
              call, and it is not added to a mailing list.
            </p>
            <p>
              Whether you get asked is decided in your browser, not on a server. The console keeps a
              count of your visits and how long the tab has actually been visible, in local storage,
              and asks once you pass one of those marks. Answering or closing the box records a
              permanent no, so you are never asked twice.
            </p>
            <p>
              The request that carries your answers also carries your IP address, as every web
              request does. That endpoint hashes it to rate-limit abuse, described above. The hash
              is not put in the message and does not travel with what you wrote.
            </p>
          </div>
        </section>

        {/* ── third parties the browser reaches directly ───────────────────── */}
        <section className="pv-block" id="third-parties">
          <div>
            <p className="pv-eyebrow">
              <span>Third parties</span>
              <span>Direct from your browser</span>
            </p>
            <h2 className="pv-h2">Who sees your IP address.</h2>
          </div>
          <div className="pv-prose">
            <p>
              A few things load straight from other people&rsquo;s servers. Those servers see your IP
              address and roughly what you are looking at, because your browser connects to them and
              not to us. We cannot see or change that.
            </p>
          </div>
          <div className="pv-cols">
            <div className="pv-card">
              <h3 className="pv-h3">OpenFreeMap</h3>
              <p>
                <span className="pv-num">tiles.openfreemap.org</span> serves the Streets map, the
                small inset maps on a pin&rsquo;s detail card, the map on the Locate page, and the
                building shapes the 3D buildings are drawn from. It was the console&rsquo;s default
                map until 7 September 2026; the default is now Satellite, so inside the console
                OpenFreeMap only sees you if you open a detail card, the Locate page, or the Streets
                map itself. Since 8 September 2026 it also serves the globe on the FRONT page,
                which CARTO used to serve &mdash; so on the landing page it sees you without your
                opening anything.
              </p>
            </div>
            <div className="pv-card">
              <h3 className="pv-h3">CARTO</h3>
              <p>
                <span className="pv-num">basemaps.cartocdn.com</span> serves the label fonts the
                Satellite and Topographic maps use. Satellite is the console&rsquo;s default map, so
                those fonts load on almost every visit to the console. It no longer serves any map
                tiles, and it is no longer contacted by the front page at all: the globe there moved
                to OpenFreeMap on 8 September 2026. If you never open the console, CARTO does not
                see you.
              </p>
            </div>
            <div className="pv-card">
              <h3 className="pv-h3">AWS Open Data</h3>
              <p>
                <span className="pv-num">elevation-tiles-prod.s3.amazonaws.com</span> serves terrain
                elevation tiles. That source is registered on every map, not only when 3D relief is
                switched on.
              </p>
            </div>
            <div className="pv-card">
              <h3 className="pv-h3">Esri and OpenTopoMap</h3>
              <p>
                <span className="pv-num">server.arcgisonline.com</span> serves the Satellite map and
                one aerial image on a satellite&rsquo;s detail card. Satellite became the
                console&rsquo;s default map on 7 September 2026, so Esri now sees you on almost
                every visit to the console rather than only when you pick it.{" "}
                <span className="pv-num">tile.opentopomap.org</span> serves the topographic basemap,
                which loads only if you pick it.
              </p>
            </div>
            <div className="pv-card">
              <h3 className="pv-h3">YouTube</h3>
              <p>
                <span className="pv-num">www.youtube.com</span> is embedded wherever a stream is a
                YouTube one. Those embeds are Google&rsquo;s and can set Google&rsquo;s cookies. Some
                autoplay as soon as the widget is on your board.
              </p>
            </div>
          </div>
          <div className="pv-prose">
            <p>
              <strong>Most camera imagery does not work this way.</strong> Road-camera stills, their
              HLS video and the Windy webcams are all fetched by our server and passed on to you, so
              the road authority or camera operator sees this deployment and not you. That was a
              deliberate choice.
            </p>
            <p>
              <strong>Two camera paths are the exception</strong>, and the difference is worth
              stating rather than glossing. A camera whose stream is a YouTube one is an embed, so
              your browser connects to Google directly and we cannot stand in front of it. The same
              is true of a custom stream URL you type into the news widget yourself: it plays from
              whatever host you gave it.
            </p>
            <p>
              Typefaces are self-hosted. They are downloaded at build time and served from this
              domain, so your browser never contacts Google Fonts.
            </p>
          </div>
        </section>

        {/* ── cookies + analytics ──────────────────────────────────────────── */}
        <section className="pv-block" id="cookies">
          <div>
            <p className="pv-eyebrow">
              <span>Cookies</span>
              <span>Analytics</span>
            </p>
            <h2 className="pv-h2">No cookies of ours. Two counters, and neither follows you.</h2>
          </div>
          <div className="pv-prose">
            <p>
              {BRAND.name} sets no cookies. Not for sessions, not for preferences, not for
              analytics. The code writes none, and production responses carry no{" "}
              <span className="pv-num">Set-Cookie</span> header. The one exception is not ours: the
              YouTube embed described above.
            </p>
            <p>
              <strong>This page used to say there was no analytics at all, and that is no longer
              true.</strong> There are now two counters &mdash; one ours, one a third party&rsquo;s
              &mdash; and since the old wording was unusually emphatic it is worth being equally
              specific about what each one does and what neither of them does.
            </p>
            <p>
              What was added is a page-view and interaction counter provided by{" "}
              <a href="https://posthog.com/privacy" target="_blank" rel="noreferrer noopener">
                PostHog
              </a>
              , running on their European servers. It records which pages were opened, in what
              order, how long each was open, and where on the page you clicked &mdash; including
              clicks that did nothing, which is how a broken control gets found. It exists because
              a server log physically cannot answer those questions: leaving a page sends no
              request, and a click that fails to do anything sends nothing at all.
            </p>
            <p>
              What was <em>not</em> added matters as much. It sets <strong>no cookie</strong>. The
              identifier it uses to tell one page view from the next lives in your tab&rsquo;s own
              memory and is destroyed when you close that tab, so there is nothing to link this
              visit to your next one and nothing to follow you to another site. It does not record
              your screen, your typing or your form fields &mdash; session replay is switched off
              in the configuration, not merely unused. There is no ad pixel, no Google Analytics,
              no Meta pixel and no fingerprinting library. And if your browser sends{" "}
              <span className="pv-num">Do Not Track</span>, it does not count you at all.
            </p>
            <p>
              Two honest consequences. Because it is a script, anything that blocks scripts blocks
              it &mdash; a good share of this site&rsquo;s visitors block it, so its numbers
              understate reality and we know they do. And it is deliberately not disguised as
              first-party traffic to get around that, which is a thing we could do and choose not
              to.
            </p>
            <p>
              <strong>The other counter is ours, and it is a much smaller thing.</strong> It answers a
              single question: how many browsers have the site open at this moment. While a tab is open it sends{" "}
              <span className="pv-num">/api/presence</span> a random string every 45 seconds &mdash;
              a string your own browser invents, keeps in{" "}
              <span className="pv-num">sessionStorage</span> only until you close the tab, and which
              means nothing anywhere else. The server holds that string and the time it last arrived,
              in memory, and deletes it three minutes later. No IP address, no browser name, no page
              address and no cookie is recorded with it, nothing is written to disk, and a restart of
              the server erases the lot. It cannot say who you are, where you came from, or what you
              looked at &mdash; only that some browser was here in the last three minutes. The number
              is shown in the console header when it is above a threshold; below that the server does
              not answer with it at all, so a quiet site does not report a small number to anyone.
            </p>
            <p>
              The page-view counts collected while the site ran on Vercel still sit in Vercel&rsquo;s
              account, and what they hold and for how long is theirs to describe rather than ours
              &mdash; see{" "}
              <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noreferrer noopener">
                their privacy policy
              </a>
              . Nothing has been added to that record since the move.
            </p>
          </div>
        </section>

        {/* ── logs ─────────────────────────────────────────────────────────── */}
        <section className="pv-block" id="logs">
          <div>
            <p className="pv-eyebrow">
              <span>Logs</span>
              <span>Ours and the host&rsquo;s</span>
            </p>
            <h2 className="pv-h2">What ends up in a log.</h2>
          </div>
          <div className="pv-prose">
            <p>
              One log statement exists across all 35 API route files. It records that a named public
              data feed threw an error, and the name comes from our own list of feeds rather than
              from anything you sent. Nothing you type is logged anywhere.
            </p>
            <p>
              Underneath the application is a web server, and it keeps an access log, as any web
              server does. That used to be Vercel&rsquo;s and is now ours, which means it is worth
              being specific about: it records the path you asked for, the status and size of the
              reply, how long it took, your user agent, and the two-letter country your request
              came from. <strong>It does not record your IP address.</strong> The server is told to
              mask it before writing &mdash; the first 16 bits survive for IPv4, which is a block of
              some sixty-five thousand addresses, and the rest is discarded. That is enough to tell
              one machine hammering the site from a genuine crowd, and not enough to point at you.
              The log rolls and old files are deleted; nothing is exported anywhere.
            </p>
            <p>
              <strong>
                Counts taken from that log are kept, and they outlive the log.
              </strong>{" "}
              Every five minutes a job on the same machine folds the new lines into one
              summary per day: how many requests, how many of them were pages, which paths,
              which referring hostnames, which country codes, which device classes, which
              status codes, how many bytes and how long things took. Those summaries are
              kept indefinitely, while the log they came from is gone in about three and a
              half days. This is what the traffic figures behind the scenes are read from,
              and it exists because the alternative was a third party&rsquo;s dashboard.
            </p>
            <p>
              What those summaries do <em>not</em> contain is any address, at any resolution
              &mdash; not even the masked form, which is discarded along with the log line
              it came from. A summary is a set of totals and nothing that points at a
              request. The single exception is how the daily visitor number is arrived at:
              for the day in progress the job keeps a set of short salted hashes, each one
              made from a masked address and a user agent, purely so that the same browser
              is not counted twice in a day. That set is <strong>deleted</strong> when the
              day is closed off, leaving only the count. It is also why that number is
              described as approximate wherever it appears: two people on one network using
              the same browser are one of them, and one person on a phone and a laptop is
              two.
            </p>
            <p>
              <strong>Something sits in front of that server now, and it does see your address.</strong>{" "}
              This site is served through{" "}
              <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer noopener">
                Cloudflare
              </a>
              , which handles the encrypted connection from your browser and passes the request on
              to us. Because it is the party your browser actually negotiates with, it necessarily
              sees your full IP address before we do. It is also where that country code comes
              from. What we write down is masked; what Cloudflare holds is Cloudflare&rsquo;s to
              describe, and no wording on our side changes that &mdash; which is why it is named
              here rather than left as an implementation detail. It is the reason the site loads
              quickly from far away, and it filters a steady volume of automated scanning that
              would otherwise reach the box directly.
            </p>
          </div>
        </section>

        {/* ── rights ───────────────────────────────────────────────────────── */}
        <section className="pv-block" id="rights">
          <div>
            <p className="pv-eyebrow">
              <span>Your rights</span>
              <span>UK GDPR</span>
            </p>
            <h2 className="pv-h2">Your rights, and the honest version of them.</h2>
          </div>
          <div className="pv-prose">
            <p>
              Under UK GDPR you can ask for a copy of your personal data, ask for it to be corrected
              or erased, object to it being processed, and complain to a regulator.
            </p>
            <p>
              The honest version here is that this application holds no record of you to hand over,
              correct or delete. There is no account, no database and no server-side profile. Most
              of the data about your use of the site is in your own browser, and you can erase it
              yourself by clearing site data.
            </p>
            <p>
              Four things sit outside that, and they are the only places anything of yours can
              persist. One is the server access log described above, which is IP-masked, rolled and
              deleted &mdash; together with the daily counts taken from it, which are kept but hold
              no address at any resolution. One is the page-view counter described above, which
              holds no cookie and nothing that survives your tab, and which will not have counted
              you at all if your browser sends Do Not Track. The third is a feedback answer, if you
              chose to send one, which is sitting as a message in a private Telegram chat &mdash;
              that is the only place a name or an email you gave us can be, and asking will get it
              deleted. The fourth is historical: the page-view counts a previous host gathered
              before the move, which are being wound down with that account and cannot be added to.
            </p>
            <p>
              If you think any of this is wrong, say so in{" "}
              <a href={ISSUES_URL} target="_blank" rel="noreferrer noopener">
                an issue
              </a>{" "}
              and it will be checked against the code. If you want to complain to a regulator, the
              UK&rsquo;s is the{" "}
              <a href="https://ico.org.uk/" target="_blank" rel="noreferrer noopener">
                Information Commissioner&rsquo;s Office
              </a>
              .
            </p>
          </div>
        </section>

        {/* ── changes ──────────────────────────────────────────────────────── */}
        <section className="pv-block" id="changes">
          <div>
            <p className="pv-eyebrow">
              <span>Changes</span>
              <span>
                <time dateTime="2026-09-03">3 September 2026</time>
              </span>
            </p>
            <h2 className="pv-h2">This page has a version history.</h2>
          </div>
          <div className="pv-prose">
            <p>
              This describes the code as deployed on 3 September 2026. When the behaviour changes this
              page is supposed to change with it, and if it has not then that is a bug worth
              reporting. Both histories live in the same public repository, so the two can be read
              against each other.
            </p>
            <p>
              Features that are designed but not shipped are deliberately absent. Describing
              something the software does not do yet would make this page wrong in the direction
              that matters least to us and most to you.
            </p>
          </div>
        </section>
      </div>

      <footer className="pv-footer">
        <div className="pv-footer-inner">
          <div>
            <h4>{BRAND.name}</h4>
            <p>{BRAND.description}</p>
          </div>
          <div>
            <h4>The product</h4>
            <a href="/">Home</a>
            <a href="/app">Open the map</a>
          </div>
          {/*
            AGPL-3.0 section 13: anyone interacting with this program over a network
            must be offered its Corresponding Source. Every page a user can land on
            carries the repo link for that reason, not as a portfolio flourish.
            Do not remove these two links.
          */}
          <div>
            <h4>The code</h4>
            <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
              GitHub
            </a>
            <a href={BRAND.license.url} target="_blank" rel="noreferrer noopener">
              Licence ({BRAND.license.short})
            </a>
          </div>
          <div>
            <h4>Attribution</h4>
            <p>
              Powered by TfL Open Data. Webcams provided by Windy.com. Basemap &copy; OpenFreeMap,
              &copy; OpenMapTiles, data from &copy; OpenStreetMap contributors. Contains public
              sector information licensed under the Open Government Licence. Star catalogue:{" "}
              <a href="https://codeberg.org/astronexus/hyg" target="_blank" rel="noreferrer noopener">
                HYG database v4.4
              </a>{" "}
              by David Nash (astronexus), licensed CC BY-SA 4.0. Star positions are real; the sky is
              shown at a wider angle than the globe's own camera so whole constellations fit the
              frame.
            </p>
            <p>
              &copy; {BRAND.license.year} {BRAND.license.holder}. {BRAND.name} is free software
              under the {BRAND.license.name}. The data above keeps its own separate terms.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
