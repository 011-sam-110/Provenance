// Shared contract for everything clickable on the globe.
//
// react-globe.gl is a SINGLE component instance, so cameras, satellites and
// planes cannot be independent React subtrees — they all feed one <Globe>.
// This type is the seam that lets each data layer be built in isolation:
// a layer's only job is to emit WorldObject[]; GlobeView renders them and
// the overlay displays the clicked one. No layer imports another.

import type { IconKey } from "@/lib/icons/svg";

export type WorldObjectKind = "camera" | "satellite" | "plane" | "webcam" | "signal" | "country" | "area";

export interface WorldObject {
  kind: WorldObjectKind;
  /** Globally-unique, namespaced id, e.g. "tfl:JamCams_00001", "sat:25544", "plane:3c4b2d". */
  id: string;
  lat: number;
  lon: number;
  /**
   * Height ABOVE the Earth's surface, in kilometres.
   * - camera: omit / 0 (sits on the ground)
   * - plane:  flight altitude (~0–13 km)
   * - satellite: orbital altitude (~400–36000 km) — GlobeView compresses this
   *   onto a visible shell; the raw value is preserved here for the detail view.
   */
  altKm?: number;
  /** Heading in degrees clockwise from north — planes orient to this. */
  heading?: number;
  /** Short human label shown on hover and as the overlay title. */
  label: string;
  /** Optional marker colour override (CSS hex). Layers may set their own palette. */
  color?: string;
  /** Which type icon to render on the globe / map / legend (see lib/icons/svg.ts). */
  icon?: IconKey;
  /** Human-readable type label for the overlay, e.g. "Airliner", "Starlink". */
  typeLabel?: string;
  /**
   * Kind-specific extras the detail view needs but the globe does not.
   * e.g. camera: { imageUrl }, plane: { callsign, origin, velocity },
   *      satellite: { noradId, objectName, footprintKm }.
   */
  meta?: Record<string, unknown>;
}
