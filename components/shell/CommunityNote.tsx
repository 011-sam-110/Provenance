"use client";
// The Discord invitation — a small card in the bottom-left corner of the console,
// shown once to anyone who has stayed about a minute, and never again after they
// answer it either way.
//
// IT IS A NOTE, NOT A MODAL, AND THAT IS THE WHOLE DESIGN. FeedbackPrompt next
// door dims the console, traps focus and asks four questions, because it is asking
// for work and has to be answered to be got rid of. This is asking for nothing: it
// is a door being pointed at. So it takes no veil, no focus trap and no
// aria-modal, it never moves focus, and every control behind it stays live while
// it is on screen. A person who ignores it entirely loses nothing.
//
// Every decision about WHETHER to show lives in lib/shell/community.ts as pure
// functions over an injectable store, so the gate is unit-tested in the node
// environment. This file is the thin shell around it: a ticker, a card, two
// buttons.
//
// ON STACKING WITH THE FEEDBACK PROMPT — deliberately NOT wired together. `.tn-note`
// sits at z-index 1050, below `.tn-fb`'s 1100, so if the feedback modal does open
// while this is still up, its veil dims this card along with the rest of the
// console and the modal reads as the one live thing. That is the correct outcome
// and it falls out of the z-order, so there is no cross-component subscription to
// keep in sync and no ordering bug to have.

import { useCallback, useEffect, useRef, useState } from "react";
import { BRAND } from "@/lib/brand";
import { BOOT_FADE_MS, BOOT_MS } from "@/lib/terminal/boot";
import { cinematic } from "@/lib/cinematic/store";
import DiscordMark from "@/components/brand/DiscordMark";
import {
  type CommunityState,
  addActiveMs,
  forcedFromSearch,
  loadCommunityState,
  markResolved,
  recordVisit,
  saveCommunityState,
  shouldInvite,
} from "@/lib/shell/community";

/** Long enough for the cold-start plate and its fade to be gone. BOOT_MS is the
 *  boot's ceiling — the plate usually leaves sooner, when the map is ready — so
 *  this holds for the worst case and is never early. Same reasoning, and the same
 *  constants, as FeedbackPrompt's hold. */
const INITIAL_HOLD_MS = BOOT_MS + BOOT_FADE_MS + 500;
/** Small enough that someone crossing the 40-second mark is asked during that
 *  visit rather than several seconds late. */
const TICK_MS = 5_000;

/**
 * `?discord=1`, read AT MODULE SCOPE rather than inside the mount effect.
 *
 * THE QUERY STRING DOES NOT SURVIVE TO FIRST EFFECT. The map syncs its camera into
 * the URL (`?lat=…&lon=…&z=…&layers=&base=…`) with a history replace, which drops
 * every param it does not own — `discord=1` included. Read from inside useEffect,
 * the override therefore worked or did not depending on which effect ran first,
 * which is the kind of bug that looks like "the flag is broken sometimes".
 *
 * Module bodies evaluate at import time, strictly before React renders anything and
 * so strictly before any effect can rewrite the URL. Capturing here removes the race
 * rather than winning it. Guarded for SSR, where there is no window at all.
 */
const FORCED = typeof window === "undefined" ? false : forcedFromSearch(window.location.search);

export default function CommunityNote() {
  const [open, setOpen] = useState(false);

  const state = useRef<CommunityState | null>(null);

  /* ── The gate ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    const s = recordVisit(loadCommunityState());
    state.current = s;
    saveCommunityState(s);

    let last = Date.now();
    const started = last;

    const tick = () => {
      const now = Date.now();
      const elapsed = now - last;
      last = now;

      // Only VISIBLE time counts — see the note in lib/shell/community.ts about
      // why a background tab must not burn a one-shot impression.
      if (document.visibilityState === "visible" && state.current) {
        state.current = addActiveMs(state.current, elapsed);
        saveCommunityState(state.current);
      }

      if (now - started < INITIAL_HOLD_MS) return;
      const cur = state.current;
      if (!cur) return;

      const ctx = {
        bootPlaying: false, // held out by INITIAL_HOLD_MS above, not by a racy read
        diveActive: cinematic.get().phase !== "idle",
      };

      // The override forces the card for review but still respects a recorded
      // resolution, so a review pass cannot silently re-ask someone who said no.
      const show = FORCED ? !cur.resolved && !ctx.diveActive : shouldInvite(cur, ctx);
      if (show) setOpen(true);
    };

    const timer = window.setInterval(tick, TICK_MS);
    // One early evaluation so a forced review does not wait a full tick past the
    // hold. A normal visitor cannot qualify this early — the hold is under six
    // seconds and the bar is forty — so this costs nothing.
    const first = window.setTimeout(tick, INITIAL_HOLD_MS + 100);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, []);

  /* ── Resolution ───────────────────────────────────────────────────────── */

  const resolve = useCallback((how: "joined" | "dismissed") => {
    if (state.current) {
      state.current = markResolved(state.current, how);
      saveCommunityState(state.current);
    }
    setOpen(false);
  }, []);

  /* ── Render ───────────────────────────────────────────────────────────── */

  // THE LIVE REGION IS MOUNTED ALWAYS, EMPTY WHEN IDLE, for the reason the toast
  // in ConsoleShell.tsx documents: a live region has to already be in the
  // accessibility tree when its content changes for the change to be announced,
  // and one that arrives *carrying* its message is announced inconsistently across
  // browser/screen-reader pairs. `.tn-note-live:empty` has no box, so the idle
  // wrapper costs nothing visually — but it must NOT be display:none, which would
  // take it back out of the tree and undo the fix.
  return (
    <div className="tn-note-live" role="status" aria-live="polite">
      {open && (
        <div className="tn-note">
          <div className="tn-note-icon" aria-hidden>
            <DiscordMark size={16} />
          </div>
          <div className="tn-note-body">
            <p className="tn-note-title">Join our Discord!</p>
            <p className="tn-note-text">
              Ask for a camera or a layer, say what is broken, or watch what gets built. It is
              new and quiet — come and make it less so.
            </p>
            <div className="tn-note-actions">
              <a
                className="tn-note-btn is-primary"
                href={BRAND.discordUrl}
                target="_blank"
                rel="noreferrer noopener"
                onClick={() => resolve("joined")}
              >
                <DiscordMark size={13} />
                <span>Join the Discord</span>
              </a>
              <button type="button" className="tn-note-btn is-ghost" onClick={() => resolve("dismissed")}>
                No thanks
              </button>
            </div>
          </div>
          {/* A second way out, in the corner, because the card is dismissible and a
              ✕ is where a hand goes first. It resolves identically to "No thanks" —
              there is no quiet third state. */}
          <button
            type="button"
            className="tn-note-x"
            onClick={() => resolve("dismissed")}
            aria-label="Close, and do not show this again"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
