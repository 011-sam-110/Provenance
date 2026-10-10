import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRAND } from "@/lib/brand";
import { fillTimes } from "@/lib/marketing/cameraSphere";
import {
  GLIDE_EASE,
  INTRO,
  INTRO_DEFAULTS,
  INTRO_GATE_SCRIPT,
  INTRO_SESSION_KEY,
  INTRO_WORD,
  MOVE_EASE,
  TUNE_SLIDERS,
  fillSchedule,
  groundLift,
  handoffProgress,
  introSnippet,
  introTimeline,
  letterProgress,
  moveProgress,
  readIntroToggles,
  readTuneParams,
  tuneSearch,
} from "@/lib/marketing/sphereIntro";

/**
 * The opening intro on `/` (components/marketing/SphereIntro.tsx). The motion itself is judged
 * by eye; what is pinned here is what other promises depend on: Leon's numbers, the order of
 * things, that the intro ends, and the gate that decides before first paint whether there is a
 * curtain at all.
 */

const tl = introTimeline(INTRO_WORD.length);

describe("the intro's timeline", () => {
  it("keeps the numbers Leon tuned on 2026-10-11", () => {
    expect(INTRO.fillSpeed).toBe(0.85);
    expect(INTRO.fillRatio).toBe(0.7);
    expect(INTRO.startDiameter).toBe(1.6);
    expect(tl.moveStart).toBe(2.81);
    expect(tl.moveEnd).toBeCloseTo(3.76, 9);
    expect(tl.lettersAt).toBeCloseTo(2.81 + 0.95 * 0.4, 9);
    // ten letters, 45 ms apart, 0.34 s each
    expect(tl.lettersEnd).toBeCloseTo(3.19 + 9 * 0.045 + 0.34, 9);
  });

  it("starts the letters before the ball lands, left to right", () => {
    expect(tl.lettersAt).toBeLessThan(tl.moveEnd);
    for (let t = 3; t < 5; t += 0.01) {
      for (let i = 1; i < 10; i++) expect(letterProgress(t, i, tl)).toBeLessThanOrEqual(letterProgress(t, i - 1, tl));
    }
  });

  it("hands over only after the wordmark is complete", () => {
    expect(tl.glideStart).toBeGreaterThanOrEqual(tl.lettersEnd);
    expect(tl.glideEnd).toBeGreaterThan(tl.glideStart);
    expect(tl.end).toBeGreaterThan(tl.glideEnd);
  });

  /* The brief: never hold the reader. The wordmark is complete at about 4.5 s and the curtain is
     gone a little over a second later. If a retune pushes past this, it is a decision to make
     out loud, not by drift. */
  it("is over, curtain and all, within six seconds of the first screen", () => {
    expect(tl.lettersEnd).toBeLessThan(4.6);
    expect(tl.end).toBeLessThanOrEqual(6);
  });

  it("lifts the curtain with the lockup, from nothing to all of it", () => {
    expect(groundLift(tl.glideStart - 0.01, tl)).toBe(0);
    expect(groundLift(tl.glideStart, tl)).toBe(0);
    expect(groundLift(tl.glideEnd, tl)).toBe(1);
    let prev = 0;
    for (let t = tl.glideStart; t <= tl.glideEnd; t += 0.01) {
      const g = groundLift(t, tl);
      expect(g).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = g;
    }
  });
});

describe("the handoff into the nav brand", () => {
  /* The snap Leon saw on 2026-10-10: a CSS fade that started only once the lockup had stopped,
     with 60% of its change in the first two frames. */
  it("starts before the lockup arrives and ends after it", () => {
    expect(tl.handoffStart).toBeLessThan(tl.glideEnd);
    expect(tl.handoffStart).toBeGreaterThanOrEqual(tl.glideStart);
    expect(tl.end).toBeGreaterThan(tl.glideEnd);
    expect(handoffProgress(tl.handoffStart, tl)).toBe(0);
    expect(handoffProgress(tl.end, tl)).toBe(1);
  });

  it("is even: no frame carries much more of the change than its neighbours", () => {
    const span = tl.end - tl.handoffStart;
    let prev = 0;
    let biggest = 0;
    for (let t = tl.handoffStart; t <= tl.end + 1e-9; t += 1 / 60) {
      const h = handoffProgress(t, tl);
      expect(h).toBeGreaterThanOrEqual(prev - 1e-12);
      biggest = Math.max(biggest, h - prev);
      prev = h;
    }
    // a linear fade moves 1/frames a frame; smoothstep peaks at 1.5 times that, mid-way
    expect(biggest).toBeLessThanOrEqual((1.5 / (span * 60)) * 1.05);
    expect(handoffProgress(tl.handoffStart + span * 0.2, tl)).toBeLessThan(0.15);
  });
});

describe("the eases", () => {
  it("start exactly at 0, end exactly at 1, and never go back", () => {
    for (const ease of [MOVE_EASE, GLIDE_EASE]) {
      expect(ease(0)).toBe(0);
      expect(ease(-1)).toBe(0);
      expect(ease(1)).toBe(1);
      expect(ease(2)).toBe(1);
      let prev = 0;
      for (let x = 0; x <= 1; x += 0.001) {
        const y = ease(x);
        expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = y;
      }
    }
  });

  it("leaves the start slowly: the move is a strong ease-in", () => {
    expect(INTRO.moveEase[0]).toBe(0.9);
    expect(MOVE_EASE(0.2)).toBeLessThan(0.05);
  });
});

describe("the word", () => {
  /* The lockup docks into the nav brand, so it must be the nav brand's own text. */
  it("is the name the nav brand prints, as the nav prints it", () => {
    expect(INTRO_WORD).toBe(BRAND.name);
    const page = readFileSync(join(process.cwd(), "app/(site)/page.tsx"), "utf8");
    expect(page).toMatch(/className="lp-brand"[\s\S]{0,200}<span>\{BRAND\.name\}<\/span>/);
  });
});

describe("the toggles", () => {
  it("default to the dissolve, once per session, no tuner", () => {
    expect(readIntroToggles("")).toEqual({ handover: "dock", always: false, tune: false });
  });

  it("read handover, intro and tune from the query", () => {
    expect(readIntroToggles("?handover=iris&intro=always")).toEqual({ handover: "iris", always: true, tune: false });
    expect(readIntroToggles("?handover=wipe")).toEqual({ handover: "dock", always: false, tune: false });
    expect(readIntroToggles("?tune")).toEqual({ handover: "dock", always: true, tune: true });
  });
});

describe("the fill", () => {
  it("is the sketch's at speed 1 and its ratio, and a faster fill divides every gap", () => {
    const sketch = { ...INTRO_DEFAULTS, fillSpeed: 1, fillRatio: 0.85 };
    expect(fillSchedule(40, sketch)).toEqual(fillTimes(40));
    const fast = fillSchedule(40, { ...sketch, fillSpeed: 2 });
    fast.forEach((t, i) => expect(t).toBeCloseTo(fillTimes(40)[i] / 2, 9));
  });

  it("lights all 59 screens of the settled ball by 3.42 s", () => {
    const T0 = fillSchedule(59);
    expect(T0[1]).toBeCloseTo(0.5 / 0.85, 9);
    expect(T0[58]).toBeCloseTo(3.415, 3);
  });

  it("holds the handover until the last screen has faded on", () => {
    const slow = { ...INTRO_DEFAULTS, fillSpeed: 0.25 };
    const T0 = fillSchedule(59, slow);
    const end = T0[58] + slow.fillFade;
    expect(introTimeline(INTRO_WORD.length, end, slow).glideStart).toBeCloseTo(end + slow.hold, 9);
  });
});

describe("the tuner's numbers", () => {
  it("start as the settled ones", () => {
    expect(readTuneParams("?tune")).toEqual(INTRO_DEFAULTS);
    expect(tuneSearch(INTRO_DEFAULTS)).toBe("?tune");
  });

  it("round-trip through the address bar, and only what changed is written", () => {
    const p = { ...INTRO_DEFAULTS, moveStart: 3.1, fillSpeed: 1.5, letterStagger: 0.06, handover: "iris" as const };
    expect(tuneSearch(p)).toBe("?tune&fs=1.5&ms=3.1&ls=0.06&handover=iris");
    expect(readTuneParams(tuneSearch(p))).toEqual(p);
  });

  it("clamp a hand-edited link to each slider, and ignore junk", () => {
    const p = readTuneParams("?tune&fs=99&ms=-4&bc=nonsense&sd=");
    expect(p.fillSpeed).toBe(4);
    expect(p.moveStart).toBe(0);
    expect(p.ballCaps).toBe(INTRO_DEFAULTS.ballCaps);
    expect(p.screenDeg).toBe(INTRO_DEFAULTS.screenDeg);
  });

  it("give every slider its own query key, with the default inside its range", () => {
    expect(new Set(TUNE_SLIDERS.map((s) => s.q)).size).toBe(TUNE_SLIDERS.length);
    for (const s of TUNE_SLIDERS) {
      expect(INTRO_DEFAULTS[s.key]).toBeGreaterThanOrEqual(s.min);
      expect(INTRO_DEFAULTS[s.key]).toBeLessThanOrEqual(s.max);
    }
  });

  it("move the ease with the slider", () => {
    const soft = introTimeline(INTRO_WORD.length, 0, { ...INTRO_DEFAULTS, moveEaseIn: 0.2 });
    const t = soft.moveStart + soft.moveDur * 0.2;
    expect(moveProgress(t, soft)).toBeGreaterThan(moveProgress(t, tl));
  });

  /* "Copy values" must paste straight over INTRO: the same keys, the settled values. */
  it("copy as lines of INTRO itself", () => {
    const src = readFileSync(join(process.cwd(), "lib/marketing/sphereIntro.ts"), "utf8");
    for (const line of introSnippet(INTRO_DEFAULTS).split("\n")) {
      const key = line.trim().split(":")[0];
      expect(src).toContain(`  ${key}:`);
    }
    expect(introSnippet(INTRO_DEFAULTS)).toContain(`moveStart: ${INTRO.moveStart},`);
    expect(introSnippet(INTRO_DEFAULTS)).toContain("moveEase: [0.9, 0, 0.16, 1] as const,");
    /* a step of 0.025 keeps three places: the sketch's 0.225 s fade must not become 0.23 */
    expect(introSnippet(INTRO_DEFAULTS)).toContain("fillFade: 0.225,");
    expect(readTuneParams("?tune&fd=0.225").fillFade).toBe(0.225);
  });
});

/* The gate runs as an inline script before first paint. Here it runs against stand-ins for the
   browser globals it reads, passed as parameters so they shadow the real ones. */
interface GateEnv {
  search?: string;
  hash?: string;
  reduced?: boolean;
  webgl?: boolean;
  saveData?: boolean;
  effectiveType?: string;
  navType?: string;
  seen?: boolean;
  storageThrows?: boolean;
}
function runGate(env: GateEnv = {}): boolean {
  let on = false;
  const el = { setAttribute: (k: string) => k === "data-on" && (on = true) };
  const document = { currentScript: { previousElementSibling: el } };
  const location = { search: env.search ?? "", hash: env.hash ?? "" };
  const matchMedia = () => ({ matches: !!env.reduced });
  const window = { matchMedia, WebGLRenderingContext: env.webgl === false ? undefined : function () {} };
  const navigator = { connection: { saveData: !!env.saveData, effectiveType: env.effectiveType ?? "4g" } };
  const performance = { getEntriesByType: () => [{ type: env.navType ?? "navigate" }] };
  const sessionStorage = {
    getItem: (k: string) => {
      if (env.storageThrows) throw new Error("blocked");
      return env.seen && k === INTRO_SESSION_KEY ? "1" : null;
    },
  };
  new Function("document", "location", "window", "matchMedia", "navigator", "performance", "sessionStorage", INTRO_GATE_SCRIPT)(
    document,
    location,
    window,
    matchMedia,
    navigator,
    performance,
    sessionStorage,
  );
  return on;
}

describe("the gate script", () => {
  it("shows the curtain on a plain first visit", () => {
    expect(runGate()).toBe(true);
  });

  it("never shows it with reduced motion, even when asked to replay", () => {
    expect(runGate({ reduced: true })).toBe(false);
    expect(runGate({ reduced: true, search: "?intro=always" })).toBe(false);
  });

  it("does not show it without WebGL, on a deep link, or on a slow or metered connection", () => {
    expect(runGate({ webgl: false })).toBe(false);
    expect(runGate({ hash: "#close" })).toBe(false);
    expect(runGate({ saveData: true })).toBe(false);
    expect(runGate({ effectiveType: "3g" })).toBe(false);
    expect(runGate({ effectiveType: "slow-2g" })).toBe(false);
  });

  it("plays once per session, and again with ?intro=always", () => {
    expect(runGate({ seen: true })).toBe(false);
    expect(runGate({ seen: true, search: "?intro=always" })).toBe(true);
    expect(runGate({ seen: true, search: "?handover=iris&intro=always" })).toBe(true);
    expect(runGate({ seen: true, search: "?intro=alwaysish" })).toBe(false);
  });

  it("plays every time on the tuner, and never under reduced motion", () => {
    expect(runGate({ seen: true, search: "?tune" })).toBe(true);
    expect(runGate({ seen: true, search: "?tune&ms=3.2" })).toBe(true);
    expect(runGate({ seen: true, search: "?tuned" })).toBe(false);
    expect(runGate({ reduced: true, search: "?tune" })).toBe(false);
  });

  it("skips a back/forward visit, and survives storage that throws", () => {
    expect(runGate({ navType: "back_forward" })).toBe(false);
    expect(runGate({ storageThrows: true })).toBe(true);
  });
});

describe("the page", () => {
  const page = readFileSync(join(process.cwd(), "app/(site)/page.tsx"), "utf8");

  /* A credit arrives with its asset (CLAUDE.md, "Image licences"). */
  it("credits the camera stills wherever it mounts the intro", () => {
    if (!page.includes("<SphereIntro")) return;
    const flat = page.replace(/\s+/g, " ");
    expect(flat).toContain("Camera stills in the photo sphere, taken on 8 October 2026");
    expect(flat).toContain("Powered by TfL Open Data (Open Government Licence)");
    expect(flat).toContain("Fintraffic / Digitraffic (CC BY 4.0)");
  });
});
