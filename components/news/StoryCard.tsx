"use client";
// components/news/StoryCard.tsx
// One event, everyone who reported it, and how much they agreed.
//
// The card is ordered the way a reader actually triages: WHO carried it (the
// badge row and the source count), WHAT happened (the headline and lede), HOW
// WELL it is corroborated (the diversity bar and the coverage gap), and only then
// the controls for going deeper. The previous board put velocity chips and
// "Updated" flags above the headline, which meant the first thing on every card
// was metadata about a story the reader had not read yet.
//
// A single-source card is deliberately plainer — no bar, no gap line, no compare
// button — because there is nothing to corroborate and dressing it up like a
// four-source story would be the whole problem this board was built to fix.

import type { Cluster } from "@/lib/news/cluster";
import type { Universe } from "@/lib/news/diversity";
import { coverageProfile, blindspotReport } from "@/lib/news/diversity";
import { clusterVelocity, velocityLabel } from "@/lib/news/velocity";
import { detectPrimarySource } from "@/lib/news/primary";
import { sourceMeta } from "@/lib/news/sources";
import { SourceIcon } from "@/components/news/SourceIcon";
import { SourceBadge } from "@/components/news/SourceBadge";
import { DiversityBar } from "@/components/news/DiversityBar";
import { CompareView } from "@/components/news/CompareView";

export type SynthState = { loading?: boolean; text?: string; note?: string };

export function StoryCard({
  c,
  universe,
  now,
  rel,
  compareOpen,
  onToggleCompare,
  onPreview,
  updated,
  change,
  synth,
  aiDormant,
  onSynthesize,
  matchup,
}: {
  c: Cluster;
  universe: Universe;
  now: number;
  rel: (ts: number, now: number) => string;
  compareOpen: boolean;
  onToggleCompare: () => void;
  onPreview: () => void;
  updated: boolean;
  change?: { from: string; to: string };
  synth?: SynthState;
  aiDormant: boolean;
  onSynthesize: () => void;
  matchup?: ReadonlySet<string>;
}) {
  const multi = c.sourceCount > 1;
  const vel = clusterVelocity(c, now);
  const vl = velocityLabel(vel);
  const trending = vel?.trending ?? false;
  const primary =
    detectPrimarySource(c.lead) ?? c.items.map((i) => detectPrimarySource(i)).find(Boolean) ?? null;
  const profile = coverageProfile(c);
  const blindspot = blindspotReport(c, universe);

  return (
    <article className={`tn-hd-card${trending ? " is-trending" : ""}${multi ? "" : " is-single"}`}>
      <div className="tn-hd-card-badges">
        {c.sources.slice(0, 7).map((s) => (
          <SourceIcon key={s} name={s} domain={sourceMeta(s).domain} size={18} title={s} />
        ))}
        {c.sources.length > 7 && <span className="tn-hd-chip-n">+{c.sources.length - 7}</span>}
        {multi && <span className="tn-hd-badge tn-hd-corrob">{c.sourceCount} sources</span>}
        {!multi && <span className="tn-hd-badge tn-hd-single">Single source</span>}
        <span className="tn-hd-card-time">{rel(c.latestTs, now)}</span>
      </div>

      <a className="tn-hd-card-title" href={c.lead.url} target="_blank" rel="noreferrer">
        {c.title}
      </a>

      <div className="tn-hd-card-lead-src">
        <SourceBadge name={c.lead.source} size={13} />
        {vl && <span className={`tn-hd-badge tn-hd-vel${trending ? " is-trending" : ""}`}>▲ {vl}</span>}
        {updated && (
          <span
            className="tn-hd-badge tn-hd-upd"
            title={change ? `Was: ${change.from}` : "Headline changed since last seen"}
          >
            Updated
          </span>
        )}
        {primary && (
          <span className="tn-hd-badge tn-hd-primary" title="Appears to reference a primary/official source">
            {primary.label}
          </span>
        )}
      </div>

      {change && <p className="tn-hd-change">Updated from: “{change.from}”</p>}
      {c.lead.description && <p className="tn-hd-snippet">{c.lead.description}</p>}

      {multi && <DiversityBar profile={profile} blindspot={blindspot} />}

      <div className="tn-hd-card-actions">
        {multi && (
          <button className="tn-hd-act" onClick={onToggleCompare} aria-expanded={compareOpen}>
            {compareOpen ? "▾ Hide comparison" : `▸ Compare ${c.sourceCount} outlets`}
          </button>
        )}
        <button className="tn-hd-act" onClick={onPreview}>
          ⛶ Read excerpts
        </button>
        {multi && !aiDormant && (
          <button className="tn-hd-act is-ai" onClick={onSynthesize} disabled={!!synth?.loading}>
            {synth?.loading ? "Synthesising…" : "✨ AI synthesis"}
          </button>
        )}
      </div>

      {compareOpen && <CompareView cluster={c} rel={rel} now={now} only={matchup} />}

      {synth?.text && (
        <div className="tn-hd-synth">
          <span className="tn-hd-synth-h">Cross-source synthesis</span>
          <p>{synth.text}</p>
          {/* Said on every generated paragraph, not once in a footer: the reader
              is looking at a model's words directly beneath a set of verifiable
              quotations, and the two must not be mistaken for each other. */}
          <span className="tn-hd-synth-note">
            Written by a language model from the headlines above. Check it against them.
          </span>
        </div>
      )}
      {synth?.note && <p className="tn-hd-synth-note">{synth.note}</p>}
    </article>
  );
}
