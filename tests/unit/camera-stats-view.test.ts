import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { buildCameraStats, type CameraStats, type StatsInput } from "@/lib/cameras/stats";
import {
  DROP_ORDER,
  SEGMENTS,
  SEGMENT_LABEL,
  agoText,
  dropClass,
  firstFrameTip,
  listedTip,
  operatorMeta,
  operatorTip,
  playedFigure,
  playedShort,
  playedTip,
  refreshTip,
  regionTip,
  secondsText,
  segmentTip,
  stripAriaLabel,
  stripTip,
  videoSentence,
  webcamsTip,
  windowText,
  type Tip,
} from "@/lib/cameras/statsView";

// The strip's honesty rules (components/terminal/CameraStats.tsx). It never calls a camera
// live and never paints the live green: VIDEO counts streams that PLAYED at their last
// check, everything else is a still, and each total is a count at a time. While the first
// play check since a server start runs, the VIDEO facts say "first check running" rather
// than a share. Every string the strip and its breakdown show comes from statsView.ts, so
// rendering all of them here, in every state, is how the rule is held.

const T0 = Date.UTC(2026, 9, 27, 4, 0, 0);

function stats(over: Partial<StatsInput> = {}, play: Partial<StatsInput["play"]> = {}): CameraStats {
  return buildCameraStats({
    cams: [
      { source: "caltrans", country: "US", live: true, refreshSeconds: 60, license: "Caltrans Terms of Use" },
      { source: "caltrans", country: "US", live: false, refreshSeconds: 60, license: "Caltrans Terms of Use" },
      { source: "tfl", country: "GB", live: false, refreshSeconds: 300, license: "OGL" },
      { source: "nzta", country: "NZ", live: false, refreshSeconds: 900, license: "No licence stated by NZTA" },
    ],
    registryAt: T0 - 4 * 60_000,
    health: [
      { key: "caltrans", ok: true },
      { key: "tfl", ok: true },
      { key: "nzta", ok: true },
    ],
    feedCount: 51,
    play: {
      listed: 3_187,
      checked: 100,
      rolling: 75,
      stalled: 5,
      error: 20,
      windowFrom: T0 - 2 * 3_600_000,
      windowTo: T0 - 5 * 60_000,
      ttffMedianMs: 1_700,
      ttffP90Ms: 3_000,
      cycleMs: 3 * 3_600_000,
      warm: false,
      byOperator: {},
      ...play,
    },
    webcams: { count: 70_698, at: Date.UTC(2026, 8, 5, 22, 56) },
    names: { caltrans: "Caltrans CCTV", tfl: "Transport for London JamCams", nzta: "NZ Transport Agency" },
    now: T0,
    ...over,
  });
}

/** Every string the strip and its breakdown can show for one state. */
function everyString(s: CameraStats, now: number): string[] {
  const tips: Tip[] = [
    ...SEGMENTS.map((id) => segmentTip(id, s, now)),
    stripTip(s, now),
    playedTip(s),
    firstFrameTip(s),
    listedTip(s),
    refreshTip(s, now),
    webcamsTip(s.webcams),
    ...s.road.regions.flatMap((r) => (["video", "stills", "countries"] as const).map((k) => regionTip(r, k, s, now))),
    ...s.operators.rows.map((r) => operatorTip(r, s, now)),
  ];
  return [
    ...tips.flatMap((t) => [t.title, t.body, t.source]),
    stripAriaLabel(s, now),
    playedFigure(s),
    playedShort(s),
    videoSentence(s),
    windowText(s),
    ...s.operators.rows.map(operatorMeta),
    ...Object.values(SEGMENT_LABEL),
    ...s.refresh.mix.map((b) => b.label),
    ...s.road.regions.map((r) => r.region),
  ];
}

const STATES: [string, CameraStats, number][] = [
  ["after the first check", stats(), T0],
  ["while the first check runs", stats({}, { warm: true, checked: 40, rolling: 31 }), T0],
  ["stale", stats(), T0 + 40 * 60_000],
  ["before any verdict", stats({}, { checked: 0, rolling: 0, stalled: 0, error: 0, windowFrom: null, windowTo: null, ttffMedianMs: null, ttffP90Ms: null }), T0],
  ["no webcam manifest", stats({ webcams: { count: null, at: null } }), T0],
  ["before the first refresh", stats({ cams: [], registryAt: null }), T0],
];

describe("the strip never says live", () => {
  test.each(STATES)("%s", (_name, s, now) => {
    const strings = everyString(s, now);
    expect(strings.length).toBeGreaterThan(40);
    const offenders = strings.filter((x) => /\blive\b/i.test(x));
    expect(offenders).toEqual([]);
  });

  test.each(STATES)("no competitor name: %s", (_name, s, now) => {
    for (const x of everyString(s, now)) expect(x).not.toMatch(/osiris|world ?monitor/i);
  });
});

describe("every number has a source", () => {
  test.each(STATES)("%s", (_name, s, now) => {
    const tips = [
      ...SEGMENTS.map((id) => segmentTip(id, s, now)),
      stripTip(s, now),
      playedTip(s),
      firstFrameTip(s),
      listedTip(s),
      refreshTip(s, now),
      webcamsTip(s.webcams),
    ];
    for (const t of tips) {
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.source.length).toBeGreaterThan(20);
    }
  });

  test("the road count states its time, the webcams their harvest date", () => {
    const s = stats();
    expect(segmentTip("video", s, T0).source).toContain("Counted 03:56 UTC, 4 min ago.");
    expect(webcamsTip(s.webcams).source).toContain("Harvested 5 Sep 2026.");
  });
});

describe("video, said honestly", () => {
  test("after the first check: a share from real verdicts", () => {
    const s = stats();
    expect(playedFigure(s)).toBe("75 of 100");
    expect(playedShort(s)).toBe("75% played at the last check");
    expect(videoSentence(s)).toBe("75 of 100 checked streams played at their last check (75%).");
    expect(windowText(s)).toBe("Checks 02:00 to 03:55 UTC.");
  });

  test("while the first check runs: no share, the words 'first check running'", () => {
    const s = stats({}, { warm: true, checked: 40, rolling: 31 });
    expect(playedFigure(s)).toBe("First check running");
    expect(playedShort(s)).toBe("first check running");
    expect(playedFigure(s) + playedShort(s)).not.toContain("%");
    expect(videoSentence(s)).toContain("still running (40 of 3,187 listed streams checked)");
    expect(segmentTip("video", s, T0).body).not.toContain("%");
  });

  test("before any verdict: says so, no share", () => {
    const s = stats({}, { checked: 0, rolling: 0, windowFrom: null, windowTo: null, ttffMedianMs: null, ttffP90Ms: null });
    expect(playedFigure(s)).toBe("No results yet");
    expect(windowText(s)).toBe("No check has finished yet.");
    expect(firstFrameTip(s).body).toContain("no first-frame time");
  });
});

describe("the strip's label", () => {
  test("one full sentence for the one button", () => {
    expect(stripAriaLabel(stats(), T0)).toBe(
      "Road and public operator cameras: 1 video, 3 stills, 3 countries, 3 operators, counted 4 min ago. " +
        "Windy webcams: 70,698, harvested 5 Sep 2026. Show breakdown",
    );
  });

  test("a stale count says so", () => {
    const later = T0 + 40 * 60_000;
    expect(stripAriaLabel(stats(), later)).toContain("counted 44 min ago, older than 15 min.");
    expect(segmentTip("counted", stats(), later).body).toContain("older than 15 min");
    expect(segmentTip("counted", stats(), T0).body).not.toContain("older than 15 min");
  });

  test("ages and intervals", () => {
    expect(agoText(T0 - 20_000, T0)).toBe("under 1 min ago");
    expect(agoText(T0 - 4 * 60_000, T0)).toBe("4 min ago");
    expect(agoText(T0 - 3 * 3_600_000, T0)).toBe("3 h ago");
    expect(agoText(T0 - 72 * 3_600_000, T0)).toBe("3 days ago");
    expect(secondsText(45)).toBe("45 s");
    expect(secondsText(120)).toBe("2 min");
    expect(secondsText(5_400)).toBe("1.5 h");
  });

  test("an operator line says when there is no licence, and splits video from stills", () => {
    const rows = stats().operators.rows;
    expect(operatorMeta(rows.find((r) => r.key === "caltrans")!)).toBe("Caltrans Terms of Use. 1 video, 1 still every 1 min");
    expect(operatorMeta(rows.find((r) => r.key === "nzta")!)).toBe("No stated licence. 1 still every 15 min");
  });
});

describe("narrow widths drop the quieter numbers first", () => {
  test("operators, then webcams, then countries", () => {
    expect(DROP_ORDER).toEqual(["operators", "webcams", "countries"]);
    expect(dropClass("operators")).toBe("is-drop-1");
    expect(dropClass("webcams")).toBe("is-drop-2");
    expect(dropClass("countries")).toBe("is-drop-3");
    for (const id of ["video", "stills", "counted"] as const) expect(dropClass(id)).toBe("");
  });
});

describe("the strip's CSS", () => {
  const css = readFileSync(resolve(__dirname, "..", "..", "app", "globals.css"), "utf8").replace(/\r\n/g, "\n");
  const start = css.indexOf("/* ── CAMERA STATS STRIP");
  const end = css.indexOf("/* ── END CAMERA STATS STRIP ── */");
  const block = css.slice(start, end);

  test("the block is there", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
  });

  test("never the live green", () => {
    expect(block).not.toContain("--tnx-live");
  });

  test("the time dot is ink-faint when fresh and alert-warn when stale", () => {
    expect(block).toMatch(/\.cs-dot \{[^}]*background: var\(--tnx-ink-faint\)/);
    expect(block).toMatch(/\.cs-score\.is-stale \.cs-dot[^{]*\{ background: var\(--tnx-alert-warn\); \}/);
  });

  const band = (min: number, max: number) => {
    const m = block.match(new RegExp(`@media \\(min-width: ${min}px\\) and \\(max-width: ${max}px\\) \\{([^}]*)\\}`));
    return m ? m[1] : "";
  };

  test("drop bands hide operators, then webcams, then countries", () => {
    const b1 = band(1320, 1419);
    const b2 = band(1240, 1319);
    const b3 = band(1180, 1239);
    expect(b1).toContain(".is-drop-1");
    expect(b1).not.toMatch(/is-drop-[23]/);
    expect(b2).toMatch(/is-drop-1.*is-drop-2/);
    expect(b2).not.toContain("is-drop-3");
    expect(b3).toMatch(/is-drop-1.*is-drop-2.*is-drop-3/);
  });

  test("phone touch targets are 44px", () => {
    expect(block).toMatch(/\.sh-x \{[^}]*width: 44px; height: 44px/);
    expect(block).toMatch(/:is\(\.cs-score, \.cs-err\) \{[^}]*min-height: 44px/);
  });

  test("motion only when the reader has not asked for less", () => {
    for (const anim of ["cs-shim", "cs-drop-in", "cs-sheet-in"]) {
      const uses = [...block.matchAll(new RegExp(`animation: ${anim}`, "g"))].map((m) => m.index!);
      expect(uses.length).toBeGreaterThan(0);
      for (const at of uses) {
        const before = block.lastIndexOf("@media", at);
        expect(block.slice(before, at)).toContain("prefers-reduced-motion: no-preference");
      }
    }
  });
});
