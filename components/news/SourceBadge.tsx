"use client";
// components/news/SourceBadge.tsx
// A source's name with its favicon, and — on hover, focus or tap — who owns it.
//
// The ownership panel is the answer to "show me who owns each outlet", and what
// it shows is corporate record: the owning company, how the newsroom is paid for,
// where it is based, and a plain flag when a government funds it. It makes no
// claim about what any of that does to the coverage; a reader looking at three
// state-funded broadcasters agreeing with each other can draw their own.
//
// TOUCH HAS NO HOVER, so the trigger is a real <button> that opens on click as
// well as on pointerenter and focus — the same rule SourceRow in the console rail
// already follows, and for the same reason: on a phone this is the only route to
// the information the badge is advertising.

import { useId, useState } from "react";
import { sourceMeta } from "@/lib/news/sources";
import { SourceIcon } from "@/components/news/SourceIcon";

export function SourceBadge({
  name,
  size = 14,
  showName = true,
}: {
  name: string;
  size?: number;
  /** Icon only — used in dense rows where the name is already on the line. */
  showName?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const m = sourceMeta(name);

  return (
    <span
      className="tn-hd-srcb"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="tn-hd-srcb-btn"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <SourceIcon name={name} domain={m.domain} size={size} />
        {showName && <span className="tn-hd-srcb-name">{name}</span>}
      </button>

      {open && (
        <span className="tn-hd-srcb-pop" id={panelId} role="tooltip">
          <span className="tn-hd-srcb-pop-h">{name}</span>
          <span className="tn-hd-srcb-pop-row">
            {m.type}
            {m.region !== "Other" ? ` · ${m.region}` : ""}
          </span>
          {m.owner ? (
            <span className="tn-hd-srcb-pop-owner">{m.owner}</span>
          ) : (
            // Never a blank panel and never a guess: an unattributed source says
            // so, because "we don't know" and "nobody owns it" are not the same.
            <span className="tn-hd-srcb-pop-owner is-unknown">
              Ownership not recorded for this source.
            </span>
          )}
          <span className="tn-hd-srcb-pop-tags">
            <span className="tn-hd-srcb-tag">{m.funding}</span>
            {m.stateFunded && (
              <span className="tn-hd-srcb-tag is-state" title="Funded by a government. Not a claim about its editorial independence.">
                Government-funded
              </span>
            )}
          </span>
        </span>
      )}
    </span>
  );
}
