"use client";
// THE MAP CLOCK: a pill of local times resting on the foot of the map stage. Mounted by
// components/terminal/StageBar.tsx inside `.tnx-stage-foot`, and (like the map controls) gone
// the instant a widget is fullscreened onto the stage.
//
// WHAT IT SHOWS. Whichever airports the person chose (lib/console/clockStore.ts, up to 8,
// defaulting to LAX JFK LHR DXB SIN HND SYD), always west to east by the CURRENT UTC offset,
// so the pill reads as a sweep across the world's time zones and follows daylight saving.
// Each clock is `LHR · United Kingdom 23:20`: the airport code is kept because one country
// spans several zones, and the country is there because a bare code is cryptic. The data and
// every rule (ordering, labels, search, the fit) are pure and live in lib/console/clockZones.ts.
//
// EACH CLOCK IS A BUTTON THAT FLIES THE MAP THERE: zoom 12, 1.6 s, or a jump under reduced
// motion (PointView.animate, lib/mapView.ts). It is the same mapViewStore.flyToPoint search and
// pins use, so it works on Globe and on Streets, and on Streets nothing else moves: the camera
// wall was filled once from the drawn ring and map moves never re-plan it.
//
// A GEAR (a real button) hangs 6px off the pill's right end, out of the flow, so showing it
// never moves a clock. It appears on hover and on keyboard focus, always on a device with no
// hover, and while the picker is open. It opens ClockPicker upward. When the map is too narrow
// for even the codes, the east-most clocks hide and the gear carries "+N".
//
// THE FIT. The pill is as wide as its clocks need, and the map's width is whatever Sources and
// the window leave it, so the label shortens as the map narrows: full country, then a short
// form (UK, UAE, US), then the code alone with the country in the tooltip. One tier for ALL
// the clocks, so they never read as a mixed row. A hidden ruler inside the foot row renders the
// three tiers of the current list; measuring it (on mount, on stage resize, on font load and
// whenever the list changes) feeds chooseClockFit. The ruler cannot be replaced by arithmetic
// on character counts: Inter is proportional and the widths decide the tier.
//
// THE PILL KEEPS ITS 26px HEIGHT AND ITS 10px FLOOR OFFSET IN EVERY TIER AND STATE, and it
// reserves nothing on the right. It publishes `--tnx-stage-foot-clear` (globals.css, the clock
// block) for the things that sit above it: the map's bottom-right controls and the Streets
// prompt read it, with a fallback, and it is 0 wherever this bar is hidden.
//
// KEYBOARD. The pill is role="toolbar" with a roving tabindex across the clocks and the gear:
// one Tab stop, Left and Right move (wrapping), Home and End jump, Enter and Space activate.
// Same pattern as components/shell/inspector/InspectorRail.tsx. While the picker is open
// Escape closes it and puts focus back on the gear; `data-owns-escape` is on the pill for that
// time so the Inspector rail's Escape handler stands down (see ClockPicker.tsx).

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import ClockPicker from "@/components/console/ClockPicker";
import { clockStore, useClockCodes } from "@/lib/console/clockStore";
import {
  chooseClockFit,
  clockAirport,
  clockLocalTime,
  goToName,
  isDayHour,
  orderWestToEast,
  type ClockAirport,
  type ClockFit,
  type ClockTier,
} from "@/lib/console/clockZones";
import { mapViewStore } from "@/lib/mapView";
import { trackStore } from "@/lib/planes/track";

/** Before mount there is no "now". A fixed winter date orders the defaults the same way all year. */
const PRE_MOUNT = new Date("2026-01-15T12:00:00Z");

/** The gear's footprint beside the pill: 26px wide plus the 6px gap. */
const GEAR_FOOTPRINT = 26 + 6;
const TIERS: readonly ClockTier[] = ["full", "short", "code"];

/** A gear: eight teeth and a hub, drawn in the same stroke style as components/shell/inspector/ToolIcons.tsx. */
function GearGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M10.28 5.11 L10.5 2.52 L13.5 2.52 L13.72 5.11 A7.1 7.1 0 0 1 15.66 5.91 L17.64 4.23 L19.77 6.36 L18.09 8.34 A7.1 7.1 0 0 1 18.89 10.28 L21.48 10.5 L21.48 13.5 L18.89 13.72 A7.1 7.1 0 0 1 18.09 15.66 L19.77 17.64 L17.64 19.77 L15.66 18.09 A7.1 7.1 0 0 1 13.72 18.89 L13.5 21.48 L10.5 21.48 L10.28 18.89 A7.1 7.1 0 0 1 8.34 18.09 L6.36 19.77 L4.23 17.64 L5.91 15.66 A7.1 7.1 0 0 1 5.11 13.72 L2.52 13.5 L2.52 10.5 L5.11 10.28 A7.1 7.1 0 0 1 5.91 8.34 L4.23 6.36 L6.36 4.23 L8.34 5.91 A7.1 7.1 0 0 1 10.28 5.11 Z" />
      <circle cx={12} cy={12} r={2.9} />
    </svg>
  );
}

/** The country text a tier shows, or null for the code tier. */
function tierCountry(a: ClockAirport, tier: ClockTier): string | null {
  if (tier === "code") return null;
  return tier === "full" ? a.country : (a.short ?? a.country);
}

/** What one clock prints inside its button. The ruler uses it too, so the two cannot drift. */
function ClockFace({ a, tier, time }: { a: ClockAirport; tier: ClockTier; time: string }) {
  const country = tierCountry(a, tier);
  return (
    <>
      <span className="tn-wc-city">{a.code}</span>
      {country !== null && (
        <>
          <span className="tn-wc-sep" aria-hidden="true">
            {"·"}
          </span>
          <span className="tn-wc-country">{country}</span>
        </>
      )}
      <span className="tn-wc-time tn-num">{time}</span>
    </>
  );
}

/**
 * The hover / focus tooltip: `Go to <airport>` over `<city>, <country>`, 10px above the pill,
 * centred on its clock and clamped inside the stage. Purely visual (the button already has an
 * aria-label and a description), so it is aria-hidden. Its own component so the layout effect
 * that places it only ever runs on the client, after a pointer or a key asked for it. It is a
 * child of the pill and finds its clock and the stage from there.
 */
function ClockTip({ a }: { a: ClockAirport }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const tip = ref.current;
    const pill = tip?.parentElement;
    const anchor = pill?.querySelector<HTMLElement>(`.tn-wc-go[data-code="${a.code}"]`);
    if (!tip || !pill || !anchor) return;
    const stage = pill.closest<HTMLElement>(".tn-cw-stage");
    const b = anchor.getBoundingClientRect();
    const p = pill.getBoundingClientRect();
    const s = stage ? stage.getBoundingClientRect() : { left: 0, right: window.innerWidth };
    const w = tip.offsetWidth;
    let left = b.left + b.width / 2 - w / 2;
    left = Math.max(s.left + 8, Math.min(left, s.right - 8 - w));
    // `left` is measured from the pill's padding box, which starts inside its 1px border.
    tip.style.left = `${Math.round(left - p.left - pill.clientLeft)}px`;
  });
  return (
    <div className="tn-wc-tip" ref={ref} aria-hidden="true">
      <b>Go to {a.airport}</b>
      <span>
        {a.city}, {a.country}
      </span>
    </div>
  );
}

export default function WorldClock() {
  const uid = useId();
  const codes = useClockCodes();
  const [now, setNow] = useState<Date | null>(null);
  const [open, setOpen] = useState(false);
  const [fit, setFit] = useState<ClockFit | null>(null);
  const [stageH, setStageH] = useState(0);
  const [tabStop, setTabStop] = useState(0);
  const [tipCode, setTipCode] = useState<string | null>(null);

  const pillRef = useRef<HTMLDivElement | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const gearRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate the saved list and start the minute tick. The store's server snapshot (and so the
  // first client render) is the defaults; hydrate reads, it never writes.
  useEffect(() => {
    clockStore.hydrate();
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000); // minute precision, kept fresh
    return () => clearInterval(t);
  }, []);

  const ordered = useMemo(
    () => orderWestToEast(codes.flatMap((c) => clockAirport(c) ?? []), now ?? PRE_MOUNT),
    [codes, now],
  );
  const listKey = ordered.map((a) => a.code).join(",");

  // ── The fit ────────────────────────────────────────────────────────────────
  // useLayoutEffect, so that adding a clock is measured before the browser paints it.
  useLayoutEffect(() => {
    const pill = pillRef.current;
    const ruler = rulerRef.current;
    if (!pill || !ruler) return;
    const stage = pill.closest<HTMLElement>(".tn-cw-stage") ?? pill.parentElement;
    if (!stage) return;
    let raf = 0;
    let dead = false;

    const measure = () => {
      if (dead) return;
      const rows = Array.from(ruler.querySelectorAll<HTMLElement>("[data-tier]"));
      const row = (t: ClockTier) => rows.find((r) => r.dataset.tier === t);
      const full = row("full");
      const short = row("short");
      const code = row("code");
      if (!full || !short || !code) return;
      const w = (el: HTMLElement) => el.getBoundingClientRect().width;
      // Display:none (a phone, or a very narrow stage) measures as zero: keep what we had.
      if (w(code) === 0) return;
      const cells = Array.from(code.querySelectorAll<HTMLElement>(".tn-wc-cell")).map(w);
      const cellSum = cells.reduce((a, b) => a + b, 0);
      const more = ruler.querySelector<HTMLElement>("[data-gear-more]");
      const next = chooseClockFit({
        avail: stage.clientWidth - 16,
        widths: { full: Math.ceil(w(full)), short: Math.ceil(w(short)), code: Math.ceil(w(code)) },
        codeWidths: cells.map((c) => Math.ceil(c)),
        pillChrome: Math.ceil(w(code) - cellSum),
        gear: GEAR_FOOTPRINT,
        gearMore: (more ? Math.ceil(w(more)) : 46) + 6,
      });
      setFit((prev) =>
        prev && prev.tier === next.tier && prev.shown === next.shown && prev.shift === next.shift ? prev : next,
      );
      setStageH(stage.clientHeight);
    };

    measure();
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(stage);
    ruler.querySelectorAll("[data-tier]").forEach((el) => ro.observe(el));
    // The web font changes every width: measure again once it has loaded.
    void document.fonts?.ready.then(schedule);
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [listKey]);

  const shown = fit ? ordered.slice(0, fit.shown) : ordered;
  const hidden = ordered.length - shown.length;
  const gearIdx = shown.length;
  const stop = Math.min(tabStop, gearIdx);

  // ── Tooltip: hover waits 250 ms, keyboard focus shows it at once, touch never ──
  const clearTip = useCallback(() => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    tipTimer.current = null;
    setTipCode(null);
  }, []);
  const showTip = useCallback((code: string, immediate: boolean) => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    if (immediate) setTipCode(code);
    else tipTimer.current = setTimeout(() => setTipCode(code), 250);
  }, []);
  useEffect(
    () => () => {
      if (tipTimer.current) clearTimeout(tipTimer.current);
    },
    [],
  );

  // ── Picker ─────────────────────────────────────────────────────────────────
  const panelId = `${uid}-picker`;
  const closePicker = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) gearRef.current?.focus();
  }, []);

  // A press outside the bar and its panel closes the picker. pointerdown, not click, so it is
  // gone before the click lands on whatever is underneath it. Focus is left where it went.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!pillRef.current?.contains(e.target as Node)) closePicker(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open, closePicker]);

  // ── Teleport ───────────────────────────────────────────────────────────────
  const flyTo = (a: ClockAirport) => {
    // Grabbing the map breaks a live plane follow (WorldMap.tsx); a flight we start does the same.
    if (trackStore.get().mode === "follow") trackStore.setMode("recenter");
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    mapViewStore.flyToPoint({ lat: a.lat, lon: a.lon, zoom: 12, animate: !reduced });
  };

  // ── Toolbar keys ───────────────────────────────────────────────────────────
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      closePicker(true);
      return;
    }
    const items = itemRefs.current.slice(0, gearIdx + 1).filter((el): el is HTMLButtonElement => el !== null);
    const at = items.indexOf(e.target as HTMLButtonElement);
    // Keys typed inside the picker belong to the picker.
    if (at < 0) return;
    let next = -1;
    if (e.key === "ArrowRight") next = (at + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (at - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    items[next]?.focus();
  };

  if (ordered.length === 0) return null; // no zone this browser can name: show nothing, never a wrong time

  const tipAirport = tipCode ? shown.find((a) => a.code === tipCode) : undefined;
  const when = now ?? PRE_MOUNT;
  const tier: ClockTier = fit?.tier ?? "code";

  return (
    <>
      <div
        ref={pillRef}
        className="tn-worldclock"
        role="toolbar"
        aria-label="World clock"
        data-tier={tier}
        data-open={open ? "" : undefined}
        data-owns-escape={open ? "" : undefined}
        style={
          {
            transform: fit && fit.shift ? `translateX(-${fit.shift}px)` : undefined,
            // Hidden until the first measure, so a tier that does not fit is never painted.
            visibility: fit ? undefined : "hidden",
            "--tn-wc-stage-h": stageH ? `${stageH}px` : undefined,
          } as React.CSSProperties
        }
        onKeyDown={onKeyDown}
      >
        {shown.map((a, i) => {
          const t = now ? clockLocalTime(a.zone, now) : null;
          const time = t ? t.time : "--:--";
          const day = t ? isDayHour(t.hour) : true;
          const descId = `${uid}-d-${a.code}`;
          return (
            <div key={a.code} className={`tn-wc-cell ${day ? "is-day" : "is-night"}`}>
              <button
                type="button"
                className="tn-wc-go"
                data-zone={a.zone}
                data-code={a.code}
                aria-label={goToName(a)}
                aria-describedby={descId}
                tabIndex={stop === i ? 0 : -1}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                onClick={() => flyTo(a)}
                onFocus={(e) => {
                  setTabStop(i);
                  // :focus-visible is keyboard focus; a mouse click or a tap does not match.
                  if (e.currentTarget.matches(":focus-visible")) showTip(a.code, true);
                }}
                onBlur={clearTip}
                onPointerEnter={(e) => {
                  if (e.pointerType !== "touch" && !open) showTip(a.code, false);
                }}
                onPointerLeave={clearTip}
              >
                <ClockFace a={a} tier={tier} time={time} />
              </button>
              <span id={descId} className="tn-sr-only">
                {a.city}, {a.country}, {time}
              </span>
            </div>
          );
        })}

        {tipAirport && !open && <ClockTip a={tipAirport} />}

        <div className="tn-wc-more">
          <button
            type="button"
            ref={(el) => {
              gearRef.current = el;
              itemRefs.current[gearIdx] = el;
            }}
            className="tn-wc-gear"
            data-more={hidden > 0 ? "" : undefined}
            aria-label={hidden > 0 ? `Choose clocks, ${hidden} hidden` : "Choose clocks"}
            aria-expanded={open}
            aria-controls={panelId}
            tabIndex={stop === gearIdx ? 0 : -1}
            onFocus={() => setTabStop(gearIdx)}
            onClick={() => {
              clearTip();
              setOpen((o) => !o);
            }}
          >
            <GearGlyph />
            {hidden > 0 && <span className="tn-wc-gear-n tn-num">+{hidden}</span>}
          </button>
          {open && <ClockPicker id={panelId} codes={codes} now={when} onClose={closePicker} />}
        </div>
      </div>

      {/* The ruler: all three tiers of the current list, invisible and out of flow, measured by
          the fit above. It lives in the foot row so it inherits the pill's exact CSS. */}
      <div className="tn-wc-ruler" ref={rulerRef} aria-hidden="true">
        {TIERS.map((t) => (
          <div key={t} className="tn-worldclock tn-wc-measure" data-tier={t}>
            {ordered.map((a) => (
              <div key={a.code} className="tn-wc-cell">
                <span className="tn-wc-go">
                  <ClockFace a={a} tier={t} time="00:00" />
                </span>
              </div>
            ))}
          </div>
        ))}
        <span className="tn-wc-gear tn-wc-measure-gear" data-gear-more="" data-more="">
          <GearGlyph />
          <span className="tn-wc-gear-n tn-num">+9</span>
        </span>
      </div>
    </>
  );
}
