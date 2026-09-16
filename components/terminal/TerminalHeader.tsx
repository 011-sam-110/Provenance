"use client";
// The Provenance Terminal's 34px top chrome — the replacement for
// components/shell/StatusBar.tsx.
//
// Left → right: brand block (logo · h1) │ board tabs │ ——— │
// presence · DISCORD · ☕ SUPPORT · SOURCE · SHORTCUTS · ⚙ SETTINGS.
//
// The board tabs are the console's whole navigation: exactly TWO — Globe and
// Streets. The other five boards (World, Nature, Skywatch, Infrastructure,
// Intel) were retired on request, the Apple-style hover panel that used to
// expand the bar downward (NavPanel) went with them, and News — a preset like
// any other — simply has no tab: it stays reachable from the Sources rail
// tiles and the ⌘K profiles list, which is where it can explain itself. The
// tabs switch boards directly on click, with nothing dropping down and nothing
// to dismiss. `lib/console/navPanel.ts` and `components/terminal/NavPanel.tsx`
// are deleted.
//
// It is a *replacement*, not an addition, so everything StatusBar carried that has
// no second home in the app is carried here verbatim:
//
//  * the page's single <h1> (with the visually-hidden tail that turns the wordmark
//    into a sentence a screen reader can use),
//  * `stat-line` — the machine-readable pulse asserted by tests/e2e/globe.spec.ts,
//  * `a11y-status-line` — the polite live region fed by appStatusLine(),
//  * `.tn-preset-pill`, `.tn-settings-trigger` — the classes the e2e suite drives
//    to reach the boards and the settings drawer.
//
// The third live region, `a11y-alert-live`, is NOT here: it belongs to BreakingBanner
// and stays there. Moving it would break `.tn-alert ~ .tn-cw-shell` in globals.css.

import { useCallback, useEffect, useRef, useState } from "react";
import { useMetrics } from "@/lib/metrics";
import { useLayers } from "@/lib/layers";
import { useActivePreset } from "@/lib/console/activePreset";
import { BUILTIN_PRESETS, TOP_BAR_PRESET_IDS, applyPreset, listPresets } from "@/lib/console/presets";
import { isBoardEdited } from "@/lib/console/boards";
import { useShellLayout } from "@/lib/console/store";
import { appStatusLine } from "@/components/shell/a11y";
import Mark from "@/components/brand/Mark";
import DiscordMark from "@/components/brand/DiscordMark";
import SettingsPanel from "@/components/shell/SettingsPanel";
import LivePresence from "@/components/shell/LivePresence";
import { BRAND } from "@/lib/brand";

/**
 * The tab label IS the board's title, uppercased. One string, one source:
 * rename a board in `presets.ts` and the tab follows.
 */
const boardLabel = (title: string) => title.toUpperCase();

/** The board ids in tab order — also the roving-focus / Home-End order.
 *  From TOP_BAR_PRESET_IDS (a subset of the lineup, pinned by
 *  console-presets.test.ts), so this file never has to learn a board id. */
const BOARD_ORDER: readonly string[] = [...TOP_BAR_PRESET_IDS];

/** The presets the tabs render, resolved once. Every id is pinned to exist. */
const TAB_PRESETS = TOP_BAR_PRESET_IDS.map(
  (id) => BUILTIN_PRESETS.find((p) => p.id === id) as (typeof BUILTIN_PRESETS)[number],
);

/** One step through BOARD_ORDER for the arrow keys, wrapping at both ends. */
function boardStep(from: string, dir: 1 | -1): string {
  const i = BOARD_ORDER.indexOf(from);
  const n = BOARD_ORDER.length;
  if (i === -1) return BOARD_ORDER[0];
  return BOARD_ORDER[(i + dir + n) % n];
}

/**
 * The travelling board marker.
 *
 * The active board used to be marked by `border-bottom-color` ON THE BUTTON, and
 * a per-element border is the one thing that cannot move: it can only switch off
 * under one tab and switch on under another. Since a preset is the WHOLE
 * workspace, that made the largest navigation in the product — the rails, the
 * widgets and the map's layer set — arrive with nothing tying it to the tab that
 * caused it.
 *
 * So the marker becomes a single bar owned by the nav, positioned from two custom
 * properties measured here. The measurement is why this is JS and not CSS: the
 * tabs are content-width, so their positions are not knowable from a stylesheet.
 *
 * It costs nothing at rest. This runs on a board change and on a resize, which is
 * exactly when the answer can have changed — there is no rAF loop and no
 * per-frame state.
 *
 * `data-ind` is set one frame AFTER the first measurement, for two reasons: the
 * per-tab border stays the marker until a real position exists (so a server
 * render, a JS failure or a browser with no ResizeObserver still shows which
 * board is open), and the bar's first appearance is already in place rather than
 * sliding in from x=0.
 */
function useBoardMarker(activePresetId: string | null) {
  const navRef = useRef<HTMLElement | null>(null);
  const [measured, setMeasured] = useState(false);

  const measure = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const active = nav.querySelector<HTMLElement>(".tnx-hdr-board.is-active");
    // No active tab is a real state — a board can be closed — and the honest
    // answer is a marker of zero width rather than one parked under tab one.
    nav.style.setProperty("--tnx-bi-x", `${active ? active.offsetLeft : 0}px`);
    nav.style.setProperty("--tnx-bi-w", `${active ? active.offsetWidth : 0}px`);
  }, []);

  useEffect(() => {
    measure();
    // One frame's grace, so the bar is painted in position instead of animating
    // there from nothing on the first load.
    const raf = requestAnimationFrame(() => setMeasured(true));
    return () => cancelAnimationFrame(raf);
  }, [measure, activePresetId]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    // The nav itself, because the tab strip reflows on a narrow header and the
    // labels are abbreviated by `boardLabel` at some widths — both change the
    // answer without changing which board is open.
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [measure]);

  return { navRef, measured };
}

function BoardTabs() {
  const activePresetId = useActivePreset();
  // Subscribed, not read: `isBoardEdited` hits localStorage, so without a re-render
  // trigger the dot would be a snapshot from whenever the header last happened to
  // paint. The value itself is unused — the subscription is the point.
  useShellLayout();

  const { navRef, measured } = useBoardMarker(activePresetId);

  // Roving tabindex: the row is one Tab stop. `focusedTab` is DOM-focus state,
  // kept separate from the active board so moving focus never implies switching.
  const [focusedTab, setFocusedTab] = useState<string | null>(null);
  const tabStop = focusedTab ?? activePresetId ?? BOARD_ORDER[0];
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const onTabKeyDown = (e: React.KeyboardEvent, id: string) => {
    // Enter/Space are handled natively (these are real <button>s) — only the
    // roving-focus keys are this handler's job.
    let next: string | null = null;
    if (e.key === "ArrowLeft") next = boardStep(id, -1);
    else if (e.key === "ArrowRight") next = boardStep(id, 1);
    else if (e.key === "Home") next = BOARD_ORDER[0];
    else if (e.key === "End") next = BOARD_ORDER[BOARD_ORDER.length - 1];
    if (!next) return;
    e.preventDefault();
    // Moving DOM focus fires that button's own onFocus below, which keeps the
    // roving stop in step for the next Tab or arrow press.
    btnRefs.current[next]?.focus();
  };

  return (
    <nav
      ref={navRef}
      className="tn-preset-pill tnx-hdr-boards"
      aria-label="Boards"
      data-ind={measured ? "1" : undefined}
    >
      {TAB_PRESETS.map((p) => {
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
            tabIndex={tabStop === p.id ? 0 : -1}
            title={`${p.title} — ${p.blurb}${edited ? " · customised" : ""}`}
            onClick={() => applyPreset(p.id)}
            onFocus={() => setFocusedTab(p.id)}
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
    </nav>
  );
}

export default function TerminalHeader({ onOpenPalette }: { onOpenPalette: () => void }) {
  const m = useMetrics();
  const layers = useLayers();
  const activePresetId = useActivePreset();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Board name for the spoken status line. Same source the tabs read, so the two can
  // never disagree about which board is loaded. listPresets() (not BUILTIN_PRESETS)
  // because a custom saved board is also a legitimate active board.
  const boardTitle = listPresets().find((p) => p.id === activePresetId)?.title ?? null;

  return (
    <>
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
              is noise. `idle` runs the slow ring-dot orbit — the ambient
              "system is live" tell. */}
          <Mark className="tnx-hdr-mark" size={24} idle />

          {/* The page's one h1. It is the wordmark itself rather than a hidden
              duplicate — the visible product name IS the page's title — with a
              visually-hidden tail so the accessible heading says what the product
              is instead of the bare name. The DOM text keeps BRAND's mixed case and
              the uppercase is CSS: an all-caps literal reads out as an initialism
              on some screen readers. */}
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
        <BoardTabs />

        <div className="tnx-hdr-spacer" />

        {/* ── Entry points ─────────────────────────────────────────────────── */}
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

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
