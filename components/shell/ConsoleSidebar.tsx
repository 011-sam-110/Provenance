"use client";
// THE CONSOLE'S SIDEBAR: the shared column (components/rail/SideRail.tsx) with the console's
// own rows. Sources, Inspector, Map settings, Areas and Notifications each open one panel
// beside it (lib/console/consolePanel.ts holds which, components/shell/SourceCatalog.tsx
// draws it); Controls opens a small popover that says how to move the map.
//
// It replaced the "≡ Sources" tab, the Sources | Inspector tabs and the tool column on the
// panel's right edge (Sam, 2026-10-31: "the inspector, sources, areas, map settings,
// notification all stay"). Search was the fifth tool and is a pill on the map now
// (components/console/MapSearch.tsx). The reasons for the tools themselves are in
// lib/console/inspectorRail.ts.
//
// ESCAPE IS SEQUENCED, NOT ASSUMED, and the order is the load-bearing part. lib/map/aoi.ts
// binds Escape on `document` in the bubble phase for the life of a draw, and ConsoleShell's
// ladder is a bubble-phase window listener. The handler here is capture phase on `window`,
// so it runs first and:
//
//   -  the Controls popover is open → close it, and nothing else
//   0. the key lands in `[data-owns-escape]` → stand down; a surface holding its own Escape
//      owns it, and that attribute is the whole protocol. The area rename field, the colour
//      picker and the search pill carry it. lib/rail/railOpen.ts reads the same attribute.
//   1. a draw is running → stand down, so aoi.ts abandons the ring
//      -  the phone's sheet is open → stand down; the sheet closes itself (SideRail.tsx)
//      -  a dialog outside the panel is open → stand down; that dialog owns the key
//   2. a tool is open → close it and refocus its row, with preventDefault for the listeners
//      that read `defaultPrevented` and stopPropagation for the ones that do not, so one
//      press does not ALSO close the object behind it or clear the selection on the map
//   3. otherwise → stand down completely. InspectorPanel's own listener closes an object,
//      and ConsoleShell's ladder leaves picking mode, closes Sources or the empty Inspector,
//      and clears the selection, in that order
//
// Rung 0 is why this is capture phase and not a plain listener: capture sees Escape BEFORE a
// field inside the panel does, so without the stand-down, Escape in a name field would close
// the panel instead of putting the old name back.
//
// THE HINT IS ON THE SOURCES ROW. On every fresh launch it hops a few times and stops, for
// the reason lib/console/sourcesRail.ts gives. On a phone the row is inside a closed sheet,
// so the ☰ hops instead. The rule is `shouldHintRail`; the look is app/console-sidebar.css.
//
// A WRAPPER WITH `display: contents`, so the column is still placed by `.tn-cw-shell` and
// the keys and the hint still have one element to hang off.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SideRail, { type RailEntry } from "@/components/rail/SideRail";
import { closeRail, railOpenStore, useRailNarrow } from "@/lib/rail/railOpen";
import { overlay, useOverlay } from "@/lib/overlay";
import { useAoiDraw } from "@/lib/map/aoi";
import {
  CONSOLE_PANEL_ID,
  PANEL_TITLE,
  closePanel,
  openPanel,
  panelAfterToolEscape,
  readPanel,
  togglePanel,
  useConsolePanel,
  type ConsolePanel,
} from "@/lib/console/consolePanel";
import { inspectorRailStore, railEdge, railStep } from "@/lib/console/inspectorRail";
import { shouldHintRail, useSourcesRail } from "@/lib/console/sourcesRail";
import { mapControlGroups } from "@/lib/console/mapControls";
import { isMac, useKeymap } from "@/lib/shell/keymap";
import {
  AlertGlyph,
  DrawGlyph,
  HelpGlyph,
  LayersGlyph,
  PinGearGlyph,
  ViewGlyph,
} from "@/components/shell/inspector/ToolIcons";

const CONTROLS_ID = "tn-console-controls";
const NAV = 'nav[data-rail="console"]';
/** Every row, in the order the arrow keys walk them. The menu button comes first. */
const WALK = ["menu", "sources", "inspector", "settings", "draw", "alerts", "controls"] as const;
type WalkId = (typeof WALK)[number];

function rowEl(id: WalkId | ConsolePanel): HTMLElement | null {
  const selector = id === "menu" ? `${NAV} [data-rail-menu]` : `${NAV} [data-rail-entry="${id}"]`;
  return document.querySelector<HTMLElement>(selector);
}

function ControlsPopover({ onClose }: { onClose: () => void }) {
  const keymap = useKeymap();
  const ref = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => mapControlGroups(keymap, isMac()), [keymap]);

  // A press anywhere else closes it. The row that opens it is left out, or that press would
  // close it here and open it again there.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (ref.current?.contains(target) || target?.closest?.(`${NAV} [data-rail-entry="controls"]`)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [onClose]);

  return (
    // A GROUP, NOT A DIALOG. ConsoleShell hands every key to any `[role="dialog"]`, and this
    // holds no field and takes no focus, so the chords should keep working while it is up.
    <div ref={ref} id={CONTROLS_ID} className="tn-sidebar-controls" role="group" aria-label="Map controls">
      <h2 className="tn-sidebar-controls-title">Controls</h2>
      {groups.map((group) => (
        <section key={group.id} data-group={group.id}>
          <h3 className="tn-sidebar-controls-head">{group.title}</h3>
          <dl className="tn-sidebar-controls-list">
            {group.rows.map((row) => (
              <div key={row.does} className="tn-sidebar-controls-row">
                <dt>{row.does}</dt>
                <dd>{row.how}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

export default function ConsoleSidebar() {
  const panel = useConsolePanel();
  const rail = useSourcesRail();
  const narrow = useRailNarrow();
  const { object } = useOverlay();
  const drawing = useAoiDraw();
  const [controls, setControls] = useState(false);

  const closeControls = useCallback(() => setControls(false), []);

  // Read through refs so the Escape listener is added once, not on every change.
  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  const drawingRef = useRef(drawing.active);
  drawingRef.current = drawing.active;

  // ── A row was chosen ──────────────────────────────────────────────────────
  // A keyboard opener moves into the panel, so Tab goes on from its title. A pointer stays
  // where it is: focus is not where a mouse user is looking.
  const focusTitle = useRef(false);
  const choose = (id: ConsolePanel) => {
    const row = rowEl(id);
    focusTitle.current = !!row?.matches(":focus-visible");
    setControls(false);
    // Close the phone's sheet first, so the panel is not opened underneath it. The call
    // changes nothing on a wide screen.
    closeRail("console");
    togglePanel(id);
  };

  const onControls = () => {
    closeRail("console");
    setControls((v) => !v);
  };

  // ── Focus follows the panel ───────────────────────────────────────────────
  // A panel that closes drops focus onto <body> if focus was inside it, which is a keyboard
  // user thrown back to the top of the page. It goes to the row that opened the panel, or to
  // the ☰ on a phone, where the row is hidden. A host that moved focus somewhere else keeps
  // it there.
  const lastPanel = useRef(panel);
  useEffect(() => {
    const was = lastPanel.current;
    lastPanel.current = panel;
    if (was === panel) return;
    if (panel && focusTitle.current) {
      focusTitle.current = false;
      document.getElementById(CONSOLE_PANEL_ID)?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
      return;
    }
    const active = document.activeElement;
    if (was && (!active || active === document.body)) {
      rowEl(narrow ? "menu" : (panel ?? was))?.focus({ preventScroll: true });
    }
  }, [panel, narrow]);

  // ── Escape: the ladder is in this file's header ───────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (controlsRef.current) {
        e.preventDefault();
        e.stopPropagation();
        setControls(false);
        rowEl("controls")?.focus({ preventScroll: true });
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("[data-owns-escape]")) return;
      if (drawingRef.current) return;
      if (railOpenStore.isSheet("console")) return;
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if ([...dialogs].some((d) => !d.closest(`#${CONSOLE_PANEL_ID}`))) return;

      const tool = inspectorRailStore.get();
      if (!tool || readPanel() !== tool) return;
      e.preventDefault();
      e.stopPropagation();
      const next = panelAfterToolEscape(overlay.get().object != null);
      if (next) openPanel(next);
      else closePanel();
      rowEl(tool)?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // ── The phone's strip starts under the header ─────────────────────────────
  // The column is `position: fixed` on a phone, so it cannot take its top from the workspace
  // it sits in. The header's height is the header's to change, so it is measured, not typed.
  useEffect(() => {
    if (!narrow) return;
    const root = document.documentElement;
    const shell = document.querySelector<HTMLElement>(".tn-cw-shell");
    if (!shell) return;
    const place = () => root.style.setProperty("--tn-workspace-top", `${shell.getBoundingClientRect().top}px`);
    place();
    const ro = new ResizeObserver(place);
    ro.observe(shell);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      root.style.removeProperty("--tn-workspace-top");
    };
  }, [narrow]);

  // ── Arrow keys ────────────────────────────────────────────────────────────
  // Up and down walk the rows and Home and End reach the ends. Enter and Space open, which
  // the buttons do by themselves. Every row stays a Tab stop as well.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-rail-entry], [data-rail-menu]");
    if (!row) return;
    const from = (row.hasAttribute("data-rail-menu") ? "menu" : row.dataset.railEntry) as WalkId;
    let next: WalkId | null = null;
    if (e.key === "ArrowDown") next = railStep(WALK, from, 1);
    else if (e.key === "ArrowUp") next = railStep(WALK, from, -1);
    else if (e.key === "Home") next = railEdge(WALK, "first");
    else if (e.key === "End") next = railEdge(WALK, "last");
    if (!next) return;
    e.preventDefault();
    rowEl(next)?.focus();
  };

  const item = (id: ConsolePanel, icon: React.ReactNode, badge?: React.ReactNode): RailEntry => ({
    kind: "action",
    id,
    label: PANEL_TITLE[id],
    icon,
    active: panel === id,
    controls: CONSOLE_PANEL_ID,
    badge,
    onClick: () => choose(id),
  });

  const entries: RailEntry[] = [
    item("sources", <LayersGlyph />),
    // THE DOT SAYS SOMETHING IS WAITING HERE: an object is selected and its view is covered
    // by another panel, or by none. Otherwise a closed panel hides that the map still holds
    // a selection.
    item(
      "inspector",
      <ViewGlyph />,
      object && panel !== "inspector" ? (
        <span className="tn-sidebar-dot" data-testid="inspector-dot">
          <span className="tn-sr-only">Selection open</span>
        </span>
      ) : undefined,
    ),
    { kind: "rule", id: "rule-map" },
    item("settings", <PinGearGlyph />),
    item("draw", <DrawGlyph />),
    { kind: "rule", id: "rule-notify" },
    item("alerts", <AlertGlyph />),
  ];

  const foot: RailEntry[] = [
    {
      kind: "action",
      id: "controls",
      label: "Controls",
      icon: <HelpGlyph />,
      active: controls,
      controls: CONTROLS_ID,
      onClick: onControls,
    },
  ];

  return (
    <div className="tn-sidebar" data-hint={shouldHintRail(rail) ? "" : undefined} onKeyDown={onKeyDown}>
      <SideRail
        surface="console"
        tone="skin"
        label="Dashboard tools"
        menuLabel="Menu"
        entries={entries}
        foot={foot}
      />
      {controls && <ControlsPopover onClose={closeControls} />}
    </div>
  );
}
