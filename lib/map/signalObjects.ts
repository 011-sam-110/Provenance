// A signal source's rows, as map objects.
//
// ONE FUNCTION FOR TWO CALLERS. WorldMap's <SignalFeed> turns what a switched-on layer
// reads into the objects the map draws, and the Sources rail's hover PREVIEW
// (lib/shell/sourcePreview.ts) turns what a switched-off source reads into the same
// objects. Both go through here so a preview cannot look different from the real thing:
// the same colour, the same precision, the same line pattern, the same dossier fields.

import type { WorldObject } from "@/lib/world";
import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { resolvePrecision } from "@/lib/signals/precision";

export function toSignalObjects(features: SignalFeature[], source: SignalSource): WorldObject[] {
  return features.map((f) => ({
    kind: "signal",
    id: f.id,
    lat: f.lat,
    lon: f.lon,
    label: f.title,
    color: f.color ?? source.color,
    typeLabel: source.label,
    meta: {
      signalId: f.signalId,
      // How precise the place is. The route writes the resolved level on
      // every feature; the layer default covers a payload that predates it.
      precision: resolvePrecision(f, source),
      // The country a country-level feature stands for (ISO alpha-3), so the
      // map can shade its outline. See lib/map/precisionMarks.ts.
      ...(f.countryIso3 ? { countryIso3: f.countryIso3 } : {}),
      props: f.props ?? {},
      attribution: source.attribution,
      sourceLabel: source.label,
      link: f.link,
      // Provider dataset/home URL for the dossier's mandatory clickable
      // source (used when a feature carries no deep record link). Optional
      // on the adapter; SignalDetail falls back to the keyed provider table.
      sourceUrl: source.sourceUrl,
      // ISO timestamp (when known) — the global time-window filter reads
      // this; untimed features have no ts and are always shown.
      ts: f.ts,
      // Carries line/area geometry (cables, jamming) through to the
      // line/fill builders in lib/map/features; absent for point signals.
      ...(f.geometry ? { geometry: f.geometry } : {}),
      // A road notice's line pattern (dash, dot, bar); absent is solid.
      ...(f.line ? { line: f.line } : {}),
    },
  }));
}
