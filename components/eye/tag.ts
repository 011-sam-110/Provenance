"use client";
// A vessel, aircraft or street tag in the God's eye view, the DOM half: a plate with a
// coloured edge, hung off a short leader from its object. Text goes in through
// textContent only. Words come from lib/eye/traffic.ts and lib/eye/streets.ts.
//
// A vessel's or aircraft's plate is a BUTTON when it is given `onSelect`: a click, a tap
// or Enter opens that mark's details (components/eye/DetailPanel.tsx). The tag stays
// pointer-events: none, so only the plate takes a click and the rest of the scene still
// pans; a drag that starts on the plate must pan the map and select nothing, which is
// what the guard below is for. A road tag and a recording's tag stay plain text.

import maplibregl from "maplibre-gl";
import { estimateTextWidth } from "@/lib/eye/declutter";
import styles from "./eye.module.css";

/** "signal" is a console layer's mark (UK street crime, a quake): its colour is the layer's own, inline. */
export type TagKind = "ship" | "plane" | "road" | "signal";

/** Plate padding, edge and letter spacing, beyond the text itself. */
const PLATE_EXTRA = 19;
const MAX_TAG_WIDTH = 240;

/** The plate's size for collision, before the DOM exists. */
export function tagSize(title: string, meta: string, phone: boolean): { width: number; height: number } {
  const t = estimateTextWidth(title, phone ? 10.5 : 11.5) * 1.03;
  const m = estimateTextWidth(meta, phone ? 9.5 : 10.5);
  return { width: Math.min(MAX_TAG_WIDTH, Math.max(t, m) + PLATE_EXTRA), height: phone ? 34 : 38 };
}

/** A pointer that moved further than this between press and release was a pan, not a click. */
const DRAG_PX = 4;

export class Tag {
  readonly el: HTMLDivElement;
  private readonly plate: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly metaEl: HTMLElement;
  private readonly noun: string | null;
  private marker: maplibregl.Marker | null = null;
  private flip = false;

  constructor(kind: TagKind, opts?: { onSelect?: () => void; color?: string }) {
    const el = document.createElement("div");
    el.className = styles.tag;
    el.dataset.kind = kind;
    if (opts?.color) el.style.setProperty("--c", opts.color);
    const leader = document.createElement("i");
    leader.className = styles.leader;
    const onSelect = opts?.onSelect;
    this.noun = onSelect ? (kind === "plane" ? "aircraft details" : "vessel details") : null;
    let plate: HTMLElement;
    if (onSelect) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `${styles.tagPlate} ${styles.tagBtn}`;
      el.dataset.interactive = "";
      // The drag guard: where the pointer went down. A mouse or finger that has moved
      // since is a pan that began on the plate (the map takes it), not a choice.
      let down: { x: number; y: number } | null = null;
      button.addEventListener("pointerdown", (e) => {
        down = { x: e.clientX, y: e.clientY };
      });
      button.addEventListener("click", (e) => {
        // A keyboard click has detail 0 and always selects.
        if (e.detail > 0 && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_PX) return;
        onSelect();
      });
      plate = button;
    } else {
      plate = document.createElement("div");
      plate.className = styles.tagPlate;
    }
    this.plate = plate;
    this.titleEl = document.createElement("b");
    this.metaEl = document.createElement("span");
    plate.append(this.titleEl, this.metaEl);
    el.append(leader, plate);
    this.el = el;
  }

  setText(title: string, meta: string): void {
    if (this.titleEl.textContent !== title) this.titleEl.textContent = title;
    if (this.metaEl.textContent !== meta) this.metaEl.textContent = meta;
    if (this.noun) {
      const label = `${title}, ${this.noun}`;
      if (this.plate.getAttribute("aria-label") !== label) this.plate.setAttribute("aria-label", label);
    }
  }

  /** Ring the plate of the mark whose details are open. */
  setSelected(on: boolean): void {
    if (on) this.el.dataset.selected = "";
    else delete this.el.dataset.selected;
  }

  /** Put keyboard focus on the plate, when it is a button. */
  focusPlate(): void {
    if (this.noun) this.plate.focus({ preventScroll: true });
  }

  /**
   * Put the tag at its object. A side change rebuilds the marker, because a marker's
   * anchor is fixed when it is made; a move only moves it.
   */
  show(map: maplibregl.Map, lngLat: [number, number], flip: boolean): void {
    if (this.marker && this.flip === flip) {
      this.marker.setLngLat(lngLat);
      return;
    }
    this.marker?.remove();
    this.flip = flip;
    if (flip) this.el.dataset.flip = "1";
    else delete this.el.dataset.flip;
    this.marker = new maplibregl.Marker({ element: this.el, anchor: flip ? "bottom-right" : "bottom-left" })
      .setLngLat(lngLat)
      .addTo(map);
  }

  remove(): void {
    this.marker?.remove();
    this.marker = null;
  }
}
