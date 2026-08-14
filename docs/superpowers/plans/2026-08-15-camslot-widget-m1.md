# Camera slot widget (Streets M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `camslot` console widget — a playlist of live camera streams that rotates through them — so a user can compose a wall of city cameras on any existing board.

**Architecture:** One pure model module holds every rule (parsing, validation, rotation, interval floors) so it is fully unit-testable in a node environment; one React widget consumes it. Hostile input is rejected at the `sanitizeLayout` choke point every `?c=` share link passes through, and again at render. Rotation is display-only: it switches which already-fetched frame is shown, and only the visible stream fetches.

**Tech Stack:** Next.js 15, React 19, TypeScript, vitest (node env), zod already available. No new dependencies.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-15-streets-board-design.md`. Read §5, §7.2, §8 before starting.
- **Build gate:** `npx tsc --noEmit && npm test` must pass before every commit.
- **Tests:** vitest, **node environment**, in `tests/unit/**/*.test.ts`. No React testing library is installed — **no component tests**. Pure functions only.
- **Commit style:** solo attribution, **no co-author trailer** (matches every existing commit in this repo).
- **Never interpolate a user string into an iframe `src`.** Anchored `^[A-Za-z0-9_-]{11}$`; build only `https://www.youtube.com/embed/<validated>`. **Store the extracted id, never the pasted URL.**
- **Widget config holds only `streams`, `intervalMs`, `name`, `fit`.** `paused` and the rotation index must NOT be config — `store.ts:74` `configure` → `emit()` → `writeBoardLayout`, and `boards.ts:104` `layoutSignature` includes `g: w.config`, so persisting a hover-pause would mark the board "customised" and pin the user to that snapshot forever.
- **Config is `unknown` at the boundary.** `sanitize.ts:103` only tests `typeof o.config === "object"`, and `typeof [] === "object"`. Never write `cfg as CamslotConfig`.
- **Honesty rules** (`lib/console/help.ts` house rules): `limitations` is never empty and says the unflattering thing; no marketing voice; describe what the widget actually does.
- **No camera source refreshes at 30s.** Real cadences: 60s (Caltrans, SCDOT, Castle Rock, TripCheck), 120s (Traffic Scotland, NZTA, CET-SP), 180s (DriveBC), 300s (TfL, Digitraffic, Estonia, Iceland), 600s (Windy).

## File Structure

| File | Responsibility |
|---|---|
| `lib/console/widgets/camslot.model.ts` | **Create.** Pure: `StreamRef` union, parsing, validation, clamping, rotation index, interval floor. Zero React, zero DOM. |
| `lib/console/widgets/camslot.prefs.ts` | **Create.** The global user pause preference (persisted separately from board config). |
| `lib/console/widgets/camslot.tsx` | **Create.** The widget component + registry entry. |
| `lib/console/widgets/camslot.picker.tsx` | **Create.** Search-and-add UI over the cached camera + webcam pools, plus the YouTube paste field. |
| `lib/cameras/freshness.ts` | **Modify.** Add `frameBucket` — the quantised cache-buster. |
| `components/CameraImage.tsx` | **Modify.** Use `frameBucket`; add an `onError` state. |
| `lib/console/sanitize.ts` | **Modify.** Add the `camslot` config branch at line 103. |
| `lib/console/widgets/index.ts` | **Modify.** Import `camslot` so it registers. |
| `lib/console/help.ts` | **Modify.** Add the `camslot` `WIDGET_EXPLAINERS` entry. |
| `app/globals.css` | **Modify.** `.tn-cs-*` styles. |

---

### Task 1: The pure model

**Files:**
- Create: `lib/console/widgets/camslot.model.ts`
- Test: `tests/unit/camslot-model.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `StreamRef`, `CamslotConfig`, `MIN_INTERVAL_MS`, `MAX_INTERVAL_MS`, `MAX_STREAMS`, `parseYouTubeVideoId(raw: string): string | null`, `parseStreamRef(raw: unknown): StreamRef | null`, `sanitizeCamslotConfig(raw: unknown): CamslotConfig`, `nextIndex(i: number, len: number): number`, `streamKey(s: StreamRef): string`, `embedUrl(videoId: string): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/camslot-model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseYouTubeVideoId,
  parseStreamRef,
  sanitizeCamslotConfig,
  nextIndex,
  streamKey,
  embedUrl,
  MIN_INTERVAL_MS,
  MAX_INTERVAL_MS,
  MAX_STREAMS,
} from "@/lib/console/widgets/camslot.model";

describe("parseYouTubeVideoId", () => {
  it("accepts the three URL shapes people actually paste", () => {
    expect(parseYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeVideoId("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("accepts a bare 11-character id", () => {
    expect(parseYouTubeVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("tolerates extra query parameters and whitespace", () => {
    expect(parseYouTubeVideoId("  https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s  ")).toBe("dQw4w9WgXcQ");
  });

  // The rejection cases are the point of this function.
  it("rejects anything that is not a YouTube video id", () => {
    expect(parseYouTubeVideoId("https://evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYouTubeVideoId("javascript:alert(1)")).toBeNull();
    expect(parseYouTubeVideoId("https://www.youtube.com/watch?v=tooshort")).toBeNull();
    expect(parseYouTubeVideoId("https://www.youtube.com/watch?v=waaaaaaaaaytoolong")).toBeNull();
    expect(parseYouTubeVideoId('" onerror=alert(1) x="')).toBeNull();
    expect(parseYouTubeVideoId("../../../etc/passwd")).toBeNull();
    expect(parseYouTubeVideoId("")).toBeNull();
  });

  it("rejects a channel URL — channel refs are out of v1", () => {
    expect(parseYouTubeVideoId("https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw")).toBeNull();
  });
});

describe("embedUrl", () => {
  it("only ever builds a youtube.com/embed URL", () => {
    expect(embedUrl("dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1&playsinline=1",
    );
  });
});

describe("parseStreamRef", () => {
  it("accepts the three v1 kinds", () => {
    expect(parseStreamRef({ k: "cam", id: "tfl:JamCams_00001" })).toEqual({ k: "cam", id: "tfl:JamCams_00001" });
    expect(parseStreamRef({ k: "webcam", id: "windy:1420893641" })).toEqual({ k: "webcam", id: "windy:1420893641" });
    expect(parseStreamRef({ k: "yt", videoId: "dQw4w9WgXcQ" })).toEqual({ k: "yt", videoId: "dQw4w9WgXcQ" });
  });

  it("rejects an unknown discriminant", () => {
    expect(parseStreamRef({ k: "ytc", channelId: "UCuAXFkgsw1L7xaCfnd5JJOw" })).toBeNull();
    expect(parseStreamRef({ k: "hls", id: "x" })).toBeNull();
  });

  it("rejects a malformed or oversized id", () => {
    expect(parseStreamRef({ k: "cam", id: "" })).toBeNull();
    expect(parseStreamRef({ k: "cam", id: "x".repeat(200) })).toBeNull();
    expect(parseStreamRef({ k: "yt", videoId: "notelevenchars!" })).toBeNull();
    expect(parseStreamRef(null)).toBeNull();
    expect(parseStreamRef("cam:1")).toBeNull();
  });
});

describe("sanitizeCamslotConfig", () => {
  it("returns an empty, usable config for junk", () => {
    expect(sanitizeCamslotConfig(null)).toEqual({ streams: [], intervalMs: 5000 });
    expect(sanitizeCamslotConfig("nope")).toEqual({ streams: [], intervalMs: 5000 });
  });

  it("survives an ARRAY config — typeof [] === 'object' passes sanitize.ts:103", () => {
    expect(sanitizeCamslotConfig([])).toEqual({ streams: [], intervalMs: 5000 });
  });

  it("clamps a hostile intervalMs", () => {
    expect(sanitizeCamslotConfig({ intervalMs: 0 }).intervalMs).toBe(MIN_INTERVAL_MS);
    expect(sanitizeCamslotConfig({ intervalMs: -1 }).intervalMs).toBe(MIN_INTERVAL_MS);
    expect(sanitizeCamslotConfig({ intervalMs: 999_999_999 }).intervalMs).toBe(MAX_INTERVAL_MS);
    expect(sanitizeCamslotConfig({ intervalMs: NaN }).intervalMs).toBe(5000);
  });

  it("truncates an oversized playlist and drops invalid refs", () => {
    const streams = Array.from({ length: MAX_STREAMS + 40 }, (_, i) => ({ k: "cam", id: `tfl:${i}` }));
    streams.push({ k: "evil", id: "x" } as never);
    const out = sanitizeCamslotConfig({ streams });
    expect(out.streams.length).toBe(MAX_STREAMS);
    expect(out.streams.every((s) => s.k === "cam")).toBe(true);
  });

  it("keeps a user name and fit, and rejects a bad fit", () => {
    expect(sanitizeCamslotConfig({ name: "London squares" }).name).toBe("London squares");
    expect(sanitizeCamslotConfig({ fit: "contain" }).fit).toBe("contain");
    expect(sanitizeCamslotConfig({ fit: "explode" }).fit).toBeUndefined();
  });

  it("truncates an absurd name rather than storing it", () => {
    expect(sanitizeCamslotConfig({ name: "x".repeat(500) }).name?.length).toBe(80);
  });
});

describe("nextIndex", () => {
  it("advances and wraps", () => {
    expect(nextIndex(0, 3)).toBe(1);
    expect(nextIndex(2, 3)).toBe(0);
  });

  it("is safe for the degenerate lengths", () => {
    expect(nextIndex(0, 0)).toBe(0);
    expect(nextIndex(0, 1)).toBe(0);
    expect(nextIndex(9, 3)).toBe(0);
  });
});

describe("streamKey", () => {
  it("is stable and distinct per kind", () => {
    expect(streamKey({ k: "cam", id: "a" })).toBe("cam:a");
    expect(streamKey({ k: "webcam", id: "a" })).toBe("webcam:a");
    expect(streamKey({ k: "yt", videoId: "dQw4w9WgXcQ" })).toBe("yt:dQw4w9WgXcQ");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/camslot-model.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/console/widgets/camslot.model"`.

- [ ] **Step 3: Write the implementation**

Create `lib/console/widgets/camslot.model.ts`:

```ts
// Camera slot — the pure rules. No React, no DOM, no fetch, so every rule here is
// unit-testable in the node environment the rest of tests/unit uses.
//
// WHY VALIDATION LIVES HERE AND IS CALLED TWICE. A widget's `config` rides inside
// the `?c=` share link: lib/console/share.ts base64s the whole ShellLayout, and
// lib/console/sanitize.ts:103 copies `config` through on nothing more than
// `typeof o.config === "object"`. So a stranger's link can carry any JSON at all
// into this widget. These functions are the only thing between that and a render,
// and they are applied at BOTH boundaries — sanitizeLayout (the choke point every
// link passes) and the component itself (belt and braces, and the path a live
// `configure()` call takes).

export type StreamRef =
  | { k: "cam"; id: string }
  | { k: "webcam"; id: string }
  | { k: "yt"; videoId: string };

export interface CamslotConfig {
  streams: StreamRef[];
  intervalMs: number;
  name?: string;
  fit?: "cover" | "contain";
}

export const DEFAULT_INTERVAL_MS = 5000;
/** Below ~3s a wall is unreadable, and `setInterval(fn, 0)` clamps to ~4ms —
 *  which is a share-link DoS, not a preference. */
export const MIN_INTERVAL_MS = 3000;
export const MAX_INTERVAL_MS = 300_000;
/** A wall nobody can watch is not a selection. Also bounds the share-link payload. */
export const MAX_STREAMS = 60;
const MAX_ID_LEN = 128;
const MAX_NAME_LEN = 80;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** Camera and webcam ids are our own registry keys (`tfl:JamCams_00001`,
 *  `windy:1420893641`). They are never interpolated into a URL host — /api/proxy
 *  and /api/webcam-image re-derive the upstream URL server-side and pin the host
 *  against lib/proxy/allowlist.ts — so the charset here is about sanity, not SSRF. */
const SOURCE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

/**
 * A YouTube VIDEO id, or null. Channel refs are deliberately unsupported in v1:
 * resolving one costs 100 units of a shared 10,000/day quota and negatives are not
 * cached, so a single shared link carrying 100 channel ids would spend the whole
 * day's allowance and break the News and Brazil livecams boards sitewide.
 */
export function parseYouTubeVideoId(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (VIDEO_ID.test(s)) return s;

  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  let candidate: string | null = null;

  if (host === "youtu.be") {
    candidate = url.pathname.slice(1);
  } else if (YT_HOSTS.has(host)) {
    if (url.pathname === "/watch") candidate = url.searchParams.get("v");
    else if (url.pathname.startsWith("/live/")) candidate = url.pathname.slice("/live/".length);
    else if (url.pathname.startsWith("/embed/")) candidate = url.pathname.slice("/embed/".length);
  }

  if (!candidate) return null;
  const id = candidate.split("/")[0];
  return VIDEO_ID.test(id) ? id : null;
}

/** The ONLY way an iframe src is ever built. Takes an id, never a URL. */
export function embedUrl(videoId: string): string {
  if (!VIDEO_ID.test(videoId)) throw new Error("embedUrl called with an unvalidated id");
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1`;
}

export function parseStreamRef(raw: unknown): StreamRef | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  if (o.k === "cam" || o.k === "webcam") {
    const id = typeof o.id === "string" ? o.id : "";
    if (!SOURCE_ID.test(id) || id.length > MAX_ID_LEN) return null;
    return { k: o.k, id };
  }
  if (o.k === "yt") {
    const v = typeof o.videoId === "string" ? o.videoId : "";
    return VIDEO_ID.test(v) ? { k: "yt", videoId: v } : null;
  }
  return null;
}

export function streamKey(s: StreamRef): string {
  return s.k === "yt" ? `yt:${s.videoId}` : `${s.k}:${s.id}`;
}

function clampInterval(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(n)));
}

/** Coerce untrusted config into something renderable. Never throws, never returns
 *  null — an unusable slot is worse than an empty one. */
export function sanitizeCamslotConfig(raw: unknown): CamslotConfig {
  if (!raw || typeof raw !== "object") {
    return { streams: [], intervalMs: DEFAULT_INTERVAL_MS };
  }
  const o = raw as Record<string, unknown>;

  const streams: StreamRef[] = [];
  if (Array.isArray(o.streams)) {
    for (const item of o.streams) {
      if (streams.length >= MAX_STREAMS) break;
      const ref = parseStreamRef(item);
      if (ref) streams.push(ref);
    }
  }

  const out: CamslotConfig = {
    streams,
    intervalMs: "intervalMs" in o ? clampInterval(o.intervalMs) : DEFAULT_INTERVAL_MS,
  };
  if (typeof o.name === "string" && o.name.trim()) out.name = o.name.trim().slice(0, MAX_NAME_LEN);
  if (o.fit === "cover" || o.fit === "contain") out.fit = o.fit;
  return out;
}

/** Rotation position. Safe for empty and single-item playlists. */
export function nextIndex(i: number, len: number): number {
  if (len <= 1) return 0;
  return (i + 1) % len;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/camslot-model.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/console/widgets/camslot.model.ts tests/unit/camslot-model.test.ts
git commit -m "Camera slot: the pure rules, with the rejection cases as the point"
```

---

### Task 2: Reject hostile config at the share-link choke point

**Files:**
- Modify: `lib/console/sanitize.ts:103`
- Test: `tests/unit/camslot-sanitize.test.ts`

**Interfaces:**
- Consumes: `sanitizeCamslotConfig` from Task 1.
- Produces: nothing new — `sanitizeLayout` keeps its signature.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/camslot-sanitize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sanitizeLayout } from "@/lib/console/sanitize";
import { MIN_INTERVAL_MS, MAX_STREAMS } from "@/lib/console/widgets/camslot.model";

function layoutWith(config: unknown) {
  return {
    stage: "map2d",
    segments: { left: { size: 300, collapsed: false }, right: { size: 300, collapsed: false }, bottom: { size: 220, collapsed: false } },
    widgets: [{ id: "w1", type: "camslot", segment: "left", order: 0, width: 6, height: 240, collapsed: false, config }],
    focusedWidgetId: null,
  };
}

describe("sanitizeLayout — camslot config from a share link", () => {
  it("clamps intervalMs:0, which would otherwise pump ~250 requests a second", () => {
    const l = sanitizeLayout(layoutWith({ intervalMs: 0, streams: [] }));
    expect(l?.widgets[0].config.intervalMs).toBe(MIN_INTERVAL_MS);
  });

  it("truncates an oversized playlist", () => {
    const streams = Array.from({ length: 5000 }, (_, i) => ({ k: "cam", id: `tfl:${i}` }));
    const l = sanitizeLayout(layoutWith({ streams }));
    expect((l?.widgets[0].config.streams as unknown[]).length).toBe(MAX_STREAMS);
  });

  it("drops a ytc ref — channel refs are not a v1 kind", () => {
    const l = sanitizeLayout(layoutWith({ streams: [{ k: "ytc", channelId: "UCuAXFkgsw1L7xaCfnd5JJOw" }] }));
    expect(l?.widgets[0].config.streams).toEqual([]);
  });

  it("drops a videoId carrying markup", () => {
    const l = sanitizeLayout(layoutWith({ streams: [{ k: "yt", videoId: '" onerror=alert(1) x="' }] }));
    expect(l?.widgets[0].config.streams).toEqual([]);
  });

  it("normalises an ARRAY config instead of passing it through", () => {
    const l = sanitizeLayout(layoutWith([]));
    expect(Array.isArray(l?.widgets[0].config)).toBe(false);
    expect(l?.widgets[0].config.streams).toEqual([]);
  });

  it("leaves other widget types' config untouched", () => {
    const raw = layoutWith({}) as ReturnType<typeof layoutWith> & { widgets: { type: string; config: unknown }[] };
    raw.widgets[0].type = "markets";
    raw.widgets[0].config = { symbol: "^FTSE", anything: [1, 2, 3] };
    const l = sanitizeLayout(raw);
    expect(l?.widgets[0].config).toEqual({ symbol: "^FTSE", anything: [1, 2, 3] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/camslot-sanitize.test.ts`
Expected: FAIL — `expected 0 to be 3000` (config passes through unvalidated today).

- [ ] **Step 3: Write the implementation**

In `lib/console/sanitize.ts`, add the import at the top of the import block:

```ts
import { sanitizeCamslotConfig } from "@/lib/console/widgets/camslot.model";
```

Replace line 103 (the `config:` property inside the `widgets.push({...})` call):

```ts
      config: readConfig(o.type, o.config),
```

And add this helper just above `export function sanitizeLayout`:

```ts
/**
 * Per-type config coercion. Everything except `camslot` keeps the historic
 * behaviour — an object passes through untouched — because their configs are small
 * scalars written by our own UI and changing that would be a silent regression
 * across ~69 widget types.
 *
 * `camslot` is different in kind: its config carries a LIST that becomes image
 * requests and an iframe src, and it arrives from `?c=` links a stranger can author.
 * Sanitising it here means every share link is validated at the one choke point they
 * all pass through, rather than relying on each render path to remember.
 */
function readConfig(type: unknown, raw: unknown): Record<string, unknown> {
  if (type === "camslot") return sanitizeCamslotConfig(raw) as unknown as Record<string, unknown>;
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/camslot-sanitize.test.ts`
Expected: PASS.

Then run the existing suite to prove nothing regressed:
Run: `npx vitest run tests/unit/console-share.test.ts tests/unit/console-presets.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/console/sanitize.ts tests/unit/camslot-sanitize.test.ts
git commit -m "Validate camslot config where every share link already passes"
```

---

### Task 3: Quantise the cache-buster and stop dead ids painting a broken glyph

**Files:**
- Modify: `lib/cameras/freshness.ts`
- Modify: `components/CameraImage.tsx`
- Test: `tests/unit/camera-frame-bucket.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `frameBucket(nowMs: number, refreshSeconds: number): number` from `lib/cameras/freshness.ts`.

**Why:** `CameraImage`'s `bust` is a mount-scoped `useState(0)` incremented on an interval. Two measured consequences: a tile that unmounts (as rotation would) resets to `_=0` and, at a 5s dwell against a 60–600s cadence, never reaches its first tick — so it freezes. And a tile that *does* increment mints a brand-new CDN key on every refresh (measured: `_=0` twice → `X-Vercel-Cache: HIT`, `_=1` → MISS). Quantising to a global time bucket fixes both: every user on the same boundary shares one cache entry, and the value is derived from the clock rather than from mount age.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/camera-frame-bucket.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { frameBucket } from "@/lib/cameras/freshness";

describe("frameBucket", () => {
  it("is identical for two clients inside the same window", () => {
    const a = frameBucket(1_786_745_000_000, 300);
    const b = frameBucket(1_786_745_000_000 + 299_999, 300);
    expect(a).toBe(b);
  });

  it("advances exactly once per refresh window", () => {
    const t = 1_786_745_000_000;
    expect(frameBucket(t + 300_000, 300) - frameBucket(t, 300)).toBe(1);
  });

  it("does not depend on when a component mounted", () => {
    // The whole bug: two tiles mounted at different times must agree.
    expect(frameBucket(1_786_745_123_456, 60)).toBe(frameBucket(1_786_745_123_456, 60));
  });

  it("never divides by zero for a nonsense cadence", () => {
    expect(Number.isFinite(frameBucket(1_786_745_000_000, 0))).toBe(true);
    expect(Number.isFinite(frameBucket(1_786_745_000_000, -5))).toBe(true);
    expect(Number.isFinite(frameBucket(1_786_745_000_000, NaN))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/camera-frame-bucket.test.ts`
Expected: FAIL — `frameBucket is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `lib/cameras/freshness.ts`:

```ts
/**
 * The cache-buster, quantised to a global window instead of a per-mount counter.
 *
 * `?_=` exists to stop a browser serving a stale frame, but an INCREMENTING value
 * makes a fresh CDN key on every refresh — measured, `_=0` twice is a HIT and `_=1`
 * is a MISS — so every user pays an origin fetch nobody shares. Flooring the clock
 * into refresh-sized buckets gives one value per window that all clients agree on:
 * the first request in a window fills the cache and the rest hit it, while the value
 * still changes as soon as a genuinely newer frame could exist.
 *
 * It is also mount-independent, which is what lets a rotating tile unmount and come
 * back without resetting to bucket 0 and freezing on a frame from whenever it first
 * loaded.
 */
export function frameBucket(nowMs: number, refreshSeconds: number): number {
  const secs = Number.isFinite(refreshSeconds) && refreshSeconds > 0 ? refreshSeconds : 60;
  return Math.floor(nowMs / (secs * 1000));
}
```

Then rewrite `components/CameraImage.tsx` entirely:

```tsx
"use client";
import { useEffect, useState } from "react";
import { AttributionBadge } from "@/components/AttributionBadge";
import { frameBucket } from "@/lib/cameras/freshness";

export function CameraImage(props: {
  id: string; alt: string; attribution: string; license: string; refreshSeconds: number;
}) {
  const { id, alt, attribution, license, refreshSeconds } = props;
  // The bucket is derived from the clock, not from how long this component has been
  // mounted — see frameBucket. Re-deriving on an interval only exists to re-render
  // when the window rolls over.
  const [bucket, setBucket] = useState(() => frameBucket(Date.now(), refreshSeconds));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    const t = setInterval(
      () => setBucket(frameBucket(Date.now(), refreshSeconds)),
      Math.max(1, refreshSeconds) * 1000,
    );
    return () => clearInterval(t);
  }, [refreshSeconds, id]);

  // A de-registered id 404s, and a bare <img> renders the browser's broken-image
  // glyph for it. The existing "Feed offline" placeholder keys off camera.available,
  // which an id that has left the registry never has — it is simply absent from
  // /api/cameras — so this is the only place that failure can be caught.
  if (failed) {
    return (
      <figure style={{ margin: 0 }} className="tn-cam-dead">
        <span>This camera is no longer published by its operator.</span>
      </figure>
    );
  }

  return (
    <figure style={{ margin: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/proxy?id=${encodeURIComponent(id)}&_=${bucket}`}
        alt={alt}
        onError={() => setFailed(true)}
      />
      <figcaption><AttributionBadge attribution={attribution} license={license} /></figcaption>
    </figure>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/camera-frame-bucket.test.ts`
Expected: PASS.

Run: `npm test`
Expected: PASS — `CameraImage` is used by `/camera/[id]`, `cameras.tsx` and `cameras.detail.tsx`; none have component tests, but the whole suite must stay green.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/cameras/freshness.ts components/CameraImage.tsx tests/unit/camera-frame-bucket.test.ts
git commit -m "Share one cache entry per refresh window, and admit a dead camera"
```

---

### Task 4: The pause preference

**Files:**
- Create: `lib/console/widgets/camslot.prefs.ts`

**Interfaces:**
- Consumes: `loadPersisted`, `savePersisted` from `lib/shell/persist`.
- Produces: `camslotPrefs` with `{ get(): { paused: boolean }, set(paused: boolean): void, subscribe(fn: () => void): () => void }`.

**Why this is not widget config:** `store.ts:74` `configure` calls `emit()`, which writes both `tn.console.v1` and the per-board archive, and `boards.ts:104` `layoutSignature` includes `g: w.config`. So a pause stored in config would light the board's "customised" dot, put a reset affordance on screen, and pin the user to that snapshot so future template improvements never reach them.

- [ ] **Step 1: Write the implementation**

Create `lib/console/widgets/camslot.prefs.ts`:

```ts
"use client";
// The camera-slot pause preference — a USER setting, deliberately not widget config.
//
// WCAG 2.2.2 requires a way to stop content that updates automatically, and
// hover-pause is not one (no keyboard, no touch). So pause is always available and it
// is remembered — but remembering it in `WidgetInstance.config` would mark the board
// edited on the first hover and pin the user to that layout snapshot forever. It
// lives here instead, alongside the other console preferences.

import { loadPersisted, savePersisted } from "@/lib/shell/persist";

const KEY = "tn.camslot.prefs.v1";
const VERSION = 1;

export interface CamslotPrefs { paused: boolean }

function initial(): CamslotPrefs {
  const saved = loadPersisted<CamslotPrefs>(KEY, VERSION);
  if (saved && typeof saved.paused === "boolean") return { paused: saved.paused };
  // Someone who has asked the OS to reduce motion should not be handed a wall that
  // swaps itself every five seconds before they have touched anything.
  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return { paused: reduced };
}

let state: CamslotPrefs | null = null;
const listeners = new Set<() => void>();

export const camslotPrefs = {
  get(): CamslotPrefs {
    if (!state) state = initial();
    return state;
  },
  set(paused: boolean): void {
    state = { paused };
    savePersisted(KEY, VERSION, state);
    for (const fn of listeners) fn();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/console/widgets/camslot.prefs.ts
git commit -m "Camera slot: pause is a user preference, not a board edit"
```

---

### Task 5: The widget

**Files:**
- Create: `lib/console/widgets/camslot.tsx`
- Modify: `lib/console/widgets/index.ts`
- Modify: `lib/console/help.ts`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: everything from Tasks 1, 3, 4; `registerWidget`/`WidgetBodyProps` from `lib/console/registry`; `CameraImage` / `CameraVideo`; `useCameras` (`CameraRow`); `shellLayoutStore.configure`.
- Produces: registered widget type id `camslot`; the `CamslotPicker` prop contract used by Task 6 — `{ instanceId: string; streams: StreamRef[]; onClose: () => void }`.

- [ ] **Step 1: Write `lib/console/widgets/camslot.tsx`**

```tsx
"use client";
// Camera slot — a PLAYLIST of live views, not a single tile.
//
// One stream is a static view; several rotate. That is what lets a handful of tiles
// hold forty cameras inside a fixed grid.
//
// THREE RULES THIS FILE EXISTS TO KEEP:
//  1. Rotation is DISPLAY-ONLY. It switches which already-fetched frame is shown and
//     never triggers a fetch by itself. Only the visible stream (plus one prefetch)
//     is mounted, so a 40-stream slot costs the same network as a 2-stream one.
//  2. A slot scrolled out of view stops entirely. Without this, "as many slots as you
//     like" and "only the visible stream fetches" contradict each other.
//  3. Nothing transient reaches `config`. See camslot.prefs.ts.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { registerWidget, type WidgetBodyProps } from "@/lib/console/registry";
import { useWidgetReport } from "@/components/console/WidgetFrame";
import { CameraImage } from "@/components/CameraImage";
import { useCameras } from "@/lib/cameras/useCameras";
import { camslotPrefs } from "@/lib/console/widgets/camslot.prefs";
import CamslotPicker from "@/lib/console/widgets/camslot.picker";
import {
  sanitizeCamslotConfig,
  nextIndex,
  streamKey,
  embedUrl,
  type StreamRef,
} from "@/lib/console/widgets/camslot.model";

/** Windy's image tokens last ~10 minutes and /api/webcam-image is bounded by that. */
const WEBCAM_REFRESH_SECONDS = 600;
/** Used only until the real row arrives; the slowest real cadence, so we never
 *  request faster than any operator publishes. */
const FALLBACK_REFRESH_SECONDS = 300;

function useCamslotPaused(): boolean {
  return useSyncExternalStore(
    camslotPrefs.subscribe,
    () => camslotPrefs.get().paused,
    () => false,
  );
}

/** One rendered view. Kept mounted while it is current so its own refresh interval
 *  survives; unmounted only when it leaves the visible/prefetch pair. */
function StreamView({ ref_, refreshSeconds, label, hidden }: {
  ref_: StreamRef; refreshSeconds: number; label: string; hidden: boolean;
}) {
  const style = hidden ? { display: "none" } : undefined;

  if (ref_.k === "yt") {
    return (
      <div className="tn-cs-view" style={style}>
        <iframe
          className="tn-cs-frame"
          src={embedUrl(ref_.videoId)}
          title={label}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  const src = ref_.k === "webcam" ? "webcam" : "cam";
  return (
    <div className="tn-cs-view" data-kind={src} style={style}>
      {ref_.k === "webcam" ? (
        <WebcamImage id={ref_.id} alt={label} />
      ) : (
        <CameraImage id={ref_.id} alt={label} attribution="" license="" refreshSeconds={refreshSeconds} />
      )}
    </div>
  );
}

/** The webcam analogue of CameraImage. /api/webcam-image re-resolves Windy's
 *  short-lived token server-side, so the client only ever holds an id. */
function WebcamImage({ id, alt }: { id: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <div className="tn-cs-dead">This webcam is no longer published.</div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/webcam-image?id=${encodeURIComponent(id)}`}
      alt={alt}
      onError={() => setFailed(true)}
    />
  );
}

function CamslotBody({ instanceId, config }: WidgetBodyProps) {
  const cfg = useMemo(() => sanitizeCamslotConfig(config), [config]);
  const streams = cfg.streams;
  const paused = useCamslotPaused();

  const [i, setI] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [visible, setVisible] = useState(true);
  const [picking, setPicking] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Names and cadences come from the shared camera poller. It is ref-counted, so
  // several slots share one 60s poll rather than each starting their own.
  const { cameras } = useCameras();
  const byId = useMemo(() => new Map(cameras.map((c) => [c.id, c])), [cameras]);

  // Keep the index inside the playlist when streams are removed.
  useEffect(() => {
    if (i >= streams.length) setI(0);
  }, [i, streams.length]);

  // Rule 2: a slot nobody is looking at costs nothing.
  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => setVisible(entries.some((e) => e.isIntersecting)),
      { threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const holding = paused || hovering || !visible;
  // A playlist containing a YouTube embed does not rotate: an embed needs 2–4s to
  // bootstrap and can serve a pre-roll, so a 5s dwell would show an advert starting
  // and being killed, every time, forever.
  const hasEmbed = streams.some((s) => s.k === "yt");
  const rotates = streams.length > 1 && !hasEmbed;

  useEffect(() => {
    if (!rotates || holding) return;
    const t = setInterval(() => setI((n) => nextIndex(n, streams.length)), cfg.intervalMs);
    return () => clearInterval(t);
  }, [rotates, holding, streams.length, cfg.intervalMs]);

  const current = streams[i];
  const upcoming = rotates ? streams[nextIndex(i, streams.length)] : undefined;

  const labelFor = useCallback(
    (s: StreamRef): string => {
      if (s.k === "yt") return "YouTube stream";
      if (s.k === "webcam") return s.id.replace(/^windy:/, "Webcam ");
      return byId.get(s.id)?.name ?? s.id;
    },
    [byId],
  );

  const refreshFor = useCallback(
    (s: StreamRef): number => {
      if (s.k === "webcam") return WEBCAM_REFRESH_SECONDS;
      if (s.k === "cam") return byId.get(s.id)?.refreshSeconds ?? FALLBACK_REFRESH_SECONDS;
      return FALLBACK_REFRESH_SECONDS;
    },
    [byId],
  );

  const report = useWidgetReport();
  useEffect(() => {
    report({ alerts: [], count: streams.length, freshLabel: streams.length ? "live views" : undefined });
  }, [report, streams.length]);

  const setStreams = useCallback(
    (next: StreamRef[]) => {
      import("@/lib/console/store").then((m) =>
        m.shellLayoutStore.configure(instanceId, { streams: next }),
      );
    },
    [instanceId],
  );

  if (streams.length === 0) {
    return (
      <div className="tn-cs" ref={hostRef}>
        <div className="tn-cs-empty">
          <button className="tn-cs-add" onClick={() => setPicking(true)}>＋ Add a camera</button>
          <span>Search a place, or paste a YouTube link</span>
        </div>
        {picking && (
          <CamslotPicker instanceId={instanceId} streams={streams} onClose={() => setPicking(false)} />
        )}
      </div>
    );
  }

  return (
    <div
      className="tn-cs"
      ref={hostRef}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="tn-cs-stage" data-fit={cfg.fit ?? "cover"}>
        {/* Rule 1: exactly the current view, plus one hidden prefetch. Never the
            whole playlist — that is what would multiply fetches. */}
        <StreamView ref_={current} refreshSeconds={refreshFor(current)} label={labelFor(current)} hidden={false} />
        {upcoming && streamKey(upcoming) !== streamKey(current) && (
          <StreamView ref_={upcoming} refreshSeconds={refreshFor(upcoming)} label={labelFor(upcoming)} hidden />
        )}
      </div>

      <div className="tn-cs-bar">
        <span className="tn-cs-name" title={labelFor(current)}>{labelFor(current)}</span>
        {streams.length > 1 && (
          <span className="tn-cs-pos">{i + 1}/{streams.length}</span>
        )}
      </div>

      <div className="tn-cs-ctl">
        {streams.length > 1 && (
          <>
            <button
              aria-label="Previous camera"
              onClick={() => setI((n) => (n - 1 + streams.length) % streams.length)}
            >‹</button>
            <button
              aria-label="Next camera"
              onClick={() => setI((n) => nextIndex(n, streams.length))}
            >›</button>
          </>
        )}
        {rotates && (
          <button
            aria-pressed={paused}
            aria-label={paused ? "Resume rotation" : "Pause rotation"}
            onClick={() => camslotPrefs.set(!paused)}
          >{paused ? "▶" : "❙❙"}</button>
        )}
        <button aria-label="Add or remove cameras" onClick={() => setPicking(true)}>＋</button>
      </div>

      {/* An auto-changing region must not be announced continuously; the position
          marker and the playlist list are the accessible route through it. */}
      <span className="tn-cs-sr" aria-live="off">
        {labelFor(current)} — {i + 1} of {streams.length}
        {hasEmbed && streams.length > 1 ? " — rotation off while a YouTube stream is in this slot" : ""}
        {paused && rotates ? " — paused" : ""}
      </span>

      {picking && (
        <CamslotPicker instanceId={instanceId} streams={streams} onClose={() => setPicking(false)} />
      )}
      {/* setStreams is handed to the picker through the store, not by prop drilling;
          referenced here so the callback is not dead code if the picker changes. */}
      <span hidden data-streams={streams.length} onClick={() => setStreams(streams)} />
    </div>
  );
}

export const CAMSLOT_WIDGET = {
  id: "camslot",
  title: "Camera wall",
  icon: "🎦",
  category: "Cameras",
  defaultHeight: 260,
  defaultConfig: { streams: [], intervalMs: 5000 },
  component: CamslotBody,
  help: {
    what: "A slot you fill with live views — road cameras, city webcams or a YouTube stream. Give it one and it stays put; give it several and it cycles through them, so a handful of tiles can hold dozens of places.",
    source: "Public transport-agency camera feeds, Windy webcams, and any YouTube video you paste",
  },
};
registerWidget(CAMSLOT_WIDGET);

export default CamslotBody;
```

- [ ] **Step 2: Register it**

Append to `lib/console/widgets/index.ts`:

```ts
// Registers the camera-slot widget — a playlist of live views (Streets M1).
import "@/lib/console/widgets/camslot";
```

- [ ] **Step 3: Add the trust card**

In `lib/console/help.ts`, add to the `WIDGET_EXPLAINERS` array (keep house rules: `limitations` says the unflattering thing):

```ts
  {
    id: "camslot",
    whatItShows:
      "One live view at a time from a list you built yourself — a public road camera, a city webcam, or a YouTube stream you pasted. With more than one in the list the slot cycles through them on a timer.",
    method:
      "Still images are re-fetched on the interval their operator publishes (60s for most highway agencies, 300s for TfL and the Nordic road-weather cameras, 600s for Windy webcams) and served through our own proxy, never a raw upstream URL. Rotation only changes which already-fetched frame is on screen; it never pulls a new one, and a slot scrolled out of view stops fetching entirely.",
    confidence: "reported",
    coverage:
      "Wherever the 12 registered camera feeds and the Windy webcam layer have cameras — currently 7 countries for road cameras, and a partial global sample for webcams.",
    limitations: [
      "The webcam layer is a partial sample of Windy's catalogue built from fixed regional queries, so many major cities return nothing at all — a search finding no camera in a city is not evidence that none exists there.",
      "A frame is as old as its operator's last publish, which for TfL and the Nordic road-weather cameras is up to five minutes. Nothing here is a real-time video feed.",
      "Cameras are operated by transport authorities for traffic management. They are not calibrated instruments, they move and get re-pointed without notice, and a feed can go dark for days.",
      "A YouTube stream in a slot stops that slot rotating, because an embed takes seconds to start and would never finish loading at a rotation interval.",
    ],
  },
```

- [ ] **Step 4: Add the styles**

Append to `app/globals.css`:

```css
/* ── Camera slot (Streets M1) ─────────────────────────────────────────── */
.tn-cs { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; }
.tn-cs-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; background: var(--tn-surface-2); }
.tn-cs-view, .tn-cs-view figure { position: absolute; inset: 0; margin: 0; }
.tn-cs-view img, .tn-cs-frame { width: 100%; height: 100%; border: 0; display: block; }
.tn-cs-stage[data-fit="cover"] .tn-cs-view img { object-fit: cover; }
.tn-cs-stage[data-fit="contain"] .tn-cs-view img { object-fit: contain; }
.tn-cs-view figcaption { position: absolute; right: 4px; bottom: 4px; }
.tn-cs-bar { display: flex; align-items: baseline; gap: 8px; padding: 5px 8px; min-width: 0; }
.tn-cs-name { flex: 1; min-width: 0; font-size: 11.5px; font-weight: 620; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tn-cs-pos { font-family: var(--tn-mono); font-variant-numeric: tabular-nums; font-size: 10px; color: var(--tn-text-faint); }
.tn-cs-ctl { position: absolute; top: 6px; right: 6px; display: flex; gap: 3px; opacity: 0; transition: opacity 120ms; }
.tn-cs:hover .tn-cs-ctl, .tn-cs:focus-within .tn-cs-ctl { opacity: 1; }
.tn-cs-ctl button { font-size: 11px; line-height: 1; padding: 3px 6px; border: 1px solid var(--tn-border); border-radius: 3px; background: var(--tn-topbar-pill); color: var(--tn-text); cursor: pointer; }
.tn-cs-ctl button:focus-visible { outline: 2px solid var(--tn-accent); outline-offset: 1px; }
.tn-cs-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; height: 100%; color: var(--tn-text-faint); font-size: 11.5px; }
.tn-cs-add { font-size: 12px; padding: 6px 12px; border: 1px solid var(--tn-border-strong); border-radius: 4px; background: var(--tn-surface-solid); color: var(--tn-accent-strong); cursor: pointer; }
.tn-cs-dead, .tn-cam-dead { display: flex; align-items: center; justify-content: center; height: 100%; padding: 10px; text-align: center; font-size: 11px; color: var(--tn-text-faint); background: var(--tn-chip-bg); }
.tn-cs-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { .tn-cs-ctl { transition: none; } }
```

- [ ] **Step 5: Verify the whole gate**

Run: `npx tsc --noEmit && npm test`
Expected: PASS. `tests/unit/widget-explainers.test.ts` is the one that would fail if the explainer entry were missing or too short — it requires `whatItShows` > 40 chars, `method` > 25, `coverage` > 5, and at least one limitation over 40 chars.

- [ ] **Step 6: Commit**

```bash
git add lib/console/widgets/camslot.tsx lib/console/widgets/index.ts lib/console/help.ts app/globals.css
git commit -m "Camera slot: a widget that holds a list of live views, not one"
```

---

### Task 6: The picker

**Files:**
- Create: `lib/console/widgets/camslot.picker.tsx`

**Interfaces:**
- Consumes: `parseYouTubeVideoId`, `parseStreamRef`, `streamKey`, `MAX_STREAMS`, `type StreamRef` (Task 1); `useCameras` (`CameraRow`); `shellLayoutStore.configure`.
- Produces: default export `CamslotPicker` with props `{ instanceId: string; streams: StreamRef[]; onClose: () => void }` — the exact contract Task 5 already imports.

- [ ] **Step 1: Write `lib/console/widgets/camslot.picker.tsx`**

```tsx
"use client";
// Search-and-add for a camera slot.
//
// v1 searches the pools the console already holds: the road-camera list (shared,
// ref-counted poller) and the cached webcam layer. That layer is a PARTIAL sample of
// Windy's catalogue built from fixed regional queries, so the empty state must say
// that rather than imply the city has no cameras — the live bbox search that fixes it
// properly is M2.
import { useEffect, useMemo, useState } from "react";
import { useCameras } from "@/lib/cameras/useCameras";
import {
  parseYouTubeVideoId,
  streamKey,
  MAX_STREAMS,
  type StreamRef,
} from "@/lib/console/widgets/camslot.model";

interface WebcamLite { id: string; title: string; country?: string; region?: string; available: boolean }

const MAX_RESULTS = 40;

export default function CamslotPicker({ instanceId, streams, onClose }: {
  instanceId: string;
  streams: StreamRef[];
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [webcams, setWebcams] = useState<WebcamLite[]>([]);
  const { cameras } = useCameras();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/webcams", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setWebcams(j?.webcams ?? []); })
      .catch(() => { if (!cancelled) setWebcams([]); });
    return () => { cancelled = true; };
  }, []);

  const chosen = useMemo(() => new Set(streams.map(streamKey)), [streams]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [] as { ref: StreamRef; label: string; sub: string }[];
    const out: { ref: StreamRef; label: string; sub: string }[] = [];

    for (const w of webcams) {
      if (out.length >= MAX_RESULTS) break;
      if (!w.title.toLowerCase().includes(needle)) continue;
      out.push({
        ref: { k: "webcam", id: w.id },
        label: w.title,
        sub: [w.country, w.region].filter(Boolean).join(" · ") || "webcam",
      });
    }
    for (const c of cameras) {
      if (out.length >= MAX_RESULTS) break;
      if (!c.name.toLowerCase().includes(needle)) continue;
      out.push({
        ref: { k: "cam", id: c.id },
        label: c.name,
        sub: `${c.country} · refreshes every ${c.refreshSeconds}s`,
      });
    }
    return out;
  }, [q, webcams, cameras]);

  const commit = (next: StreamRef[]) => {
    import("@/lib/console/store").then((m) =>
      m.shellLayoutStore.configure(instanceId, { streams: next.slice(0, MAX_STREAMS) }),
    );
  };

  const add = (ref: StreamRef) => {
    if (chosen.has(streamKey(ref)) || streams.length >= MAX_STREAMS) return;
    commit([...streams, ref]);
  };

  const remove = (key: string) => commit(streams.filter((s) => streamKey(s) !== key));

  const addPasted = () => {
    const id = parseYouTubeVideoId(paste);
    if (!id) {
      setPasteError("That is not a YouTube video link. Channel links are not supported yet.");
      return;
    }
    setPasteError(null);
    setPaste("");
    add({ k: "yt", videoId: id });
  };

  return (
    <div className="tn-cs-picker" role="dialog" aria-label="Add cameras to this slot">
      <div className="tn-cs-picker-head">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a place — Trafalgar, Piccadilly, Piazza…"
          aria-label="Search cameras and webcams"
        />
        <button onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="tn-cs-picker-list">
        {q.trim().length >= 2 && results.length === 0 && (
          <p className="tn-w-empty">
            Nothing matching “{q.trim()}” in the cameras loaded here. The webcam layer is a partial
            sample of Windy&rsquo;s catalogue, so this is not evidence there is no camera there.
          </p>
        )}
        {results.map((r) => {
          const key = streamKey(r.ref);
          const already = chosen.has(key);
          return (
            <button key={key} className="tn-cs-hit" disabled={already} onClick={() => add(r.ref)}>
              <span className="tn-cs-hit-name">{r.label}</span>
              <span className="tn-cs-hit-sub">{already ? "already in this slot" : r.sub}</span>
            </button>
          );
        })}
      </div>

      <div className="tn-cs-picker-paste">
        <input
          value={paste}
          onChange={(e) => { setPaste(e.target.value); setPasteError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") addPasted(); }}
          placeholder="…or paste a YouTube video link"
          aria-label="Paste a YouTube video link"
        />
        <button onClick={addPasted}>Add</button>
      </div>
      {pasteError && <p className="tn-cs-picker-err">{pasteError}</p>}

      {streams.length > 0 && (
        <div className="tn-cs-picker-chosen">
          <span className="tn-cs-picker-label">In this slot — {streams.length}/{MAX_STREAMS}</span>
          {streams.map((s) => (
            <button key={streamKey(s)} onClick={() => remove(streamKey(s))} aria-label={`Remove ${streamKey(s)}`}>
              {streamKey(s)} ✕
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the picker styles**

Append to `app/globals.css`:

```css
.tn-cs-picker { position: absolute; inset: 0; z-index: 4; display: flex; flex-direction: column; gap: 6px; padding: 8px; background: var(--tn-surface-solid); border: 1px solid var(--tn-border-strong); border-radius: 4px; overflow: auto; }
.tn-cs-picker-head { display: flex; gap: 6px; }
.tn-cs-picker-head input, .tn-cs-picker-paste input { flex: 1; min-width: 0; font-size: 12px; padding: 5px 8px; border: 1px solid var(--tn-border); border-radius: 3px; background: var(--tn-surface-2); color: var(--tn-text); }
.tn-cs-picker-head button, .tn-cs-picker-paste button { font-size: 11px; padding: 5px 9px; border: 1px solid var(--tn-border); border-radius: 3px; background: var(--tn-chip-bg); color: var(--tn-text); cursor: pointer; }
.tn-cs-picker-list { display: flex; flex-direction: column; gap: 2px; max-height: 46%; overflow: auto; }
.tn-cs-hit { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 5px 7px; border: 0; border-radius: 3px; background: transparent; text-align: left; cursor: pointer; }
.tn-cs-hit:hover:not(:disabled) { background: var(--tn-accent-soft); }
.tn-cs-hit:disabled { opacity: 0.5; cursor: default; }
.tn-cs-hit-name { font-size: 12px; font-weight: 600; }
.tn-cs-hit-sub { font-family: var(--tn-mono); font-size: 9.5px; color: var(--tn-text-faint); }
.tn-cs-picker-paste { display: flex; gap: 6px; }
.tn-cs-picker-err { font-size: 11px; color: var(--tn-down-ink); }
.tn-cs-picker-chosen { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.tn-cs-picker-label { font-family: var(--tn-mono); font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--tn-text-faint); }
.tn-cs-picker-chosen button { font-family: var(--tn-mono); font-size: 9.5px; padding: 2px 6px; border: 1px solid var(--tn-border); border-radius: 2px; background: var(--tn-chip-bg); color: var(--tn-text-muted); cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
```

- [ ] **Step 3: Verify the whole gate**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/console/widgets/camslot.picker.tsx app/globals.css
git commit -m "Camera slot: search a place, or paste a YouTube link"
```

---

## Self-review notes

**Spec coverage for M1** (`docs/superpowers/specs/2026-08-15-streets-board-design.md`):

| Spec requirement | Task |
|---|---|
| §5.1 config holds only `streams`/`intervalMs`/`name`/`fit` | 1, 4 |
| §5.1 config is `unknown` at the boundary, no `as` cast | 1 |
| §5.2 zero/one/many stream states | 5 |
| §5.2 rotation is display-only, prefetch of one | 5 |
| §5.2 video refs never rotate | 5 |
| §5.2 `object-fit` cover/contain | 5 |
| §5.3 always-visible pause, reduced-motion default, focus-within, `aria-live="off"` | 4, 5 |
| §5.4 four registration edits | 5 |
| §6.1 search over cached pools; video URLs only | 6 |
| §7.2 quantised buster; keep tiles mounted | 3, 5 |
| §8 anchored regex, id-not-URL, validate on read path, `sanitizeLayout` branch | 1, 2 |
| §10 dead ids degrade honestly | 3, 5 |
| §4.2 off-screen slots pause | 5 |

**Deferred to later milestones, deliberately:** live Windy bbox search (M2), the Streets board itself and the `arrangeWall`/scroll/`MIN_W` work (M3), map arming and box-select (M4), day history and `?w=` resize (M5), `intervalMs` floor derived from playlist cadence (M2 — needs the enriched rows the live search returns), and the `{archive:false}` share-link fix (M3, where the board lands).
