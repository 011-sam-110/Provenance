"use client";
// The tile overlay itself. Presentational only — every string it renders was
// already decided by camslot.conditions.ts, and every threshold (density, tier
// colour) is a prop or a CSS rule keyed off `data-tier`/`data-density`. This file
// adds no wording of its own; it calls the same pure functions the rest of the
// feature calls and renders their output.
//
// aria-hidden on the whole root: camslot.tsx:365's `.tn-cs-sr` region is the
// accessible route through a rotating slot (deliberately `aria-live="off"`, because
// an auto-changing region must not interrupt a screen-reader user indefinitely).
// This overlay would be a second, uncoordinated announcement of the same tile, so
// it stays out of the accessibility tree entirely rather than adding one.
//
// `now` is a PROP, not read from Date.now() in here, so the clock ticks on the
// parent's single 30s interval (see camslot.tsx) instead of every mounted overlay
// running its own timer.

import { frameAge, type Claim, type Density } from "@/lib/console/widgets/camslot.conditions";

export function CamslotConditions({
  claim,
  weather,
  place,
  refreshSeconds,
  lastSampledAt,
  density,
  now,
}: {
  claim: Claim;
  weather: { text: string; title: string } | null;
  place: { clock: string; offset: string };
  refreshSeconds: number;
  lastSampledAt: string | undefined;
  density: Density;
  now: number;
}) {
  if (density === "hidden") return null;

  const mark = claim.tier === "measured" ? "●" : claim.tier === "derived" || claim.tier === "modelled" ? "~" : "";

  if (density === "compact") {
    return (
      <div className="tn-cscond" data-tier={claim.tier} data-density={density} aria-hidden="true">
        <div className="tn-cscond-row">
          {claim.label && <span className="tn-cscond-label">{claim.label}</span>}
          {mark && (
            <span className="tn-cscond-mark" aria-hidden="true">
              {mark}
            </span>
          )}
          {/* Titles carried in COMPACT too. A small tile is exactly where the one
              visible line has least room to explain itself, so dropping the
              explanation here would remove it from the case that needs it most. */}
          <span className="tn-cscond-claim" title={claim.title}>
            {claim.text}
          </span>
          {weather && (
            <span className="tn-cscond-wx" title={weather.title}>
              {weather.text}
            </span>
          )}
          <span className="tn-cscond-time">{place.clock}</span>
        </div>
      </div>
    );
  }

  const age = frameAge(lastSampledAt, refreshSeconds, now);

  return (
    <div className="tn-cscond" data-tier={claim.tier} data-density={density} aria-hidden="true">
      <div className="tn-cscond-row">
        {claim.label && <span className="tn-cscond-label">{claim.label}</span>}
        {mark && (
          <span className="tn-cscond-mark" aria-hidden="true">
            {mark}
          </span>
        )}
        <span className="tn-cscond-claim" title={claim.title}>
          {claim.text}
        </span>
        {weather && (
          <span className="tn-cscond-wx" title={weather.title}>
            {weather.text}
          </span>
        )}
      </div>
      <div className="tn-cscond-row">
        <span className="tn-cscond-time">
          {place.clock} {place.offset}
        </span>
        <span className="tn-cscond-age" title={age.title}>
          · {age.text}
        </span>
      </div>
    </div>
  );
}
