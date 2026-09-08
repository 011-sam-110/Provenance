"use client";
// The OpenData Terminal's 34px top chrome — the replacement for
// components/shell/StatusBar.tsx.
//
// Left → right: brand block (logo · h1) │ board tabs │ ——— │
// ☕ SUPPORT · SOURCE · SHORTCUTS · ⚙ SETTINGS.
//
// The UTC clock, the CONSOLE|WALL pair, the ⌘K cap and the avatar were all here and
// are all gone; each entry below that still names one is describing what it replaced.
//
// It is a *replacement*, not an addition, so everything StatusBar carried that has
// no second home in the app is carried here verbatim:
//
//  * the page's single <h1> (with the visually-hidden tail that turns the wordmark
//    into a sentence a screen reader can use),
//  * `stat-line` — the machine-readable pulse asserted by tests/e2e/globe.spec.ts,
//  * `a11y-status-line` — the polite live region fed by appStatusLine(),
//  * `.tn-preset-pill`, `.tn-palette-trigger`, `.tn-settings-trigger` — the classes
//    the e2e suite drives to reach the boards, the palette and settings. These were
//    guided-tour spotlight targets too, and the tour's unit guard failed loudly on a
//    rename; the tour is gone, so a rename now only fails in Playwright.
//
// The third live region, `a11y-alert-live`, is NOT here: it belongs to BreakingBanner
// and stays there. Moving it would break `.tn-alert ~ .tn-cw-shell` in globals.css.
//
// ─────────────────────────────────────────────────────────────────────────────
// CSS THE INTEGRATOR MUST ADD (all inside the scoped `.tn-terminal` token block in
// app/globals.css — this file owns no CSS). Values are the design's, verbatim.
//
// THE TWO FONT NAMES BELOW ARE THE HANDOFF'S, NOT THE SHIPPED RULE'S. They are left
// verbatim because this block is a record of what was specified. What actually ships
// is `var(--tnx-font-mono)` / `var(--tnx-font-title)`, and since the move to a single
// typeface BOTH resolve to Inter — JetBrains Mono and IBM Plex Sans are loaded
// nowhere in the repo. Read the rules in globals.css, not these comments, for the
// current face.
//
//   .tn-terminal .tnx-hdr {
//     flex: none; display: flex; align-items: stretch; height: 34px;
//     background: #080b0f; border-bottom: 1px solid var(--tnx-line-strong);
//     font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: var(--tnx-fs);
//     color: var(--tnx-ink);
//   }
//
//   /* Brand */
//   .tn-terminal .tnx-hdr-brand { display: flex; align-items: center; gap: 8px;
//     padding: 0 11px; border-right: 1px solid var(--tnx-line); }
//   .tn-terminal .tnx-hdr-mark { width: 24px; height: 24px; display: block; }
//   .tn-terminal .tnx-hdr-h1 { margin: 0; font-family: 'IBM Plex Sans', system-ui, sans-serif;
//     font-size: 12px; font-weight: 800; letter-spacing: 0.14em; line-height: 1;
//     text-transform: uppercase; color: var(--tnx-ink); }
//        ↑ text-transform, NOT a capitalised literal: the DOM text is "OpenData" so
//          the accessible heading stays "OpenData — live global situational-awareness
//          map" instead of a string some screen readers spell out letter by letter.
//
//   /* Board tabs. The FIRST rule is mandatory, not cosmetic: the shared
//      `.tn-preset-pill` in globals.css is `position:absolute; left:50%; top:50%;
//      transform:translate(-50%,-50%)` (globals.css:2316) for the old centred pill.
//      Left as-is it rips the tab strip out of the header's flex row. `.tn-terminal`
//      + class beats the bare class on specificity, so this reset wins. */
//   .tn-terminal .tn-preset-pill.tnx-hdr-boards {
//     position: static; transform: none; z-index: auto; display: flex; align-items: stretch;
//   }
//   .tn-terminal .tnx-hdr-board {
//     font: inherit; font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
//     padding: 0 13px; background: none; cursor: pointer; white-space: nowrap;
//     border: 0; border-right: 1px solid var(--tnx-line);
//     border-bottom: 2px solid transparent; color: var(--tnx-ink-faint);
//   }
//   .tn-terminal .tnx-hdr-board.is-active {
//     color: var(--tnx-ink); background: var(--tnx-panel-head); border-bottom-color: var(--tnx-accent);
//   }
//   .tn-terminal .tnx-hdr-board:hover { color: var(--tnx-ink-dim); }
//
//   .tn-terminal .tnx-hdr-spacer { flex: 1; min-width: 0; }
//
//   /* UTC clock */
//   .tn-terminal .tnx-hdr-utc { display: flex; align-items: center; gap: 6px;
//     padding: 0 10px; border-left: 1px solid var(--tnx-line); }
//   .tn-terminal .tnx-hdr-utc-label { font-size: 9.5px; color: var(--tnx-ink-faint); }
//   .tn-terminal .tnx-hdr-utc-time { font-size: 12px; font-weight: 700;
//     font-variant-numeric: tabular-nums; color: var(--tnx-ink); }
//
//   /* Right cluster — ONE family, the shape CONSOLE|WALL used to have. */
//   .tn-terminal .tnx-hdr-right { display: flex; align-items: stretch; padding: 0;
//     border-left: 1px solid var(--tnx-line); flex: none; }
//   .tn-terminal .tnx-hdr-btn { display: inline-flex; align-items: center; gap: 5px;
//     font: inherit; font-size: 9.5px; font-weight: 700; letter-spacing: 0.1em;
//     padding: 0 10px; border: 0; border-right: 1px solid var(--tnx-line);
//     background: none; cursor: pointer; color: var(--tnx-ink-dim);
//     text-decoration: none; white-space: nowrap; }
//   .tn-terminal .tnx-hdr-btn:hover { color: var(--tnx-ink); background: var(--tnx-panel-head); }
//   .tn-terminal .tnx-hdr-kbd { font-size: 9.5px; font-weight: 700; padding: 1px 5px;
//     border: 1px solid var(--tnx-line-strong); color: var(--tnx-ink); }
//   .tn-terminal .tnx-hdr-btn-label { color: inherit; }
//
//   /* ProfileMenu keeps its own light-theme classes; this only shrinks the avatar
//      into the 34px band. See the report — the popover is still light-tokened. */
//   .tn-terminal .tnx-hdr-profile .tn-profile-avatar { width: 22px; height: 22px; font-size: 10px; }
//
//   /* Focus must stay visible on a dark, borderless bar. */
//   .tn-terminal .tnx-hdr :focus-visible { outline: 2px solid var(--tnx-accent); outline-offset: -2px; }
//
// ONE EXISTING RULE TO REVIEW (in globals.css, outside the scoped block):
//   `@media (max-width: 768px) { .tn-palette-trigger { display: none } }` (globals.css:602)
//   still hides the palette trigger on phones. That was deliberate for the old shell; it
//   now also applies here. Left alone — changing it is the integrator's call.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { useMetrics } from "@/lib/metrics";
import { useLayers } from "@/lib/layers";
import { activePresetStore, useActivePreset } from "@/lib/console/activePreset";
import { BUILTIN_PRESETS, applyPreset, listPresets, resetActiveBoard } from "@/lib/console/presets";
import { isBoardEdited } from "@/lib/console/boards";
import { useShellLayout } from "@/lib/console/store";
import { appStatusLine } from "@/components/shell/a11y";
import Mark from "@/components/brand/Mark";
import DiscordMark from "@/components/brand/DiscordMark";
import SettingsPanel from "@/components/shell/SettingsPanel";
import LivePresence from "@/components/shell/LivePresence";
import { BRAND } from "@/lib/brand";
import NavPanel, { NAV_PANEL_ID } from "@/components/terminal/NavPanel";
import { CLOSE_GRACE_MS, boardStep, navPanelStore, nextOpenDelay, useNavPanel } from "@/lib/console/navPanel";

/**
 * The tab label IS the board's title, uppercased. There used to be a second map here
 * translating the six titles into terminal wording — "World Overview" → WORLD,
 * "Markets & Cyber" → MKT·CYBER — and it cost more than it saved:
 *
 *  * WORLD and EARTH are the same word in English. Six reviewers, briefed separately
 *    as different real users, each reported independently that they could not tell
 *    which tab held "a bit of everything" and which held natural hazards. The full
 *    titles ("World Overview" / "Earth Systems") at least disambiguated; the
 *    abbreviations threw that away for horizontal space the 34px band was not short
 *    of — the tabs end around x=700 with the clock starting near x=940.
 *  * Three naming layers — board id, preset title, tab label — could disagree, and
 *    did: `mobility` was a better name than AIR·SEA·SPACE and it was already in the
 *    code, unused.
 *
 * One string, one source. Rename a board in `presets.ts` and the tab follows.
 */
const boardLabel = (title: string) => title.toUpperCase();

// THE UTC CLOCK IS GONE. It was a live per-second readout in its own component,
// kept out of a live region so a screen reader would not recite it forever. Removed
// on request as part of thinning the header — the world-clock strip along the bottom
// of the stage (`.tnx-stage-foot`) already carries LA/NYC/LDN/DXB/SGP/TYO/SYD, so UTC
// in the top bar was the second clock on the page.

/** The seven board ids in tab order — also the roving-focus / Home-End order,
 *  and the order `boardStep` walks for ArrowLeft/ArrowRight. One source, so a
 *  reordering of BUILTIN_PRESETS is the only place that has to change. */
const BOARD_ORDER = BUILTIN_PRESETS.map((p) => p.id);

/**
 * The board tabs, and the edited/reset state that belongs with them.
 *
 * Its own component, for the reason the clock above used to be: it subscribes to the console
 * layout so the "customised" dot is live, and the layout changes on every cell
 * crossing of every drag. Keeping that subscription here re-renders six buttons
 * instead of dragging SettingsPanel and ProfileMenu along with it.
 *
 * AS OF THE NAV REBUILD, each tab is also an Apple-style expanding-nav label:
 * hovering or focusing one PREVIEWS its board's quick-settings panel (see
 * NavPanel.tsx) without switching; click/Enter/Space still switches
 * immediately, unchanged. The hover/close TIMERS live one level up, in
 * TerminalHeader — see the comment there for why — this component only calls
 * the callbacks it's handed and owns the parts that are genuinely per-tab:
 * which button ref is which, and the roving `tabIndex`.
 */
function BoardTabs({
  openId,
  onTabHoverEnter,
  onTabFocus,
  onToggleClick,
}: {
  openId: string | null;
  onTabHoverEnter: (sceneId: string) => void;
  onTabFocus: (sceneId: string) => void;
  onToggleClick: () => void;
}) {
  const activePresetId = useActivePreset();
  // Subscribed, not read: `isBoardEdited` hits localStorage, so without a re-render
  // trigger the dot would be a snapshot from whenever the header last happened to
  // paint. The value itself is unused — the subscription is the point.
  useShellLayout();

  const activeTitle = BUILTIN_PRESETS.find((p) => p.id === activePresetId)?.title;

  // Roving tabindex: the row is one Tab stop. `focusedTab` is DOM-focus state,
  // deliberately separate from `openId` (which also moves on plain mouse
  // hover, with no DOM focus change at all) — tying the roving stop to hover
  // would relocate where a keyboard Tab lands every time the mouse passed
  // over a different label. Defaults to the active board, same convention
  // MapRail's `tabStop` uses for its own roving group.
  const [focusedTab, setFocusedTab] = useState<string | null>(null);
  const tabStop = focusedTab ?? activePresetId ?? BOARD_ORDER[0];
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const onTabKeyDown = (e: React.KeyboardEvent, id: string) => {
    // Enter/Space are handled natively (these are real <button>s) — only the
    // roving-focus keys are this handler's job.
    let next: string | null = null;
    if (e.key === "ArrowLeft") next = boardStep(BOARD_ORDER, id, -1);
    else if (e.key === "ArrowRight") next = boardStep(BOARD_ORDER, id, 1);
    else if (e.key === "Home") next = BOARD_ORDER[0];
    else if (e.key === "End") next = BOARD_ORDER[BOARD_ORDER.length - 1];
    if (!next) return;
    e.preventDefault();
    // Moving DOM focus fires that button's own onFocus below, which is what
    // actually opens/retargets the panel — one mechanism for both Tab and
    // arrow-key navigation, per nav-spec §5.
    btnRefs.current[next]?.focus();
  };

  return (
    <nav className="tn-preset-pill tnx-hdr-boards" aria-label="Boards">
      {BUILTIN_PRESETS.map((p) => {
        const active = p.id === activePresetId;
        // A board is "edited" once its owner has moved, resized, added or removed
        // something on it. Merely opening a board does not count — see the
        // `archive: false` path in lib/console/store.
        //
        // The dot exists because the state model used to be invisible in both
        // directions: a board switch silently rebuilt the board from its template
        // and destroyed the user's arrangement, and the only signal was noticing
        // later that the cards had moved. Switching now preserves the work, and
        // this says so.
        const edited = isBoardEdited(p.id);
        return (
          <button
            key={p.id}
            ref={(el) => {
              btnRefs.current[p.id] = el;
            }}
            type="button"
            className={`tnx-hdr-board${active ? " is-active" : ""}${edited ? " is-edited" : ""}`}
            aria-pressed={active}
            // In addition to aria-pressed ("is this the active board"), NOT a
            // replacement for it — true only for whichever scene's panel is
            // currently open, which may or may not be the active one.
            aria-expanded={openId === p.id}
            aria-controls={NAV_PANEL_ID}
            tabIndex={tabStop === p.id ? 0 : -1}
            title={`${p.title} — ${p.blurb}${edited ? " · customised" : ""}`}
            onClick={() => {
              applyPreset(p.id);
              // Click commits — Apple's split. The preview is over once the
              // board it was previewing is the board you're now on.
              navPanelStore.close();
            }}
            onMouseEnter={() => onTabHoverEnter(p.id)}
            onFocus={() => {
              setFocusedTab(p.id);
              onTabFocus(p.id);
            }}
            onKeyDown={(e) => onTabKeyDown(e, p.id)}
          >
            {boardLabel(p.title)}
            {edited && <span className="tnx-hdr-board-dot" aria-hidden>•</span>}
            {/* Appends to the visible text, so the accessible name still contains
                it (WCAG 2.5.3 label-in-name). */}
            <span className="tn-sr-only"> board{edited ? ", customised" : ""}</span>
          </button>
        );
      })}

      {/* Reset. Shown only when the open board actually has edits to throw away — a
          permanently-visible destructive control on a monitoring surface is one
          people learn to avoid rather than use. No confirm dialog: this is reached
          far more often on purpose than by accident, and a modal in a monitoring
          tool is a tax. The board's template comes straight back. */}
      {activePresetId && isBoardEdited(activePresetId) && (
        <button
          type="button"
          className="tnx-hdr-board-reset"
          onClick={() => resetActiveBoard()}
          title={`Reset ${activeTitle ?? "this board"} to its default layout`}
        >
          <span aria-hidden>⟲</span>
          <span className="tn-sr-only">Reset {activeTitle ?? "this board"} to its default layout</span>
        </button>
      )}

      {/* THE UNIVERSAL ENTRY POINT — mouse, keyboard AND touch alike, and the
          ONLY one touch gets. Hover has no touch equivalent, so this is what
          makes quick settings reachable at all on a coarse pointer; on every
          pointer type it always opens the ACTIVE board's panel, never a
          preview, which is what makes it safe to be the one thing every input
          method can reach — a tap can't "preview" the way a hover does, so it
          doesn't try to.

          onMouseEnter SELF-HEALS a real bug (found by claude-qa): this button
          sits at the end of the SAME hover-sensitive row as the seven tabs, so
          a mouse travelling from a just-clicked tab toward the toggle crosses
          the intervening tabs' own boxes and fires THEIR onMouseEnter along
          the way. Because retargeting between two ALREADY-open scenes is
          instant (nextOpenDelay()=0, by design, for real tab-to-tab hovering),
          openId would silently end up pointed at whichever tab the pointer
          last grazed in transit — not the active board — by the time it
          reached the toggle, corrupting the click that follows. Treating
          arrival at the toggle exactly like arriving at a tab for the ACTIVE
          board corrects openId the instant the pointer gets here, before any
          click can read a stale value; it costs nothing when nothing was
          open (same debounced-open a first hover on any tab would get) and
          nothing extra when the active board's panel was already showing. */}
      <button
        type="button"
        className="tnx-hdr-nav-toggle"
        aria-expanded={openId !== null}
        aria-controls={NAV_PANEL_ID}
        aria-label={`Quick settings for ${activeTitle ?? "this board"}`}
        onClick={onToggleClick}
        onMouseEnter={() => {
          if (activePresetId) onTabHoverEnter(activePresetId);
        }}
      >
        <span aria-hidden>{openId ? "▴" : "▾"}</span>
      </button>
    </nav>
  );
}

export default function TerminalHeader({ onOpenPalette }: { onOpenPalette: () => void }) {
  const m = useMetrics();
  const layers = useLayers();
  const activePresetId = useActivePreset();
  const { openId } = useNavPanel();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Board name for the spoken status line. Same source the tabs read, so the two can
  // never disagree about which board is loaded. listPresets() (not BUILTIN_PRESETS)
  // because a custom saved board is also a legitimate active board.
  const boardTitle = listPresets().find((p) => p.id === activePresetId)?.title ?? null;

  // ── The nav panel's hover/close TIMERS ──────────────────────────────────
  //
  // These live here, one level above BoardTabs and NavPanel, because they are
  // the one piece of state three different triggers all have to share and
  // agree on: a tab's mouseenter (open, debounced), the WHOLE navshell's
  // mouseleave (close, debounced — the wrapper below, not any one tab or the
  // panel, so moving the pointer from a tab down into the panel is never a
  // "leave"), and the toggle button's click (immediate, no debounce). They
  // are plain `useRef` timer handles, per nav-spec §5 — NOT part of the pure
  // lib/console/navPanel.ts module, which only answers "how long" and "what
  // happens," never owns a `setTimeout` that has to outlive a render.
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read once, not per mouseenter — a `matchMedia` call per hover would be
  // wasteful and its answer cannot change mid-session on a real device.
  // Coarse/no-hover pointers (touch) never get the hover preview at all;
  // `.tnx-hdr-nav-toggle` is their entry point instead (nav-spec §7).
  const finePointerRef = useRef(false);
  useEffect(() => {
    finePointerRef.current =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(hover: hover) and (pointer: fine)").matches
        : false;
  }, []);

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current !== null) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);
  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const handleTabHoverEnter = useCallback(
    (sceneId: string) => {
      if (!finePointerRef.current) return;
      clearCloseTimer();
      clearOpenTimer();
      const delay = nextOpenDelay(navPanelStore.get(), sceneId);
      if (delay === 0) navPanelStore.open(sceneId);
      else openTimerRef.current = setTimeout(() => navPanelStore.open(sceneId), delay);
    },
    [clearCloseTimer, clearOpenTimer],
  );

  // Focus (Tab, or the DOM focus an arrow key just moved) opens immediately —
  // Tab-ing through the row previews each board for free, with none of
  // hover's debounce (a keyboard user is not "passing through").
  const handleTabFocus = useCallback(
    (sceneId: string) => {
      clearOpenTimer();
      clearCloseTimer();
      navPanelStore.open(sceneId);
    },
    [clearOpenTimer, clearCloseTimer],
  );

  const handleToggleClick = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    if (navPanelStore.get().openId === null) {
      const id = activePresetStore.get();
      if (id) navPanelStore.open(id);
    } else {
      navPanelStore.close();
    }
  }, [clearOpenTimer, clearCloseTimer]);

  // The pointer leaving the WHOLE navshell (header + panel together — React's
  // onMouseEnter/onMouseLeave already behave like native mouseenter/mouseleave,
  // firing only at this element's own boundary, not on every descendant
  // crossing) starts the close grace timer; re-entering anywhere in the
  // navshell before it fires cancels it. Entering or leaving a tab WITHIN the
  // navshell never touches this pair at all.
  const handleNavshellMouseLeave = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => navPanelStore.close(), CLOSE_GRACE_MS);
  }, [clearOpenTimer, clearCloseTimer]);
  const handleNavshellMouseEnter = useCallback(() => {
    clearCloseTimer();
  }, [clearCloseTimer]);

  useEffect(
    () => () => {
      clearOpenTimer();
      clearCloseTimer();
    },
    [clearOpenTimer, clearCloseTimer],
  );

  // ── Escape closes the panel, and ONLY the panel ──────────────────────────
  //
  // .tnx-nav-panel is role="region", never role="dialog" — ConsoleShell's own
  // global keydown handler early-returns whenever `[role="dialog"]` is
  // mounted, and using that role here would silently disable Escape/;/Ctrl-K
  // for the app for as long as this panel was open, which is a bigger
  // regression than anything about the panel itself (nav-spec §7). Because
  // ConsoleShell does NOT defer to a role="region" panel on its own, this
  // listener has to both close the panel AND stop the SAME keypress also
  // reaching ConsoleShell's handler, which would otherwise run its own
  // Escape branch (leave picking mode, else clear the selection) as an
  // unwanted second effect of the same keystroke.
  //
  // stopImmediatePropagation, not stopPropagation: both listeners are on
  // `window`, so there is no capture/bubble path between them to interrupt —
  // only registration ORDER decides who runs first, and stopImmediatePropagation
  // is what stops a LATER-registered listener on the same target from running
  // at all once an earlier one has handled the event.
  //
  // Mounted always (not only while open) and self-gating on the store, so the
  // listener's own registration happens once, on mount, rather than being
  // added and removed every time the panel opens and closes — which matters
  // here specifically: registration order is what makes this run before
  // ConsoleShell's own listener (React mounts child effects before parent
  // effects, and TerminalHeader is ConsoleShell's child), and re-registering
  // this one on every open/close would not change that order but adds churn
  // for no benefit.
  //
  // VERIFIED IN A REAL BROWSER, not just by trusting the mount-order argument
  // above (nav-spec §7 asks for this explicitly): opened a scene's panel with
  // the mouse, pressed Escape once, and confirmed BOTH that the panel closed
  // AND that ConsoleShell's own Escape branch did not also fire on the same
  // keypress (no selection-clear side effect). See #nav-shell for the note.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (navPanelStore.get().openId === null) return;
      navPanelStore.close();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <div className="tnx-navshell" onMouseEnter={handleNavshellMouseEnter} onMouseLeave={handleNavshellMouseLeave}>
      <header className="tnx-hdr" role="banner">
        {/* Canonical machine-readable pulse — visually hidden, kept for the e2e smoke
            test and screen readers. */}
        <span data-testid="stat-line" className="tn-sr-only">
          {/* "off" is not "0". An audit read this line as "0 planes · 0 satellites"
              and concluded two of three headline feeds were dead, while /api/planes
              was serving 3,000 aircraft and the layer was simply not switched on.
              Reporting a disabled layer as a zero count is the same error as a
              frozen feed reporting "live". */}
          {m.camerasTotal.toLocaleString()} cameras ·{" "}
          {layers.planes ? `${m.planes.toLocaleString()} planes` : "planes off"} ·{" "}
          {layers.satellites ? `${m.satellites.toLocaleString()} satellites` : "satellites off"}
        </span>

        {/* The SPOKEN status line, and deliberately a different string from the one
            above. The pulse line re-renders every few seconds as the tallies move,
            so wiring aria-live to it would make a screen reader recite
            "18,729 cameras · 3,000 planes · 412 satellites" on a loop — noise that
            drowns the page. This one carries state only (board + which layers are
            on), so it changes when, and only when, the user changed something.
            See appStatusLine() in components/shell/a11y.ts. */}
        <span className="tn-sr-only" role="status" aria-live="polite" data-testid="a11y-status-line">
          {appStatusLine({ boardTitle, layers })}
        </span>

        {/* ── Brand ────────────────────────────────────────────────────────── */}
        <div className="tnx-hdr-brand">
          {/* SVG, not the PNG this used to load. The raster has a baked near-black
              plate, so on the light skin it sat as a dark square in the header;
              the vector draws from currentColor and works on both. It is also the
              one source the favicon and PWA icons are generated from, which is
              what stopped the browser tab showing a different logo from the app.

              No label: the mark is a decorative duplicate of the h1 beside it, and
              a second copy of the product name in the accessibility tree
              is noise. `idle` runs
              the slow ring-dot orbit — the ambient "system is live" tell. */}
          <Mark className="tnx-hdr-mark" size={24} idle />

          {/* The page's one h1. It is the wordmark itself rather than a hidden
              duplicate — the visible product name IS the page's title — with a
              visually-hidden tail so the accessible heading says what the product
              is instead of the bare name. The DOM text keeps BRAND's mixed case and
              the uppercase is CSS (see the block at the top of this file): an
              all-caps literal reads out as an initialism on some screen readers. */}
          <h1 className="tnx-hdr-h1">
            {BRAND.name}
            <span className="tn-sr-only"> — {BRAND.tagline}</span>
          </h1>
        </div>

        {/* ── Board tabs ───────────────────────────────────────────────────── */}
        {/* A <nav aria-label="Boards"> carrying `.tn-preset-pill`, exactly as the old
            centred PresetPill did. Two reasons, both load-bearing: the class is a
            selector the e2e suite clicks to change board, and picking a board swaps
            every widget AND the map overlays, which makes this the console's main
            menu rather than a group of buttons.

            aria-pressed rather than role="tab"/aria-selected: these tabs control the
            whole workspace — widgets, map layers, stage — not one tabpanel, and a
            tablist with no tabpanel is a promise the DOM does not keep. */}
        <BoardTabs
          openId={openId}
          onTabHoverEnter={handleTabHoverEnter}
          onTabFocus={handleTabFocus}
          onToggleClick={handleToggleClick}
        />

        <div className="tnx-hdr-spacer" />

        {/* ── Entry points + identity ──────────────────────────────────────── */}
        {/*
          ONE BUTTON FAMILY, not four styles in a row. The skin toggle, Support,
          Source and the palette trigger were each dressed differently — a bordered
          chip, two bare accent links, and a key-cap-plus-label — which made a
          four-item cluster read as four unrelated things. They are all the same
          kind of control (a way OUT of the console, or a way to change how it
          looks), so they now share `.tnx-hdr-btn`: the flat segmented style
          CONSOLE/WALL used to have, kept on after those buttons were removed
          because it was the one shape in this cluster that read as a button at 34px.

          The glyphs stay. They are the fastest way to tell four same-shaped
          segments apart at a glance, and each is aria-hidden so nothing is read out
          as a symbol.

          ⚙ IS BACK. It left when settings opened from the profile popover, and it
          returned when that popover did not survive the header trim — a drawer
          holding theme, language, boards, sharing, notifications and the keymap
          cannot be a room with no door. `.tn-settings-trigger` came back with it.
        */}
        <div className="tnx-hdr-right">
          {/* HOW MANY PEOPLE ARE ON THE SITE, when that is worth saying.
              Renders NOTHING below the threshold — not a zero, not a gap — so it
              adds no width to this cluster on the ordinary day. It leads the
              cluster because it is a readout rather than a control, and the three
              things after it are all controls. */}
          <LivePresence />
          {/* THE PERMANENT DOOR TO THE DISCORD, and the reason CommunityNote's
              dismissal is allowed to be permanent. That card asks once and then
              never again; without a standing link, "No thanks" would close the
              only route rather than just the prompt. It joins this cluster because
              it is the same kind of control as the two beside it — a way OUT of the
              console — and it uses `.tnx-hdr-btn-label` (as SHORTCUTS and SETTINGS
              do, and SUPPORT and SOURCE do not) so it collapses to the mark alone
              under 720px and adds no width on a phone. */}
          <a
            className="tnx-hdr-btn"
            href={BRAND.discordUrl}
            target="_blank"
            rel="noreferrer noopener"
            title={`Join the ${BRAND.name} Discord`}
          >
            <DiscordMark size={12} />
            <span className="tnx-hdr-btn-label">DISCORD</span>
          </a>

          {/* Buy Me a Coffee (Ko-fi) — the app is free + keyless; this is a calm,
              opt-in way to support it. */}
          <a
            className="tnx-hdr-btn"
            href="https://ko-fi.com/opendata"
            target="_blank"
            rel="noreferrer noopener"
            title={`Support ${BRAND.name} on Ko-fi`}
          >
            <span aria-hidden>☕</span>
            <span>SUPPORT</span>
          </a>

          {/* AGPL-3.0 section 13: a user who interacts with this program remotely —
              which is the only way anyone uses it — must be offered the Corresponding
              Source. This link is that offer, so it is a licence obligation rather
              than a nicety. Removing it puts the deployment in breach of its own
              licence. */}
          <a
            className="tnx-hdr-btn"
            href={BRAND.repoUrl}
            target="_blank"
            rel="noreferrer noopener"
            title={`${BRAND.name} is free software under the ${BRAND.license.name}. Read the source.`}
          >
            <span aria-hidden>{"<>"}</span>
            <span>SOURCE</span>
          </a>

          {/*
            SHORTCUTS, not COMMAND. The palette is a command bar, but "COMMAND" told
            a first-time reader nothing about what was behind it, and the ⌘K cap
            beside it was doing all the explaining on its own. "Shortcuts" names what
            people open it for. `.tn-palette-trigger` is unchanged — it is the
            selector the e2e suite opens the palette with.
          */}
          <button
            type="button"
            className="tnx-hdr-btn tn-palette-trigger"
            onClick={onOpenPalette}
            aria-label="Shortcuts and command palette"
            // NO ⌘K CAP, AND NO ⌘K IN THE TITLE. That chord opens the Sources rail
            // now (ConsoleShell's keydown handler says why), so the cap would have
            // been an instruction that does something else. This button is the
            // palette's door; it does not have a chord of its own.
            title="Shortcuts and commands"
          >
            <span className="tnx-hdr-btn-label">SHORTCUTS</span>
          </button>

          {/* ⚙ IS BACK, AND IT IS THE ONLY DOOR AGAIN.

              It was removed when Settings moved into the profile popover, on the
              grounds that a header icon was "a second door to a room that already
              had one". The popover has now gone with the "?" avatar, so that
              reasoning inverts: without this button the settings drawer — theme,
              language, board loading, sharing, Telegram and the whole notifications
              section — has no way in at all.

              `.tn-settings-trigger` is carried over VERBATIM: it is the selector
              tests/e2e/shortcuts.spec.ts opens the drawer with to rebind a key. */}
          <button
            type="button"
            className="tnx-hdr-btn tn-settings-trigger"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            title="Settings"
          >
            <span aria-hidden>⚙</span>
            <span className="tnx-hdr-btn-label">SETTINGS</span>
          </button>
        </div>
      </header>

      {/* Sibling of <header>, inside the same navshell, so the navshell's own
          height (not a fixed/absolute overlay) is what visibly "grows
          downward" when it opens — the same trick Apple's bar uses. */}
      <NavPanel openId={openId} />
      </div>

      {/* Sibling of .tnx-navshell — covers everything BELOW the bar by
          z-index alone, dims the page behind an open panel without making it
          inert (role="region", not role="dialog" — see the Escape comment
          above), and closes the panel on any outside click. Placed here,
          still inside TerminalHeader's own returned fragment, so no
          ConsoleShell.tsx edit was needed to add it. */}
      <div
        className="tnx-nav-scrim"
        data-open={openId !== null || undefined}
        onClick={() => navPanelStore.close()}
      />

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
