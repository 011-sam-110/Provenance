"use client";
// The camera stats strip in the console's top bar, and the breakdown it opens.
//
// VIDEO | STILLS | COUNTRIES | OPERATORS | COUNTED <n> min ago | WEBCAMS, read from
// /api/camera-stats. One button: a click opens the breakdown under it (on a phone, a
// bottom sheet). Every number says what it counts, its source and its time on hover and
// on keyboard focus.
//
// THE HONESTY RULES ARE NOT STYLE. The strip never says "live" and never uses the live
// green: VIDEO counts streams that PLAYED at their last check, the rest are stills, and
// every total is a count at a time, never a standing fact. While the first play check
// since a server start is still running, the VIDEO facts say "first check running"
// instead of a share. All the wording is in lib/cameras/statsView.ts, where it is tested.
//
// The webcam count has its own source and its own state: when the road count fails, the
// strip says "Counts unavailable" with Retry and still shows the webcams, read straight
// from the static catalogue manifest.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { isStale, WEBCAMS_SOURCE, type CameraStats as Stats, type RegionRow } from "@/lib/cameras/stats";
import {
  SEGMENTS,
  SEGMENT_LABEL,
  agoText,
  dropClass,
  firstFrameTip,
  fmt,
  hhmmUtc,
  dateUtc,
  listedTip,
  msText,
  operatorMeta,
  operatorTip,
  percent,
  playedFigure,
  playedShort,
  playedTip,
  refreshTip,
  regionTip,
  secondsText,
  segmentTip,
  stripAriaLabel,
  stripTip,
  webcamsTip,
  windowText,
  type SegmentId,
  type Tip,
} from "@/lib/cameras/statsView";
import { useNow } from "@/lib/shell/useNow";
import { StillsGlyph, VideoGlyph } from "@/components/terminal/StatGlyphs";

const POLL_MS = 5 * 60_000;
/** A stale answer is usually the server refreshing in the background: ask again soon. */
const STALE_RETRY_MS = 75_000;
const PANEL_W = 624;
const OPS_SHOWN = 6;
const PANEL_ID = "cs-panel";
const TITLE_ID = "cs-panel-title";
const TIP_ID = "cs-tip";
const MANIFEST_URL = "/webcams/manifest.json";

type Webcams = Stats["webcams"];
type Load =
  | { state: "loading" }
  | { state: "ok"; stats: Stats }
  | { state: "error"; webcams: Webcams | null };

async function fetchStats(): Promise<Stats> {
  const r = await fetch("/api/camera-stats");
  if (!r.ok) throw new Error(`camera-stats ${r.status}`);
  return (await r.json()) as Stats;
}

/** The webcam count without the route: the committed manifest, a static file. */
async function fetchWebcams(): Promise<Webcams | null> {
  const r = await fetch(MANIFEST_URL);
  if (!r.ok) return null;
  const m = (await r.json()) as { harvested?: unknown; generatedAt?: unknown };
  if (typeof m.harvested !== "number") return null;
  const at = typeof m.generatedAt === "string" ? Date.parse(m.generatedAt) : NaN;
  return { count: m.harvested, at: Number.isFinite(at) ? at : null, source: WEBCAMS_SOURCE };
}

function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

const Skel = ({ w }: { w: number }) => <span className="cs-skel" style={{ width: w }} aria-hidden="true" />;

export default function CameraStats() {
  const now = useNow(30_000);
  const phone = usePhone();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [nonce, setNonce] = useState(0);
  const [open, setOpen] = useState(false);
  const [opsOpen, setOpsOpen] = useState(false);
  const [opsAll, setOpsAll] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [tip, setTip] = useState<{ tip: Tip; rect: DOMRect; beside: DOMRect | null } | null>(null);

  const stripRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const tippedRef = useRef<HTMLElement | null>(null);
  const lastStats = useRef<Stats | null>(null);

  const stats = load.state === "ok" ? load.stats : null;

  // ── Data: on mount, every 5 min, sooner while stale; Retry starts over ──────────
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      let next: Stats | null = null;
      try {
        next = await fetchStats();
        lastStats.current = next;
        if (alive) setLoad({ state: "ok", stats: next });
      } catch {
        // A count already on screen stays: its time says how old it is, and past 15 min
        // the strip marks it stale. Only a strip with nothing to show says unavailable.
        next = lastStats.current;
        if (!next) {
          const webcams = await fetchWebcams().catch(() => null);
          if (alive) setLoad({ state: "error", webcams });
        }
      }
      if (!alive) return;
      timer = setTimeout(loop, next && isStale(next.road.at, Date.now()) ? STALE_RETRY_MS : POLL_MS);
    };
    void loop();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [nonce]);

  const retry = () => {
    setLoad({ state: "loading" });
    setNonce((n) => n + 1);
  };

  // ── Tooltips: one element, placed beside the number it explains ─────────────────
  const tipFor = useCallback(
    (key: string): Tip | null => {
      if (key === "seg:webcams" || key === "web") {
        const w = stats?.webcams ?? (load.state === "error" ? load.webcams : null);
        return w ? webcamsTip(w) : null;
      }
      if (!stats) return null;
      if (key === "strip") return stripTip(stats, now);
      if (key.startsWith("seg:")) return segmentTip(key.slice(4) as SegmentId, stats, now);
      if (key.startsWith("r:")) {
        const [, i, kind] = key.split(":");
        const row = stats.road.regions[Number(i)];
        return row ? regionTip(row, kind as "video" | "stills" | "countries", stats, now) : null;
      }
      if (key.startsWith("op:")) {
        const row = stats.operators.rows.find((r) => r.key === key.slice(3));
        return row ? operatorTip(row, stats, now) : null;
      }
      if (key === "f:played") return playedTip(stats);
      if (key === "f:ttff") return firstFrameTip(stats);
      if (key === "f:listed") return listedTip(stats);
      if (key === "f:refresh") return refreshTip(stats, now);
      return null;
    },
    [stats, load, now],
  );

  const hideTip = useCallback(() => {
    const el = tippedRef.current;
    if (el) {
      el.classList.remove("is-tipped");
      el.removeAttribute("aria-describedby");
      tippedRef.current = null;
    }
    setTip(null);
  }, []);

  const showTip = useCallback(
    (el: HTMLElement, key: string) => {
      const t = tipFor(key);
      if (!t) return;
      if (tippedRef.current && tippedRef.current !== el) {
        tippedRef.current.classList.remove("is-tipped");
        tippedRef.current.removeAttribute("aria-describedby");
      }
      const panel = el.closest(".cs-drop");
      // Rendered before the description is attached, so a screen reader that reads the
      // description on focus finds the text already there.
      flushSync(() => setTip({ tip: t, rect: el.getBoundingClientRect(), beside: panel ? panel.getBoundingClientRect() : null }));
      el.classList.add("is-tipped");
      if (el !== stripRef.current || key === "strip") el.setAttribute("aria-describedby", TIP_ID);
      tippedRef.current = el;
    },
    [tipFor],
  );

  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el || !tip) return;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    let x = Math.min(Math.max(8, tip.rect.left), vw - tw - 8);
    let y = tip.rect.bottom + 6;
    if (y + th + 8 > vh && tip.rect.top > th + 12) y = tip.rect.top - th - 6;
    // Inside the breakdown, beside the panel, so a tip never covers the rows it explains.
    if (tip.beside && tip.beside.right + tw + 16 < vw) {
      x = tip.beside.right + 8;
      y = Math.max(8, Math.min(tip.rect.top - 8, vh - th - 8));
    }
    el.style.left = `${Math.max(8, x)}px`;
    el.style.top = `${Math.max(8, y)}px`;
  }, [tip]);

  const tipKeyOf = (target: EventTarget | null): [HTMLElement, string] | null => {
    const el = target instanceof Element ? target.closest<HTMLElement>("[data-tip],[data-k]") : null;
    if (!el) return null;
    const key = el.dataset.tip ?? (el.dataset.k ? `seg:${el.dataset.k}` : null);
    return key ? [el, key] : null;
  };
  const onOver = (e: React.MouseEvent) => {
    const hit = tipKeyOf(e.target);
    if (hit && hit[0] !== tippedRef.current) showTip(hit[0], hit[1]);
  };
  const onOut = (e: React.MouseEvent) => {
    const hit = tipKeyOf(e.target);
    if (!hit) return;
    const to = e.relatedTarget as Node | null;
    if (to && hit[0].contains(to)) return;
    if (document.activeElement === hit[0]) return;
    hideTip();
  };
  const onFocusIn = (e: React.FocusEvent) => {
    const el = e.target as HTMLElement;
    if (el === stripRef.current) {
      if (el.matches(":focus-visible")) showTip(el, "strip");
      return;
    }
    const key = el.dataset.tip;
    if (key) showTip(el, key);
  };
  const onFocusOut = () => hideTip();

  // ── Open and close ────────────────────────────────────────────────────────────────
  const close = useCallback(
    (refocus: boolean) => {
      setOpen(false);
      hideTip();
      if (refocus) stripRef.current?.focus();
    },
    [hideTip],
  );

  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open, phone]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Desktop: a click anywhere else closes the breakdown (the phone sheet has its scrim).
  useEffect(() => {
    if (!open || phone) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || stripRef.current?.contains(t)) return;
      close(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, phone, close]);

  useLayoutEffect(() => {
    if (!open || phone) return;
    const place = () => {
      const r = stripRef.current?.getBoundingClientRect();
      if (!r) return;
      const vw = document.documentElement.clientWidth;
      const width = Math.min(PANEL_W, vw - 16);
      setPos({ left: Math.max(8, Math.min(r.left, vw - width - 8)), top: r.bottom + 6, width });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, phone]);

  // The phone sheet is modal: Tab stays inside it.
  const onPanelKey = (e: React.KeyboardEvent) => {
    if (!phone || e.key !== "Tab" || !panelRef.current) return;
    const f = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button, [tabindex="0"]'));
    if (f.length === 0) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // ── The strip ─────────────────────────────────────────────────────────────────────
  const stale = stats ? isStale(stats.road.at, now) : false;
  const tipHandlers = { onMouseOver: onOver, onMouseOut: onOut, onFocus: onFocusIn, onBlur: onFocusOut };

  const tipEl = (
    <div className="cs-tip" id={TIP_ID} role="tooltip" ref={tipRef} hidden={!tip}>
      {tip && (
        <>
          <div className="t1">{tip.tip.title}</div>
          {tip.tip.body}
          <div className="src">
            <b>Source:</b> {tip.tip.source}
          </div>
        </>
      )}
    </div>
  );

  if (load.state === "error") {
    const w = load.webcams;
    return (
      <>
        <div className="cs-err" role="status" {...tipHandlers}>
          <span className="cs-seg cs-errmsg">
            <span className="cs-dot" aria-hidden="true" />
            Counts unavailable
          </span>
          <button type="button" className="cs-retry" onClick={retry}>
            Retry
          </button>
          {w && w.count !== null && (
            <span className={`cs-seg cs-desk cs-web ${dropClass("webcams")}`} data-tip="seg:webcams" tabIndex={0}>
              <span className="cs-lab">Webcams</span>
              <span className="cs-num">{fmt(w.count)}</span>
            </span>
          )}
        </div>
        {tipEl}
      </>
    );
  }

  const segValue = (id: SegmentId): React.ReactNode => {
    if (!stats) return <Skel w={id === "stills" ? 56 : id === "video" ? 44 : id === "webcams" ? 54 : id === "counted" ? 58 : 20} />;
    switch (id) {
      case "video":
        return <span className="cs-num">{fmt(stats.road.video)}</span>;
      case "stills":
        return <span className="cs-num">{fmt(stats.road.stills)}</span>;
      case "countries":
        return <span className="cs-num">{fmt(stats.road.countries)}</span>;
      case "operators":
        return <span className="cs-num">{fmt(stats.road.operators)}</span>;
      case "webcams":
        return <span className="cs-num">{stats.webcams.count === null ? "–" : fmt(stats.webcams.count)}</span>;
      case "counted":
        return (
          <span className="cs-ftime">
            <span className="cs-dot" aria-hidden="true" />
            {stats.road.at === null ? "not yet" : agoText(stats.road.at, now)}
          </span>
        );
    }
  };

  const segClass = (id: SegmentId) =>
    [
      "cs-seg cs-desk",
      id === "countries" || id === "operators" ? "is-minor" : "",
      id === "video" || id === "stills" ? "is-major" : "",
      id === "counted" ? "cs-fresh" : "",
      id === "webcams" ? "cs-web" : "",
      dropClass(id),
    ]
      .filter(Boolean)
      .join(" ");

  const label = stats ? stripAriaLabel(stats, now) : "Camera counts loading";
  const ago = stats && stats.road.at !== null ? agoText(stats.road.at, now) : null;

  const strip = (
    <button
      ref={stripRef}
      type="button"
      className={`cs-score${stale ? " is-stale" : ""}`}
      aria-expanded={open}
      aria-controls={open ? PANEL_ID : undefined}
      aria-label={label}
      aria-disabled={stats ? undefined : true}
      data-testid="camera-stats"
      onClick={() => {
        if (!stats) return;
        hideTip();
        setOpen((o) => !o);
      }}
      onMouseOver={onOver}
      onMouseLeave={() => {
        if (document.activeElement !== stripRef.current || !stripRef.current?.matches(":focus-visible")) hideTip();
      }}
      onFocus={onFocusIn}
      onBlur={onFocusOut}
    >
      {SEGMENTS.map((id) => (
        <span key={id} className={segClass(id)} data-k={stats ? id : undefined}>
          <span className="cs-lab">
            {id === "video" && <VideoGlyph />}
            {id === "stills" && <StillsGlyph />}
            <span className="cs-word">{id === "counted" && !stats ? "Counting" : SEGMENT_LABEL[id]}</span>
          </span>
          {segValue(id)}
        </span>
      ))}
      <span className="cs-chevwrap cs-desk" aria-hidden="true">
        <span className="cs-chev" />
      </span>
      <span className="cs-pline cs-phone" aria-hidden="true">
        <VideoGlyph />
        {stats ? <span className="cs-num">{fmt(stats.road.video)}</span> : <Skel w={32} />}
        <span className="cs-gap" />
        <StillsGlyph />
        {stats ? <span className="cs-num">{fmt(stats.road.stills)}</span> : <Skel w={42} />}
        <span className="cs-chev" />
      </span>
      <span className="cs-pfresh cs-phone" aria-hidden="true">
        {stats && <span className="cs-dot" />}
        {stats ? (ago ? `counted ${ago}` : "not counted yet") : "counting…"}
      </span>
    </button>
  );

  if (!stats || !open) {
    return (
      <>
        {strip}
        {tipEl}
      </>
    );
  }

  // ── The breakdown ─────────────────────────────────────────────────────────────────
  const s = stats;
  const p = s.play;
  const counted = s.road.at === null ? null : `${hhmmUtc(s.road.at)}`;
  const median = s.refresh.medianSeconds === null ? "–" : secondsText(s.refresh.medianSeconds);
  const share = percent(p.rolling, p.checked);
  const tipAttrs = (key: string) => ({ "data-tip": key, tabIndex: 0 });

  const regionTable = (compact: boolean) => {
    const max = Math.max(1, ...s.road.regions.map((r) => r.video + r.stills));
    const cell = (r: RegionRow, i: number, kind: "video" | "stills" | "countries") => {
      const v = kind === "countries" ? r.countries : r[kind];
      return (
        <td className={v === 0 ? "z" : "n"} {...(v > 0 ? tipAttrs(`r:${i}:${kind}`) : {})}>
          {fmt(v)}
        </td>
      );
    };
    return (
      <table className="cs-box">
        <caption className="tn-sr-only">Cameras by region{counted ? `, counted ${counted}` : ""}</caption>
        <thead>
          <tr>
            <th scope="col">Region</th>
            <th scope="col">Video</th>
            <th scope="col">Stills</th>
            {!compact && <th scope="col">Countries</th>}
            {!compact && (
              <th scope="col" className="cs-barh">
                <span className="cs-key">
                  <span className="cs-chip v" aria-hidden="true" />
                  Video
                </span>
                <span className="cs-key">
                  <span className="cs-chip s" aria-hidden="true" />
                  Stills
                </span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {s.road.regions.map((r, i) => {
            const total = r.video + r.stills;
            const vw = total ? Math.max(r.video ? 2 : 0, Math.round((150 * r.video) / max)) : 0;
            const sw = total ? Math.max(r.stills ? 2 : 0, Math.round((150 * r.stills) / max)) : 0;
            return (
              <tr key={r.region} className={total === 0 ? "is-none" : undefined}>
                <td>
                  {r.region}
                  {total === 0 && compact && <span className="cs-none">No source yet</span>}
                </td>
                {cell(r, i, "video")}
                {cell(r, i, "stills")}
                {!compact && cell(r, i, "countries")}
                {!compact && (
                  <td className="cs-barcell">
                    {total === 0 ? (
                      <span className="cs-none">No source yet</span>
                    ) : (
                      <span className="cs-bar" aria-hidden="true">
                        {vw > 0 && <i className="v" style={{ width: vw }} />}
                        {sw > 0 && <i className="s" style={{ width: sw }} />}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>All regions</td>
            <td {...tipAttrs("seg:video")}>{fmt(s.road.video)}</td>
            <td {...tipAttrs("seg:stills")}>{fmt(s.road.stills)}</td>
            {!compact && <td {...tipAttrs("seg:countries")}>{fmt(s.road.countries)}</td>}
            {!compact && <td />}
          </tr>
        </tfoot>
      </table>
    );
  };

  const facts = (compact: boolean) => (
    <div className={`cs-facts${compact ? " sh-facts" : ""}`}>
      <div className="cs-frow">
        <div className="cs-fcap">
          <VideoGlyph />
          <b>Video</b>
          <span>
            {fmt(s.road.video)} cameras shown as video; {playedShort(s)}
          </span>
        </div>
        <div className="cs-fgrid">
          <div className="cs-fact">
            <h3>Played at the last check</h3>
            <div className="cs-big">
              <span {...tipAttrs("f:played")}>
                {playedFigure(s)}
              </span>
              {!p.warm && share !== null && <small>{share}%</small>}
            </div>
            <div className="cs-sub">
              {p.warm ? `${fmt(p.checked)} of ${fmt(p.listed)} listed streams checked so far` : windowText(s)}
            </div>
          </div>
          <div className="cs-fact">
            <h3>First frame</h3>
            <div className="cs-big">
              <span {...tipAttrs("f:ttff")}>{p.ttffMedianMs === null ? "Not measured yet" : msText(p.ttffMedianMs)}</span>
              {p.ttffMedianMs !== null && <small>median</small>}
            </div>
            <div className="cs-sub">
              {p.ttffP90Ms === null ? "over the streams that played" : `p90 ${msText(p.ttffP90Ms)}, over ${fmt(p.rolling)} streams that played`}
            </div>
          </div>
          <div className="cs-fact">
            <h3>Streams listed</h3>
            <div className="cs-big">
              <span {...tipAttrs("f:listed")}>{fmt(p.listed)}</span>
            </div>
            <div className="cs-sub">each one checked every {Math.round(p.cycleMs / 3_600_000)} h</div>
          </div>
        </div>
      </div>
      <div className="cs-frow">
        <div className="cs-fcap">
          <StillsGlyph />
          <b>Stills</b>
          <span>
            {fmt(s.road.stills)} pictures; {median} median refresh
          </span>
        </div>
        <div className="cs-fgrid is-one">
          <div className="cs-fact">
            <h3>Refresh interval, as each operator states it</h3>
            <div className="cs-big">
              <span {...tipAttrs("f:refresh")}>{median}</span>
              <small>median</small>
            </div>
            <div className="cs-steps" aria-hidden="true">
              {s.refresh.mix.map((b) => (
                <i key={b.label} style={{ flex: b.count }} />
              ))}
            </div>
            <div className="cs-stepkey">
              {s.refresh.mix.map((b) => (
                <span key={b.label}>
                  <b>{b.label}</b>
                  {fmt(b.count)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const shown = opsAll ? s.operators.rows : s.operators.rows.slice(0, OPS_SHOWN);
  const operators = opsOpen && (
    <section className="cs-ops" id="cs-ops" aria-labelledby="cs-ops-title">
      <h3 className="cs-ops-title" id="cs-ops-title">
        All {s.operators.rows.length} operators, with licence
      </h3>
      <p className="op-sum">Every camera on the map names its operator and the licence it is shown under.</p>
      <div className="op-lic">
        <span>
          Licence stated <b>{s.operators.licenceStated}</b>
        </span>
        <span>
          No licence stated <b>{s.operators.noLicence}</b>
        </span>
      </div>
      <ul className="op-list">
        {shown.map((r) => (
          <li className="op" key={r.key} title={r.license}>
            <span className="op-n">{r.name}</span>
            <span className="op-c" {...tipAttrs(`op:${r.key}`)}>
              {fmt(r.cameras)}
            </span>
            <span className="op-m">{operatorMeta(r)}</span>
          </li>
        ))}
      </ul>
      {s.operators.rows.length > OPS_SHOWN && (
        <button type="button" className="cl-more" aria-expanded={opsAll} onClick={() => setOpsAll((a) => !a)}>
          {opsAll ? "Show fewer operators" : `Show all ${s.operators.rows.length} operators`}
        </button>
      )}
    </section>
  );

  const opsButton = (
    <button
      type="button"
      className="cs-link"
      aria-expanded={opsOpen}
      aria-controls="cs-ops"
      onClick={() => setOpsOpen((o) => !o)}
    >
      Per-operator coverage
    </button>
  );

  const unplaced = s.road.unplaced.length > 0 && (
    <p className="cs-unplaced">Not in a region yet: {s.road.unplaced.join(", ")}.</p>
  );

  const webCount = s.webcams.count === null ? "–" : fmt(s.webcams.count);
  const webWhen = s.webcams.at === null ? "harvest date unknown" : `harvested ${dateUtc(s.webcams.at)}`;

  const panel = phone ? (
    <section
      id={PANEL_ID}
      ref={panelRef}
      className="cs-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby={TITLE_ID}
      onKeyDown={onPanelKey}
      {...tipHandlers}
    >
      <div className="sh-grab" aria-hidden="true" />
      <div className="sh-head">
        <h2 id={TITLE_ID} ref={titleRef} tabIndex={-1}>
          Camera count
        </h2>
        <button type="button" className="sh-x" aria-label="Close" onClick={() => close(true)}>
          ×
        </button>
      </div>
      <div className="sh-body">
        <div className="sh-pair">
          <div>
            <span className="cs-lab">
              <VideoGlyph />
              Video
            </span>
            <div className="cs-big" {...tipAttrs("seg:video")}>
              {fmt(s.road.video)}
            </div>
            <div className="cs-sub">cameras shown as video; {playedShort(s)}</div>
          </div>
          <div>
            <span className="cs-lab">
              <StillsGlyph />
              Stills
            </span>
            <div className="cs-big" {...tipAttrs("seg:stills")}>
              {fmt(s.road.stills)}
            </div>
            <div className="cs-sub">pictures; {median} median refresh</div>
          </div>
        </div>
        <div className={`sh-when${stale ? " is-stale" : ""}`}>
          <span className="cs-dot" aria-hidden="true" />
          <span>
            Road and public operators.{" "}
            {counted ? (
              <>
                Counted <b>{counted}</b>, {ago}
              </>
            ) : (
              "Not counted yet"
            )}
          </span>
        </div>
        <div className="sh-minor">
          <span>
            <b {...tipAttrs("seg:countries")}>{fmt(s.road.countries)}</b>countries
          </span>
          <span>
            <b {...tipAttrs("seg:operators")}>{fmt(s.road.operators)}</b>operators
          </span>
        </div>
        <div className="sh-web">
          <div>
            <span className="cs-lab">Webcams</span>
            <div className="cs-big" {...tipAttrs("web")}>
              {webCount}
            </div>
          </div>
          <div className="cs-sub">Windy layer, not in the counts above; {webWhen}.</div>
        </div>
        <h3 className="sh-sec">By region</h3>
        {regionTable(true)}
        {unplaced}
        <h3 className="sh-sec">Video and stills</h3>
        {facts(true)}
        <h3 className="sh-sec">Operators</h3>
        <div className="sh-ops">{opsButton}</div>
        {operators}
        <p className="sh-foot">Tap a number to see what it counts, where it comes from and when.</p>
      </div>
    </section>
  ) : (
    /* Placed under the strip by the layout effect above, before the first paint. Never
       hidden until then: a hidden panel cannot take focus, and its title must. */
    <section
      id={PANEL_ID}
      ref={panelRef}
      className="cs-drop"
      role="dialog"
      aria-labelledby={TITLE_ID}
      style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { left: 8, top: 46 }}
      {...tipHandlers}
    >
      <div className="cs-head">
        <h2 className="cs-title" id={TITLE_ID} ref={titleRef} tabIndex={-1}>
          Camera count
        </h2>
        <span className="cs-scope">Road and public operators</span>
        <span className={`cs-when${stale ? " is-stale" : ""}`}>
          {counted ? (
            <>
              Counted <b>{counted}</b>, {ago}
            </>
          ) : (
            "Not counted yet"
          )}
        </span>
        <button type="button" className="cs-x" aria-label="Close breakdown" onClick={() => close(true)}>
          ×
        </button>
      </div>
      {regionTable(false)}
      {unplaced}
      {facts(false)}
      <div className="cs-also">
        <span className="cs-also-k">
          <b>Webcams</b>
          <strong {...tipAttrs("web")}>{webCount}</strong>
        </span>
        <span>from Windy, on their own layer and not in the counts above.</span>
        <span className="cs-when">{webWhen}</span>
      </div>
      <div className="cs-foot">
        <p>Counts come from this server&apos;s camera list, at the times shown. Hover or focus a number to see its source.</p>
        {opsButton}
      </div>
      {operators}
    </section>
  );

  return (
    <>
      {strip}
      {phone && <div className="cs-scrim" aria-hidden="true" onClick={() => close(true)} />}
      {panel}
      {tipEl}
    </>
  );
}
