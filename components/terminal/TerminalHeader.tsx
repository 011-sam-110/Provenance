"use client";
// The OpenData Terminal's 34px top chrome — the replacement for
// components/shell/StatusBar.tsx.
//
// Left → right: brand block (logo · h1 · tag) │ board tabs │ ——— │ UTC clock │
// CONSOLE|WALL │ ☕ · ⌘K COMMAND · ⚙ · avatar.
//
// It is a *replacement*, not an addition, so everything StatusBar carried that has
// no second home in the app is carried here verbatim:
//
//  * the page's single <h1> (with the visually-hidden tail that turns the wordmark
//    into a sentence a screen reader can use),
//  * `stat-line` — the machine-readable pulse asserted by tests/e2e/globe.spec.ts,
//  * `a11y-status-line` — the polite live region fed by appStatusLine(),
//  * `.tn-preset-pill`, `.tn-palette-trigger`, `.tn-settings-trigger` — three of the
//    six TourOverlay spotlight selectors. resolveTourSteps() silently DROPS a step
//    whose target is missing, so dropping a class here shortens the tour with no
//    error and no failing test (lib/console/tour.ts:63-79).
//
// The third live region, `a11y-alert-live`, is NOT here: it belongs to BreakingBanner
// and stays there. Moving it would break `.tn-alert ~ .tn-cw-shell` in globals.css.
//
// ─────────────────────────────────────────────────────────────────────────────
// CSS THE INTEGRATOR MUST ADD (all inside the scoped `.tn-terminal` token block in
// app/globals.css — this file owns no CSS). Values are the design's, verbatim.
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
//   .tn-terminal .tnx-hdr-tag { font-size: 9.5px; letter-spacing: 0.12em;
//     text-transform: uppercase; color: var(--tnx-ink-faint); }
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
//   /* CONSOLE | WALL */
//   .tn-terminal .tnx-hdr-mode { display: flex; align-items: stretch;
//     border-left: 1px solid var(--tnx-line); }
//   .tn-terminal .tnx-hdr-mode-btn {
//     font: inherit; font-size: 9.5px; font-weight: 700; letter-spacing: 0.1em;
//     padding: 0 9px; border: 0; background: none; cursor: pointer; color: var(--tnx-ink-dim);
//   }
//   .tn-terminal .tnx-hdr-mode-btn.is-active { background: var(--tnx-accent); color: #06080b; }
//
//   /* Right cluster */
//   .tn-terminal .tnx-hdr-right { display: flex; align-items: center; gap: 8px;
//     padding: 0 9px; border-left: 1px solid var(--tnx-line); }
//   .tn-terminal .tnx-hdr-kofi { display: inline-flex; align-items: center; gap: 4px;
//     font-size: 9.5px; font-weight: 700; letter-spacing: 0.08em; text-decoration: none;
//     color: var(--tnx-accent); }
//   .tn-terminal .tnx-hdr-kofi:hover { text-decoration: underline; }
//   .tn-terminal .tnx-hdr-cmd { display: inline-flex; align-items: center; gap: 6px;
//     font: inherit; border: 0; background: none; cursor: pointer; padding: 0;
//     color: var(--tnx-ink-dim); }
//   .tn-terminal .tnx-hdr-kbd { font-size: 9.5px; font-weight: 700; padding: 2px 6px;
//     border: 1px solid var(--tnx-line-strong); color: var(--tnx-ink); }
//   .tn-terminal .tnx-hdr-cmd-label { font-size: 9.5px; font-weight: 700; letter-spacing: 0.1em;
//     color: var(--tnx-ink-faint); }
//   .tn-terminal .tnx-hdr-icon { width: 22px; height: 22px; display: inline-flex;
//     align-items: center; justify-content: center; font: inherit; font-size: 11px;
//     border: 1px solid var(--tnx-line-strong); background: none; cursor: pointer;
//     color: var(--tnx-ink-dim); }
//   .tn-terminal .tnx-hdr-icon:hover { color: var(--tnx-ink); border-color: var(--tnx-accent); }
//   /* ProfileMenu keeps its own light-theme classes; this only shrinks the avatar
//      into the 34px band. See the report — the popover is still light-tokened. */
//   .tn-terminal .tnx-hdr-profile .tn-profile-avatar { width: 22px; height: 22px; font-size: 10px; }
//
//   /* Focus must stay visible on a dark, borderless bar. */
//   .tn-terminal .tnx-hdr :focus-visible { outline: 2px solid var(--tnx-accent); outline-offset: -2px; }
//
// ONE EXISTING RULE TO REVIEW (in globals.css, outside the scoped block):
//   `@media (max-width: 768px) { .tn-palette-trigger { display: none } }` (globals.css:602)
//   still hides the ⌘K control on phones. That was deliberate for the old shell; it
//   now also applies here. Left alone — changing it is the integrator's call.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { useMetrics } from "@/lib/metrics";
import { useLayers } from "@/lib/layers";
import { useActivePreset } from "@/lib/console/activePreset";
import { BUILTIN_PRESETS, applyPreset, listPresets, resetActiveBoard } from "@/lib/console/presets";
import { isBoardEdited } from "@/lib/console/boards";
import { useShellLayout } from "@/lib/console/store";
import { appStatusLine } from "@/components/shell/a11y";
import { terminalModeStore, useTerminalMode, type TerminalMode } from "@/lib/terminal/mode";
import { terminalSkinStore, useTerminalSkin } from "@/lib/terminal/skin";
import Mark from "@/components/brand/Mark";
import ProfileMenu from "@/components/shell/ProfileMenu";
import SettingsPanel from "@/components/shell/SettingsPanel";
import { BRAND } from "@/lib/brand";

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

/** CONSOLE first, WALL second — the design's reading order. */
const MODES: { id: TerminalMode; label: string; title: string }[] = [
  { id: "console", label: "CONSOLE", title: "Map-dominant console (C)" },
  { id: "wall", label: "WALL", title: "All widgets on one grid (W)" },
];

/**
 * The live UTC readout.
 *
 * Its own component on purpose: the interval sets state once a second, and state
 * lives where it is read, so the tick re-renders ~30 characters instead of the whole
 * header (which would drag the six board tabs, the Ko-fi link and — through
 * TerminalHeader's own subscriptions — nothing useful along with it every second).
 *
 * Renders a placeholder until the first effect runs. `new Date()` during render would
 * make the server HTML and React's first client pass disagree, which is a hydration
 * error; and the server has no business claiming a clock time anyway.
 */
function UtcClock() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    // toISOString() is UTC by definition, so this needs no timezone maths and cannot
    // drift with the viewer's locale. Slice 11..19 is exactly HH:MM:SS.
    const tick = () => setTime(new Date().toISOString().slice(11, 19));
    tick();
    const handle = window.setInterval(tick, 1000);
    return () => window.clearInterval(handle);
  }, []);

  return (
    // Not in any live region — a polite region on a per-second value would make a
    // screen reader recite the time forever (the same failure the pulse line below
    // is kept out of). The group label makes it readable on demand instead.
    <div className="tnx-hdr-utc" aria-label="Coordinated Universal Time">
      <span className="tnx-hdr-utc-label" aria-hidden>UTC</span>
      <span className="tnx-hdr-utc-time">{time ?? "--:--:--"}</span>
    </div>
  );
}

/**
 * The board tabs, and the edited/reset state that belongs with them.
 *
 * Its own component for the same reason UtcClock is: it subscribes to the console
 * layout so the "customised" dot is live, and the layout changes on every cell
 * crossing of every drag. Keeping that subscription here re-renders six buttons
 * instead of dragging SettingsPanel and ProfileMenu along with it.
 */
function BoardTabs() {
  const activePresetId = useActivePreset();
  // Subscribed, not read: `isBoardEdited` hits localStorage, so without a re-render
  // trigger the dot would be a snapshot from whenever the header last happened to
  // paint. The value itself is unused — the subscription is the point.
  useShellLayout();

  const activeTitle = BUILTIN_PRESETS.find((p) => p.id === activePresetId)?.title;

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
            type="button"
            className={`tnx-hdr-board${active ? " is-active" : ""}${edited ? " is-edited" : ""}`}
            aria-pressed={active}
            title={`${p.title} — ${p.blurb}${edited ? " · customised" : ""}`}
            onClick={() => applyPreset(p.id)}
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
    </nav>
  );
}

export default function TerminalHeader({ onOpenPalette }: { onOpenPalette: () => void }) {
  const m = useMetrics();
  const layers = useLayers();
  const activePresetId = useActivePreset();
  const mode = useTerminalMode();
  const skin = useTerminalSkin();
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

          {/* aria-hidden, and OUTSIDE the h1: inside it, this would append to the
              heading's accessible name and the h1 would stop reading as the
              product-plus-description sentence the tail exists to build. */}
          <span className="tnx-hdr-tag" aria-hidden>OSINT Terminal</span>
        </div>

        {/* ── Board tabs ───────────────────────────────────────────────────── */}
        {/* A <nav aria-label="Boards"> carrying `.tn-preset-pill`, exactly as the old
            centred PresetPill did. Two reasons, both load-bearing: the class is a
            TourOverlay spotlight target (a rename shortens the tour silently), and
            picking a board swaps every widget AND the map overlays, which makes this
            the console's main menu rather than a group of buttons.

            aria-pressed rather than role="tab"/aria-selected: these tabs control the
            whole workspace — widgets, map layers, stage — not one tabpanel, and a
            tablist with no tabpanel is a promise the DOM does not keep. */}
        <BoardTabs />

        <div className="tnx-hdr-spacer" />

        <UtcClock />

        {/* ── CONSOLE | WALL ───────────────────────────────────────────────── */}
        {/* terminalModeStore, NOT viewModeStore: that one drives the MapLibre
            projection (globe↔mercator) and flipping it here would spin the globe.
            See the header comment in lib/terminal/mode.ts. */}
        <div className="tnx-hdr-mode" role="group" aria-label="Layout mode">
          {MODES.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`tnx-hdr-mode-btn${mode === opt.id ? " is-active" : ""}`}
              aria-pressed={mode === opt.id}
              title={opt.title}
              onClick={() => terminalModeStore.set(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* ── Entry points + identity ──────────────────────────────────────── */}
        <div className="tnx-hdr-right">
          {/* Skin. Sits beside CONSOLE/WALL because it is the same kind of control —
              how the Terminal looks, not what it shows — and it is deliberately a
              two-state toggle rather than a third mode button: the label names the
              skin you would GET, which is what a single button has to do to be
              unambiguous. It does not touch [data-theme]; see lib/terminal/skin.ts
              for why a Terminal skin cannot be a theme. */}
          <button
            type="button"
            className="tnx-hdr-skin"
            onClick={() => terminalSkinStore.toggle()}
            aria-pressed={skin === "light"}
            title={skin === "dark" ? "Switch to the light skin" : "Switch to the dark skin"}
          >
            <span aria-hidden>{skin === "dark" ? "☀" : "☾"}</span>
            <span>{skin === "dark" ? "LIGHT" : "DARK"}</span>
          </button>

          {/* Buy Me a Coffee (Ko-fi) — the app is free + keyless; this is a calm,
              opt-in way to support it. Kept in the header rather than exiled to the
              footer: the 34px band holds a 9.5px chip fine, and the footer's right
              cluster is the keyboard-hint block. */}
          <a
            className="tnx-hdr-kofi"
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
              licence. Reuses .tnx-hdr-kofi so the right cluster stays one visual
              family; see the CSS block at the top of this file. */}
          <a
            className="tnx-hdr-kofi"
            href={BRAND.repoUrl}
            target="_blank"
            rel="noreferrer noopener"
            title={`${BRAND.name} is free software under the ${BRAND.license.name}. Read the source.`}
          >
            <span aria-hidden>{"<>"}</span>
            <span>SOURCE</span>
          </a>

          <button
            type="button"
            className="tnx-hdr-cmd tn-palette-trigger"
            onClick={onOpenPalette}
            aria-label="Command palette"
            title="Command palette (⌘K)"
          >
            <span className="tnx-hdr-kbd" aria-hidden>⌘K</span>
            <span className="tnx-hdr-cmd-label" aria-hidden>COMMAND</span>
          </button>

          <button
            type="button"
            className="tnx-hdr-icon tn-settings-trigger"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            title="Settings"
          >
            <span aria-hidden>⚙</span>
          </button>

          {/* Not in the design's header, kept anyway: this popover is the ONLY UI for
              the display name (profileStore) and the "Sign in" seam, and one of two
              ways into the tour. Dropping it would delete a control, not restyle one.
              Its own light-token popover is a known cosmetic mismatch — see report. */}
          <span className="tnx-hdr-profile">
            <ProfileMenu onOpenSettings={() => setSettingsOpen(true)} />
          </span>
        </div>
      </header>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
