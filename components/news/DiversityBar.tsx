"use client";
// components/news/DiversityBar.tsx
// One bar per story: what KINDS of newsroom carried it, and what is missing.
//
// The bar is proportional, so a story carried by four commercial broadcasters and
// nothing else reads as one solid block at a glance — which is the finding. The
// figures come from lib/news/diversity.ts, which counts the sources in front of
// the reader; nothing here is modelled or estimated.
//
// The blindspot line underneath is printed WITH its caveat, never without. A
// missing outlet means the story was not among the latest headlines that outlet's
// feed gave us, which is a weaker statement than "they ignored it" and has to
// keep looking like one.

import type { CoverageProfile, BlindspotReport } from "@/lib/news/diversity";

/**
 * Stable colour per outlet type.
 *
 * Fixed rather than generated so the same kind of newsroom is the same colour on
 * every card — a bar you have to re-read the legend for each time is decoration.
 * An unlisted type falls through to the neutral, which is honest: a colour it has
 * not earned would imply a grouping nobody decided.
 */
const TYPE_COLOR: Record<string, string> = {
  "Public broadcaster": "var(--tn-accent)",
  "Public radio": "var(--tn-accent-strong)",
  Newswire: "#0e7d97",
  Newspaper: "#7c3aed",
  Broadcaster: "#d97706",
  "OSINT monitor": "#94a3b8",
};

export function DiversityBar({
  profile,
  blindspot,
}: {
  profile: CoverageProfile;
  blindspot?: BlindspotReport;
}) {
  const total = profile.byType.reduce((a, s) => a + s.count, 0) || 1;

  return (
    <div className="tn-hd-div">
      <div
        className="tn-hd-div-bar"
        role="img"
        aria-label={profile.summary}
        title={profile.summary}
      >
        {profile.byType.map((s) => (
          <span
            key={s.label}
            className="tn-hd-div-seg"
            style={{
              width: `${(s.count / total) * 100}%`,
              background: TYPE_COLOR[s.label] ?? "var(--tn-border-strong)",
            }}
          />
        ))}
      </div>

      <div className="tn-hd-div-legend">
        <span className="tn-hd-div-sum">{profile.summary}</span>
        {profile.stateFunded > 0 && (
          <span
            className="tn-hd-div-state"
            title="Funded by a government. Not a claim about editorial independence — it is here so a reader can see when several of the agreeing outlets share a funder."
          >
            {profile.stateFunded} government-funded
          </span>
        )}
      </div>

      {blindspot && !blindspot.inconclusive && blindspot.claim && (
        <p
          className={`tn-hd-blind${blindspot.missingRegions.length ? " has-gap" : ""}`}
          title={blindspot.caveat}
        >
          <span className="tn-hd-blind-k">
            {blindspot.missingRegions.length ? "Coverage gap" : "Coverage"}
          </span>
          {blindspot.claim}
          <span className="tn-hd-blind-caveat">{blindspot.caveat}</span>
        </p>
      )}
    </div>
  );
}
