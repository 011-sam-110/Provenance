"use client";
// The command palette — search-and-jump plus quick layer control. A calm,
// keyboardless door now: it opens from the header's SHORTCUTS button. ⌘K used to
// open it and belongs to the Sources rail since the keymap landed (lib/shell/keymap.ts).
// keyboard-first way to compose the view: toggle a layer, apply a preset, switch
// basemap, or fly to a covered region. Open/close is owned by ConsoleShell.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { layersStore, ACTIVE_LAYERS, useLayers, type LayerKey } from "@/lib/layers";
import { mapViewStore, useMapView } from "@/lib/mapView";
import { BASEMAPS, type BasemapKey } from "@/lib/basemaps";
import { CAMERA_REGIONS } from "@/lib/icons/svg";
import { cinematic } from "@/lib/cinematic/store";
import { pickLiveCamera } from "@/lib/cinematic/livePick";
import { loadedCamerasStore } from "@/lib/cameras/loaded";
import "@/lib/console/widgets";
import { widgetsByCategory, getWidgetType } from "@/lib/console/registry";
import { shellLayoutStore, useShellLayout } from "@/lib/console/store";
import type { StageId } from "@/lib/console/types";
import { placementStore } from "@/lib/console/placement";
import { listPresets, applyPreset, saveCustomPreset, resetActiveBoard } from "@/lib/console/presets";
import { activePresetStore, useActivePreset } from "@/lib/console/activePreset";
import { encodeLayout } from "@/lib/console/share";
import { uiStore, useUI } from "@/lib/shell/ui";
import { langStore, useLang } from "@/lib/i18n/store";
import { LANGS } from "@/lib/i18n/catalog";
import { variantStore, useVariant } from "@/lib/variants/store";
import { BUILTIN_VARIANTS } from "@/lib/variants/builtins";
import {
  groupCommands,
  columnize,
  orderGroups,
  decorate,
  assignWidgetSection,
  POPULAR_WIDGET_IDS,
  type Command,
  type PaletteSnapshot,
} from "@/lib/console/paletteGroups";
import type { GeocodeResult } from "@/lib/geo/geocode";

// Pick a fly-to zoom from a geocode result's extent (wider areas frame out).
function zoomForResult(r: GeocodeResult): number {
  if (!r.bbox) return 11;
  const [w, s, e, n] = r.bbox;
  const span = Math.max(Math.abs(e - w), Math.abs(n - s));
  if (span > 4) return 5;
  if (span > 1) return 7;
  if (span > 0.2) return 9;
  if (span > 0.04) return 11;
  return 13;
}

const LAYER_NAMES: Record<LayerKey, string> = {
  cameras: "Cameras",
  planes: "Planes",
  satellites: "Satellites",
  ships: "Ships",
  webcams: "Webcams",
  weather: "Weather",
  countries: "Borders & names",
};

function buildCommands(close: () => void): Command[] {
  const cmds: Command[] = [];

  // ── Profiles: apply a persona workspace (the fast path to a full board) ──
  for (const p of listPresets()) cmds.push({ id: `cpreset-${p.id}`, label: `${p.icon} ${p.title}`, hint: p.blurb, group: "Profiles", run: () => { applyPreset(p.id); close(); } });

  // ── Go to: fly to a covered region, dive to a live feed ─────────────────
  for (const r of CAMERA_REGIONS) {
    if (!r.view) continue;
    const view = r.view;
    cmds.push({
      id: `jump-${r.source}`,
      label: `Fly to ${r.label}`,
      hint: "region",
      group: "Go to",
      run: () => {
        mapViewStore.flyTo(view);
        close();
      },
    });
  }

  cmds.push({
    id: "dive-live",
    label: "Dive to a live feed",
    hint: "live",
    group: "Go to",
    run: () => {
      const cam = pickLiveCamera(loadedCamerasStore.get());
      if (cam) {
        cinematic.dive({
          kind: "camera",
          id: cam.id,
          lat: cam.lat,
          lon: cam.lon,
          label: cam.name,
          meta: { available: true },
        });
      }
      close();
    },
  });

  // ── Add widget: a cross-category "Popular widgets" fast-path, then the rest of
  //    the catalogue split into per-category sections (was ONE 40-item flat wall).
  //    Section = POPULAR_WIDGET_IDS ? "Popular widgets" : the widget's category, so
  //    each widget appears exactly once and command ids stay `add-<type>` (unchanged
  //    → deep links / presets / ?c= share unaffected). Which widgets float up and how
  //    categories order is data-driven in lib/console/paletteGroups.ts.
  const catalog = widgetsByCategory();
  const byWidgetId = new Map<string, { title: string; category: string; defaultConfig: Record<string, unknown>; defaultHeight: number }>();
  for (const g of catalog) for (const t of g.types) byWidgetId.set(t.id, { title: t.title, category: g.category, defaultConfig: t.defaultConfig, defaultHeight: t.defaultHeight });
  const addWidgetCmd = (id: string, meta: { title: string; category: string; defaultConfig: Record<string, unknown>; defaultHeight: number }) => {
    const openCount = shellLayoutStore.get().widgets.filter((w) => w.type === id).length;
    cmds.push({
      id: `add-${id}`,
      label: `Add ${meta.title}${openCount ? ` (${openCount} open)` : ""}`,
      hint: meta.category.toLowerCase(),
      group: assignWidgetSection({ id, category: meta.category }, POPULAR_WIDGET_IDS),
      // Asks which rail, like every other add path — the palette closes first so
      // the picker is not left behind a modal that is dismissing itself. The
      // capacity cap is raised by the picker's commit now that the add lives
      // there, so the local alertCapacity() helper went with the add it served.
      run: () => { close(); placementStore.ask({ type: id, label: meta.title, config: { ...meta.defaultConfig }, height: meta.defaultHeight }); },
    });
  };
  // Popular first, in the curated order; then everything else in category order.
  for (const id of POPULAR_WIDGET_IDS) { const m = byWidgetId.get(id); if (m) addWidgetCmd(id, m); }
  for (const g of catalog) for (const t of g.types) { if (POPULAR_WIDGET_IDS.includes(t.id)) continue; addWidgetCmd(t.id, { title: t.title, category: g.category, defaultConfig: t.defaultConfig, defaultHeight: t.defaultHeight }); }

  // ── Open widgets: jump focus to a card that's already on the workspace ──
  const openWidgets = shellLayoutStore.get().widgets;
  // A card is called what the CARD is called, using the same precedence the frame
  // uses (WidgetFrame's frameTitle): the instance's own name first, the type's name
  // second. Reading the type title here while the board reads the instance one is
  // worse than both being anonymous — a user who can finally see "London" on a card
  // would search the palette for "London" and find four rows called
  // "Focus Camera wall #1..#4", numbered against nothing on screen.
  const titleFor = (w: { type: string; config?: Record<string, unknown> }) => {
    const t = getWidgetType(w.type);
    return t?.titleOf?.(w.config ?? {}) || t?.title || w.type;
  };
  // The #n disambiguator is keyed on the RESOLVED title, not the type: three named
  // walls need no numbering at all, and numbering them would re-introduce exactly
  // the anonymity the names just removed. Two walls that genuinely share a name
  // still get numbered, because then the number is the only thing telling them apart.
  const titleTotals = new Map<string, number>();
  for (const w of openWidgets) {
    const t = titleFor(w);
    titleTotals.set(t, (titleTotals.get(t) ?? 0) + 1);
  }
  const titleSeen = new Map<string, number>();
  for (const w of openWidgets) {
    const title = titleFor(w);
    const total = titleTotals.get(title) ?? 1;
    const n = (titleSeen.get(title) ?? 0) + 1;
    titleSeen.set(title, n);
    cmds.push({
      id: `focus-${w.id}`,
      label: `Focus ${title}${total > 1 ? ` #${n}` : ""}`,
      hint: "widget",
      group: "Open widgets",
      run: () => { shellLayoutStore.focus(w.id); close(); },
    });
  }

  // ── Map layers: toggle an individual globe layer ────────────────────────
  for (const k of ACTIVE_LAYERS) {
    cmds.push({
      id: `toggle-${k}`,
      label: `Toggle ${LAYER_NAMES[k]}`,
      hint: "layer",
      group: "Map layers",
      run: () => {
        layersStore.toggle(k);
        close();
      },
    });
  }

  // ── Basemap: swap the underlying map style ──────────────────────────────
  for (const k of Object.keys(BASEMAPS) as BasemapKey[]) {
    cmds.push({
      id: `basemap-${k}`,
      label: `${BASEMAPS[k].label}`,
      hint: "basemap",
      group: "Basemap",
      run: () => {
        mapViewStore.setBasemap(k);
        close();
      },
    });
  }

  // ── Stage: what the centre stage shows ──────────────────────────────────
  const STAGES: { id: StageId; label: string }[] = [{ id: "map3d", label: "3D map" }, { id: "map2d", label: "2D map" }, { id: "clock", label: "World clock" }];
  for (const s of STAGES) cmds.push({ id: `stage-${s.id}`, label: `Stage → ${s.label}`, hint: "stage", group: "Stage", run: () => { shellLayoutStore.stage(s.id); close(); } });

  // ── Scenarios: switch the top-left monitor variant ──────────────────────
  for (const v of BUILTIN_VARIANTS) cmds.push({ id: `variant-${v.id}`, label: `${v.title}`, hint: "scenario", group: "Scenarios", run: () => { variantStore.setActive(v.id); close(); } });

  // ── Appearance: theme + language ────────────────────────────────────────
  cmds.push({ id: "theme-toggle", label: "Toggle light / dark theme", hint: "theme", group: "Appearance", run: () => { uiStore.toggleTheme(); close(); } });
  for (const l of LANGS) cmds.push({ id: `lang-${l.code}`, label: `Language: ${l.name}`, hint: "language", group: "Appearance", run: () => { langStore.set(l.code); close(); } });

  // ── Workspace: reset / save / share the current composition ─────────────
  // Names the board it will actually reset. The old command ran
  // `applyPreset(DEFAULT_PRESET_ID)`, so on any board but the landing one it did not
  // reset anything — it navigated you to a different board. Now that boards restore
  // their saved layout it would have been worse still: "reset" on Hazards would have
  // opened Brief *with Brief's edits intact*, i.e. the opposite of the label, twice.
  const boardName = listPresets().find((p) => p.id === activePresetStore.get())?.title;
  cmds.push({
    id: "reset-layout",
    label: boardName ? `Reset ${boardName} to its default layout` : "Reset this board to its default layout",
    hint: "reset", group: "Workspace",
    run: () => { resetActiveBoard(); close(); },
  });
  cmds.push({ id: "save-preset", label: "Save layout as preset…", hint: "save", group: "Workspace", run: () => { const t = window.prompt("Preset name?"); if (t) saveCustomPreset(t); close(); } });
  cmds.push({ id: "share-layout", label: "Copy shareable link", hint: "share", group: "Workspace", run: () => { const url = `${location.origin}${location.pathname}?c=${encodeLayout(shellLayoutStore.get())}`; navigator.clipboard?.writeText(url); close(); } });

  return cmds;
}

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [vw, setVw] = useState(1280);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo(() => buildCommands(onClose), [onClose]);

  // ── Live active-state snapshot ──────────────────────────────────────────────
  // Every stateful choice the palette can reflect, read reactively so the ✓/ON/OFF
  // pills always show what's currently live. The palette closes on any action, so a
  // fresh snapshot per open is enough — but subscribing keeps it correct if state
  // changes underneath (e.g. a variant flips theme while the palette is open).
  const mapView = useMapView();
  const ui = useUI();
  const lang = useLang();
  const activePreset = useActivePreset();
  const variant = useVariant();
  const layout = useShellLayout();
  const layerState = useLayers();
  const snapshot = useMemo<PaletteSnapshot>(() => ({
    basemap: mapView.basemap,
    stage: layout.stage,
    theme: ui.theme,
    lang,
    layers: layerState as unknown as Record<string, boolean>,
    activePresetId: activePreset,
    activeVariantId: variant.activeId,
    activeLayerSet: null, // Layer sets were removed from the palette — nothing to mark active.
  }), [mapView.basemap, layout.stage, ui.theme, lang, layerState, activePreset, variant.activeId]);

  // Stamp active/ON/OFF/current-choice onto each command from the live snapshot.
  const decorated = useMemo(() => decorate(commands, snapshot), [commands, snapshot]);

  // Column count for the mega-menu layout — sections sit side by side, more of
  // them the wider the viewport. Tracked in state so a resize reflows the palette.
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const colCount = vw >= 1080 ? 3 : vw >= 680 ? 2 : 1;

  // Live place search: any query ≥2 chars also geocodes (keyless Photon via
  // /api/geocode) so you can fly to ANY place (Kyiv, Gaza…), not just the
  // hardcoded camera regions. Debounced; latest query wins; failures are silent.
  const [geo, setGeo] = useState<GeocodeResult[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setGeo([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      fetch(`/api/geocode?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => { if (alive) setGeo(((d.results as GeocodeResult[]) ?? []).slice(0, 5)); })
        .catch(() => { if (alive) setGeo([]); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);

  // Live place results are the product of the query itself — surface them under
  // "Go to" unfiltered (never re-filtered by the substring), matching the prior
  // "append to the list" behaviour, just now grouped.
  const geoCmds = useMemo<Command[]>(() => geo.map((r) => ({
    id: `geo-${r.lat},${r.lon}`,
    label: `Fly to ${r.name}`,
    hint: r.type || "place",
    group: "Go to",
    run: () => { mapViewStore.flyToPoint({ lat: r.lat, lon: r.lon, zoom: zoomForResult(r) }); onClose(); },
  })), [geo, onClose]);

  // Grouped, query-filtered sections in data-driven priority order; live geocode
  // results fold into "Go to" (added even when the static Go-to group filtered empty),
  // then the whole set is re-ordered by section priority.
  const grouped = useMemo(() => {
    const base = groupCommands(decorated, query);
    if (geoCmds.length === 0) return base;
    const byGroup = new Map(base.map((g) => [g.group, g.commands]));
    byGroup.set("Go to", [...(byGroup.get("Go to") ?? []), ...geoCmds]);
    return orderGroups([...byGroup].map(([group, cmds]) => ({ group, commands: cmds })));
  }, [decorated, query, geoCmds]);

  // Sections laid out into side-by-side columns (the mega-menu). The flat index
  // space is column-major — down a column, then on to the next — so ↑/↓ walk a
  // column and ←/→ hop columns.
  const columns = useMemo(() => columnize(grouped, colCount), [grouped, colCount]);
  const flat = useMemo(() => columns.flat().flatMap((sec) => sec.commands), [columns]);
  const indexById = useMemo(() => {
    const m = new Map<string, number>();
    flat.forEach((c, i) => m.set(c.id, i));
    return m;
  }, [flat]);
  // Each column's start offset + length in the flat index space — drives ←/→.
  const colMeta = useMemo(() => {
    let start = 0;
    return columns.map((col) => {
      const len = col.reduce((s, sec) => s + sec.commands.length, 0);
      const m = { start, len };
      start += len;
      return m;
    });
  }, [columns]);

  const activeRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest" }); }, [active]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // focus after paint
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const delta = e.key === "ArrowRight" ? 1 : -1;
      setActive((a) => {
        const ci = colMeta.findIndex((m) => a >= m.start && a < m.start + m.len);
        if (ci < 0) return a;
        const target = Math.min(Math.max(ci + delta, 0), colMeta.length - 1);
        if (target === ci) return a;
        const offset = a - colMeta[ci].start; // keep the same row when hopping columns
        return colMeta[target].start + Math.min(offset, colMeta[target].len - 1);
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      flat[active]?.run();
    }
  };

  return (
    <div className="tn-palette-root" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="tn-palette-backdrop" onClick={onClose} />
      <div className="tn-palette" onKeyDown={onKey}>
        <input
          ref={inputRef}
          className="tn-palette-input"
          placeholder="Search actions — switch profile, add a widget, fly to any place…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Command search"
        />
        {flat.length === 0 ? (
          <div className="tn-palette-empty">No matching commands</div>
        ) : (
          <div className="tn-palette-cols" role="listbox">
            {columns.map((col, ci) => (
              <div className="tn-palette-col" key={ci}>
                {col.map((g) => (
                  <Fragment key={g.group}>
                    <div className="tn-palette-group" aria-hidden="true">{g.group}</div>
                    <ul className="tn-palette-seclist" role="presentation">
                      {g.commands.map((c) => {
                        const i = indexById.get(c.id)!;
                        const off = c.state === "OFF";
                        return (
                          <li
                            key={c.id}
                            ref={i === active ? activeRef : undefined}
                            role="option"
                            aria-selected={i === active}
                            aria-checked={c.active ? true : undefined}
                            className={`tn-palette-item${i === active ? " is-active" : ""}${c.active ? " is-on" : ""}`}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => c.run()}
                          >
                            <span className="tn-palette-check" aria-hidden="true">{c.active ? "✓" : ""}</span>
                            <span className="tn-palette-label">{c.label}</span>
                            {c.state && <span className={`tn-palette-state${c.active ? " on" : off ? " off" : ""}`}>{c.state}</span>}
                            <span className="tn-palette-hint">{c.hint}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </Fragment>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="tn-palette-foot">
          <span><span className="tn-kbd">↑↓</span> in column</span>
          <span><span className="tn-kbd">←→</span> columns</span>
          <span><span className="tn-kbd">↵</span> run</span>
          <span><span className="tn-kbd">esc</span> close</span>
        </div>
      </div>
    </div>
  );
}
