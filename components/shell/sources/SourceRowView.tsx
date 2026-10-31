"use client";
// One source, one line, as DRAWING and nothing else: dot · label · ＋ · switch, and the
// popover that says where its data comes from.
//
// This is the markup SourceRow.tsx used to hold, moved here. The console's rail (SourceRow)
// and the God's eye view's Sources tray (components/eye/EyeSources.tsx) both draw their rows
// through it, so the two cannot drift apart: same classes, same dot, same switch, same
// popover surface. What each one MEANS is theirs to say, and arrives as props:
//   - the console's ＋ places a widget on the dashboard, its switch paints the map layer,
//     its row lights its marks while you point at it (SourceRow's `rowProps`), and its
//     popover is drawn in the shell, beside the rail;
//   - the tray's ＋ pins the source to the sidebar, its switch shows it in this view, and its
//     popover hangs under the row.
// So the view holds NO state of its own: the popover's open state, its id and its handlers
// are the caller's, because the console's decides things this view cannot see (a preview, a
// hover light).
//
// IT IMPORTS NOTHING FROM THE CONSOLE'S WIDGET, PLACEMENT, STATUS OR REGISTRY MODULES.
// /eye loads this file in the browser, and those modules carry the whole widget registry
// with them (tests/unit/eye-sources-bundle.test.ts holds the line). The pieces that need
// them, the provenance chip and the locked badge, are SourceRow's and reach the popover
// through `pop`.
//
// TOUCH HAS NO HOVER, so a caller opens the popover on pointerenter AND on focus AND on tap
// of the label, and the label is a real <button>. Without that a phone user could never see
// where a layer's data comes from, which is the claim this product is built on.

import type { ReactNode } from "react";

/** The three things a row needs to know about a source to draw it. */
export interface SourceRowViewRow {
  id: string;
  label: string;
  color: string;
}

/** The ＋ beside the label. */
export interface SourceRowSlot {
  /** Filled (`data-placed`): the console's widget is open, or the tray's pin is in the sidebar. */
  placed: boolean;
  disabled?: boolean;
  ariaLabel: string;
  title?: string;
  /** Set where the ＋ is a toggle (the tray's pin): `aria-pressed`. Absent on the console's. */
  pressed?: boolean;
  onPress: () => void;
}

/** What a caller may put on the row itself: its handlers, `aria-*` and `data-*` (a preview's state). */
export type SourceRowProps = Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "style" | "children" | "onPointerDown"> & {
  [key: `data-${string}`]: string | undefined;
};

export default function SourceRowView({
  row,
  on,
  slot,
  onToggle,
  toggleLabel,
  toggleDisabled,
  open,
  popoverId,
  labelProps,
  pop,
  onPointerDown,
  grip,
  extra,
  rowRef,
  rowProps,
}: {
  row: SourceRowViewRow;
  on: boolean;
  slot: SourceRowSlot;
  /** Absent: the row has no map layer, so it has no switch (a widget-only row). */
  onToggle?: () => void;
  toggleLabel: string;
  /** A switch that cannot do anything here says so instead of doing nothing. */
  toggleDisabled?: boolean;
  /** The popover is open: the label says so (`aria-expanded`) and names it (`aria-describedby`). */
  open: boolean;
  popoverId: string;
  /** The label's own handlers: the popover opens on focus and on a tap. */
  labelProps?: Pick<React.ButtonHTMLAttributes<HTMLButtonElement>, "onFocus" | "onBlur" | "onClick">;
  /** Drawn last in the row: the popover itself, or a portal of it. Null while it is shut. */
  pop: ReactNode;
  /** A press that lands on a control is that control's, not the drag's: the caller guards. */
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  /** A phone's drag handle (⋮⋮) before the dot. */
  grip?: boolean;
  /** After the label: the tray's detail line. */
  extra?: ReactNode;
  rowRef?: React.Ref<HTMLDivElement>;
  rowProps?: SourceRowProps;
}) {
  return (
    <div
      {...rowProps}
      ref={rowRef}
      className="tn-src-row"
      data-source-row={row.id}
      data-on={on}
      style={{ ["--tn-src-dot" as string]: row.color }}
      onPointerDown={onPointerDown}
    >
      {grip ? (
        <span className="tn-src-grip" aria-hidden>
          ⋮⋮
        </span>
      ) : null}
      <span className="tn-src-dot" aria-hidden />
      <button
        type="button"
        className="tn-src-label"
        title={row.label}
        aria-expanded={open}
        aria-describedby={open ? popoverId : undefined}
        {...labelProps}
      >
        {row.label}
      </button>
      {extra}
      <button
        type="button"
        className="tn-src-add"
        data-source-add={row.id}
        data-placed={slot.placed}
        disabled={slot.disabled}
        aria-label={slot.ariaLabel}
        aria-pressed={slot.pressed}
        title={slot.title}
        onClick={slot.onPress}
      >
        ＋
      </button>
      {/*
        A widget-only row has no map layer, so it has no toggle. Rendering a
        switch labelled "Show X on the map" beside something the map cannot draw
        would be a control that lies; worse, the rail's onToggle falls through to
        signalsStore for any id it does not recognise, so the switch would have
        written a phantom signal and then reported itself as off.
      */}
      {onToggle ? (
        <button
          type="button"
          className="tn-src-toggle"
          role="switch"
          aria-checked={on}
          aria-label={toggleLabel}
          disabled={toggleDisabled}
          onClick={onToggle}
        />
      ) : (
        <span className="tn-src-toggle-none" aria-hidden />
      )}
      {pop}
    </div>
  );
}
