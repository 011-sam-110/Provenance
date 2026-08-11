// components/console/WidgetFrame.tsx
"use client";
import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { WidgetInstance } from "@/lib/console/types";
import { shellLayoutStore } from "@/lib/console/store";
import { spanFromPointer } from "@/lib/console/resize";
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

export default function WidgetFrame({ instance }: { instance: WidgetInstance }) {
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

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/tn-widget", instance.id);
    e.dataTransfer.effectAllowed = "move";
  };
  const onResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY, startH = instance.height;
    const move = (ev: PointerEvent) => shellLayoutStore.resizeWidget(instance.id, startH + (ev.clientY - startY));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const measureSeg = (target: HTMLElement) => {
    const seg = target.closest(".tn-seg") as HTMLElement | null;
    const slot = target.closest(".tn-seg-slot") as HTMLElement | null;
    if (!seg || !slot) return null;
    const cs = getComputedStyle(seg);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    return { slotLeft: slot.getBoundingClientRect().left, segWidth: seg.getBoundingClientRect().width - padL - padR };
  };
  const onResizeWidthPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const m = measureSeg(e.currentTarget as HTMLElement);
    if (!m) return;
    const move = (ev: PointerEvent) =>
      shellLayoutStore.resizeWidth(instance.id, spanFromPointer({ pointerX: ev.clientX, slotLeft: m.slotLeft, segWidth: m.segWidth }));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const onResizeCornerPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const m = measureSeg(e.currentTarget as HTMLElement);
    const startY = e.clientY, startH = instance.height;
    const move = (ev: PointerEvent) => {
      shellLayoutStore.resizeWidget(instance.id, startH + (ev.clientY - startY));
      if (m) shellLayoutStore.resizeWidth(instance.id, spanFromPointer({ pointerX: ev.clientX, slotLeft: m.slotLeft, segWidth: m.segWidth }));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  return (
    <div className="tn-cw" data-widget-type={instance.type} style={{ maxHeight: instance.collapsed ? undefined : instance.height }}>
      <header className="tn-cw-head" draggable onDragStart={onDragStart}>
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
        <h3 className="tn-cw-title" style={{ margin: 0, fontSize: "inherit" }}>{type.title}</h3>
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
        <div className="tn-cw-menu-pop" role="menu">
          <button onClick={() => { const r = shellLayoutStore.add(instance.type, { config: { ...cfg } }); if (!r.ok) window.dispatchEvent(new CustomEvent("tn-toast", { detail: "50-widget limit — remove one to add another" })); setMenuOpen(false); }}>⧉ Duplicate</button>
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
          <div className="tn-cw-resize" onPointerDown={onResizePointerDown} title="Drag to resize height" />
          <div className="tn-cw-resize-x" onPointerDown={onResizeWidthPointerDown} title="Drag to resize width" />
          <div className="tn-cw-resize-xy" onPointerDown={onResizeCornerPointerDown} title="Drag to resize" />
        </>
      )}
    </div>
  );
}
