"use client";
// components/news/CompareView.tsx
// One story, every outlet that carried it, side by side.
//
// This is the thing the board exists for: the same event, and the words each
// newsroom chose for it, close enough together to read across in one go. Columns
// scroll horizontally rather than stacking, because the comparison is the point
// and a stack is just the list again.
//
// WHAT IS HIGHLIGHTED, AND WHY IT IS SAFE TO HIGHLIGHT. The marked words are the
// terms that appear in exactly one outlet's coverage of this story and in none of
// the others' — computed in lib/news/framing.ts, no model involved. A highlight
// therefore means "only this outlet used this word here", which the reader can
// confirm by looking at the column next to it. It does NOT mean the word is
// loaded, and nothing in this component grades it; the shared-terms strip above
// exists partly to keep that honest, by showing how much the outlets agreed on
// before showing where they diverged.

import type { Cluster } from "@/lib/news/cluster";
import { compareFraming, markTerms } from "@/lib/news/framing";
import { SourceBadge } from "@/components/news/SourceBadge";

function Marked({ text, terms }: { text: string; terms: readonly string[] }) {
  return (
    <>
      {markTerms(text, terms).map((run, i) =>
        run.mark ? (
          <mark key={i} className="tn-hd-cmp-mark">
            {run.text}
          </mark>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
    </>
  );
}

export function CompareView({
  cluster,
  rel,
  now,
  only,
}: {
  cluster: Cluster;
  rel: (ts: number, now: number) => string;
  now: number;
  /** Restrict to these sources (the matchup filter). Empty/undefined = all. */
  only?: ReadonlySet<string>;
}) {
  const framing = compareFraming(cluster);
  const columns = only?.size
    ? framing.bySource.filter((s) => only.has(s.source))
    : framing.bySource;

  if (!framing.comparable || columns.length < 2) {
    return (
      <p className="tn-hd-cmp-empty">
        Only one outlet in this pull carried this story, so there is nothing to compare it with.
      </p>
    );
  }

  return (
    <div className="tn-hd-cmp">
      {framing.shared.length > 0 && (
        <p className="tn-hd-cmp-shared">
          <span className="tn-hd-cmp-shared-k">Every outlet used</span>
          {framing.shared.slice(0, 12).map((t) => (
            <span key={t} className="tn-hd-cmp-term">
              {t}
            </span>
          ))}
        </p>
      )}

      <div className="tn-hd-cmp-cols">
        {columns.map((col) => {
          const lead = col.items[0];
          return (
            <article key={col.source} className="tn-hd-cmp-col">
              <header className="tn-hd-cmp-col-h">
                <SourceBadge name={col.source} size={15} />
                <span className="tn-hd-cmp-col-time">{rel(lead.ts, now)}</span>
              </header>

              <a className="tn-hd-cmp-title" href={lead.url} target="_blank" rel="noreferrer">
                <Marked text={lead.title} terms={col.distinctive} />
              </a>

              {lead.description && (
                <p className="tn-hd-cmp-lede">
                  <Marked text={lead.description} terms={col.distinctive} />
                </p>
              )}

              {col.items.length > 1 && (
                <ul className="tn-hd-cmp-also">
                  {col.items.slice(1).map((it) => (
                    <li key={it.url}>
                      <a href={it.url} target="_blank" rel="noreferrer">
                        {it.title}
                      </a>
                    </li>
                  ))}
                </ul>
              )}

              {col.distinctive.length > 0 ? (
                <p className="tn-hd-cmp-only">
                  <span className="tn-hd-cmp-only-k">Only here</span>
                  {col.distinctive.map((t) => (
                    <span key={t} className="tn-hd-cmp-term is-only">
                      {t}
                    </span>
                  ))}
                </p>
              ) : (
                <p className="tn-hd-cmp-only is-none">
                  No wording unique to this outlet — it used the same terms as the others.
                </p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
