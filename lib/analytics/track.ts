// Named usage events for the analytics beacon. PURE and dependency-free: it imports
// nothing from posthog-js, so a call site in a store or a component never pulls the
// library into the main bundle. Beacon.tsx binds the client once PostHog has loaded.
// Until then, and for every browser that is not counted, track() does nothing.
//
// ENUMERATED VALUES ONLY. No free text, no coordinates, no camera or object ids, no area
// names. /privacy says each action is "recorded with the type of thing, never with a place,
// a name or anything you typed". eventProperties() is where that sentence is made true.
// The signal registry is NOT imported to validate layer ids: that would put every adapter
// in the client bundle (see CLAUDE.md). A short-slug rule does the same job for privacy.
//
// Spec: docs/superpowers/specs/2026-09-14-returning-visitors-design.md

import type { WorldObjectKind } from "@/lib/world";

export type UsageEvent =
  | { name: "object_opened"; kind: WorldObjectKind }
  | { name: "board_switched"; board: string }
  | { name: "layer_toggled"; layer: string }
  | { name: "share_link_copied"; what: "view" | "layout" }
  | { name: "alert_armed" };

export interface BeaconClient {
  capture(event: string, properties?: Record<string, string>): unknown;
}

/** A Record, not a Set, so adding a WorldObjectKind is a compile error until it is listed. */
const OBJECT_KINDS: Record<WorldObjectKind, true> = {
  camera: true,
  satellite: true,
  plane: true,
  webcam: true,
  signal: true,
  country: true,
  area: true,
};

/** Preset ids, layer keys and signal ids are all lowercase slugs. Anything else is dropped. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The properties an event may send, or null when it must not be sent at all. */
export function eventProperties(e: UsageEvent): Record<string, string> | null {
  switch (e.name) {
    case "object_opened":
      return Object.prototype.hasOwnProperty.call(OBJECT_KINDS, e.kind) ? { kind: e.kind } : null;
    case "board_switched":
      return SLUG.test(e.board) ? { board: e.board } : null;
    case "layer_toggled":
      return SLUG.test(e.layer) ? { layer: e.layer } : null;
    case "share_link_copied":
      return e.what === "view" || e.what === "layout" ? { what: e.what } : null;
    case "alert_armed":
      return {};
  }
}

let client: BeaconClient | null = null;

export function bindBeacon(next: BeaconClient | null): void {
  client = next;
}

export function track(e: UsageEvent): void {
  if (!client) return;
  const props = eventProperties(e);
  if (!props) return;
  try {
    client.capture(e.name, props);
  } catch {
    /* Analytics must never break the product. */
  }
}
