/**
 * The signature: one real earthquake, from a government's raw bytes to a marker on
 * the map, in three scroll-scrubbed beats.
 *
 * This is the whole product dramatised. `lib/signals/usgs.ts` does exactly this,
 * and every other adapter in the registry does the same for its own upstream. The
 * count in the closing line is measured from the registry, never typed.
 *
 * All three beats are in the DOM at once and CSS switches on `data-beat`, which
 * ScrollGround writes. Nothing here re-renders while you scroll.
 *
 * The payload is a REAL USGS GeoJSON feature (event us6000ph7m, M6.1, 2026-08-04),
 * trimmed for width. Inventing one on a page whose argument is "we never fabricate
 * data" would be self-defeating.
 */
export default function AdapterSection({ adapterCount }: { adapterCount: number }) {
  return (
    <section className="pv-adapter pv-bleed" data-pv-adapter data-beat="0" id="adapter">
      <div className="pv-adapter-track" data-pv-adapter-track>
        <div className="pv-adapter-pin">
          <div className="pv-adapter-inner">
            <div>
              <p className="pv-eyebrow">
                <span>USGS</span>
                <span>Earthquake</span>
                <span>60s</span>
                <span>Public domain</span>
              </p>
              <h2 className="pv-h2">Every dot has a receipt.</h2>
            </div>

            <div className="pv-adapter-stage">
              <div className="pv-payload-stack">
                <pre className="pv-payload pv-p0">{`{
  "type": "Feature",
  "id": "us6000ph7m",
  "properties": {
    "mag": 6.1,
    "place": "122 km SSE of Sand Point, Alaska",
    "time": 1786010421000,
    "updated": 1786012004040,
    "tz": null, "felt": 3, "cdi": 3.4,
    "net": "us", "sig": 572, "nst": 118,
    "dmin": 0.641, "rms": 0.87, "gap": 29,
    "magType": "mww", "type": "earthquake"
  },
  "geometry": {
    "type": "Point",
    "coordinates": [-159.9, 54.1, 32.5]
  }
}`}</pre>

                <pre className="pv-payload pv-p1">{`mag        6.1              `}<b>{`──►  magnitude`}</b>{`
place      "122 km SSE…"    `}<b>{`──►  title`}</b>{`
time       1786010421000    `}<b>{`──►  ts (ISO)`}</b>{`
coordinates[-159.9, 54.1]   `}<b>{`──►  lat / lon`}</b>{`
id         "us6000ph7m"     `}<b>{`──►  "usgs:us6000ph7m"`}</b>{`

tz         null             `}<s>{`───  dropped`}</s>{`
cdi        3.4              `}<s>{`───  dropped`}</s>{`
rms        0.87             `}<s>{`───  dropped`}</s>{`
gap        29               `}<s>{`───  dropped`}</s>{`
nst        118              `}<s>{`───  dropped`}</s>{`

zod parse  `}<b>{`ok`}</b>{`  ·  1 feature`}</pre>

                <pre className="pv-payload pv-p2">{`SignalFeature {
  id:       "usgs:us6000ph7m"
  signalId: "earthquakes"
  lat:      54.1
  lon:     -159.9
  title:    "M6.1 — 122 km SSE of Sand Point"
  ts:       "2026-08-04T20:00:21.000Z"
  props:  { magnitude: 6.1, depthKm: 32.5 }
  link:     "earthquake.usgs.gov/…/us6000ph7m"
}`}</pre>
              </div>

              <div className="pv-arrow" aria-hidden="true">
                ──►
              </div>

              <div className="pv-marker-stage">
                <span className="pv-marker" aria-hidden="true" />
                <dl className="pv-dossier">
                  <div>
                    <dt>event</dt>
                    <dd>M6.1</dd>
                  </div>
                  <div>
                    <dt>source</dt>
                    <dd>USGS</dd>
                  </div>
                  <div>
                    <dt>licence</dt>
                    <dd>public domain</dd>
                  </div>
                  <div>
                    <dt>recorded</dt>
                    <dd>2026-08-04</dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="pv-beats" aria-hidden="true">
              <i className="pv-b0" />
              <i className="pv-b1" />
              <i className="pv-b2" />
              <span className="pv-beat-label">
                <span className="pv-beat-0">Raw upstream</span>
                <span className="pv-beat-1">Normalising</span>
                <span className="pv-beat-2">Rendered</span>
              </span>
            </div>

            <p className="pv-caption">
              <span className="pv-beat-0">
                This is what an earthquake looks like when a government publishes it.
              </span>
              <span className="pv-beat-1">
                One adapter reads it, checks its shape, and throws away nothing it cannot explain.
              </span>
              <span className="pv-beat-2">
                Same earthquake. Now it is a place on a map, with its source attached.
              </span>
            </p>

            <p className="pv-adapter-closer">
              {adapterCount} adapters. One per source.
              <br />
              That is the entire product.
            </p>
            <p className="pv-adapter-foot">
              A real USGS record, captured 2026-08-04. The live version of it is one scroll away.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
