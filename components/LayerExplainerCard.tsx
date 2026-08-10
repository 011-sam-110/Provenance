"use client";
// The trust card: what this layer is, how the number was arrived at, how far it
// reaches, and — the part everyone else leaves out — what it cannot tell you.
//
// Rendered in the signal dossier under the source links, so the answer to "can I
// rely on this?" sits next to the thing being relied on rather than in a docs page
// nobody opens.
//
// It renders nothing at all for an id with no explainer, rather than a "not
// documented yet" placeholder. That placeholder is precisely how the competing
// product ended up shipping this same card blank on twelve of its twenty layers;
// tests/unit/signals-explain.test.ts makes the empty case unreachable for us by
// failing the build when a registered layer has no entry.

import { confidenceLabel, explainerFor } from "@/lib/signals/explain";

export default function LayerExplainerCard({ signalId }: { signalId?: string }) {
  const e = signalId ? explainerFor(signalId) : undefined;
  if (!e) return null;

  return (
    <section className="tn-explain" data-testid="layer-explainer" aria-label="About this layer">
      <h3 className="tn-explain-h">About this layer</h3>

      <p className="tn-explain-what">{e.whatItShows}</p>

      <dl className="tn-explain-rows">
        <dt>How it is derived</dt>
        <dd>{e.method}</dd>
        <dt>Confidence</dt>
        <dd>
          <span className={`tn-explain-conf tn-conf-${e.confidence}`}>{confidenceLabel(e.confidence)}</span>
        </dd>
        <dt>Coverage</dt>
        <dd>{e.coverage}</dd>
      </dl>

      <div className="tn-explain-lims">
        <div className="tn-explain-lims-h">What it cannot tell you</div>
        <ul>
          {e.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
