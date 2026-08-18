import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { SOURCE_CATALOG } from "@/lib/sources/catalog";
import { buildWall, marqueePublishers, wallCount } from "@/lib/marketing/wall";
import ScrollGround from "@/components/marketing/ScrollGround";
import InstrumentBar from "@/components/marketing/InstrumentBar";
import HeroStage from "@/components/marketing/HeroStage";
import Starfield from "@/components/marketing/Starfield";
import Marquee from "@/components/marketing/Marquee";
import AdapterSection from "@/components/marketing/AdapterSection";
import SourceWall from "@/components/marketing/SourceWall";
import HonestLedger from "@/components/marketing/HonestLedger";
import RepoFacts from "@/components/marketing/RepoFacts";

const REPO = "011-sam-110/TrafficNerd-V2";
const REPO_URL = `https://github.com/${REPO}`;

export const metadata: Metadata = {
  title: `${BRAND.name} · ${BRAND.tagline}`,
  description: BRAND.description,
  alternates: { canonical: "/" },
};

/**
 * The landing page.
 *
 * Everything countable on it is computed from the app's own registries at render
 * time (`SOURCE_CATALOG` → `buildWall`), or fetched live in the browser from the
 * same endpoints the console uses. There is not a hand-typed figure on the page,
 * because the page's entire argument is that its numbers are checkable.
 *
 * DEEP-LINK SHIM. Shared links and the OG cards were minted against `/` carrying
 * `?v=` (board) or `?c=` (layout). The console now lives at /app, so those params
 * are forwarded there with the query intact. Without this, every link anyone has
 * already shared would land on marketing copy instead of the map they sent.
 */
export default async function Landing({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  if (sp.v !== undefined || sp.c !== undefined) {
    const qs = new URLSearchParams();
    for (const [k, val] of Object.entries(sp)) {
      if (typeof val === "string") qs.set(k, val);
      else if (Array.isArray(val) && val[0] !== undefined) qs.set(k, val[0]);
    }
    redirect(`/app?${qs.toString()}`);
  }

  const groups = buildWall();
  const total = wallCount();
  const publishers = marqueePublishers();
  const ledgerSources = SOURCE_CATALOG.filter((s) => s.kind === "signal").map((s) => ({
    id: s.id,
    label: s.label,
    group: s.group,
  }));

  // Every registered signal layer, handed to the hero globe. Read here on the
  // server rather than imported by the globe itself: `SOURCE_CATALOG` pulls in
  // `SIGNALS`, and `SIGNALS` pulls in all ~39 adapter modules, none of which the
  // browser needs in order to read three strings off each entry.
  //
  // This is why the hero cannot drift from the product. A new adapter appears on
  // the globe, in the wall and in the ledger from the same registry entry, and
  // there is no marketing-side list to forget to update.
  const heroLayers = SOURCE_CATALOG.filter((s) => s.kind === "signal").map((s) => ({
    id: s.id,
    label: s.label,
    color: s.color,
  }));

  // Four exemplars for the hero's key. Looked up rather than typed, so the swatch
  // is the colour the globe is actually painting that layer — a legend that has
  // drifted from its map is worse than no legend.
  //
  // Chosen to span the registry AND the palette: infrastructure, space, a hazard,
  // and the synthesis layer. Wildfires was the obvious fourth and is the wrong
  // one — its registry colour sits a few degrees from the earthquake orange, so
  // the two swatches were indistinguishable at 0.45rem.
  const legend = ["cables", "satellites", "earthquakes", "instability"]
    .map((id) => SOURCE_CATALOG.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
  const satColor = SOURCE_CATALOG.find((s) => s.id === "satellites")?.color ?? "#7c3aed";

  return (
    <>
      <div className="pv-ground" aria-hidden="true" />
      <div className="pv-progress" aria-hidden="true" />
      <ScrollGround />

      <InstrumentBar />

      {/* ── hero: a full-bleed night stage, outside the document grid ─────── */}
      {/* `pv-intro` arms the launch sequence and is server-rendered so a cold load
          plays it on the first paint. HeroStage takes it off and puts it back to
          replay the sequence when the page returns from the back/forward cache. */}
      <header className="pv-hero pv-intro" id="top" data-pv-hero>
        <HeroStage layers={heroLayers} satColor={satColor} />

        <div className="pv-hero-copy">
          <p className="pv-hero-eyebrow">
            <span>Live · no key · no login</span>
            <span>{total} adapters, one per source</span>
          </p>
          {/* Two spans, not a <br>: each line wipes up under its own clip, and a
              line break cannot carry an animation. */}
          <h1 className="pv-h1">
            <span>You already</span>
            <span>paid for this.</span>
          </h1>
          <p className="pv-hero-lede">
            Satellites, seismographs, road cameras and river gauges, funded by the public and
            published in formats almost nobody can read. {BRAND.name} renders them, live, on one
            map.
          </p>
          <div className="pv-cta-row">
            <a className="pv-cta" href="/app">
              Open the map
            </a>
            <a className="pv-cta pv-cta-ghost" href={REPO_URL} target="_blank" rel="noreferrer noopener">
              Read the source
            </a>
          </div>
          {/* The globe's key: four of the {total} layers on it, named and coloured
              from the same registry the globe renders from. */}
          <div className="pv-hero-legend">
            {legend.map((s) => (
              <span key={s.id}>
                <i style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
        </div>
      </header>

      <div className="pv-doc">
        {/* ── the publishers ─────────────────────────────────────────────── */}
        <div className="pv-bleed">
          <Marquee publishers={publishers} />
        </div>

        {/* ── the case ───────────────────────────────────────────────────── */}
        <section className="pv-block">
          <div>
            <p className="pv-eyebrow">
              <span>The case</span>
              <span>Why this exists</span>
            </p>
            <h2 className="pv-h2">
              The data is already free.
              <br />
              The reading of it is not.
            </h2>
          </div>
          <div className="pv-cols">
            <div className="pv-card">
              <h3 className="pv-h3">The data is already yours</h3>
              <p>
                Public money, public sensors, public endpoints. You have paid for the satellites
                and the seismographs whether or not you have ever seen what they produce.
              </p>
            </div>
            <div className="pv-card">
              <h3 className="pv-h3">The reading of it is the hard part</h3>
              <p>
                CSV, GeoJSON, TLE sets, and endpoints that silently cap at a hundred rows. The gap
                between published and legible is where the public loses access.
              </p>
            </div>
            <div className="pv-card">
              <h3 className="pv-h3">A renderer is not a middleman</h3>
              <p>
                Nothing here is resold, gated, or enriched into something you have to pay for. The
                map is the reading, and the source of every reading travels with it.
              </p>
            </div>
          </div>
        </section>

        {/* ── open source ────────────────────────────────────────────────── */}
        <section className="pv-block" id="open-source">
          <div>
            <p className="pv-eyebrow">
              <span>Open source</span>
              <span>{REPO}</span>
            </p>
            <h2 className="pv-h2">Nothing here is a black box.</h2>
          </div>
          <div className="pv-split">
            <div className="pv-prose">
              <p>
                The adapters, the normalisers, the map, the tests. If you think a number on this
                page is wrong, you can read the function that produced it and open a pull request
                against it.
              </p>
              <p>
                Every upstream is keyless-first and dormant-safe: a feed that fails resolves to an
                empty set or the last good answer. It never guesses, and it never fabricates a
                value to fill a gap. That rule is enforced in the code, not in a promise.
              </p>
              <p className="pv-note">
                {total} adapters, one per source. Adding one is a single file plus a registry entry
                plus a test — which is why the wall below is generated rather than maintained.
              </p>
            </div>
            <RepoFacts repo={REPO} adapters={total} />
          </div>
        </section>
      </div>

      {/* ── the signature, full bleed: the ground crossover hides here ───── */}
      <AdapterSection adapterCount={total} />

      <div className="pv-doc">
        {/* ── the source wall ────────────────────────────────────────────── */}
        <SourceWall groups={groups} total={total} />

        {/* ── the honest ledger ──────────────────────────────────────────── */}
        <HonestLedger sources={ledgerSources} />
      </div>

      {/* ── handoff ──────────────────────────────────────────────────────── */}
      <section className="pv-handoff">
        {/* The page closes under the same sky it opened on. */}
        <Starfield />
        <div className="pv-handoff-inner">
          <p className="pv-eyebrow">
            <span>The map</span>
            <span>No login</span>
            <span>No key</span>
          </p>
          <h2 className="pv-h2">Everything above was this.</h2>
          <p className="pv-lede">
            The globe at the top of this page is the product, running, on live data. The rest of it
            is one click away.
          </p>
          <div className="pv-cta-row">
            <a className="pv-cta" href="/app">
              Open the map
            </a>
            <a className="pv-cta pv-cta-ghost" href={REPO_URL} target="_blank" rel="noreferrer noopener">
              Read the source
            </a>
          </div>
        </div>
      </section>

      <footer className="pv-footer">
        <div className="pv-footer-inner">
          <div>
            <h4>{BRAND.name}</h4>
            <p>{BRAND.description}</p>
          </div>
          <div>
            <h4>The product</h4>
            <a href="/app">Open the map</a>
            <a href="#sources">All {total} sources</a>
            <a href="#ledger">Live layer status</a>
            <a href="/privacy">Privacy</a>
          </div>
          <div>
            <h4>The code</h4>
            <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
              GitHub
            </a>
            <a href={`${REPO_URL}/blob/main/docs/API_KEYS.md`} target="_blank" rel="noreferrer noopener">
              Which layers need a key
            </a>
            <a href={BRAND.license.url} target="_blank" rel="noreferrer noopener">
              Licence ({BRAND.license.short})
            </a>
            <a href={BRAND.kofiUrl} target="_blank" rel="noreferrer noopener">
              Support the running costs
            </a>
          </div>
          <div>
            <h4>Typefaces</h4>
            <a href="https://fonts.google.com/specimen/Archivo" target="_blank" rel="noreferrer noopener">
              Archivo
            </a>
            <a href="https://fonts.google.com/specimen/Public+Sans" target="_blank" rel="noreferrer noopener">
              Public Sans
            </a>
            <a href="https://fonts.google.com/specimen/IBM+Plex+Mono" target="_blank" rel="noreferrer noopener">
              IBM Plex Mono
            </a>
          </div>
          <div>
            <h4>Attribution</h4>
            <p>
              Powered by TfL Open Data. Webcams provided by Windy.com. Basemap © CARTO, ©
              OpenStreetMap contributors. Contains public sector information licensed under the
              Open Government Licence.
            </p>
            <p>
              © {BRAND.license.year} {BRAND.license.holder}. {BRAND.name} is free software
              under the {BRAND.license.name}. The data above keeps its own separate terms.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
