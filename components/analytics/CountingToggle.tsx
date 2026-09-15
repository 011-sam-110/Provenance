"use client";

// The /privacy opt-out. UK PECR Schedule A1 exempts the page-view counter only with "a
// simple means of objecting", and the ICO says Do Not Track alone is not one. So here it is.
//
// It RELOADS instead of stopping posthog-js in place. opt_out_capturing() would store its
// own marker, and in posthog-js 1.428.1 that marker can only be localStorage or a cookie.
// After the reload, Beacon.tsx's armedConfig() sees the flag and never imports the library,
// so the tab provably stops.
//
// Renders nothing on the server: the state lives in this browser, and guessing it at
// render time would cause a hydration mismatch.

import { useEffect, useState } from "react";
import { beaconConfig } from "@/lib/analytics/beacon";
import {
  countingState,
  currentTimeZone,
  isOptedOut,
  optIn,
  optOut,
  privacySignal,
  type CountingState,
} from "@/lib/analytics/optOut";

const COPY: Record<CountingState, string> = {
  not_configured: "This copy of the site runs no page-view counter.",
  signal: "Your browser asks not to be tracked, so it is not counted.",
  excluded_zone: "Your browser is set to Germany's time zone, so it is not counted.",
  opted_out: "This browser is not counted.",
  counted: "This browser is counted.",
};

export function CountingToggle() {
  const [state, setState] = useState<CountingState | null>(null);

  useEffect(() => {
    setState(
      countingState({
        configured: beaconConfig() !== null,
        optedOut: isOptedOut(),
        signal: privacySignal(navigator, window as Window & { doNotTrack?: string | null }),
        timeZone: currentTimeZone(),
      }),
    );
  }, []);

  if (state === null) return null;

  const flip = () => {
    if (state === "counted") optOut();
    else optIn();
    window.location.reload();
  };

  return (
    <p className="pv-counting" role="status">
      <span>{COPY[state]}</span>
      {(state === "counted" || state === "opted_out") && (
        <button type="button" id="pv-counting-toggle" className="pv-counting-btn" onClick={flip}>
          {state === "counted" ? "Stop counting this browser" : "Count this browser again"}
        </button>
      )}
    </p>
  );
}
