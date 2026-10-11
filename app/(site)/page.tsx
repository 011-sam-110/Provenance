import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import { BRAND, siteUrl } from "@/lib/brand";
import { shareMetadata } from "@/lib/seo/shareCard";
import { serializeJsonLd, websiteJsonLd } from "@/lib/seo/structuredData";
import Mark from "@/components/brand/Mark";
import LandingStage from "@/components/marketing/LandingStage";
import SphereIntro from "@/components/marketing/SphereIntro";
import Starfield from "@/components/marketing/Starfield";
import CommunityNote from "@/components/shell/CommunityNote";
import { AUDIT_TOTALS } from "@/lib/marketing/coverage-audit.data";
import { CAMERA_FACTS } from "@/lib/marketing/camera-facts.data";
import { GLOBE_SNAPSHOT } from "@/lib/marketing/globe-snapshot.meta";
import { formatCoord, INSET_C } from "@/lib/marketing/landingGlobe";
import "../landing.css";

const REPO_URL = BRAND.repoUrl;

const HOME_TITLE = `${BRAND.name} · ${BRAND.tagline}`;

export const metadata: Metadata = {
  title: HOME_TITLE,
  description: BRAND.description,
  alternates: { canonical: "/" },
  // The root layout no longer asserts og:url, so the home page states its own.
  ...shareMetadata({
    title: HOME_TITLE,
    description: BRAND.description,
    path: "/",
    imageAlt: `${BRAND.name} live map preview`,
  }),
};

/**
 * THE LANDING PAGE'S TYPEFACE, and the one place it is loaded.
 *
 * Archivo, variable, with the width axis: the display type is set wide (125) and light, the
 * text at 100, all from one file. `next/font` downloads it at build time and serves it from
 * this origin, so a visit makes no request to Google. tests/e2e/landing.spec.ts fails if one
 * appears, and /privacy tells readers there is none.
 *
 * It is loaded HERE and not in a layout on purpose. The (site) layout also wraps /privacy,
 * and the root layout wraps the console. Neither may download a marketing face. `variable`
 * publishes the family as `--lp-font` on the page root below, and app/landing.css reads it.
 * `weight` is left out because a variable font carries the whole range.
 */
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  variable: "--lp-font",
});

/**
 * Where the still sky looks behind the hero and behind the close, in the terms
 * components/marketing/Starfield.tsx takes: the longitude and latitude a globe would be
 * centred on to have that sky behind it. The sky's centre is then right ascension
 * `90 - lngDeg`, declination `-latDeg`.
 *
 * Hero: Orion in the clear sky above the headline, left of the Earth, with Sirius just off
 * the left edge so the brightest star in the sky does not sit in the headline. Close: the
 * summer Milky Way, with Altair to the left of the closing headline and Antares low on the
 * right, where the Earth comes up. Nothing turns: the Earth on this page is a canvas, not the
 * MapLibre globe the sky used to follow. app/landing.css flips the canvas, and says why.
 *
 * BOTH CENTRES STAY NEAR THE CELESTIAL EQUATOR, AND THAT IS A LIMIT OF THE TEXTURE. The sky
 * texture is an equirectangular map with every star drawn as a round dot, so a dot at
 * declination d comes out squeezed sideways by cos(d) on the sphere. Near the equator that
 * is nothing. The close first looked at the pole (Cassiopeia and the Plough, as the design
 * has it), and there the stars drew as short dashes and the ones beside Polaris all but
 * vanished. Measured for the centres below, in the band where each sky is at full strength:
 * the worst stretch is 1.28 in the hero and 1.16 in the close, and a dot that size still
 * reads as round. Move a centre past about 30 degrees of declination only with a texture
 * that widens its dots towards the poles.
 */
const HERO_SKY = { lngDeg: 45, latDeg: 22 };
const CLOSE_SKY = { lngDeg: 175, latDeg: 20 };

/**
 * The landing page.
 *
 * ONE GLOBE, START TO END. The Earth in the hero is the same object in every section. It
 * starts as a photograph, becomes the data, comes apart into layers, opens onto real places,
 * goes flat, lands on a street, and comes back whole under the last call to action. This
 * file is the document: every heading, sentence, link and image is server-rendered here, so
 * the page reads with no script. components/marketing/LandingStage.tsx is the only client
 * code that moves anything, and lib/marketing/landingGlobe.ts is the renderer.
 *
 * THE ONE RULE. Not a figure on this page is typed by hand. Each comes from a committed file
 * that a test or a script can re-derive:
 *
 *   camera-facts.data.ts     feeds, countries and catalogued webcams, each pinned by a test
 *                            that recomputes it.
 *   coverage-audit.data.ts   the layer count, generated from a production run.
 *   globe-snapshot.meta.ts   the date of the snapshot the globe draws.
 *
 * If a sentence needs a number that none of those carries, the sentence loses the number.
 *
 * THE GLOBE IS A SNAPSHOT AND THE PAGE SAYS SO. The dots are one saved read of the live map
 * (public/marketing/globe-snapshot.json), not a feed. The date is printed where the data
 * first appears and again in the footer, both from the same constant. Do not reword either
 * line to "live".
 *
 * THE SECTION IDS ARE AN INTERFACE. `hero inset split plates layers flat street close`, in
 * that order, are read by the stage and asserted by tests/e2e/landing.spec.ts.
 *
 * DEEP-LINK SHIM. Legacy `?v=`/`?c=` links are forwarded to /app by `redirects()` in
 * next.config.ts, NOT here. Reading `searchParams` in this component is what once made the
 * whole page dynamic. tests/unit/landing-static.test.ts guards both halves. Do not
 * reintroduce a `searchParams` prop on this page.
 */
export default function Landing() {
  const nf = new Intl.NumberFormat("en-GB");
  const feeds = nf.format(CAMERA_FACTS.feeds);
  const countries = nf.format(CAMERA_FACTS.countries);
  const webcams = nf.format(CAMERA_FACTS.webcams);
  const layers = nf.format(AUDIT_TOTALS.layers);

  // The snapshot's own date, read in UTC so the server's time zone cannot move it by a day.
  const takenAt = new Date(GLOBE_SNAPSHOT.takenAt);
  const snapshotDate = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(takenAt);
  const snapshotIso = takenAt.toISOString().slice(0, 10);

  return (
    <>
      {/* WebSite name + alternateName for the site name Google shows. See lib/seo/structuredData. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(websiteJsonLd(siteUrl())) }}
      />

      <div className={`lp-root ${archivo.variable}`}>
        {/* The opening intro: a curtain over the hero below, which is rendered here in full and
            reads without it. It shows only when its own gate script says so before the first
            paint, and any input skips it. components/marketing/SphereIntro.tsx. */}
        <SphereIntro />

        <a className="lp-skip" href="#main">
          Skip to content
        </a>

        {/* The one fixed canvas, the lens label, the one scroll listener and the one loop. */}
        <LandingStage />

        <header className="lp-nav" data-tone="space">
          <a className="lp-brand" href="#hero" aria-label={`${BRAND.name}, back to top`}>
            <Mark className="lp-mark" size={30} />
            <span>{BRAND.name}</span>
          </a>
          <nav className="lp-nav-links" aria-label="Site">
            <a className="lp-nav-link" href={REPO_URL} target="_blank" rel="noreferrer noopener">
              Source code
            </a>
            <a className="lp-btn lp-btn-primary lp-btn-sm" href="/app">
              Open the map
            </a>
          </nav>
        </header>

        <main id="main">
          {/* 1. Hero: the photoreal Earth */}
          <section className="lp-hero" id="hero" aria-labelledby="hero-h">
            <Starfield className="lp-sky" still={HERO_SKY} />
            <div className="lp-hero-copy">
              <h1 className="lp-display" id="hero-h">
                Earth, right now.
              </h1>
              <p className="lp-lede">
                Flights, earthquakes, wildfires and public cameras on one live globe. Free, open
                source, no login.
              </p>
              <div className="lp-ctas">
                <a className="lp-btn lp-btn-primary" href="/app">
                  Open the map
                </a>
                <a className="lp-btn lp-btn-ghost" href={REPO_URL} target="_blank" rel="noreferrer noopener">
                  Source code
                </a>
              </div>
            </div>
            {/* The same still the canvas draws. It is NOT lazy and that is deliberate: with
                motion it is display:none and still fetched, which is what puts the Earth in
                the cache before the stage asks for it. With reduced motion it is the hero. */}
            <img
              className="lp-rm-still lp-rm-hero"
              src="/marketing/landing/still-hero.webp"
              alt="A photoreal Earth, half lit, with city lights and coloured data points on its night side."
              width={1600}
              height={1600}
              fetchPriority="high"
            />
          </section>
          <div className="lp-bridge" aria-hidden="true" />

          {/* 2 + 3. The Earth lands in a framed inset and becomes the data globe. Then it
              separates into four. One pinned stage, two scenes. */}
          <div className="lp-split">
            <div className="lp-stage">
              <section className="lp-scene lp-scene-inset" id="inset" aria-labelledby="inset-h">
                <div className="lp-inset">
                  <div className="lp-frame">
                    <canvas className="lp-rm-globe" data-rm="all" aria-hidden="true" />
                  </div>
                  <p className="lp-readout" aria-hidden="true">
                    {formatCoord(INSET_C[1], INSET_C[0])}
                  </p>
                </div>
                <div className="lp-inset-copy">
                  <h2 className="lp-h2" id="inset-h">
                    Every dot is real.
                  </h2>
                  <p className="lp-lede">
                    Every coloured point on this globe is a record from the live map, taken from
                    one snapshot on <time dateTime={snapshotIso}>{snapshotDate}</time>.
                  </p>
                  <ul className="lp-key" aria-label="What the dot colours mean">
                    <li>
                      <Chip c="cam" />
                      Traffic cameras
                    </li>
                    <li>
                      <Chip c="air" />
                      Aircraft
                    </li>
                    <li>
                      <Chip c="haz" />
                      Quakes, fires, volcanoes
                    </li>
                    <li>
                      <Chip c="infra" />
                      Airports, ports, plants, cables
                    </li>
                  </ul>
                </div>
              </section>
              <section className="lp-scene lp-scene-seps" id="split" aria-labelledby="split-h">
                <div className="lp-seps-copy">
                  <h2 className="lp-h2" id="split-h">
                    One globe. Many feeds.
                  </h2>
                  <p className="lp-lede">
                    Each layer is a public feed you could find on its own. {BRAND.name} stacks
                    them so you can read them together.
                  </p>
                </div>
                {/* The order is the order of FAMILIES in lib/marketing/landingGlobe.ts: the
                    engine parks globe i over label i. */}
                <ol className="lp-seps" aria-label="The layer families, shown apart">
                  <li className="lp-sep">
                    <canvas className="lp-rm-globe" data-rm="0" aria-hidden="true" />
                    <span>Traffic cameras</span>
                  </li>
                  <li className="lp-sep">
                    <canvas className="lp-rm-globe" data-rm="1" aria-hidden="true" />
                    <span>Aircraft</span>
                  </li>
                  <li className="lp-sep">
                    <canvas className="lp-rm-globe" data-rm="2" aria-hidden="true" />
                    <span>Quakes, fires, volcanoes</span>
                  </li>
                  <li className="lp-sep">
                    <canvas className="lp-rm-globe" data-rm="3" aria-hidden="true" />
                    <span>Airports, ports, plants, cables</span>
                  </li>
                </ol>
              </section>
            </div>
          </div>

          {/* 4. A dot opens into a photograph. The globe becomes a corner lens and turns to
              each place. */}
          <section className="lp-photos" id="plates" aria-label="What a dot is">
            <div className="lp-stage">
              <figure className="lp-photo">
                <img
                  src="/marketing/landing/plate-camera.webp"
                  width={1880}
                  height={1254}
                  alt="Two dome cameras on a street pole against a grey, sunlit sky."
                  style={{ objectPosition: "36% 40%" }}
                />
                <figcaption className="lp-cap">
                  <h2 className="lp-h2">This dot is a camera on a pole.</h2>
                  <p>
                    Road agencies publish their own camera feeds. {BRAND.name} draws {feeds}{" "}
                    operator feeds across {countries} countries, plus {webcams} webcams catalogued
                    worldwide.
                  </p>
                  <p className="lp-credit">Photo: Jakub Zerdzicki, Pexels</p>
                </figcaption>
              </figure>
              <figure className="lp-photo">
                <img
                  src="/marketing/landing/plate-volcano.webp"
                  width={1880}
                  height={1322}
                  alt="A volcano in Guatemala erupting at night, lava running down its flank under a starry sky."
                  style={{ objectPosition: "58% 60%" }}
                  loading="lazy"
                />
                <figcaption className="lp-cap">
                  <h2 className="lp-h2">This one is a volcano.</h2>
                  <p>
                    Eruptions, earthquakes and fires come from the public agencies that watch
                    them, and land on the same globe.
                  </p>
                  <p className="lp-credit">Photo: Luis D. Alvarez, Pexels</p>
                </figcaption>
              </figure>
              <figure className="lp-photo">
                <img
                  src="/marketing/landing/plate-aircraft.webp"
                  width={1880}
                  height={1258}
                  alt="An airliner on final approach at dusk, over the runway approach lights."
                  style={{ objectPosition: "48% 50%" }}
                  loading="lazy"
                />
                <figcaption className="lp-cap">
                  <h2 className="lp-h2">This one is a plane.</h2>
                  <p>
                    Aircraft, ports and submarine cables show how people, goods and data move
                    around the planet.
                  </p>
                  <p className="lp-credit">Photo: Carlos Ruiz, Pexels</p>
                </figcaption>
              </figure>
            </div>
          </section>

          {/* 5. The layers: a pinned band of cards. The globe filters to the card in focus.
              `data-layer` is a layer id in the snapshot, and the engine reads it, so a card
              cannot show one layer's photograph over another layer's dots. */}
          <section className="lp-band" id="layers" aria-labelledby="band-h">
            <div className="lp-stage">
              <div className="lp-band-head">
                <h2 className="lp-h2" id="band-h">
                  {layers} layers on one globe.
                </h2>
                <p>
                  Each photo is a layer you can switch on. The globe shows that layer&rsquo;s real
                  points from one live snapshot.
                </p>
              </div>
              <div className="lp-window">
                <div className="lp-track">
                  <Card
                    layer="cameras"
                    c="cam"
                    title="Traffic cameras"
                    text="Public road cameras from the agencies that run the roads."
                    img="band-cameras"
                    w={1000}
                    h={668}
                    alt="A London motorway at night, streaked with headlight trails under sodium lamps."
                  />
                  <Card
                    layer="planes"
                    c="air"
                    title="Aircraft"
                    text="Planes in the air right now, from public flight data."
                    img="band-aircraft"
                    w={1000}
                    h={750}
                    alt="A jet high in a deep blue sky, trailing four white contrails."
                    position="30% 30%"
                  />
                  <Card
                    layer="earthquakes"
                    c="haz"
                    title="Earthquakes"
                    text="Quakes as USGS reports them, placed where the ground moved."
                    img="band-earthquakes"
                    w={1000}
                    h={666}
                    alt="A rift valley in Iceland, where two tectonic plates pull apart."
                  />
                  <Card
                    layer="wildfires"
                    c="haz"
                    title="Wildfires"
                    text="Active fires, from open satellite and agency feeds."
                    img="band-wildfires"
                    w={1000}
                    h={562}
                    alt="Smoke rising from a forest fire on a wooded hillside, seen from above."
                  />
                  <Card
                    layer="gdacs"
                    c="haz"
                    title="Disaster alerts"
                    text="Storms, floods and cyclones, from GDACS alerts."
                    img="band-alerts"
                    w={1000}
                    h={562}
                    alt="A shelf cloud rolling over an empty country road."
                    position="60% 50%"
                  />
                  <Card
                    layer="ports"
                    c="infra"
                    title="Ports"
                    text="Major seaports, where the world’s goods change hands."
                    img="band-ports"
                    w={1000}
                    h={666}
                    alt="Container cranes at a harbour, lit by sodium lamps at dusk."
                  />
                  <Card
                    layer="cables"
                    c="infra"
                    title="Submarine cables"
                    text="The cables on the sea floor that carry the internet."
                    img="band-cables"
                    w={1000}
                    h={666}
                    alt="A white cable-laying ship at sea."
                    position="55% 50%"
                  />
                  <Card
                    layer="launches"
                    c="air"
                    title="Rocket launches"
                    text="Launches and the pads they fly from."
                    img="band-launches"
                    w={1000}
                    h={656}
                    alt="A rocket launching on a column of smoke, reflected in still water."
                  />
                  <div className="lp-card lp-card-end" data-layer="all">
                    <div>
                      <h3 className="lp-h3">Also on the map</h3>
                      <p>
                        Satellites, GPS jamming, internet outages, air quality, nuclear plants,
                        news and markets.
                      </p>
                    </div>
                    <a className="lp-btn lp-btn-primary" href="/app">
                      Open the map
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 6 + 7. The globe unrolls into a flat map. Then the map zooms to London and hands
              off to the console. One pinned stage, two acts, so the zoom never cuts. */}
          <div className="lp-dive" data-step="1">
            <div className="lp-stage">
              <section className="lp-flat" id="flat" aria-labelledby="flat-h">
                <h2 className="lp-h2 lp-flat-h" id="flat-h">
                  The cameras are already public.
                </h2>
                <canvas className="lp-rm-flat" aria-hidden="true" />
                <div className="lp-facts">
                  <p>
                    {feeds} operator feeds in {countries} countries, and {webcams} more webcams
                    catalogued worldwide. {BRAND.name} draws them on one map.
                  </p>
                  <p className="lp-keyline">
                    <Chip c="cam" />
                    Blue dots: traffic cameras in the snapshot.
                  </p>
                </div>
              </section>
              <section className="lp-street" id="street" aria-labelledby="street-h">
                <div className="lp-screen">
                  <figure className="lp-shot lp-shot-1">
                    <img
                      src="/brand/gate-globe.webp"
                      alt={`The ${BRAND.name} map: Europe and Africa covered in live points, with side panels listing ports, airports and GPS interference.`}
                      width={1200}
                      height={540}
                      loading="lazy"
                    />
                  </figure>
                  <figure className="lp-shot lp-shot-2">
                    <img
                      src="/brand/gate-cameras3d.webp"
                      alt="London in 3D, with live camera thumbnails pinned above the streets."
                      width={1200}
                      height={568}
                      loading="lazy"
                    />
                  </figure>
                  <figure className="lp-shot lp-shot-3">
                    <img
                      src="/brand/gate-streets.webp"
                      alt="A wall of live street cameras, Trafalgar Square, Madrid and Prague among them, beside a map of London's camera pins."
                      width={1200}
                      height={571}
                      loading="lazy"
                    />
                  </figure>
                </div>
                <div className="lp-street-copy">
                  <h2 className="lp-h2" id="street-h">
                    Then go down to the street.
                  </h2>
                  <p className="lp-body">
                    Zoom from the globe into a city in 3D, then open the public camera on the
                    corner.
                  </p>
                  <ol className="lp-steps">
                    <li>The globe, every layer at once</li>
                    <li>A city in 3D, cameras pinned in place</li>
                    <li>The street, live from public cameras</li>
                  </ol>
                </div>
              </section>
            </div>
          </div>

          {/* 8. Close: the whole Earth rises */}
          <section className="lp-close" id="close" aria-labelledby="close-h">
            <Starfield className="lp-sky" still={CLOSE_SKY} />
            <div className="lp-close-copy">
              <h2 className="lp-h2" id="close-h">
                Have a look around.
              </h2>
              <p className="lp-lede">
                It runs in your browser. Nothing to install, nothing to sign up for.
              </p>
              <div className="lp-ctas">
                <a className="lp-btn lp-btn-primary" href="/app">
                  Open the map
                </a>
                <a className="lp-btn lp-btn-ghost" href={REPO_URL} target="_blank" rel="noreferrer noopener">
                  Source code
                </a>
              </div>
            </div>
            <img
              className="lp-rm-still lp-rm-whole"
              src="/marketing/landing/still-whole.webp"
              alt="The whole Earth in daylight: the Atlantic, Africa and Europe."
              width={1600}
              height={1600}
              loading="lazy"
            />
          </section>
        </main>

        <footer className="lp-footer">
          <div className="lp-foot-brand">
            <a className="lp-brand" href="#hero">
              <Mark className="lp-mark" size={30} />
              <span>{BRAND.name}</span>
            </a>
            <p className="lp-small">{BRAND.description}</p>
          </div>
          <nav className="lp-foot-links" aria-label="Footer">
            <a href="/app">Open the map</a>
            {/*
              The home page takes nearly every search click, and this is its only link into
              the camera directory. Without it the camera, road and place pages are reachable
              only through the sitemap. A plain <a> so a crawler follows it without script.
            */}
            <a href="/cameras">Browse every traffic camera</a>
            {/* AGPL-3.0 section 13: a hosted AGPL program must offer its source to the people
                using it. This link and the licence beside it are that offer. Do not remove
                either. tests/unit/privacy-page.test.ts fails if one goes. */}
            <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
              Source code
            </a>
            <a href={BRAND.license.url} target="_blank" rel="noreferrer noopener">
              Licence ({BRAND.license.short})
            </a>
            <a href={BRAND.discordUrl} target="_blank" rel="noreferrer noopener">
              Discord
            </a>
            <a href={BRAND.kofiUrl} target="_blank" rel="noreferrer noopener">
              Support on Ko-fi
            </a>
            <a href="/privacy">Privacy</a>
          </nav>
          {/* EVERY LINE BELOW IS A CLAIM ABOUT WHAT THIS PAGE LOADS, so each must stay true of
              it. The old footer went on crediting a basemap and two typefaces after the page
              stopped loading them. When an asset or a layer leaves the page, its credit
              leaves this list in the same change, and a new one arrives with its credit. */}
          <div className="lp-foot-legal lp-small">
            <p>
              © {BRAND.license.year} {BRAND.license.holder}. {BRAND.name} is free software under
              the {BRAND.license.name}. The source code for this site and the map is on{" "}
              <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
                GitHub
              </a>
              . The data keeps its own separate terms.
            </p>
            <p>
              The globe on this page shows a snapshot of the live map taken on{" "}
              <time dateTime={snapshotIso}>{snapshotDate}</time>.
            </p>
            {/* One clause per layer in the snapshot, worded from the `attribution` each
                adapter declares in lib/sources and lib/signals. */}
            <p>
              Powered by TfL Open Data. Webcams provided by Windy.com. Contains public sector
              information licensed under the Open Government Licence. Earthquake data from the
              U.S. Geological Survey (USGS). Wildfire and volcano data from NASA EONET. Aircraft
              from adsb.lol. Airports from OurAirports. Nuclear plant data from OpenStreetMap
              contributors. Launch data from The Space Devs. Disaster alerts from GDACS. Submarine
              cable data from TeleGeography.
            </p>
            <p>
              Country outlines on this page: Natural Earth 110m (public domain). Earth imagery in
              the two renders: NASA Visible Earth, Blue Marble Next Generation and Black Marble
              2016, rendered in Blender.
            </p>
            {/* What the three console screenshots show, as docs/IMAGE-LICENSES.md records it.
                The satellite credit is the string lib/basemaps.ts gives the console itself. */}
            <p>
              In the console screenshots, the satellite map is Esri World Imagery (Imagery © Esri,
              Maxar, Earthstar Geographics). The 3D building shapes are from OpenFreeMap and
              OpenMapTiles, data © OpenStreetMap contributors. One camera frame carries the
              Transport for London mark (Powered by TfL Open Data, Open Government Licence).
            </p>
            <p>
              Star catalogue:{" "}
              <a href="https://codeberg.org/astronexus/hyg" target="_blank" rel="noreferrer noopener">
                HYG database v4.4
              </a>{" "}
              by David Nash (astronexus), licensed CC BY-SA 4.0. Star positions are real. The sky
              is shown at a wider angle than the camera of the Earth renders, so whole
              constellations fit the frame.
            </p>
            <p>
              Camera stills in the photo sphere, taken on 8 October 2026: Powered by TfL Open Data
              (Open Government Licence); DriveBC / BC Ministry of Transportation and Infrastructure
              (Open Government Licence – British Columbia); Fintraffic / Digitraffic (CC BY 4.0).
            </p>
            <p>
              Photographs from Pexels by Jakub Zerdzicki, Luis D. Alvarez, Carlos Ruiz, Dominik
              Gryzbon, SevenStorm JUHASZIMRUS, Balázs Gábor, K, Guillermo, Griffin Wooldridge,
              Jeffry Surianto and Pixabay.
            </p>
            {/* Archivo sets this page. Inter sets the Discord note, which is console chrome
                and mounts below. Permanent Marker is still loaded by the (site) layout for
                nothing on this page, so it is not credited here. */}
            <p>
              Typefaces:{" "}
              <a href="https://fonts.google.com/specimen/Archivo" target="_blank" rel="noreferrer noopener">
                Archivo
              </a>{" "}
              and{" "}
              <a href="https://fonts.google.com/specimen/Inter" target="_blank" rel="noreferrer noopener">
                Inter
              </a>
              .
            </p>
          </div>
        </footer>
      </div>

      {/* The Discord invitation. It gates itself (lib/shell/community.ts): an empty live
          region until 40 seconds of visible time, and never again once answered here or
          in the console. Most visitors land here and many never open /app. It sits OUTSIDE
          `.lp-root` so the landing sheet cannot restyle it. */}
      <CommunityNote surface="landing" />
    </>
  );
}

type FamilyToken = "cam" | "air" | "haz" | "infra";

/** A layer swatch: a dot of the layer's colour on a piece of the globe's ocean. Decorative. */
function Chip({ c }: { c: FamilyToken }) {
  return (
    <span className="lp-chip" style={{ "--c": `var(--${c})` } as CSSProperties} aria-hidden="true">
      <i />
    </span>
  );
}

function Card(props: {
  /** A layer id in the snapshot. The stage filters the globe to it while this card is in focus. */
  layer: string;
  c: FamilyToken;
  title: string;
  text: string;
  /** File name under public/marketing/landing, without the extension. */
  img: string;
  w: number;
  h: number;
  alt: string;
  position?: string;
}) {
  return (
    <figure className="lp-card" data-layer={props.layer}>
      <div className="lp-ph">
        <img
          src={`/marketing/landing/${props.img}.webp`}
          width={props.w}
          height={props.h}
          alt={props.alt}
          loading="lazy"
          style={props.position ? { objectPosition: props.position } : undefined}
        />
      </div>
      <figcaption>
        <h3 className="lp-h3">
          <Chip c={props.c} />
          {props.title}
        </h3>
        <p>{props.text}</p>
      </figcaption>
    </figure>
  );
}
