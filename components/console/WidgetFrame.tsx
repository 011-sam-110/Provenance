// components/console/WidgetFrame.tsx
"use client";
import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { WidgetInstance } from "@/lib/console/types";
import { shellLayoutStore, useShellLayout } from "@/lib/console/store";
import {
  activePreset,
  HEIGHT_PRESETS,
  HEIGHT_PRESET_TOLERANCE_PX,
} from "@/lib/console/resize";
import { nudgeTarget, sendToTarget, otherSegments, SEGMENT_LABEL } from "@/lib/console/move";
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
  onNudgeKey,
}: {
  instance: WidgetInstance;
  /** Arrow keys on the grip, with RAIL meanings: up/down reorder within the
   *  rail, left/right send the card to another rail. Supplied by
   *  ConsoleWorkspace, which owns the layout. `onGrab` and `onNudge` are gone
   *  with the grid drag they served — there is no free-form drag left to start
   *  and no grid cell left to nudge into. */
  onNudgeKey?: (e: React.KeyboardEvent) => void;
}) {
  const type = getWidgetType(instance.type);
  // Subscribed, not read off the store during render: the move controls need
  // to know about the OTHER cards in this rail (is this one already at the
  // top? which rails is it not in?), and that is state this component does not
  // receive through `instance`.
  const layout = useShellLayout();
  const [report, setReport] = useState<Report>({ alerts: [] });
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpBtnRef = useRef<HTMLButtonElement>(null);
  const onReport = useCallback((r: Report) => setReport(r), []);

  // What this CARD is called, which is not always what its TYPE is called. A widget
  // that can appear several times on one board and be pointed at individually — a
  // camera wall, four of them on Streets — has to say WHICH one it is, or every
  // control that targets one by name is aiming at an unlabelled row of identical
  // headers. Falls back to the type title, which is the right answer for the ~70
  // widgets that are only ever on a board once.
  const frameTitle = type?.titleOf?.(instance.config) || type?.title || instance.type;

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
  // pointer capture the grid drag depended on — the two could not coexist on one
  // element. The only consumer of that payload was components/console/Segment.tsx,
  // which nothing has imported since the Terminal replaced the three segment
  // containers with one grid; it is deleted rather than left behind implementing
  // a protocol no one sends.

  // ── Explicit move + size, so neither needs a drag ────────────────────────
  //
  // ── THE COMMENT THAT USED TO SIT HERE ARGUED THE OPPOSITE. IT WAS RIGHT AT
  //    THE TIME AND IS NOW WRONG, SO IT IS REWRITTEN RATHER THAN DELETED. ────
  //
  // It said the "send to left / right / bottom" buttons had to go, because on a
  // free-form grid the three segments "no longer describe where anything is",
  // and a button offering to send a card "to the bottom dock" when there is no
  // bottom dock "would be a control that lies".
  //
  // That reasoning was sound and its premise has been deleted. There IS a bottom
  // dock again. A widget's `segment` is no longer migration residue — it is the
  // widget's actual and only position, and the rail it names is a thing on
  // screen with a visible seam you can drag. So the send-to buttons come BACK,
  // and it is the directional nudges that now lie: `dx: -1` meant "one grid
  // column left", and there are no grid columns.
  //
  // Up/down keep their meaning, narrowed honestly from "move past the card
  // above" to "one place up THIS RAIL". Left/right are replaced by named
  // destinations rather than directions, because from the bottom rail "left" is
  // a place, not a direction, and only the destination form survives being read
  // out loud by a screen reader without the user having to know the layout.
  const railTargets = otherSegments(layout, instance.id);
  const canNudge = (dir: -1 | 1) => nudgeTarget(layout, instance.id, dir) !== null;
  const doNudge = (dir: -1 | 1) => {
    const t = nudgeTarget(layout, instance.id, dir);
    if (t) shellLayoutStore.move(instance.id, t.segment, t.index);
  };
  const doSend = (seg: (typeof railTargets)[number]) => {
    const t = sendToTarget(layout, instance.id, seg);
    if (t) shellLayoutStore.move(instance.id, t.segment, t.index);
    setMenuOpen(false);
  };

  // Height is the only size a rail has. `instance.height` is now the single
  // source of truth for it — there is no rect to disagree with, which is what
  // made the old two-source read necessary and fragile.
  const activeHeight = activePreset(HEIGHT_PRESETS, instance.height, HEIGHT_PRESET_TOLERANCE_PX);
  /** One step of height, in px. Matches the splitter's fine arrow step. */
  const HEIGHT_STEP = 40;
  const bumpHeight = (d: number) => shellLayoutStore.resizeWidget(instance.id, instance.height + d);

  return (
    <div className="tn-cw" data-widget-type={instance.type} style={{ maxHeight: instance.collapsed ? undefined : instance.height }}>
      <header className="tn-cw-head">
        {/* The move affordance. It is NO LONGER A DRAG SOURCE — there is nothing
            to drag a card to, because a card's position is which rail it is in
            and where in that rail's stack it sits. It stays a real, focusable
            button carrying the keyboard path to both.

            The label says what the keys DO rather than naming a gesture. It used
            to promise "shift with arrow keys resizes", which was true on the
            grid; size now belongs to the rail's own splitter (which can announce
            the new size, as this never could) and to the ⋯ menu's height chips. */}
        <button
          type="button"
          className="tn-cw-grip"
          aria-label={`Move ${frameTitle}. Up and down reorder it in this rail; left and right send it to another rail.`}
          title="Arrows reorder in this rail · left/right send it to another rail"
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
        <h3 className="tn-cw-title" style={{ margin: 0, fontSize: "inherit" }} title={frameTitle}>{frameTitle}</h3>
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
            last entry in a scrolling panel, so on a short card it sits below an
            internal scroll — a control you have to already know is there. The
            menu entry stays: this is a second route, not a move.

            The WCAG 2.5.8 clause that used to be argued here is no longer this
            file's to claim. It said the menu's nudge buttons were the
            equivalent alternative to the 10px drag handles. Those handles are
            gone with the grid, and the control that replaced them — the rail
            splitter — carries its own keyboard path and announces its value,
            so it does not need cover from here.

            ORDERING: ✕ sits inboard of ⋯, and the hazard that forced that is
            also gone. A 16x16 .tn-rz-ne handle used to be pinned over the
            header's top-right corner at z-index 20, so a control placed last
            was drawn but not clickable — Playwright caught it swallowing the
            click. Nothing renders that handle now. The order is left alone
            because it reads fine and changing it buys nothing, NOT because the
            corner is still taken. Note the CSS rules for those handles are
            still in globals.css with nothing to attach to. */}
        <button className="tn-cw-close" aria-label={`Remove ${frameTitle}`} title="Remove from board"
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
        <div className="tn-cw-menu-pop" role="group" aria-label={`${frameTitle} options`}>
          {/* ORDER WITHIN THE RAIL. Disabled at the ends rather than hidden:
              a control that vanishes at the top of a list makes the row jump
              under the pointer, and "why did that button move?" is a worse
              question than "why is that button grey?". */}
          <div className="tn-cw-menu-sec">Order</div>
          <div className="tn-cw-menu-row">
            <button
              className="tn-cw-chip"
              title="One place up this rail"
              aria-label="Move one place up this rail"
              disabled={!canNudge(-1)}
              onClick={() => doNudge(-1)}
            >▲</button>
            <button
              className="tn-cw-chip"
              title="One place down this rail"
              aria-label="Move one place down this rail"
              disabled={!canNudge(1)}
              onClick={() => doNudge(1)}
            >▼</button>
          </div>

          {/* DESTINATIONS, not directions. Only the two rails it is not in. */}
          <div className="tn-cw-menu-sec">Send to</div>
          {railTargets.map((seg) => (
            <button key={seg} onClick={() => doSend(seg)}>
              {SEGMENT_LABEL[seg]}
            </button>
          ))}

          {/* SIZE. There is no width in a rail — the rail's own splitter owns
              that, for every card in it at once. Height is per-card. */}
          <div className="tn-cw-menu-sec">Grow / shrink</div>
          <div className="tn-cw-menu-row">
            <button className="tn-cw-chip" title="Shorter" aria-label="Make shorter" onClick={() => bumpHeight(-HEIGHT_STEP)}>−H</button>
            <button className="tn-cw-chip" title="Taller" aria-label="Make taller" onClick={() => bumpHeight(HEIGHT_STEP)}>+H</button>
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
          {/* DUPLICATE DOES NOT ASK WHERE. Every other add-path opens the
              placement picker, and this one deliberately does not: a copy
              belongs directly beneath its original. That is a fact about what
              the word means, not a preference the user should have to restate
              each time. It lands at order + 1 in the same rail — `add` appends
              to the end of the rail, so the move is what puts it under its
              source rather than at the bottom of a long column. */}
          <button onClick={() => {
            const r = shellLayoutStore.add(instance.type, {
              segment: instance.segment,
              config: { ...cfg },
              height: instance.height,
            });
            if (!r.ok) window.dispatchEvent(new CustomEvent("tn-toast", { detail: WIDGET_LIMIT_MESSAGE }));
            else if (r.id) shellLayoutStore.move(r.id, instance.segment, instance.order + 1);
            setMenuOpen(false);
          }}>⧉ Duplicate</button>
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
          {/* Nothing resizes a card from its own edges any more, and this note
              has now been wrong twice in the same place, so it is worth stating
              what the file actually does rather than what the last rewrite
              intended. It first described three handles on the frame. It was
              then rewritten to describe eight handles on the SLOT, owned by
              ConsoleWorkspace — true for exactly as long as there was a grid to
              resize a card inside.

              There is no width to resize now: a card is as wide as its rail, so
              width is a property of the RAIL and belongs to the splitter between
              them, which is one control for the whole column rather than one per
              card. Height is per-card and lives in the ⋯ menu, where it can be
              driven from a keyboard and speak its new value. Both are above; no
              handle is rendered here. */}
        </>
      )}
    </div>
  );
}
