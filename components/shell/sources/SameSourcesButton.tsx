"use client";
// "USE SAME SOURCES FROM <VIEW>": the button at the top of the Sources pane.
//
// Every view keeps its own sources (lib/console/viewSources.ts), so a switch from
// Globe to Streets brings Streets' own switches, not Globe's. This is the way to say
// "I want what I had on the view I just left": one press makes this view's sources an
// exact copy of that one, once, and each then goes its own way. An Undo note takes the
// button's place for a few seconds.
//
// Shown after a switch, only while the two sets differ; it goes on use, on the ×, or
// on ANY source change in this view (the store clears it, so this file only renders
// what the store holds). It renders nothing unless the offer is for the board that is
// open now: a stale offer for another board must never show.

import { useEffect, useMemo, useRef, useState } from "react";
import { UndoNote, type UndoCloseReason } from "@/components/shell/UndoNote";
import { useActivePreset } from "@/lib/console/activePreset";
import { listPresets } from "@/lib/console/presets";
import { onIds, sameSources, sourceLine, useSameSources } from "@/lib/console/viewSources";

function CopyGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />
    </svg>
  );
}

// Same glyph as ContextSwitcher's ClearGlyph; copied, because importing it would make
// that file and this one depend on each other through SourceCatalog.
function XGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden
      focusable="false"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** The ids' rail labels, in the rail's order. An id the rail does not list keeps its own id. */
function labelsInRailOrder(ids: string[], labelOf: ReadonlyMap<string, string>): string[] {
  const want = new Set(ids);
  const out: string[] = [];
  for (const [id, label] of labelOf) if (want.has(id)) out.push(label);
  for (const id of ids) if (!labelOf.has(id)) out.push(id);
  return out;
}

export default function SameSourcesButton({ labelOf }: { labelOf: ReadonlyMap<string, string> }) {
  const { offer, undo } = useSameSources();
  const active = useActivePreset();
  const titles = useMemo(() => new Map(listPresets().map((p) => [p.id, p.title])), [active]);

  // True when the copy came from the keyboard: only then may the note take focus. A
  // mouse click that also handed focus over would pause the note for as long as focus
  // stayed (UndoNote pauses on focus-within), and it would never leave.
  const [fromKeyboard, setFromKeyboard] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const refocusCopy = useRef(false);

  // After Undo the button is back; put focus on it only if the note had focus.
  useEffect(() => {
    if (offer && refocusCopy.current) {
      refocusCopy.current = false;
      copyRef.current?.focus();
    }
  }, [offer]);

  // The button is meant to be seen: when it arrives and the pane has been scrolled down
  // the list (the phone sheet keeps its scroll across a switch), bring it back into view.
  // `nearest` moves nothing when it is already visible, and the move is instant.
  useEffect(() => {
    if (offer) slotRef.current?.scrollIntoView({ block: "nearest" });
  }, [offer]);

  const showUndo = undo !== null && undo.here === active;
  const showOffer = !showUndo && offer !== null && offer.here === active;
  if (!showUndo && !showOffer) return null;

  if (showUndo && undo) {
    const from = titles.get(undo.from) ?? undo.from;
    return (
      <div className="tn-same-slot" ref={slotRef}>
        <UndoNote
          message={`Now using ${from}'s sources.`}
          autoFocus={fromKeyboard}
          onUndo={() => {
            refocusCopy.current = !!slotRef.current?.contains(document.activeElement);
            sameSources.undo();
          }}
          onClose={(reason: UndoCloseReason) => {
            sameSources.closeUndo();
            // Esc and the × leave the note under the pointer or the keyboard's hand;
            // the bar below is the next thing in the pane. A timeout moves nothing.
            if (reason !== "timeout") document.querySelector<HTMLElement>(".tn-ctxbar")?.focus();
          }}
        />
      </div>
    );
  }

  if (!offer) return null;
  const from = titles.get(offer.from) ?? offer.from;
  const line = sourceLine(labelsInRailOrder(onIds(offer.fromSet), labelOf));
  return (
    <div className="tn-same-slot" ref={slotRef}>
      <div className="tn-same-wrap">
        <button
          ref={copyRef}
          type="button"
          className="tn-same"
          onClick={(e) => {
            setFromKeyboard(e.detail === 0);
            sameSources.copy();
          }}
          aria-label={`Use the same sources as ${from} here: ${line}. Replaces this view's sources.`}
        >
          <span className="tn-same-glyph" aria-hidden>
            <CopyGlyph />
          </span>
          <span className="tn-same-text">
            <span className="tn-same-title">Use same sources from {from}</span>
            <span className="tn-same-sub">{line}</span>
          </span>
        </button>
        <button
          type="button"
          className="tn-same-x"
          onClick={() => {
            // The × is about to unmount under a keyboard user's focus: hand it to the bar.
            const hadFocus = !!slotRef.current?.contains(document.activeElement);
            sameSources.dismiss();
            if (hadFocus) document.querySelector<HTMLElement>(".tn-ctxbar")?.focus();
          }}
          aria-label="Keep this view's own sources"
          title="Keep this view's own sources"
        >
          <XGlyph />
        </button>
      </div>
    </div>
  );
}
