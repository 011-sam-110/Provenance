"use client";
// The Discord pop-up: it says the Discord link works again, shows the server's real member
// count, and says what is in there. Each browser sees it once, after 15 seconds of visible
// time, on the landing page and in the console. God's eye view does not carry it, by request.
//
// IT IS A MODAL, AND IT WAS NOT ALWAYS. Until 2026-10-30 this was a quiet corner card. The
// invite then expired on 7 October and every Discord link on the site went dead for three
// weeks, so this has something to announce, and a loud pop-up was asked for to say so. It takes
// the veil and the focus trap FeedbackPrompt and DevNotice use. It is still easy to leave:
// the Escape key, the veil, the X and "Not now" all close it, and nothing asks twice.
//
// IT ONLY SAYS THE LINK WORKS IF DISCORD JUST AGREED. Before it opens it asks /api/community
// (lib/community/invite.ts). A dead invite keeps it closed, and the visitor keeps their one
// showing for the day the invite is repaired. A fault opens it without any figure. The
// figures on screen are Discord's: nothing here types a count.
//
// Every decision about WHETHER to show lives in lib/shell/community.ts as pure functions over
// an injectable store, so the gate is unit-tested in the node environment.
//
// THE PORTAL. It mounts in the (site) layout's `.pv-root` and the console's `.tn-terminal`, two
// sheets with two ideas of what a paragraph looks like. In <body>, with its own tokens in
// app/community.css, it looks the same on both.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { BRAND } from "@/lib/brand";
import { BOOT_FADE_MS, BOOT_MS } from "@/lib/terminal/boot";
import { cinematic } from "@/lib/cinematic/store";
import { UNKNOWN_INVITE, coerceInviteStatus, type InviteStatus } from "@/lib/community/invite";
import DiscordMark from "@/components/brand/DiscordMark";
import MemberGlobe from "@/components/shell/MemberGlobe";
import {
  type CommunityResolution,
  type CommunityState,
  type CommunitySurface,
  addActiveMs,
  gateContext,
  initialHoldMs,
  isTypingTarget,
  loadCommunityState,
  markResolved,
  recordVisit,
  reviewRequested,
  saveCommunityState,
  shouldOpenInvite,
} from "@/lib/shell/community";
import "@/app/community.css";

/** Long enough for the console's cold-start plate and its fade to be gone. BOOT_MS is the
 *  boot's ceiling, so this holds for the worst case and is never early. */
const INITIAL_HOLD_MS = BOOT_MS + BOOT_FADE_MS + 500;
/** Small enough that someone crossing the 15-second mark is asked at about that moment. */
const TICK_MS = 2_500;
/** A slow answer must not hold the pop-up: past this it opens without the figures. */
const ASK_TIMEOUT_MS = 2_500;
/** Matches `.tn-join.is-closing` in app/community.css. */
const CLOSE_MS = 150;
/** The pop-up arrives while people are using the page, so a click already on its way must
 *  not land on the veil and spend their only showing before they read a word. */
const VEIL_GRACE_MS = 800;
/** The keys that would scroll the page behind the pop-up. */
const SCROLL_KEYS = new Set([" ", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);

const FACTS: ReadonlyArray<readonly [string, string]> = [
  ["The community is open.", "Anyone can join. Accept the rules and you can post."],
  ["The devs are active.", `The people who build ${BRAND.name} read and reply in the server.`],
  ["We would love your feedback.", `Tell us what to fix and what to add. It helps us build ${BRAND.name} out.`],
];

/**
 * `?discord=1`, read AT MODULE SCOPE rather than inside the mount effect, because the map
 * syncs its camera into the URL with a history replace, which drops every param it does not
 * own. Module bodies evaluate strictly before any effect can rewrite the URL. It also stays
 * on for the tab (see reviewRequested), so a plain reload shows the pop-up again.
 */
const FORCED =
  typeof window === "undefined"
    ? false
    : reviewRequested(
        window.location.search,
        (() => {
          try {
            return window.sessionStorage;
          } catch {
            return null;
          }
        })(),
      );

/** Ask once, and never take long about it. */
function askDiscord(): Promise<InviteStatus> {
  return fetch("/api/community", { signal: AbortSignal.timeout(ASK_TIMEOUT_MS) })
    .then((res) => (res.ok ? res.json() : null))
    .then(coerceInviteStatus)
    .catch(() => UNKNOWN_INVITE);
}

/** Each digit is a reel of 0 to 9, twice over, that spins to its place. Only the reel's
 *  transform moves, and the rightmost digit spins longest, as on an odometer. */
function CountReel({ value }: { value: number }) {
  const chars = [...value.toLocaleString("en-GB")];
  return (
    <span className="tn-join-count" data-digits={chars.length} aria-hidden>
      {chars.map((c, i) =>
        /\d/.test(c) ? (
          <span
            key={i}
            className="tn-join-reel"
            style={{ "--d": Number(c), "--i": i } as CSSProperties}
          >
            <span className="tn-join-strip">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n, k) => (
                <span key={k}>{n}</span>
              ))}
            </span>
          </span>
        ) : (
          <span key={i} className="tn-join-sep">
            {c}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * `surface` is "console" in ConsoleShell and "landing" on the home page. The two share one
 * persisted state (lib/shell/community.ts), so an answer on one is final on the other.
 */
export default function CommunityNote({ surface = "console" }: { surface?: CommunitySurface } = {}) {
  const [invite, setInvite] = useState<InviteStatus | null>(null);
  const [closing, setClosing] = useState(false);
  const open = invite !== null;

  const state = useRef<CommunityState | null>(null);
  const openedAt = useRef(0);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);

  /* ── The gate ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    const s = recordVisit(loadCommunityState());
    state.current = s;
    saveCommunityState(s);

    const hold = initialHoldMs(surface, INITIAL_HOLD_MS);
    const started = Date.now();
    let last = started;
    let answer: InviteStatus | "asking" | null = null;
    let finished = false;
    let timer = 0;

    const stop = () => {
      finished = true;
      window.clearInterval(timer);
    };

    const tick = () => {
      if (finished) return;
      const now = Date.now();
      const elapsed = now - last;
      last = now;

      // Only VISIBLE time counts: a tab left open behind others means nobody looked at it.
      if (document.visibilityState === "visible" && state.current) {
        state.current = addActiveMs(state.current, elapsed);
        saveCommunityState(state.current);
      }

      if (now - started < hold) return;
      const cur = state.current;
      if (!cur) return;

      const ctx = gateContext(surface, {
        bootPlaying: false, // held out by the hold above, not by a racy read
        diveActive: cinematic.get().phase !== "idle",
        otherDialog: document.querySelector('[role="dialog"]') !== null,
        typing: isTypingTarget(document.activeElement as HTMLElement | null),
        automated: navigator.webdriver === true,
      });
      if (!shouldOpenInvite(cur, ctx, FORCED)) return;

      if (answer === "asking") return;
      if (answer === null) {
        answer = "asking";
        void askDiscord().then((status) => {
          answer = status;
          tick();
        });
        return;
      }

      // A dead invite spends nothing: this page stops asking, and the next visit asks again.
      if (answer.state === "dead" && !FORCED) {
        stop();
        return;
      }
      stop();
      openedAt.current = now;
      restoreFocus.current = document.activeElement as HTMLElement | null;
      setInvite(answer.state === "dead" ? UNKNOWN_INVITE : answer);
    };

    timer = window.setInterval(tick, TICK_MS);
    // One early evaluation so a forced review does not wait a full tick past the hold.
    const first = window.setTimeout(tick, hold + 100);
    return () => {
      stop();
      window.clearTimeout(first);
    };
  }, [surface]);

  /* ── Resolution ───────────────────────────────────────────────────────── */

  const resolve = useCallback((how: CommunityResolution) => {
    if (state.current) {
      state.current = markResolved(state.current, how);
      saveCommunityState(state.current);
    }
    setClosing(true);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => {
      setInvite(null);
      setClosing(false);
      restoreFocus.current?.focus?.();
    }, still ? 0 : CLOSE_MS);
  }, []);

  /* ── Focus and scroll ─────────────────────────────────────────────────── */

  // Focus lands on the card, not on "Join the Discord". The pop-up arrives unasked, so a
  // keyboard user's next Enter must not join a server they have not read about yet.
  //
  // THE KEYS ARE HEARD ON THE DOCUMENT, IN THE CAPTURE PHASE, not on the dialog. A handler on the
  // dialog hears a key only while focus is inside it, and focus can leave: a click on the veil
  // during its grace period drops it on <body>, and then Escape did nothing and Tab walked out
  // into the page. Measured: 2 of 10 runs of the Escape test failed that way. A layout effect,
  // so that the key is heard from the moment the pop-up is on screen.
  useLayoutEffect(() => {
    if (!open) return;
    card.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        resolve("dismissed");
        return;
      }
      const c = card.current;
      if (!c) return;
      const here = document.activeElement;
      if (SCROLL_KEYS.has(e.key)) {
        // Space still presses a focused button or link, and a sheet that scrolls still scrolls.
        const pressing = e.key === " " && here instanceof HTMLElement && here.matches("a[href], button");
        const s = sheet.current;
        if (!pressing && (!s || s.scrollHeight <= s.clientHeight)) e.preventDefault();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = Array.from(c.querySelectorAll<HTMLElement>("a[href], button"));
      if (focusable.length === 0) return;
      const firstEl = focusable[0];
      const lastEl = focusable[focusable.length - 1];
      const inside = here !== null && here !== c && c.contains(here);
      if (e.shiftKey && (!inside || here === firstEl)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && (!inside || here === lastEl)) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, resolve]);

  // The landing page scrolls behind this, and its scroll drives the globe. Wheel and touch
  // stop here unless the sheet itself has to scroll, which it does on a short screen.
  useEffect(() => {
    const el = root.current;
    if (!open || !el) return;
    const hold = (e: Event) => {
      const s = sheet.current;
      if (s && e.target instanceof Node && s.contains(e.target) && s.scrollHeight > s.clientHeight) return;
      e.preventDefault();
    };
    el.addEventListener("wheel", hold, { passive: false });
    el.addEventListener("touchmove", hold, { passive: false });
    return () => {
      el.removeEventListener("wheel", hold);
      el.removeEventListener("touchmove", hold);
    };
  }, [open]);

  if (!open) return null;

  const members = invite.state === "live" ? invite.members : null;
  const online = invite.state === "live" ? invite.online : null;

  return createPortal(
    <div
      ref={root}
      className={`tn-join${closing ? " is-closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tn-join-title"
      aria-describedby="tn-join-why"
    >
      <div
        className="tn-join-veil"
        aria-hidden
        onClick={() => {
          if (Date.now() - openedAt.current >= VEIL_GRACE_MS) resolve("dismissed");
        }}
      />
      <div className="tn-join-flash" aria-hidden />
      <div ref={card} className="tn-join-card" tabIndex={-1}>
        <div ref={sheet} className="tn-join-sheet">
          <div className="tn-join-poster">
            <h2 className="tn-join-title" id="tn-join-title">
              The Discord link works again.
            </h2>
            <p className="tn-join-why" id="tn-join-why">
              <span>The old invite expired on 7 October.</span> <span>The new one does not expire.</span>
            </p>
          </div>
          <ul className="tn-join-facts">
            {FACTS.map(([lead, line]) => (
              <li key={lead}>
                <b>{lead}</b> {line}
              </li>
            ))}
          </ul>
          <div className="tn-join-actions">
            <a
              className="tn-join-cta"
              href={BRAND.discordUrl}
              target="_blank"
              rel="noreferrer noopener"
              onClick={() => resolve("joined")}
            >
              <DiscordMark size={20} />
              <span>Join the Discord</span>
            </a>
            <button type="button" className="tn-join-later" onClick={() => resolve("dismissed")}>
              Not now
            </button>
          </div>
        </div>
        {/* After the sheet, so it stands over it and can leave the card at the corner. It
            takes no pointer events, so nothing under it stops being clickable. */}
        <div className="tn-join-orb">
          <span className="tn-join-ring" aria-hidden />
          <span className="tn-join-ring is-late" aria-hidden />
          <MemberGlobe members={members} online={online} />
          {/* With no count the planet is only a shape, so it carries the mark, not an empty middle. */}
          {members === null && (
            <div className="tn-join-stats">
              <DiscordMark size={104} />
            </div>
          )}
          {members !== null && (
            <div className="tn-join-stats">
              <CountReel value={members} />
              <p className="tn-join-members">
                {/* The reel is hidden from screen readers, so the number is said here. */}
                <span className="tn-join-sr">{members.toLocaleString("en-GB")} </span>
                members
              </p>
              {online !== null && (
                <p className="tn-join-online">
                  <i aria-hidden />
                  {online.toLocaleString("en-GB")} online
                </p>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className="tn-join-x"
          onClick={() => resolve("dismissed")}
          aria-label="Close, and do not show this again"
        >
          ×
        </button>
      </div>
    </div>,
    document.body,
  );
}
