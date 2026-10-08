"use client";
// The filters that a typed question put on the map, as chips, on the map.
//
// The command palette reads a question into filters and closes. From then on this
// bar is where the user sees them: one chip for each filter that has an effect now,
// and each chip is a button that removes its filter. A filter that the user cannot
// see is the failure this bar is here to prevent, so it renders from the live
// stores (lib/shell/askApplied.ts) and shows nothing when nothing is filtered.
//
// The palette mounts the same list under its input, so the filters are in reach
// from the keyboard without leaving the palette.
//
// ONE BUTTON FOR EACH CHIP. The whole chip is the control: Tab reaches it, and
// Enter, Space, Delete or Backspace removes it. Its name says the effect ("Remove
// filter: Time, Last 24 hours") and its tooltip says what the filter does.

import { KIND_LABEL } from "@/lib/shell/ask";
import { removeApplied, useAppliedChips, type AppliedChip } from "@/lib/shell/askApplied";

export function AppliedChipButton({ chip, onRemoved }: { chip: AppliedChip; onRemoved?: () => void }) {
  // The button goes away with its filter, and focus would fall to the page. So it
  // moves first: to where the caller says (the palette's input), or to the chip
  // beside this one, so a keyboard user can remove the next filter from where they are.
  const remove = (from: HTMLElement) => {
    const li = from.closest("li");
    const beside = (li?.nextElementSibling ?? li?.previousElementSibling)?.querySelector<HTMLElement>("button");
    removeApplied(chip);
    if (onRemoved) onRemoved();
    else beside?.focus();
  };
  return (
    <button
      type="button"
      className="tn-ask-chip is-applied"
      data-kind={chip.kind}
      data-ask-chip=""
      title={`${chip.note} Press to remove this filter.`}
      aria-label={`Remove filter: ${KIND_LABEL[chip.kind]}, ${chip.label}`}
      onClick={(e) => remove(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          remove(e.currentTarget);
        }
      }}
    >
      <span className="tn-ask-chip-kind">{KIND_LABEL[chip.kind]}</span>
      <span className="tn-ask-chip-label">{chip.label}</span>
      <span className="tn-ask-chip-x" aria-hidden="true">×</span>
    </button>
  );
}

/** The chip list alone. The palette puts it under its input. */
export function AppliedChipList({ chips, onRemoved }: { chips: readonly AppliedChip[]; onRemoved?: () => void }) {
  return (
    <ul className="tn-ask-chips">
      {chips.map((chip) => (
        <li key={chip.key}>
          <AppliedChipButton chip={chip} onRemoved={onRemoved} />
        </li>
      ))}
    </ul>
  );
}

/** The bar on the map. */
export default function AskChips() {
  const chips = useAppliedChips();
  if (chips.length === 0) return null;
  return (
    <section className="tn-askbar" aria-label="Filters on the map" data-testid="ask-applied">
      <span className="tn-askbar-title" aria-hidden="true">Filters</span>
      <AppliedChipList chips={chips} />
    </section>
  );
}
