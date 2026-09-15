// Who is NOT counted. UK PECR Schedule A1 asks for a simple, free way to object that does
// not rely only on browser settings, and Sam chose on 2026-09-14 not to load the beacon
// in German time zones. Every rule here decides whether posthog-js is even fetched.

import { describe, it, expect } from "vitest";
import {
  countingState,
  isOptedOut,
  optIn,
  optOut,
  OPT_OUT_KEY,
  privacySignal,
  shouldCount,
} from "@/lib/analytics/optOut";
import { VISIT_KEY } from "@/lib/analytics/returnFlag";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

const base = { configured: true, optedOut: false, signal: false, timeZone: "Europe/London" };

describe("browser privacy signals", () => {
  it("reads Do Not Track as 1 or yes, from navigator or window", () => {
    expect(privacySignal({ doNotTrack: "1" })).toBe(true);
    expect(privacySignal({ doNotTrack: "yes" })).toBe(true);
    expect(privacySignal({ doNotTrack: null }, { doNotTrack: "1" })).toBe(true);
    expect(privacySignal({ doNotTrack: "0" })).toBe(false);
    expect(privacySignal({ doNotTrack: null })).toBe(false);
  });

  it("reads Global Privacy Control", () => {
    expect(privacySignal({ globalPrivacyControl: true })).toBe(true);
    expect(privacySignal({ globalPrivacyControl: false })).toBe(false);
  });

  it("is false with no navigator at all", () => {
    expect(privacySignal(undefined)).toBe(false);
  });
});

describe("shouldCount", () => {
  it("counts a configured browser that has not objected", () => {
    expect(shouldCount(base)).toBe(true);
  });

  it("does not count without a key, after an opt-out, or with a browser signal", () => {
    expect(shouldCount({ ...base, configured: false })).toBe(false);
    expect(shouldCount({ ...base, optedOut: true })).toBe(false);
    expect(shouldCount({ ...base, signal: true })).toBe(false);
  });

  it.each(["Europe/Berlin", "Europe/Busingen"])("does not count a browser set to %s", (timeZone) => {
    expect(shouldCount({ ...base, timeZone })).toBe(false);
  });

  it.each(["Europe/Vienna", "Europe/Zurich", undefined])("counts a browser set to %s", (timeZone) => {
    // An unreadable time zone must not block counting on its own.
    expect(shouldCount({ ...base, timeZone })).toBe(true);
  });
});

describe("countingState", () => {
  it("names the reason in a fixed priority order", () => {
    expect(countingState({ ...base, configured: false })).toBe("not_configured");
    expect(countingState({ ...base, signal: true, optedOut: true })).toBe("signal");
    expect(countingState({ ...base, timeZone: "Europe/Berlin", optedOut: true })).toBe("excluded_zone");
    expect(countingState({ ...base, optedOut: true })).toBe("opted_out");
    expect(countingState(base)).toBe("counted");
  });
});

describe("the opt-out", () => {
  it("records the choice and deletes the visit dates", () => {
    const s = memoryStorage({ [VISIT_KEY]: JSON.stringify({ v: 1, d: { first: "2026-09-01", last: "2026-09-13" } }) });
    optOut(s);
    expect(isOptedOut(s)).toBe(true);
    expect(s.map.has(VISIT_KEY)).toBe(false);
  });

  it("can be undone", () => {
    const s = memoryStorage();
    optOut(s);
    optIn(s);
    expect(isOptedOut(s)).toBe(false);
    expect(s.map.has(OPT_OUT_KEY)).toBe(false);
  });

  it("reads a damaged value as not opted out instead of throwing", () => {
    expect(isOptedOut(memoryStorage({ [OPT_OUT_KEY]: "{bad" }))).toBe(false);
  });
});
