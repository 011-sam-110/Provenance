import type { WallGroup } from "@/lib/marketing/wall";

/**
 * Every source, cited — scrolled sideways.
 *
 * The argument this section makes is made by LENGTH: you push sideways for a long
 * time and the citations do not run out. So the content is generated from
 * `buildWall()` (which reads the app's own registry) rather than curated here.
 * Adding an adapter adds a card. Nothing in this file needs to change for it.
 *
 * The cards carry the static citation only — publisher, cadence, group. Live
 * status is deliberately NOT shown here: a page load would have to hit every
 * upstream to earn those dots honestly, and 40-odd cold fetches for a decorative
 * green light is exactly the kind of thing this product refuses to do. The live
 * check lives in the honest ledger below, where the reader asks for it.
 *
 * Desktop pins and scrubs horizontally (ScrollGround drives --pv-wall-x). Touch
 * gets a native snap strip instead — a pinned scrub on touch is the single most
 * common way a page like this falls apart.
 */
export default function SourceWall({ groups, total }: { groups: WallGroup[]; total: number }) {
  const cards = groups.flatMap((g) => g.entries);

  // Two rows rather than one. A single strip left the pinned viewport half empty and
  // read as a shelf; stacking them doubles the density so the section actually looks
  // like the wall the copy claims. Split on cumulative CARD count, not group count,
  // so the two rows come out close to the same width and finish their travel
  // together — groups vary from 1 to 9 entries.
  const half = Math.ceil(cards.length / 2);
  const rows: WallGroup[][] = [[], []];
  let run = 0;
  for (const g of groups) {
    rows[run < half ? 0 : 1].push(g);
    run += g.entries.length;
  }
  if (rows[1].length === 0 && rows[0].length > 1) rows[1].push(rows[0].pop() as WallGroup);

  return (
    <section className="pv-wall pv-bleed" data-pv-wall id="sources">
      <div className="pv-wall-pin">
        <div className="pv-wall-head">
          <p className="pv-eyebrow">
            <span>{total} sources</span>
            <span>Generated from the registry</span>
          </p>
          <h2 className="pv-h2">Every source, cited.</h2>
          <p className="pv-lede">
            This list is not maintained by hand. It is the same registry the map renders from, so
            it cannot drift from what the product actually reads.
          </p>
        </div>

        <div className="pv-wall-track-outer pv-wall-viewport">
          {rows.map((row, i) => (
            <div className="pv-wall-track" data-pv-wall-track data-row={i + 1} key={i}>
              {row.map((g) => (
                <div className="pv-wall-group" key={g.group}>
                  <span className="pv-wall-group-label">
                    {g.group} · {g.entries.length}
                  </span>
                  <div className="pv-wall-cards">
                    {g.entries.map((e) => (
                      <article className="pv-src" key={e.id}>
                        <span
                          className="pv-src-label"
                          style={{ borderLeft: `2px solid ${e.color}`, paddingLeft: ".5rem" }}
                        >
                          {e.label}
                        </span>
                        <p className="pv-src-attr">{e.attribution}</p>
                        <div className="pv-src-meta">
                          <span>{e.kind === "core" ? "core layer" : "signal"}</span>
                          <span>{e.cadence}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Touch / reduced-motion fallback: the same cards, swipeable. */}
        <div className="pv-wall-swipe">
          {cards.map((e) => (
            <article className="pv-src" key={`s-${e.id}`}>
              <span className="pv-src-label" style={{ borderLeft: `2px solid ${e.color}`, paddingLeft: ".5rem" }}>
                {e.label}
              </span>
              <p className="pv-src-attr">{e.attribution}</p>
              <div className="pv-src-meta">
                <span>{e.group}</span>
                <span>{e.cadence}</span>
              </div>
            </article>
          ))}
        </div>

        <div className="pv-wall-rail" aria-hidden="true">
          <i />
        </div>
      </div>
    </section>
  );
}
