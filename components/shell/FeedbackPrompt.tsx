"use client";
// The feedback prompt — a centred card over a dimmed console, shown once, to a
// third of the people who have plausibly USED the thing (15 minutes of visible
// time, or a return visit).
//
// Every decision about WHETHER to show lives in lib/shell/feedback.ts as pure
// functions over an injectable store, so the gate is unit-tested in the node
// environment. This file is the thin shell around it: a ticker, a focus trap and
// a form.
//
// WHY IT WAITS BEFORE EVALUATING AT ALL. BootSequence writes its "seen" flag when
// the plate STARTS, so reading shouldPlayBoot() from here could see the flag
// already set while the boot is still on screen, depending on the order sibling
// effects run in. I have NOT measured that ordering and this deliberately does not
// depend on it either way: the gate simply does not run for the first few seconds
// of any visit. Nobody can qualify that early (a first visit cannot qualify by
// visit count, and the time arm needs fifteen minutes), so the hold costs nothing
// and removes the question rather than answering it.

import { useCallback, useEffect, useRef, useState } from "react";
import { BOOT_FADE_MS, BOOT_MS } from "@/lib/terminal/boot";
import { cinematic } from "@/lib/cinematic/store";
import { tourStore } from "@/lib/shell/tour";
import {
  CAP_EMAIL,
  CAP_OCCUPATION,
  CAP_USEFUL,
  type FeedbackState,
  loadFeedbackState,
  addActiveMs,
  forcedFromSearch,
  markResolved,
  recordVisit,
  rollWins,
  saveFeedbackState,
  shouldPrompt,
  triggerFor,
  validateFeedback,
} from "@/lib/shell/feedback";

/** Long enough for the cold-start plate and its fade to be gone. BOOT_MS is the
 *  boot's ceiling — the plate usually leaves sooner, when the map is ready — so
 *  this holds for the worst case and is never early. */
const INITIAL_HOLD_MS = BOOT_MS + BOOT_FADE_MS + 500;
/** How often visible time is banked and the gate re-checked. Small enough that a
 *  first-time visitor who crosses fifteen minutes is asked during THAT visit. */
const TICK_MS = 15_000;

const OCCUPATIONS = [
  "Journalist",
  "Researcher / academic",
  "OSINT / investigations",
  "Security / defence",
  "Software / engineering",
  "Emergency response",
  "Student",
] as const;

const OTHER = "__other__";

type Phase = "idle" | "open" | "sending" | "sent";

export default function FeedbackPrompt() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [occupation, setOccupation] = useState("");
  const [occupationOther, setOccupationOther] = useState("");
  const [useful, setUseful] = useState("");
  const [rating, setRating] = useState(0);
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot; a human never sees it
  const [error, setError] = useState("");

  const state = useRef<FeedbackState | null>(null);
  const openedAt = useRef(0);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const card = useRef<HTMLDivElement>(null);
  // Drawn ONCE per visit. Re-drawing on every tick would converge on certainty,
  // which is the bug this ref exists to prevent.
  const rollWon = useRef(rollWins(Math.random()));
  const forced = useRef(false);

  /* ── The gate ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    const s = recordVisit(loadFeedbackState());
    state.current = s;
    saveFeedbackState(s);
    forced.current = forcedFromSearch(window.location.search);

    let last = Date.now();
    const started = last;

    const tick = () => {
      const now = Date.now();
      const elapsed = now - last;
      last = now;

      // Only VISIBLE time counts. A tab left open overnight is normal on a live
      // map and means nobody looked at it.
      if (document.visibilityState === "visible" && state.current) {
        state.current = addActiveMs(state.current, elapsed);
        saveFeedbackState(state.current);
      }

      if (now - started < INITIAL_HOLD_MS) return;
      const cur = state.current;
      if (!cur) return;

      const ctx = {
        bootPlaying: false, // held out by INITIAL_HOLD_MS above, not by a racy read
        tourOpen: tourStore.isActive(),
        diveActive: cinematic.get().phase !== "idle",
      };

      // The override forces the prompt for review but still respects a recorded
      // dismissal, so a review pass cannot silently undo a visitor's "no".
      const show = forced.current
        ? !cur.resolved && !ctx.tourOpen && !ctx.diveActive
        : shouldPrompt(cur, ctx, rollWon.current);

      if (show) {
        setPhase((p) => (p === "idle" ? "open" : p));
      }
    };

    const timer = window.setInterval(tick, TICK_MS);
    // One early evaluation so a forced review, or a returning visitor, does not
    // wait a full tick past the hold.
    const first = window.setTimeout(tick, INITIAL_HOLD_MS + 100);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, []);

  /* ── Resolution ───────────────────────────────────────────────────────── */

  const resolve = useCallback((how: "submitted" | "dismissed") => {
    if (state.current) {
      state.current = markResolved(state.current, how);
      saveFeedbackState(state.current);
    }
  }, []);

  const dismiss = useCallback(() => {
    resolve("dismissed");
    setPhase("idle");
    restoreFocus.current?.focus?.();
  }, [resolve]);

  /* ── Focus management ─────────────────────────────────────────────────── */

  useEffect(() => {
    if (phase !== "open") return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    openedAt.current = Date.now();
    const first = card.current?.querySelector<HTMLElement>("select, textarea, input, button");
    first?.focus();
  }, [phase]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      dismiss();
      return;
    }
    if (e.key !== "Tab" || !card.current) return;
    const focusable = Array.from(
      card.current.querySelectorAll<HTMLElement>(
        "button, select, textarea, input:not([type='hidden']), [href]",
      ),
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

  /* ── Submit ───────────────────────────────────────────────────────────── */

  const send = async () => {
    setError("");
    const resolvedOccupation = occupation === OTHER ? occupationOther.trim() : occupation;
    const payload = {
      occupation: resolvedOccupation,
      useful: useful.trim(),
      rating,
      email: email.trim(),
      trigger: forced.current ? "forced" : (triggerFor(state.current ?? { visits: 0, activeMs: 0 }) ?? "forced"),
      dwellMs: Date.now() - openedAt.current,
      website,
    };

    // Validated here with the SAME function the route uses, so the message a
    // person sees matches the rule that will actually be enforced.
    const checked = validateFeedback(payload);
    if (!checked.ok) {
      setError(
        !resolvedOccupation
          ? "Let me know what you do first."
          : !payload.useful
            ? "Tell me what is useful, even briefly."
            : rating < 1
              ? "Pick a rating from 1 to 10."
              : checked.error,
      );
      return;
    }

    setPhase("sending");
    try {
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!j?.ok) {
        setPhase("open");
        setError(j?.error ?? "Could not send that just now.");
        return;
      }
    } catch {
      setPhase("open");
      setError("Could not send that just now.");
      return;
    }
    resolve("submitted");
    setPhase("sent");
    window.setTimeout(() => setPhase("idle"), 3200);
  };

  if (phase === "idle") return null;

  if (phase === "sent") {
    return (
      <div className="tn-fb" role="dialog" aria-modal="true" aria-label="Thank you">
        <div className="tn-fb-veil" aria-hidden />
        <div className="tn-fb-card is-thanks">
          <div className="tn-fb-tick" aria-hidden>✓</div>
          <h2 className="tn-fb-title">Thank you - genuinely.</h2>
          <p className="tn-fb-sub">That goes straight to my phone. You will not be asked again.</p>
        </div>
      </div>
    );
  }

  const busy = phase === "sending";

  return (
    <div
      className="tn-fb"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tn-fb-title"
      onKeyDown={onKeyDown}
    >
      <div className="tn-fb-veil" onClick={dismiss} aria-hidden />
      <div className="tn-fb-card" ref={card}>
        <div className="tn-fb-head">
          <div>
            <h2 id="tn-fb-title" className="tn-fb-title">Got 30 seconds?</h2>
            <p className="tn-fb-sub">You have used Provenance a fair bit. I would like to know what for.</p>
          </div>
          <button
            type="button"
            className="tn-fb-x"
            onClick={dismiss}
            aria-label="Close, and do not ask again"
          >
            ×
          </button>
        </div>

        <div className="tn-fb-body">
          <div className="tn-fb-field">
            <label className="tn-fb-label" htmlFor="tn-fb-occ">What do you do?</label>
            <select
              id="tn-fb-occ"
              className="tn-fb-input"
              value={occupation}
              disabled={busy}
              onChange={(e) => setOccupation(e.target.value)}
            >
              <option value="">Select...</option>
              {OCCUPATIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
              <option value={OTHER}>Other...</option>
            </select>
            {occupation === OTHER && (
              <input
                className="tn-fb-input"
                type="text"
                maxLength={CAP_OCCUPATION}
                value={occupationOther}
                disabled={busy}
                placeholder="Tell me what you do"
                aria-label="Your occupation"
                onChange={(e) => setOccupationOther(e.target.value)}
              />
            )}
          </div>

          <div className="tn-fb-field">
            <label className="tn-fb-label" htmlFor="tn-fb-useful">What do you find useful here?</label>
            <textarea
              id="tn-fb-useful"
              className="tn-fb-input tn-fb-area"
              maxLength={CAP_USEFUL}
              value={useful}
              disabled={busy}
              placeholder="The bit you would miss if it disappeared."
              onChange={(e) => setUseful(e.target.value)}
            />
          </div>

          <div className="tn-fb-field">
            <span className="tn-fb-label" id="tn-fb-rate">How would you rate it?</span>
            <div className="tn-fb-rating" role="radiogroup" aria-labelledby="tn-fb-rate">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n} out of 10`}
                  className={`tn-fb-rate${rating === n ? " is-on" : ""}`}
                  disabled={busy}
                  onClick={() => setRating(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="tn-fb-scale">
              <span>1 - not useful</span>
              <span>10 - essential</span>
            </div>
          </div>

          <div className="tn-fb-field">
            <label className="tn-fb-label" htmlFor="tn-fb-email">
              Email <span className="tn-fb-optional">- optional</span>
            </label>
            <input
              id="tn-fb-email"
              className="tn-fb-input"
              type="email"
              maxLength={CAP_EMAIL}
              value={email}
              disabled={busy}
              placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="tn-fb-privacy">
              Goes to Sam, who builds this, so he can ask you for a 15-minute call. It arrives as a
              message in his Telegram, is not added to any list, and is not stored anywhere else.
              Leave it blank and the rest still sends.
            </p>
          </div>

          {/* Honeypot. Positioned off-screen rather than display:none - the usual
              advice, on the theory that some bots skip hidden fields. I have not
              measured that, and it is not load-bearing: the caps, the same-origin
              check and the dwell guard are. */}
          <input
            className="tn-fb-hp"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />

          {error && <p className="tn-fb-error" role="alert">{error}</p>}
        </div>

        <div className="tn-fb-foot">
          <button type="button" className="tn-fb-btn is-primary" onClick={send} disabled={busy}>
            {busy ? "Sending..." : "Send"}
          </button>
          <span className="tn-fb-spacer" />
          <button type="button" className="tn-fb-btn is-ghost" onClick={dismiss} disabled={busy}>
            No thanks
          </button>
        </div>
      </div>
    </div>
  );
}
