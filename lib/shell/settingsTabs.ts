// THE SETTINGS DRAWER'S THREE TABS, AND THE ARROW ARITHMETIC BEHIND THE STRIP.
//
// Pure, and nothing touches window/document at module scope — the same rule
// lib/shell/keymap.ts states for itself, so importing this on the server or under the
// node vitest environment is inert.
//
// THE TAB LIST LIVES HERE, NOT IN SettingsPanel, because two things read it: the strip
// that renders the buttons, and tests/e2e/shortcuts.spec.ts, which clicks a tab by its
// accessible name. A label typed in both places is a label that gets renamed in one.

export type SettingsTabId = "main" | "display" | "shortcuts";

/**
 * The tabs, in rail order.
 *
 * MAIN IS FIRST AND IS THE LANDING TAB. Rebinding a key is a one-off — you set Ctrl+G
 * once and never come back — while the notification rules and the alert channels are the
 * surface people return to. Ordering the rail so the rare visit opens first would tax
 * the common one.
 *
 * `blurb` IS THE ONE PIECE OF NEW COPY THE RAIL ADDED, and it was not invented: each line
 * is the sentence the tab's own file header already opened with, moved somewhere the user
 * can read it. The rail took the drawer's title into its own column, which left the panel
 * header holding nothing but the ✕; this is what that bar says instead of standing empty.
 * Keep it descriptive. It names what the tab governs — it must never grow into a claim
 * about what the console does.
 */
export const SETTINGS_TABS: { id: SettingsTabId; label: string; blurb: string }[] = [
  { id: "main", label: "Main", blurb: "Where alerts go" },
  { id: "display", label: "Display", blurb: "What the console shows you" },
  { id: "shortcuts", label: "Shortcuts", blurb: "The keys that are yours" },
];

/**
 * Pure: which tab a key moves to from `current`, or null when the key is not ours.
 *
 * BOTH AXES ARE LIVE, AND THAT IS NOT LAZINESS. The list is a vertical rail on the left of
 * the drawer, and below 540px it folds back into a horizontal strip above the panel — so
 * there is no single "correct" arrow axis to pick. WAI-APG asks a vertical tablist for
 * ↑/↓ and a horizontal one for ←/→; answering to both means the same handler is right at
 * both widths and a user who learned one axis never finds it dead at the other. It costs
 * nothing, because the rail holds buttons only: unlike the shell's global handler, there
 * is no caret in here for ← to hijack.
 *
 * WRAPS AT BOTH ENDS, which is the WAI-ARIA tab pattern, and is also the only behaviour
 * that reads as finished on a three-item list — stopping dead on the last tab feels like
 * a key that failed rather than a boundary that was reached.
 *
 * NULL RATHER THAN `current` FOR AN UNHANDLED KEY, and that is the load-bearing part: the
 * handler uses the null to decide whether to call preventDefault. Returning the current
 * tab for every key would make the rail swallow Tab and Escape along with the arrows,
 * which is how a tablist traps a keyboard user.
 */
export function nextTabId(
  tabs: readonly { id: SettingsTabId }[],
  current: SettingsTabId,
  key: string,
): SettingsTabId | null {
  if (tabs.length === 0) return null;
  const i = tabs.findIndex((t) => t.id === current);
  if (i < 0) return null;
  if (key === "ArrowDown" || key === "ArrowRight") return tabs[(i + 1) % tabs.length].id;
  if (key === "ArrowUp" || key === "ArrowLeft") return tabs[(i - 1 + tabs.length) % tabs.length].id;
  if (key === "Home") return tabs[0].id;
  if (key === "End") return tabs[tabs.length - 1].id;
  return null;
}
