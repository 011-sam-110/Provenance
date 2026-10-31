"use client";
// The details of the vessel, aircraft or TfL road notice that was clicked in the God's eye view: docked
// on the right on a wide screen, a bottom sheet on a phone (eye.module.css).
//
// IT WRITES NO WORDS OF ITS OWN. Every label, value, note and credit is built by
// lib/eye/detail.ts, which says who set each value; this file lays a model out. The
// panel is a dialog that does not trap focus (aria-modal is false): the scene behind it
// stays live, and its own Close button, Escape and a click on empty water all end it.
//
// IT NEVER RENDERS PER FRAME. It reads the clock when it opens, again every 5 s (or at
// each step of a film's clock) for the ages it prints, and when the mark's report
// changes: EyeOverlay hands it a new subject at each feed refresh, never in between.

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  PANEL_WORDS,
  NOT_SENT,
  aircraftDetail,
  distanceText,
  noticeGoneText,
  roadDetail,
  staleText,
  vesselDetail,
  type DetailModel,
} from "@/lib/eye/detail";
import type { PickKind } from "@/lib/eye/pick";
import type { StreetDisruption, StreetPaint } from "@/lib/eye/streets";
import type { Aircraft, Vessel } from "@/lib/eye/traffic";
import type { EyeClock } from "@/lib/eye/motion";
import styles from "./eye.module.css";

export type DetailSubject =
  | { kind: "ship"; v: Vessel }
  | { kind: "plane"; a: Aircraft; pulledAt: number | null; drawn?: "lowered" | "unsent" | null }
  | { kind: "road"; d: StreetDisruption; fetchedAt: number | null };

export interface AlsoHere {
  id: string;
  kind: PickKind;
  name: string;
  metres: number;
  /** A road notice's paint, for its chip's mark. */
  paint?: StreetPaint;
}

interface Props {
  subject: DetailSubject;
  /** The marks that sit close to this one, nearest first. */
  also: AlsoHere[];
  /** Set when the mark is not in the latest report: when it was last heard. */
  staleSince: number | null;
  clock: EyeClock;
  onClose(): void;
  onPick(id: string, kind: PickKind): void;
  /** The panel's box changed (it opened, closed or switched mark): place the tags around it. */
  onLayout(): void;
}

/** The view's own chevron, the mark of a vessel or an aircraft (EyeOverlay's `chevron`). */
function Chevron({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-32 -32 64 64" aria-hidden="true">
      <path d="M0 -25L17 21L0 11L-17 21Z" />
    </svg>
  );
}

/**
 * A road notice's mark: a short stretch of its own paint on a dark casing (the map's own
 * patterns, EyeOverlay's eye-selected-* layers). Works are rose dashes, an incident violet
 * dots, a closure rose bars on white. Never one solid colour.
 */
function RoadMark({ paint, className }: { paint: StreetPaint; className?: string }) {
  // The colours come from the view's own tokens (eye.module.css), through `style`: a
  // `var()` is not reliable in an SVG presentation attribute.
  const stroke = (colour: string, width: number, dash?: string, cap: "butt" | "round" = "butt") => (
    <line x1="2" y1="15" x2="18" y2="5" style={{ stroke: colour }} strokeWidth={width} strokeDasharray={dash} strokeLinecap={cap} />
  );
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true">
      {stroke("rgba(3,7,9,0.9)", 7, undefined, "round")}
      {paint === "closed" ? (
        <>
          {stroke("#eef3f1", 4.4)}
          {stroke("var(--eye-road)", 4.4, "3.2 3.2")}
        </>
      ) : paint === "incident" ? (
        stroke("var(--eye-incident)", 4, "0 5.4", "round")
      ) : (
        stroke("var(--eye-road)", 3.2, "4 2.8")
      )}
    </svg>
  );
}

const TICK_MS = 5_000;

export default function DetailPanel({ subject, also, staleSince, clock, onClose, onPick, onLayout }: Props) {
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    setNow(clock.now());
    if (clock.film) return clock.subscribe(() => setNow(clock.now()));
    const t = setInterval(() => setNow(clock.now()), TICK_MS);
    return () => clearInterval(t);
  }, [clock]);

  const model: DetailModel =
    subject.kind === "ship"
      ? vesselDetail(subject.v, now)
      : subject.kind === "plane"
        ? aircraftDetail(subject.a, now, subject.pulledAt, subject.drawn ?? null)
        : roadDetail(subject.d, now, subject.fetchedAt);
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Focus moves to the name when the panel opens and when another mark is chosen, so a
  // keyboard or a screen reader lands on what changed. Not at each refresh of the same one.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [model.id]);

  // The panel's box is part of the frame the tags are placed around: tell EyeOverlay when
  // it appears, changes mark and goes.
  const layout = useRef(onLayout);
  layout.current = onLayout;
  useLayoutEffect(() => {
    layout.current();
  }, [model.id]);
  useLayoutEffect(() => () => layout.current(), []);

  const figures = model.readout.length;
  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-eye-keep
      data-kind={model.kind}
      data-paint={model.paint}
      className={styles.detail}
    >
      <header className={styles.dHead}>
        {model.paint ? <RoadMark paint={model.paint} className={styles.dMark} /> : <Chevron className={styles.dMark} />}
        <div className={styles.dName}>
          <h2 id={titleId} ref={headingRef} tabIndex={-1}>
            {model.title}
          </h2>
          <p>{model.kindLine}</p>
        </div>
        <button type="button" className={styles.btn} onClick={onClose}>
          {PANEL_WORDS.close}
        </button>
      </header>

      {staleSince != null && (
        <p className={styles.dStale} role="status">
          {subject.kind === "road" ? noticeGoneText(staleSince, now) : staleText(staleSince)}
        </p>
      )}

      <div className={styles.dRead} style={figures === 4 ? ({ "--n": 2 } as React.CSSProperties) : undefined}>
        {model.readout.map((r) => (
          <div key={r.label}>
            <b className={r.value == null ? styles.dNone : undefined}>{r.value ?? NOT_SENT}</b>
            <span>{r.label}</span>
          </div>
        ))}
      </div>

      {also.length > 0 && (
        <div className={styles.dAlso}>
          <h3>{PANEL_WORDS.also}</h3>
          <ul>
            {also.map((m) => (
              <li key={m.id}>
                <button type="button" className={styles.alsoBtn} data-kind={m.kind} onClick={() => onPick(m.id, m.kind)}>
                  {m.kind === "road" ? <RoadMark paint={m.paint ?? "works"} /> : <Chevron />}
                  <span>{m.name}</span>
                  <small>{distanceText(m.metres)}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.dBody}>
        {model.prose?.map((p) => (
          <div key={p.heading} className={styles.dGroup}>
            <h3>{p.heading}</h3>
            <p className={styles.dProse}>{p.text}</p>
          </div>
        ))}
        {model.groups.map((g) => (
          <div key={g.heading} className={styles.dGroup}>
            <h3>{g.heading}</h3>
            <dl>
              {g.rows.map((r, i) => (
                // A label may repeat (one "Street named" row for each street TfL names).
                <div key={`${r.label}:${i}`} style={{ display: "contents" }}>
                  <dt>{r.label}</dt>
                  <dd>
                    {r.value}
                    {r.note && <small>{r.note}</small>}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      <footer className={styles.dFoot}>
        {model.note && <p>{model.note}</p>}
        <p>{model.credit}</p>
      </footer>
    </section>
  );
}
