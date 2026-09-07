"use client";
// The live-build warning — the first thing anyone handed an access code sees, shown
// once and then not again until its text is revised.
//
// IT IS A MODAL, WHERE CommunityNote NEXT DOOR IS A CORNER CARD, and the difference is
// the design rather than an inconsistency. The invitation asks for nothing and may be
// ignored at no cost, so it takes no veil and never moves focus. This one carries the
// only statement anybody gets that the data is unverified and the software is
// unwarranted, and a person who never reads it is the person the warning existed for.
// So it takes the veil and focus trap FeedbackPrompt uses.
//
// Escape still closes it. A dialog with no way out is an accessibility defect, and
// this is a notice rather than a contract — the licence it points at binds whether or
// not anyone clicks a button, so trapping people would buy nothing legally and cost
// real usability. Clicking the veil does NOT close it, because that is the accidental
// dismissal, and this is the one card worth protecting from one.
//
// Every decision about WHETHER to show lives in lib/shell/devnotice.ts as pure
// functions over an injectable store, unit-tested in the node environment. This file
// is the thin shell: a hold, a card, two controls.
//
// z-index 1200 puts it above FeedbackPrompt's 1100 and CommunityNote's 1050. If any
// of them ever coincide, the warning is the one that must be readable, and that falls
// out of the z-order with no cross-component subscription to keep in sync.

import { useCallback, useEffect, useRef, useState } from "react";
import { BRAND } from "@/lib/brand";
import { BOOT_FADE_MS, BOOT_MS } from "@/lib/terminal/boot";
import DiscordMark from "@/components/brand/DiscordMark";
import {
  NOTICE_REVISION,
  type DevNoticeState,
  loadDevNoticeState,
  markAcknowledged,
  saveDevNoticeState,
  shouldWarn,
  forcedFromSearch,
} from "@/lib/shell/devnotice";

/** Long enough for the cold-start plate and its fade to be gone — the same constants
 *  and the same reasoning as CommunityNote's hold. BOOT_MS is the boot's ceiling, so
 *  this holds for the worst case and is never early. */
const INITIAL_HOLD_MS = BOOT_MS + BOOT_FADE_MS + 500;

/**
 * Captured in the module body, not inside an effect.
 *
 * The console rewrites its own query string, stripping every param it does not own.
 * Read from inside an effect, the override would work or not depending on which
 * effect ran first. Module bodies evaluate at import time, strictly before React
 * renders and so strictly before anything can rewrite the URL — this removes the race
 * rather than winning it. Guarded for SSR, where there is no window at all.
 */
const FORCED = typeof window === "undefined" ? false : forcedFromSearch(window.location.search);

export default function DevNotice() {
  const [open, setOpen] = useState(false);
  const state = useRef<DevNoticeState | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);

  /* ── The gate ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    const s = loadDevNoticeState();
    state.current = s;

    // No qualifying time, unlike the invitation next door: a warning shown late has
    // already been overtaken by the bug it was warning about. The only wait is for
    // the boot plate, so the card is readable when it lands.
    const t = window.setTimeout(() => {
      if (FORCED || shouldWarn(s, { bootPlaying: false })) setOpen(true);
    }, INITIAL_HOLD_MS);

    return () => window.clearTimeout(t);
  }, []);

  const acknowledge = useCallback(() => {
    const next = markAcknowledged(state.current ?? { acknowledged: 0 }, NOTICE_REVISION);
    state.current = next;
    saveDevNoticeState(next);
    setOpen(false);
    restoreFocus.current?.focus?.();
  }, []);

  /* ── Focus management ─────────────────────────────────────────────────── */

  // Focus the PRIMARY ACTION explicitly, not "the first focusable in the card".
  // The licence link sits mid-paragraph and is first in DOM order, so a generic
  // first-focusable query drops the caret into the middle of the legal sentence:
  // a screen reader starts there, and a sighted keyboard user sees the ring on a
  // link they did not ask for. The way out of the dialog is the thing to land on.
  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    primary.current?.focus();
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      acknowledge();
      return;
    }
    if (e.key !== "Tab" || !card.current) return;
    const focusable = Array.from(
      card.current.querySelectorAll<HTMLElement>("button, [href]"),
    ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
    if (focusable.length === 0) return;
    const firstEl = focusable[0];
    const lastEl = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  };

  if (!open) return null;

  return (
    <div
      className="tn-dev"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tn-dev-title"
      onKeyDown={onKeyDown}
    >
      {/* No onClick: an accidental veil click must not dismiss this one. */}
      <div className="tn-dev-veil" aria-hidden />
      <div className="tn-dev-card" ref={card}>
        <div className="tn-dev-head">
          <span className="tn-dev-flag">Preview build</span>
          <h2 className="tn-dev-title" id="tn-dev-title">
            You are looking at a live build
          </h2>
        </div>

        <div className="tn-dev-body">
          <p className="tn-dev-lead">
            {BRAND.name} is being actively developed while you use it. Expect half-finished
            features, visible bugs, layouts that break and the occasional crash. None of that
            is a surprise to us — it is what an access code buys you.
          </p>

          <ul className="tn-dev-list">
            <li>
              <b>The data is not verified.</b> Everything on the map comes from open sources
              and is shown as those sources published it. Some of it is wrong, stale, or
              coded by a machine that misread a news article.
            </li>
            <li>
              <b>Do not rely on it for anything that matters.</b> It is not fit for safety,
              navigation, operational or emergency decisions, and it is not a substitute for
              an official source.
            </li>
            <li>
              <b>Nothing here is promised.</b> No uptime, no accuracy, no feature staying
              where you found it, and no notice before any of that changes.
            </li>
          </ul>

          {/* The disclaimer is NOT drafted here. The project ships under AGPL-3.0, whose
              sections 15 and 16 already disclaim warranty and limit liability; writing a
              parallel set of terms would risk contradicting the licence the software is
              actually distributed under. So this states it plainly and points at the real
              text, which is the binding one. */}
          <p className="tn-dev-legal">
            Provided <b>as is</b>, without warranty of any kind, under the{" "}
            <a href={BRAND.license.url} target="_blank" rel="noopener noreferrer">
              {BRAND.license.short} licence
            </a>{" "}
            — see sections 15 and 16 for the full disclaimer of warranty and limitation of
            liability. Use it at your own risk.
          </p>

          {/* THE POINT OF THIS PARAGRAPH IS TO UNDO THE ONE ABOVE IT. Telling someone to
              expect bugs quietly tells them not to report any — they assume anything they
              hit is already known, and the tester who would have filed it stays silent.
              Saying so explicitly is the only thing that recovers those reports. */}
          <p className="tn-dev-ask">
            None of that means you cannot find bugs — please look for them.{" "}
            <b>State the obvious.</b> If something looks wrong, assume nobody has noticed it
            yet and say so anyway. Opinions count as much as faults: what is missing, what
            should exist, how the layout ought to work. All of it goes in the Discord, and it
            is the reason you have a code.
          </p>
        </div>

        <div className="tn-dev-actions">
          <button ref={primary} type="button" className="tn-dev-btn is-primary" onClick={acknowledge}>
            I understand
          </button>
          <a
            className="tn-dev-btn is-discord"
            href={BRAND.discordUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <DiscordMark />
            Report on Discord
          </a>
        </div>
      </div>
    </div>
  );
}
