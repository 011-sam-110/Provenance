// Guards on the analytics beacon's arming rule and its runtime options.
//
// These are not decoration. Two of them pin claims made in writing to visitors on
// app/(site)/privacy — that we set no cookies, and that we do not record sessions — and
// a third pins the one option that decides whether bounce rate is a real number or a
// constant ~100%. All three are the kind of thing a later "simplify the config" commit
// would quietly reverse while every test stayed green.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beaconConfig, beaconOptions, DEFAULT_BEACON_HOST } from "@/lib/analytics/beacon";

const ROOT = join(__dirname, "..", "..");

describe("beacon arming", () => {
  it("is dormant with no key, so posthog-js is never fetched", () => {
    expect(beaconConfig({})).toBeNull();
  });

  it("treats an empty or whitespace key as unset", () => {
    expect(beaconConfig({ NEXT_PUBLIC_POSTHOG_KEY: "" })).toBeNull();
    expect(beaconConfig({ NEXT_PUBLIC_POSTHOG_KEY: "   " })).toBeNull();
  });

  it("refuses a leftover placeholder, which is worse than an unset key", () => {
    // A placeholder looks configured: it loads the library and posts every event into
    // nothing, so the dashboard stays empty while the code says it is collecting.
    for (const key of ["your-key-here", "CHANGEME", "phc_xxxxxxxx", "TODO"]) {
      expect(beaconConfig({ NEXT_PUBLIC_POSTHOG_KEY: key }), key).toBeNull();
    }
  });

  it("arms on a real key and defaults to the EU host", () => {
    const config = beaconConfig({ NEXT_PUBLIC_POSTHOG_KEY: "phc_realLookingKey123" });
    expect(config).not.toBeNull();
    expect(config?.key).toBe("phc_realLookingKey123");
    // EU rather than US so visitor data does not leave the region.
    expect(config?.host).toBe(DEFAULT_BEACON_HOST);
    expect(DEFAULT_BEACON_HOST).toContain("eu.");
  });

  it("lets a self-hoster point at their own instance", () => {
    const config = beaconConfig({
      NEXT_PUBLIC_POSTHOG_KEY: "phc_key",
      NEXT_PUBLIC_POSTHOG_HOST: "https://ph.example.org",
    });
    expect(config?.host).toBe("https://ph.example.org");
  });
});

describe("beacon options pin what privacy promises", () => {
  const options = beaconOptions({ key: "phc_key", host: DEFAULT_BEACON_HOST });

  it("stores nothing that outlives the tab, so it sets no cookie", () => {
    // The default is "localStorage+cookie", which persists across visits and is exactly
    // what the privacy page says we do not do.
    expect(options.persistence).toBe("sessionStorage");
  });

  it("does NOT use memory persistence, which would make bounce rate always ~100%", () => {
    // With no storage at all PostHog cannot tell page 2 belongs to the same visit as
    // page 1, so every pageview becomes a new person. The metric would still render —
    // as a number that is permanently wrong. This is the trap this test exists for.
    expect(options.persistence).not.toBe("memory");
  });

  it("never records sessions or shows surveys", () => {
    // Session replay records the DOM. It is a different order of collection from
    // counting, and it was explicitly not chosen.
    expect(options.disable_session_recording).toBe(true);
    expect(options.disable_surveys).toBe(true);
  });

  it("keeps autocapture and pageleave, which are the only source of the click metrics", () => {
    // Autocapture is where rage clicks and dead clicks come from; they are derived from
    // captured clicks and do not need replay. capture_pageleave is what makes bounce
    // rate and time-on-page computable at all.
    expect(options.autocapture).toBe(true);
    expect(options.capture_pageleave).toBe(true);
  });

  it("honours Do Not Track", () => {
    expect(options.respect_dnt).toBe(true);
  });
});

describe("privacy page dependency count", () => {
  // WHY A TEST FOR A NUMBER IN PROSE. The privacy page cites the runtime dependency
  // count as evidence for "nothing here stores you". On 2026-09-07 the page said BOTH
  // "nine" in one place and "ten" in another — one of them fossilised when
  // @vercel/analytics was removed. Nobody noticed, because prose has no compiler.
  const WORDS = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve"];

  it("matches package.json, in every place the page states it", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const count = Object.keys(pkg.dependencies ?? {}).length;
    const word = WORDS[count] ?? String(count);
    const page = readFileSync(join(ROOT, "app", "(site)", "privacy", "page.tsx"), "utf8");

    const claims = [...page.matchAll(/(\w+) runtime dep(?:endenc(?:y|ies)|s)?/gi)].map((m) => m[1].toLowerCase());
    expect(claims.length, "the privacy page should state the runtime dependency count").toBeGreaterThan(0);
    for (const claim of claims) {
      expect(claim, `the privacy page says "${claim} runtime deps" but package.json ships ${count} (${word})`).toBe(word);
    }
  });
});
