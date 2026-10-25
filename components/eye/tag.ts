"use client";
// A vessel, aircraft or street tag in the God's eye view, the DOM half: a plate with a
// coloured edge, hung off a short leader from its object. Text goes in through
// textContent only. Words come from lib/eye/traffic.ts and lib/eye/streets.ts.

import maplibregl from "maplibre-gl";
import { estimateTextWidth } from "@/lib/eye/declutter";
import styles from "./eye.module.css";

export type TagKind = "ship" | "plane" | "road";

/** Plate padding, edge and letter spacing, beyond the text itself. */
const PLATE_EXTRA = 19;
const MAX_TAG_WIDTH = 240;

/** The plate's size for collision, before the DOM exists. */
export function tagSize(title: string, meta: string, phone: boolean): { width: number; height: number } {
  const t = estimateTextWidth(title, phone ? 10.5 : 11.5) * 1.03;
  const m = estimateTextWidth(meta, phone ? 9.5 : 10.5);
  return { width: Math.min(MAX_TAG_WIDTH, Math.max(t, m) + PLATE_EXTRA), height: phone ? 34 : 38 };
}

export class Tag {
  readonly el: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  private readonly metaEl: HTMLElement;
  private marker: maplibregl.Marker | null = null;
  private flip = false;

  constructor(kind: TagKind) {
    const el = document.createElement("div");
    el.className = styles.tag;
    el.dataset.kind = kind;
    const leader = document.createElement("i");
    leader.className = styles.leader;
    const plate = document.createElement("div");
    plate.className = styles.tagPlate;
    this.titleEl = document.createElement("b");
    this.metaEl = document.createElement("span");
    plate.append(this.titleEl, this.metaEl);
    el.append(leader, plate);
    this.el = el;
  }

  setText(title: string, meta: string): void {
    if (this.titleEl.textContent !== title) this.titleEl.textContent = title;
    if (this.metaEl.textContent !== meta) this.metaEl.textContent = meta;
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
