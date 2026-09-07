"use client";
// kind → detail-component registry for the feed overlay.
//
// <FeedOverlay> renders <OverlayBody object={openObject} />; this switch maps a
// WorldObject.kind to its detail view:
//   • camera    → live proxied image + mandatory attribution (CameraDetail)
//   • satellite → identity + Esri satellite imagery of the ground beneath it
//   • plane     → live flight info (callsign, altitude, speed, heading)
//   • area      → a saved Inspector area: its shape, what it has on, load/remove

import type { WorldObject } from "@/lib/world";
import { CameraDetail } from "@/components/CameraDetail";
import SatelliteDetail from "@/components/SatelliteDetail";
import PlaneDetail from "@/components/PlaneDetail";
import WebcamDetail from "@/components/WebcamDetail";
import SignalDetail from "@/components/SignalDetail";
import CountryDetail from "@/components/CountryDetail";
import AreaDetail from "@/components/shell/inspector/AreaDetail";

export function OverlayBody({ object }: { object: WorldObject }) {
  switch (object.kind) {
    case "camera":
      return <CameraDetail object={object} />;
    case "satellite":
      return <SatelliteDetail object={object} />;
    case "plane":
      return <PlaneDetail object={object} />;
    case "webcam":
      return <WebcamDetail object={object} />;
    case "signal":
      return <SignalDetail object={object} />;
    case "country":
      return <CountryDetail object={object} />;
    case "area":
      return <AreaDetail object={object} />;
    default:
      return null;
  }
}
