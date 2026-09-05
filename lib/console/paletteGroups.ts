// Pure grouping + filter + ordering + active-state resolution for the ⌘K command
// palette. Deliberately import-light — no React, no stores — so the palette
// component stays thin and this logic unit-tests fast. CommandPalette.tsx owns the
// command definitions and rendering; this owns the shape (Command), the data-driven
// section PRIORITY, how a query slices commands into groups, and how the currently
// active/toggled state is resolved onto each command.
//
// ── Re-tuning priority (the one-line knob the owner asked for) ──────────────────
// Section order is driven ENTIRELY by SECTION_PRIORITY + WIDGET_CATEGORY_ORDER +
// POPULAR_WIDGET_IDS below (lower number = earlier). To resurface a section, bump
// its number; to reorder the widget catalogue, reorder WIDGET_CATEGORY_ORDER; to
// change which widgets float to the top "Popular" fast-path, edit POPULAR_WIDGET_IDS.
// Nothing else needs touching — buildCommands + groupCommands read these.

/**
 * A palette section key. Fixed chrome sections (Profiles, Go to, …) plus the
 * dynamic widget-catalogue sections, whose key is either "Popular widgets" or a
 * widget category name ("Aviation", "Natural hazards", …). Kept a plain string so
 * the catalogue can grow new categories without editing a union.
 */
export type CommandGroup = string;

export interface Command {
  id: string;
  label: string;
  hint: string;
  group: CommandGroup;
  run: () => void;
  /** Single-select "this is the current choice" — renders a ✓ + active row. */
  active?: boolean;
  /** Short right-aligned state pill, e.g. "ON" / "OFF" / "LIGHT". */
  state?: string;
}

export interface GroupedCommands {
  group: CommandGroup;
  commands: Command[];
}

/**
 * Data-driven section priority (LOWER = earlier). This is the primary re-tune knob.
 * The widget-catalogue categories are NOT listed here — they occupy the 40–42 band
 * via WIDGET_CATEGORY_ORDER so the whole catalogue sits between "Map layers" and
 * "Go to". Ordered most-used-first per the owner's brief: profiles → common/focus
 * widgets → layer toggles → catalogue → basemap/stage → workspace.
 */
export const SECTION_PRIORITY: Record<string, number> = {
  Profiles: 10,
  "Popular widgets": 20,
  "Open widgets": 25,
  "Map layers": 30,
  // widget categories: 40 + index * 0.1  (see sectionPriority)
  "Go to": 48,
  "Layer sets": 52,
  Basemap: 60,
  Stage: 62,
  Scenarios: 70,
  Appearance: 80,
  Workspace: 90,
};

/**
 * The widget catalogue's categories, most-used first. Index drives priority within
 * the 40–42 band, so reordering this list reorders the catalogue. Any category NOT
 * listed sorts to the end of the band (still grouped, just last). Categories whose
 * every widget was pulled into POPULAR_WIDGET_IDS simply don't render (no empties).
 */
export const WIDGET_CATEGORY_ORDER: string[] = [
  "Synthesis",
  "Events",
  "News",
  "Aviation",
  "Cameras",
  "Markets",
  "Space",
  "Natural hazards",
  "Conflict",
  "Intel",
  "Military",
  "Maritime",
  "Space weather",
  "Infrastructure",
  "Cyber threat",
  "Human cost",
  "Civic safety",
  "Environment",
  "Weather",
  "Tools",
];

/**
 * Widgets that float OUT of their category into the cross-category "Popular widgets"
 * fast-path at the top of the catalogue, in this display order. A widget listed here
 * appears ONCE (in Popular), never also in its home category — so command ids stay
 * unique and there's no duplication. Re-tune by editing this list.
 */
export const POPULAR_WIDGET_IDS: string[] = [
  "anomaly", // What's abnormal — the cross-layer triage flagship
  "events", // Disasters & Events
  "signal:instability", // Country Instability Index
  "camslot", // Camera wall — replaced the retired "cameras" grid
  "aviation",
  "markets",
  "headlines", // World Headlines
  "signal:gdacs", // Disaster alerts
];

const WIDGET_CATEGORY_BASE = 40;

/** Priority for a section key — fixed chrome first, then the catalogue band. */
export function sectionPriority(group: CommandGroup): number {
  if (group in SECTION_PRIORITY) return SECTION_PRIORITY[group];
  const idx = WIDGET_CATEGORY_ORDER.indexOf(group);
  if (idx >= 0) return WIDGET_CATEGORY_BASE + idx * 0.1; // 40.0 … 41.9 (< 48 "Go to")
  return WIDGET_CATEGORY_BASE + WIDGET_CATEGORY_ORDER.length * 0.1; // unknown category → just after the last known, still in-band
}

/** The section a catalogue widget belongs to: the Popular fast-path, else its category. */
export function assignWidgetSection(widget: { id: string; category: string }, popularIds: string[]): CommandGroup {
  return popularIds.includes(widget.id) ? "Popular widgets" : widget.category;
}

/** Sort already-grouped sections by the data-driven priority (stable for ties). */
export function orderGroups(groups: GroupedCommands[]): GroupedCommands[] {
  return [...groups].sort((a, b) => sectionPriority(a.group) - sectionPriority(b.group));
}

/**
 * Slice commands into priority-ordered sections, applying a case-insensitive
 * substring filter over each command's label + hint. A blank query keeps every
 * command. Groups that end up empty are dropped; the surviving groups are ordered by
 * sectionPriority(), and within a group the incoming command order is preserved.
 */
export function groupCommands(commands: Command[], query: string): GroupedCommands[] {
  const q = query.trim().toLowerCase();
  const matches = (c: Command) =>
    !q || c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q);

  const order: CommandGroup[] = [];
  const byGroup = new Map<CommandGroup, Command[]>();
  for (const c of commands) {
    if (!matches(c)) continue;
    if (!byGroup.has(c.group)) { byGroup.set(c.group, []); order.push(c.group); }
    byGroup.get(c.group)!.push(c);
  }
  return orderGroups(order.map((g) => ({ group: g, commands: byGroup.get(g)! })));
}

// ── Active / toggled state resolution ─────────────────────────────────────────
// A snapshot of every stateful choice the palette can reflect. buildCommands reads
// the live stores into this shape; decorate() stamps active/state onto each command
// purely from its id, so "what's currently on" is testable without React or stores.

export interface PaletteSnapshot {
  basemap: string;
  stage: string;
  lang: string;
  /** Core map-layer key → on. */
  layers: Record<string, boolean>;
  activePresetId: string | null;
  activeVariantId: string;
  /** Which LAYER_PRESETS id the current layer state matches, or null. */
  activeLayerSet: string | null;
}

const on = (c: Command, isOn: boolean): Command => ({ ...c, active: isOn, state: isOn ? "ON" : "OFF" });
const sel = (c: Command, isSel: boolean): Command => (isSel ? { ...c, active: true } : c);

/**
 * Stamp a single command with its current active/toggle state, keyed by its id.
 * Unknown / stateless commands (add-, focus-, jump-, geo-, save-, reset-…) pass
 * through untouched.
 */
export function decorateCommand(c: Command, s: PaletteSnapshot): Command {
  if (c.id.startsWith("basemap-")) return sel(c, c.id.slice(8) === s.basemap);
  if (c.id.startsWith("stage-")) return sel(c, c.id.slice(6) === s.stage);
  if (c.id.startsWith("cpreset-")) return sel(c, c.id.slice(8) === s.activePresetId);
  if (c.id.startsWith("variant-")) return sel(c, c.id.slice(8) === s.activeVariantId);
  if (c.id.startsWith("lang-")) return sel(c, c.id.slice(5) === s.lang);
  if (c.id.startsWith("preset-")) return sel(c, c.id.slice(7) === s.activeLayerSet);
  if (c.id.startsWith("toggle-")) return on(c, !!s.layers[c.id.slice(7)]);
  return c;
}

/** Stamp active/toggle state onto a whole command list. */
export function decorate(commands: Command[], s: PaletteSnapshot): Command[] {
  return commands.map((c) => decorateCommand(c, s));
}

/**
 * The id of the first layer-set whose on/off state exactly matches `current`, or
 * null when the live layers match no named set (an honest "custom" state). Compares
 * the union of keys so an extra layer being on (e.g. webcams) correctly means
 * "no set matches".
 */
export function matchingSetId(
  current: Record<string, boolean>,
  sets: { id: string; state: Record<string, boolean> }[],
): string | null {
  for (const s of sets) {
    const keys = new Set([...Object.keys(current), ...Object.keys(s.state)]);
    let eq = true;
    for (const k of keys) {
      if (!!current[k] !== !!s.state[k]) { eq = false; break; }
    }
    if (eq) return s.id;
  }
  return null;
}

/**
 * Lay the (already ordered) sections out across `columnCount` side-by-side columns
 * for the mega-menu palette — sections stay whole (never split) and keep their order,
 * flowing left-to-right. Each section lands in the column its running "centre of mass"
 * falls into, then clamped so columns fill sequentially with no gaps and no backwards
 * jumps. The result reads column-major (top of col 0 → bottom, then col 1 …), which is
 * exactly the order ↑/↓ walks in the palette. Columns beyond the section count collapse
 * away, so a 2-section filter never renders 3 empty columns.
 */
export function columnize(sections: GroupedCommands[], columnCount: number): GroupedCommands[][] {
  if (sections.length === 0) return [];
  const n = Math.max(1, Math.min(columnCount, sections.length));
  const cols: GroupedCommands[][] = Array.from({ length: n }, () => []);
  const total = sections.reduce((s, g) => s + g.commands.length, 0);
  const target = total / n; // items per column, on average
  let col = 0;
  let colWeight = 0;
  for (let i = 0; i < sections.length; i++) {
    const remaining = sections.length - i; // sections still to place, incl. this one
    if (col < n - 1 && colWeight > 0) {
      const emptyAfter = n - 1 - col; // columns after the current one still needing content
      // Forced: keeping this section here would strand a trailing column empty.
      const forced = remaining - 1 < emptyAfter;
      // Balanced: current column has met its share and advancing won't strand columns.
      const balanced = colWeight >= target && remaining - 1 >= emptyAfter;
      if (forced || balanced) { col += 1; colWeight = 0; }
    }
    cols[col].push(sections[i]);
    colWeight += sections[i].commands.length;
  }
  return cols;
}
