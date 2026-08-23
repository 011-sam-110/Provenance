// components/console/WidgetFrame.tsx
"use client";
import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { WidgetInstance } from "@/lib/console/types";
import { shellLayoutStore } from "@/lib/console/store";
import {
  activePreset,
  HEIGHT_PRESETS,
  HEIGHT_PRESET_TOLERANCE_PX,
  WIDTH_PRESETS,
} from "@/lib/console/resize";
import { ROW_PX, GAP_PX } from "@/lib/terminal/layoutGrid";
import { getWidgetType } from "@/lib/console/registry";
import { resolveWidgetHelp } from "@/lib/console/help";
import { topSeverity, type Alert } from "@/lib/console/alerts";
import { WidgetErrorBoundary } from "@/components/console/WidgetErrorBoundary";
import { toCsv, toGeoJson, downloadText, exportFilename, type GeoPoint } from "@/lib/export";
import {
  notificationsStore, useRule, useNotifications, dispatch, isDiscordConfigured, requestNotifyPermission,
} from "@/lib/shell/notifications";
import { useTelegram, isTelegramConfigured } from "@/lib/shell/telegram";
import FreshChip from "@/components/console/FreshChip";
import LayerExplainerCard from "@/components/LayerExplainerCard";
import type { FreshObservation } from "@/lib/console/freshChip";
import { WIDGET_LIMIT_MESSAGE } from "@/lib/console/types";

interface Report {
  alerts: Alert[];
  count?: number;
  /** A REAL observation of when this widget's data last arrived. Preferred over
   *  freshLabel: the chip derives its own state, colour, ageing text and tooltip,
   *  so a feed that freezes visibly drifts live → "4m old" → "stale · 2h" with no
   *  further reports from the widget. See lib/console/freshChip.ts. */
  fresh?: FreshObservation;
  /** Escape hatch for the handful of widgets whose header word is not about age —
   *  "estimate" on a geolocation guess, "lookup" on an on-demand query. Ignored
   *  when `fresh` is present. Do NOT use it to write "live". */
  freshLabel?: string;
  /** Optional export payload — a widget hands its visible rows/points here and the
   *  frame menu offers CSV / GeoJSON downloads. */
  export?: { rows?: Record<string, unknown>[]; geo?: GeoPoint[]; name?: string };
}
const ReportCtx = createContext<(r: Report) => void>(() => {});
export function useWidgetReport() { return useContext(ReportCtx); }

export default function WidgetFrame({
  instance,
  onGrab,
  onNudgeKey,
  onNudge,
}: {
  instance: WidgetInstance;
  /** Starts a grid drag. Supplied by ConsoleWorkspace, which owns the board. */
  onGrab?: (e: React.PointerEvent) => void;
  /** Arrow-key move, Shift+arrow resize — the keyboard path to the same result. */
  onNudgeKey?: (e: React.KeyboardEvent) => void;
  /** One-cell move/resize, for the ⋯ menu's buttons. */
  onNudge?: (d: { dx?: number; dy?: number; dw?: number; dh?: number }) => void;
}) {
  const type = getWidgetType(instance.type);
  const [report, setReport] = useState<Report>({ alerts: [] });
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpBtnRef = useRef<HTMLButtonElement>(null);
  const onReport = useCallback((r: Report) => setReport(r), []);

  // Per-widget notification rule (keyed by TYPE) + the creds that gate each channel.
  const rule = useRule(instance.type);
  const notif = useNotifications();
  const tg = useTelegram();
  const tgReady = isTelegramConfigured(tg);
  const discordReady = isDiscordConfigured(notif.discordWebhook);

  // Dispatch NEW alerts to the armed channels. A silent baseline is seeded on first
  // mount so pre-existing alerts don't stampede; dedupe by alert.ref ?? alert.id in a
  // ref Set that survives renders (mirrors lib/events/alerting's seeded/fired pattern).
  const firedRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  useEffect(() => {
    const keyOf = (a: Alert) => a.ref ?? a.id;
    if (!seededRef.current) {
      for (const a of report.alerts) firedRef.current.add(keyOf(a));
      seededRef.current = true;
      return;
    }
    const fresh = report.alerts.filter((a) => !firedRef.current.has(keyOf(a)));
    for (const a of fresh) firedRef.current.add(keyOf(a));
    if (fresh.length === 0) return;
    for (const a of fresh) dispatch(a.text, rule); // dormant-safe: no-op unless armed + configured
  }, [report.alerts, rule]);

  if (!type) return null;
  const Body = type.component;
  const help = resolveWidgetHelp(type); // ? popover text — what it shows + its data source
  const sev = topSeverity(report.alerts);
  const cfg = instance.config ?? {};
  const alertStyle = (cfg.alertStyle as string) ?? "top"; // "top" | "feed"

  const setChannel = (patch: Partial<{ browser: boolean; telegram: boolean; discord: boolean }>) =>
    notificationsStore.setRule(instance.type, { channels: patch });
  const onThreshold = (raw: string) => {
    const v = raw.trim();
    if (v === "") {
      notificationsStore.setRule(instance.type, { minValue: undefined });
      shellLayoutStore.configure(instance.id, { alertMin: undefined });
      return;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    notificationsStore.setRule(instance.type, { minValue: n });
    shellLayoutStore.configure(instance.id, { alertMin: n }); // widget's own alert maths honours it
  };

  // The header used to carry `draggable` + an HTML5 dataTransfer payload
  // ("text/tn-widget"). Both are gone, and removing them was not optional: a
  // `draggable` element starts a NATIVE drag on pointerdown, which cancels the
  // pointer capture the grid drag depends on — the two cannot coexist on one
  // element. The only consumer of that payload was components/console/Segment.tsx,
  // which nothing has imported since the Terminal replaced the three segment
  // containers with one grid; it is deleted in the same change rather than left
  // behind implementing a protocol no one sends.

  // ── Explicit move + size, so neither needs a drag ────────────────────────
  // Dragging works, but a draggable header with no alternative is a feature most
  // people never find — and one nobody without a pointer can use at all.
  //
  // The "send to left / right / bottom" buttons that used to live here are GONE.
  // They moved a widget between three fixed segments, and on a free-form grid
  // those segments no longer describe where anything is: a widget's `segment`
  // survives only as preset-authoring and migration input. A button offering to
  // send a card "to the bottom dock" when there is no bottom dock would be a
  // control that lies, which is the exact fault this whole change is fixing.
  // Directional nudges replace them — same one-click, no-aim, keyboard-reachable
  // promise, in coordinates the board actually has.
  const rect = instance.rect;
  const nudgeBy = (d: { dx?: number; dy?: number; dw?: number; dh?: number }) => onNudge?.(d);
  const activeWidth = activePreset(WIDTH_PRESETS, rect?.w ?? instance.width);
  // Height, like width, has to come off the GRID RECT when there is one.
  // `instance.height` is the legacy px field: the preset buttons write it, but a
  // drag-resize writes rect.h and never touches it, so reading it alone left the
  // S/M/L/XL chips showing whatever was last chosen from this menu no matter how
  // far the card had since been dragged. Width was already correct because it
  // reads rect.w first; this is the same rule applied to the other axis.
  // Rows convert at the grid's own pitch rather than a retyped 25.
  const activeHeight = activePreset(
    HEIGHT_PRESETS,
    rect ? rect.h * (ROW_PX + GAP_PX) : instance.height,
    HEIGHT_PRESET_TOLERANCE_PX,
  );

  return (
    <div className="tn-cw" data-widget-type={instance.type} style={{ maxHeight: instance.collapsed ? undefined : instance.height }}>
      <header className="tn-cw-head" onPointerDown={onGrab}>
        {/* The grab affordance. The whole header is the drag source; this is the
            signpost, because without something that LOOKS draggable the drag may
            as well not exist.

            It is a real button now rather than an aria-hidden decoration: it
            carries the KEYBOARD path to moving and resizing (arrows, and Shift
            with arrows). It used to be safe to hide because the ⋯ menu offered
            "send to left/right/bottom" as ordinary buttons — but those segments
            no longer describe where anything is on a free-form grid, so this is
            the accessible route and it has to be announced. */}
        <button
          type="button"
          className="tn-cw-grip"
          aria-label={`Move ${type.title}. Arrow keys move, shift with arrow keys resizes.`}
          title="Drag to move · arrows to nudge · shift+arrows to resize"
          onPointerDown={onGrab}
          onKeyDown={onNudgeKey}
        >
          ⠿
        </button>
        <span className="tn-cw-icon" aria-hidden="true">{type.icon}</span>
        {/* Real heading (not a styled span) so a screen reader gets a stop for
            every widget and can jump by heading. margin/fontSize are reset
            inline because there is no global h1-h6 reset in globals.css and
            the browser UA heading styles (margin ~1em, larger font-size) would
            otherwise break this compact flex header — .tn-cw-title itself is
            untouched so the visible styling (weight/color/ellipsis) is
            unchanged. No aria-label goes on the .tn-cw frame: this h3 is
            already the frame's accessible name source, and a label here too
            would just duplicate it. */}
        {/* `title` carries the SAME string the heading already shows, purely so a
            sighted user can recover a name the column was too narrow to render:
            .tn-cw-title ellipsises, and the Terminal's 250-300px columns clip most
            widget names ("Country Instability Index" renders as "COU…"). It is
            deliberately identical text rather than a longer description - an
            accessible description that merely repeats the accessible name is
            suppressed by screen readers rather than announced twice, which is the
            trap f79b004 fixed and this must not reintroduce. */}
        <h3 className="tn-cw-title" style={{ margin: 0, fontSize: "inherit" }} title={type.title}>{type.title}</h3>
        {report.count != null && <span className="tn-cw-count">{report.count}</span>}
        <span className="tn-cw-sp" />
        {report.alerts.length > 0 && <span className={`tn-cw-badge tn-sev-${sev}`}>{report.alerts.length}</span>}
        {report.fresh
          ? <FreshChip obs={report.fresh} />
          : report.freshLabel && <span className="tn-cw-fresh">{report.freshLabel}</span>}
        <button ref={helpBtnRef} className={`tn-cw-help${helpOpen ? " is-on" : ""}`} aria-label={`What is ${type.title}?`}
          aria-haspopup="dialog" aria-expanded={helpOpen} title="What is this?"
          onClick={() => { setHelpOpen((o) => !o); setMenuOpen(false); setBellOpen(false); }}>?</button>
        <button className={`tn-cw-bell${rule.enabled ? " is-on" : ""}`} aria-label="Notifications" aria-pressed={rule.enabled}
          title={rule.enabled ? "Notifications on" : "Notify me"} onClick={() => { setBellOpen((o) => !o); setMenuOpen(false); setHelpOpen(false); }}>🔔</button>
        <button className="tn-cw-expand" aria-label="Expand widget" title="Expand to main window" onClick={() => shellLayoutStore.focus(instance.id)}>⤢</button>
        {/* Remove is on the card, not only in the ⋯ menu. In the menu it is the
            LAST of nineteen entries in a scrolling panel, so on a short card it
            sits below an internal scroll — a control you have to already know is
            there. The menu entry stays: this is a second route, not a move, and
            the menu also holds the nudge buttons that let the 10px resize handles
            claim the WCAG 2.5.8 equivalent-alternative exemption. */}
        {/* Sits INBOARD of the menu button on purpose. The 16x16 .tn-rz-ne
            resize handle is pinned to the card corner at z-index 20 and covers
            the top-right of the header, so a control placed last here is drawn
            but not clickable — Playwright caught the handle swallowing the
            click. Raising this above the handle instead would take the corner
            away from resizing, which is a real control, not dead space. */}
        <button className="tn-cw-close" aria-label={`Remove ${type.title}`} title="Remove from board"
          onClick={() => shellLayoutStore.remove(instance.id)}>✕</button>
        <button className="tn-cw-menu" aria-label="Widget menu" onClick={() => { setMenuOpen((o) => !o); setBellOpen(false); setHelpOpen(false); }}>⋯</button>
      </header>

      {helpOpen && (
        <div className="tn-cw-help-pop" role="dialog" aria-label={`About ${type.title}`}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setHelpOpen(false); helpBtnRef.current?.focus(); } }}>
          <div className="tn-cw-help-head">
            <span className="tn-cw-help-title">{help.title}</span>
            <button className="tn-cw-help-x" aria-label="Close help" autoFocus
              onClick={() => { setHelpOpen(false); helpBtnRef.current?.focus(); }}>✕</button>
          </div>
          <p className="tn-cw-help-what">{help.what}</p>
          {help.source && <p className="tn-cw-help-src"><span className="tn-cw-help-src-k">Source</span> {help.source}</p>}
          {/* The trust card, for EVERY widget — the 37 generic signal widgets resolve
              theirs from the layer registry, the 15 bespoke ones from
              lib/console/help.ts. Inlined here as well as in the dossier so "what
              can this NOT tell me?" is answerable without first finding a pin to
              click. An audit found this reaching only 2 of the 8 widgets on the
              default board, which is worse than the competitor's 8-of-20 that the
              whole feature exists to beat. */}
          <LayerExplainerCard explainer={help.explainer} />
        </div>
      )}

      {bellOpen && (
        <div className="tn-cw-notify-pop" role="dialog" aria-label="Notifications">
          <label className="tn-cw-notify-toggle">
            <input type="checkbox" checked={rule.enabled}
              onChange={(e) => notificationsStore.setRule(instance.type, { enabled: e.target.checked })} />
            <span>Notify me</span>
          </label>
          <div className="tn-cw-notify-chs">
            <label className="tn-cw-notify-ch">
              <input type="checkbox" checked={rule.channels.browser}
                onChange={(e) => { setChannel({ browser: e.target.checked }); if (e.target.checked) void requestNotifyPermission(); }} />
              <span>Browser</span>
            </label>
            <label className={`tn-cw-notify-ch${tgReady ? "" : " is-off"}`}>
              <input type="checkbox" checked={rule.channels.telegram} disabled={!tgReady}
                onChange={(e) => setChannel({ telegram: e.target.checked })} />
              <span>Telegram{!tgReady && <em className="tn-cw-notify-hint"> · set in Settings</em>}</span>
            </label>
            <label className={`tn-cw-notify-ch${discordReady ? "" : " is-off"}`}>
              <input type="checkbox" checked={rule.channels.discord} disabled={!discordReady}
                onChange={(e) => setChannel({ discord: e.target.checked })} />
              <span>Discord{!discordReady && <em className="tn-cw-notify-hint"> · set in Settings</em>}</span>
            </label>
          </div>
          <label className="tn-cw-notify-field">
            <span>Threshold (min value)</span>
            <input type="number" className="tn-cw-notify-num" placeholder="any"
              value={rule.minValue ?? ""} onChange={(e) => onThreshold(e.target.value)} />
          </label>
        </div>
      )}

      {menuOpen && (
        // Not role="menu" any more. A menu's children are expected to be
        // menuitems that fire and close; half of this panel is now stateful
        // toggles (the size chips carry aria-pressed), and a pressed menuitem is
        // a contradiction most screen readers announce badly. A labelled group of
        // ordinary buttons describes what this actually is.
        <div className="tn-cw-menu-pop" role="group" aria-label={`${type.title} options`}>
          {/* MOVE — the drag, as buttons. One click, no aim, keyboard-reachable. */}
          <div className="tn-cw-menu-sec">Move</div>
          <div className="tn-cw-menu-row">
            <button className="tn-cw-chip" title="Move one column left" onClick={() => nudgeBy({ dx: -1 })}>◀</button>
            <button className="tn-cw-chip" title="Move up past the card above" onClick={() => nudgeBy({ dy: -1 })}>▲</button>
            <button className="tn-cw-chip" title="Move down past the card below" onClick={() => nudgeBy({ dy: 1 })}>▼</button>
            <button className="tn-cw-chip" title="Move one column right" onClick={() => nudgeBy({ dx: 1 })}>▶</button>
          </div>
          <div className="tn-cw-menu-sec">Grow / shrink</div>
          <div className="tn-cw-menu-row">
            <button className="tn-cw-chip" title="One column narrower" onClick={() => nudgeBy({ dw: -1 })}>−W</button>
            <button className="tn-cw-chip" title="One column wider" onClick={() => nudgeBy({ dw: 1 })}>+W</button>
            <button className="tn-cw-chip" title="One row shorter" onClick={() => nudgeBy({ dh: -1 })}>−H</button>
            <button className="tn-cw-chip" title="One row taller" onClick={() => nudgeBy({ dh: 1 })}>+H</button>
          </div>

          {/* SIZE — the same sizes the drag handles snap to, as named targets. */}
          <div className="tn-cw-menu-sec">Width</div>
          <div className="tn-cw-menu-row">
            {WIDTH_PRESETS.map((p) => (
              <button
                key={p.label}
                className="tn-cw-chip"
                aria-pressed={activeWidth === p.value}
                data-on={activeWidth === p.value}
                title={p.hint}
                onClick={() => shellLayoutStore.resizeWidth(instance.id, p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="tn-cw-menu-sec">Height</div>
          <div className="tn-cw-menu-row">
            {HEIGHT_PRESETS.map((p) => (
              <button
                key={p.label}
                className="tn-cw-chip"
                aria-pressed={activeHeight === p.value}
                data-on={activeHeight === p.value}
                title={p.hint}
                onClick={() => shellLayoutStore.resizeWidget(instance.id, p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="tn-cw-menu-sep" />
          <button onClick={() => { const r = shellLayoutStore.add(instance.type, { config: { ...cfg } }); if (!r.ok) window.dispatchEvent(new CustomEvent("tn-toast", { detail: WIDGET_LIMIT_MESSAGE })); setMenuOpen(false); }}>⧉ Duplicate</button>
          <button onClick={() => { shellLayoutStore.configure(instance.id, { alertStyle: alertStyle === "top" ? "feed" : "top" }); setMenuOpen(false); }}>
            ⚡ Alerts: {alertStyle === "top" ? "on top" : "in feed"}
          </button>
          {report.export?.rows && report.export.rows.length > 0 && (
            <button onClick={() => { const base = exportFilename(report.export!.name ?? instance.type, Date.now()); downloadText(`${base}.csv`, "text/csv", toCsv(report.export!.rows!)); setMenuOpen(false); }}>⬇ Export CSV</button>
          )}
          {report.export?.geo && report.export.geo.length > 0 && (
            <button onClick={() => { const base = exportFilename(report.export!.name ?? instance.type, Date.now()); downloadText(`${base}.geojson`, "application/geo+json", toGeoJson(report.export!.geo!)); setMenuOpen(false); }}>⬇ Export GeoJSON</button>
          )}
          <button className="tn-cw-danger" onClick={() => shellLayoutStore.remove(instance.id)}>✕ Remove</button>
        </div>
      )}

      {!instance.collapsed && (
        <>
          {alertStyle === "top" && report.alerts.length > 0 && (
            <div className="tn-cw-attn">
              <div className="tn-cw-attn-h">Needs attention · {report.alerts.length}</div>
              {report.alerts.slice(0, 4).map((a) => (
                <div key={a.id} className={`tn-cw-alert tn-sev-${a.severity}`}>{a.text}</div>
              ))}
            </div>
          )}
          <div className="tn-cw-body">
            {alertStyle === "feed" && report.alerts.length > 0 && (
              <div className="tn-cw-attn-feed">
                {report.alerts.slice(0, 4).map((a) => (
                  <div key={a.id} className={`tn-cw-alert tn-sev-${a.severity}`}>{a.text}</div>
                ))}
              </div>
            )}
            <WidgetErrorBoundary>
              <ReportCtx.Provider value={onReport}><Body instanceId={instance.id} config={cfg} /></ReportCtx.Provider>
            </WidgetErrorBoundary>
          </div>
          {/* The three old resize handles used to live here. They are gone, not
              moved: they resized a widget by writing `width`/`height`, which the
              Terminal never read, and globals.css hid them outright on top of
              that. Resizing is now eight handles on the SLOT, owned by
              ConsoleWorkspace — they have to sit outside this frame's overflow
              so an edge stays grabbable, and the board is the only thing that
              knows what a resize does to a widget's neighbours. */}
        </>
      )}
    </div>
  );
}
