"use client";
// The colour picker for ONE drawn area, as a small popover anchored to that area's row.
//
// WHAT IT LOOKS LIKE AND WHY. A row of eight circles — the palette from
// lib/shell/areaColors.ts — with the area's current colour ringed, and a "Custom"
// control under them that opens the platform's own colour picker. That is the whole
// menu: the palette is the offer (eight colours picked to stay apart from each other
// and to survive being drawn over satellite imagery), and the custom field is there
// because someone will have a specific hex in mind and a fixed palette that refuses it
// is a palette that gets worked around by editing localStorage.
//
// A POPOVER RATHER THAN A ROW OF SWATCHES IN THE ROW. Eight circles per area, times
// forty areas, is a wall of colour in a list whose job is names; the popover keeps the
// row to one circle and shows the choice only while it is being made.
//
// role="dialog" IS NOT USED, and the reason is the same one the rail's own header
// gives: ConsoleShell's global keydown handler early-returns while any [role="dialog"]
// is mounted, so a dialog-flavoured popover would switch off "/" and the Escape ladder
// app-wide for as long as it was open. It is a non-modal panel over a list the user can
// still scroll, so it says so: role="group", with the focus ring doing the work.
//
// ESCAPE IS OURS, AND THE RAIL HAS TO KNOW. The rail's Escape handler is capture phase
// on window, so it sees the key before this component does — hence `data-owns-escape`
// on the root, which is the documented stand-down (see InspectorRail.tsx's ladder).
// Without it, Escape with the picker open would close the whole panel behind it.

import { useEffect, useRef } from "react";
import { AREA_COLORS, areaColorName } from "@/lib/shell/areaColors";
import type { InspectorArea } from "@/lib/shell/inspector";

export default function AreaColorPicker({
  area,
  id,
  onPick,
  onClose,
}: {
  area: InspectorArea;
  /** Referenced by the swatch's aria-controls. Passed in rather than invented here,
      because the button that opens this is the thing that has to name it. */
  id: string;
  onPick: (hex: string) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const firstRef = useRef<HTMLButtonElement | null>(null);

  // Focus lands on the current colour, or the first one when it is a custom hex that
  // is not in the palette. Somewhere real for a keyboard user, and it means Escape has
  // something to hand focus back from.
  useEffect(() => {
    const target =
      rootRef.current?.querySelector<HTMLButtonElement>("[aria-checked='true']") ?? firstRef.current;
    target?.focus();
    // Only on mount: `area.color` changes as the user picks, and re-focusing on every
    // change would fight the click that caused it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close on an outside press. `pointerdown` rather than `click`, so the popover is
  // gone before the click lands on whatever is underneath it.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [onClose]);

  // Arrow keys walk the palette, Home/End jump to its ends. The swatches are a
  // radiogroup, so this is the WAI-APG pattern rather than an invention.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      // Ours: the rail stands down for it (see the header), so this is the only
      // handler that acts — and it must not reach the console's own ladder either.
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "ArrowDown" && e.key !== "ArrowUp") {
      return;
    }
    const dots = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>(".tn-insp-color-dot") ?? [],
    );
    if (dots.length === 0) return;
    e.preventDefault();
    const at = dots.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    dots[(at + step + dots.length) % dots.length]?.focus();
  };

  return (
    <div
      className="tn-insp-color-pop"
      id={id}
      role="group"
      aria-label={`Colour for ${area.label}`}
      ref={rootRef}
      data-owns-escape=""
      onKeyDown={onKeyDown}
    >
      <span className="tn-insp-color-head">Colour</span>

      <div className="tn-insp-color-grid" role="radiogroup" aria-label="Area colour">
        {AREA_COLORS.map((c, i) => (
          <button
            key={c.hex}
            type="button"
            role="radio"
            aria-checked={area.color === c.hex}
            aria-label={c.name}
            title={c.name}
            className="tn-insp-color-dot"
            style={{ ["--c" as string]: c.hex }}
            ref={i === 0 ? firstRef : undefined}
            onClick={() => onPick(c.hex)}
          />
        ))}
      </div>

      {/* The platform picker, behind a labelled row rather than a bare input: Chrome
          renders `type=color` as a small swatch with no text, which reads as a
          decoration next to eight real buttons until something names it. */}
      <label className="tn-insp-color-custom">
        <input
          type="color"
          value={area.color}
          aria-label="Custom colour"
          onChange={(e) => onPick(e.target.value)}
        />
        <span className="tn-insp-color-custom-text">
          Custom{areaColorName(area.color) === area.color ? ` — ${area.color}` : ""}
        </span>
      </label>
    </div>
  );
}
