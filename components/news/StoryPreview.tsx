"use client";
// components/news/StoryPreview.tsx
// Every outlet's excerpt of one story, in a dialog, without leaving the board.
//
// The board's job is triage across a lot of stories; this is the one place it
// stops and lets you read. Each outlet gets its headline, its lede as the feed
// supplied it, its publication time and a link out — enough to judge the framing
// without opening seven tabs, and never enough to pretend it is the article.
// The footer says so, because an excerpt shown at length starts to look like the
// piece itself.
//
// role="dialog" is load-bearing, not decoration: ConsoleShell's global key handler
// hands Escape to any mounted dialog rather than acting on it (see its GUARD 2),
// so this closes cleanly instead of also dropping the reader's map selection.

import { useEffect, useRef } from "react";
import type { Cluster } from "@/lib/news/cluster";
import { coverageProfile } from "@/lib/news/diversity";
import { SourceBadge } from "@/components/news/SourceBadge";

export function StoryPreview({
  cluster,
  now,
  rel,
  onClose,
}: {
  cluster: Cluster;
  now: number;
  rel: (ts: number, now: number) => string;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Focus moves INTO the dialog on open. Without it a keyboard reader's focus
  // stays on the card behind, and the first Tab walks the board underneath the
  // thing they just opened.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const profile = coverageProfile(cluster);

  return (
    <div
      className="tn-hd-modal-wrap"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="tn-hd-modal"
        role="dialog"
        aria-modal="true"
        aria-label={cluster.title}
        ref={panelRef}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          onClose();
        }}
      >
        <header className="tn-hd-modal-h">
          <div>
            <h2 className="tn-hd-modal-title">{cluster.title}</h2>
            <p className="tn-hd-modal-sub">{profile.summary}</p>
          </div>
          <button ref={closeRef} className="tn-hd-modal-x" onClick={onClose} aria-label="Close excerpts">
            ✕
          </button>
        </header>

        <div className="tn-hd-modal-body">
          {cluster.items.map((it) => (
            <article key={it.url} className="tn-hd-ex">
              <header className="tn-hd-ex-h">
                <SourceBadge name={it.source} size={14} />
                <span className="tn-hd-ex-time">{rel(it.ts, now)}</span>
              </header>
              <a className="tn-hd-ex-title" href={it.url} target="_blank" rel="noreferrer">
                {it.title}
              </a>
              {it.description ? (
                <p className="tn-hd-ex-body">{it.description}</p>
              ) : (
                <p className="tn-hd-ex-body is-none">This feed supplied a headline with no summary.</p>
              )}
            </article>
          ))}
        </div>

        <footer className="tn-hd-modal-f">
          Excerpts as the outlets&rsquo; own feeds supplied them. Follow a headline for the full article.
        </footer>
      </div>
    </div>
  );
}
