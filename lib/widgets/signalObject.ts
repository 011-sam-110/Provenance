// Pure: a SignalFeature → a clickable WorldObject for the dossier. Mirrors how
// WorldMap's SignalFeed builds signal objects, so a widget row opens the SAME
// dossier even when the map layer is off. Kept import-light (types only) so it is
// node-testable; the side-effecting open/fly action lives in openSignal.ts.

import type { SignalFeature } from "@/lib/signals/types";
import type { WorldObject } from "@/lib/world";

export function buildSignalObject(f: SignalFeature, sourceLabel: string): WorldObject {
  return {
    kind: "signal",
    id: f.id,
    lat: f.lat,
    lon: f.lon,
    label: f.title,
    color: f.color,
    typeLabel: sourceLabel,
    meta: {
      signalId: f.signalId,
      // Present on every feature the /api/signals route served. Absent only for a
      // feature built by hand, where SignalDetail falls back to the layer default.
      ...(f.precision ? { precision: f.precision } : {}),
      ...(f.countryIso3 ? { countryIso3: f.countryIso3 } : {}),
      props: f.props ?? {},
      sourceLabel,
      link: f.link,
      ts: f.ts,
      ...(f.geometry ? { geometry: f.geometry } : {}),
    },
  };
}
