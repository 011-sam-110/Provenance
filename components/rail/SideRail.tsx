"use client";
// THE SHARED SIDEBAR: one component, used by God's eye view and by the console. Each host
// passes its rows and its handlers; this file owns the column, its open state, its phone
// sheet and its accessibility, so the two views cannot drift apart.
//
// lib/rail/railOpen.ts holds the state and says why a saved "open" and a phone's sheet are
// two different things. rail.module.css holds the look and what a host can set.
//
// NEIGHBOURS MOVE; THE OPEN COLUMN NEVER COVERS THEM. The width goes out as `--rail-w` on
// <html>: 64px, 232px, or 0px on a phone. A neighbour reads `calc(var(--rail-w, 64px) + Npx)`
// and uses the same .18s transition. The property is removed on unmount.
//
// ESCAPE IS CAPTURE PHASE ON WINDOW, AND ONLY WHILE A SHEET IS OPEN. The sheet sits over
// everything else on a phone, so one press must close the sheet and nothing behind it. That
// rules out a later phase: EyeOverlay's camera card listens on `document`, its detail panel
// and ConsoleShell's ladder listen on `window` in the bubble phase, and all of those would
// act first or as well. This handler sets `preventDefault` for the listeners that look at
// `defaultPrevented`, and `stopPropagation` for the ladder, which does not. Other capture
// listeners on window that were added earlier run first, so a surface that already took the
// press has prevented its default and the sheet stands down (`sheetTakesEscape`).
//
// NOT A DIALOG. ConsoleShell hands every key to any `[role="dialog"]`, and this is a nav
// that happens to have a scrim on a phone. Tab stays inside the sheet by a small wrap below
// instead, because the page behind the scrim is not this component's to mark inert.

import { useEffect, useId, useRef } from "react";
import {
  RAIL_WIDTH_PROP,
  closeRail,
  railExpanded,
  railMenuName,
  railOpenStore,
  railWidth,
  sheetTakesEscape,
  useRailNarrow,
  useRailOpen,
  useRailSheet,
  type RailSurface,
} from "@/lib/rail/railOpen";
import styles from "./rail.module.css";

export type RailEntry =
  | {
      kind: "action";
      id: string;
      label: string;
      icon: React.ReactNode;
      onClick: () => void;
      active?: boolean;
      /** The id of the panel this row opens. Gives it aria-controls, and aria-expanded from `active`. */
      controls?: string;
      badge?: React.ReactNode;
    }
  | { kind: "switch"; id: string; label: string; icon: React.ReactNode; on: boolean; onClick: () => void }
  | {
      kind: "link";
      id: string;
      label: string;
      icon: React.ReactNode;
      href: string;
      /** Read when the link is pressed, focused or clicked, so the address is right at that moment. */
      refreshHref?: () => string;
    }
  | { kind: "rule"; id: string };

export interface SideRailProps {
  /** The open state is kept per surface. */
  surface: RailSurface;
  /** "dark" always, or "skin" to follow the console's skin. */
  tone: "dark" | "skin";
  /** The nav's accessible name. */
  label: string;
  /** The word beside the three bars when open. */
  menuLabel: string;
  /** The top of the column. */
  entries: RailEntry[];
  /** The bottom of the column. */
  foot: RailEntry[];
}

/** The icon, the label and whatever ends the row. The row clips this until the column opens. */
function RowBody({ icon, label, children }: { icon: React.ReactNode; label: string; children?: React.ReactNode }) {
  return (
    <span className={styles.inner}>
      <span className={styles.icon} aria-hidden>
        {icon}
      </span>
      <span className={styles.label}>{label}</span>
      {children}
    </span>
  );
}

function RailRow({ entry }: { entry: RailEntry }) {
  if (entry.kind === "rule") return <div className={styles.rule} role="separator" data-rail-entry={entry.id} />;

  let control: React.ReactNode;
  if (entry.kind === "switch") {
    control = (
      <button
        type="button"
        role="switch"
        aria-checked={entry.on}
        className={styles.row}
        data-rail-entry={entry.id}
        onClick={() => entry.onClick()}
      >
        <RowBody icon={entry.icon} label={entry.label}>
          <span className={styles.track} data-on={entry.on} aria-hidden>
            <span className={styles.knob} />
          </span>
        </RowBody>
      </button>
    );
  } else if (entry.kind === "link") {
    // A plain <a> and a full page load, like every way between the two maps. The address is
    // read as it is used, the same as `refreshExit` in components/eye/EyeHud.tsx.
    const refresh = (e: React.SyntheticEvent<HTMLAnchorElement>) => {
      if (entry.refreshHref) e.currentTarget.href = entry.refreshHref();
    };
    control = (
      <a
        className={styles.row}
        href={entry.href}
        data-rail-entry={entry.id}
        onPointerDown={refresh}
        onFocus={refresh}
        onClick={refresh}
      >
        <RowBody icon={entry.icon} label={entry.label} />
      </a>
    );
  } else {
    control = (
      <button
        type="button"
        className={styles.row}
        data-rail-entry={entry.id}
        data-active={entry.active ? "true" : undefined}
        aria-controls={entry.controls}
        aria-expanded={entry.controls ? !!entry.active : undefined}
        aria-pressed={!entry.controls && entry.active !== undefined ? entry.active : undefined}
        onClick={() => entry.onClick()}
      >
        <RowBody icon={entry.icon} label={entry.label}>
          {entry.badge != null && <span className={styles.badge}>{entry.badge}</span>}
        </RowBody>
      </button>
    );
  }

  return (
    <div className={styles.item}>
      {control}
      {/* The label again, for the eye only: the row's own text is already its name. */}
      <span className={styles.tip} data-rail-tip={entry.id} aria-hidden>
        {entry.label}
      </span>
    </div>
  );
}

export default function SideRail({ surface, tone, label, menuLabel, entries, foot }: SideRailProps) {
  const open = useRailOpen(surface);
  const sheet = useRailSheet(surface);
  const narrow = useRailNarrow();
  const expanded = railExpanded({ open, sheet, narrow });
  const width = railWidth({ expanded, narrow });
  const sheetOpen = narrow && sheet;

  const navRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const bodyId = useId();

  useEffect(() => {
    railOpenStore.hydrate();
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty(RAIL_WIDTH_PROP, width);
  }, [width]);

  useEffect(
    () => () => {
      document.documentElement.style.removeProperty(RAIL_WIDTH_PROP);
      closeRail(surface);
    },
    [surface],
  );

  // A window dragged from phone width to wide leaves no sheet waiting to come back.
  useEffect(() => {
    if (!narrow) closeRail(surface);
  }, [narrow, surface]);

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (!sheetTakesEscape(e)) return;
      e.preventDefault();
      e.stopPropagation();
      closeRail(surface);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sheetOpen, surface]);

  // The rows hide when the sheet closes, and a hidden element drops focus onto <body>, so
  // focus returns to the button. A host that moved focus somewhere else keeps it there.
  const wasSheetOpen = useRef(false);
  useEffect(() => {
    if (wasSheetOpen.current && !sheetOpen) {
      const active = document.activeElement;
      if (!active || active === document.body || navRef.current?.contains(active)) {
        menuRef.current?.focus({ preventScroll: true });
      }
    }
    wasSheetOpen.current = sheetOpen;
  }, [sheetOpen]);

  const onMenu = () => {
    if (narrow) railOpenStore.setSheet(surface, !sheet);
    else railOpenStore.toggle(surface);
  };

  const onNavKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!sheetOpen || e.key !== "Tab" || !navRef.current) return;
    const items = navRef.current.querySelectorAll<HTMLElement>("a[href], button");
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  return (
    <>
      {sheetOpen && <div className={styles.scrim} data-rail-scrim="" aria-hidden onClick={() => closeRail(surface)} />}
      <nav
        ref={navRef}
        className={tone === "skin" ? `${styles.rail} ${styles.skin}` : styles.rail}
        aria-label={label}
        data-rail={surface}
        data-tone={tone}
        data-expanded={expanded}
        onKeyDown={onNavKey}
      >
        <div className={`${styles.item} ${styles.menuItem}`}>
          <button
            ref={menuRef}
            type="button"
            className={`${styles.row} ${styles.menu}`}
            aria-label={railMenuName(menuLabel)}
            aria-expanded={expanded}
            aria-controls={bodyId}
            data-rail-menu=""
            onClick={onMenu}
          >
            <RowBody
              icon={
                <span className={styles.bars}>
                  <span />
                  <span />
                  <span />
                </span>
              }
              label={menuLabel}
            />
          </button>
          <span className={styles.tip} data-rail-tip="menu" aria-hidden>
            Menu
          </span>
        </div>
        <div className={styles.rule} role="separator" />
        <div id={bodyId} className={styles.body}>
          <div className={styles.group}>
            {entries.map((entry) => (
              <RailRow key={entry.id} entry={entry} />
            ))}
          </div>
          <div className={styles.group}>
            {foot.map((entry) => (
              <RailRow key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      </nav>
    </>
  );
}
