import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NotifyChannels } from "@/lib/shell/notifications";

// Hoisted so the mock factory below can close over it — vi.mock is lifted above the
// imports, and a plain `const` would still be in its temporal dead zone when the
// factory runs.
const { sent } = vi.hoisted(() => ({ sent: [] as { text: string; channels: NotifyChannels }[] }));

// `dispatch` is the boundary. Everything before it is ours and is asserted here;
// everything after it is the existing master gate and the channel relays, which have
// their own tests and must not be re-exercised from node.
vi.mock("@/lib/shell/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/shell/notifications")>();
  return {
    ...actual,
    dispatch: (text: string, rule: { channels: NotifyChannels }) => {
      sent.push({ text, channels: rule.channels });
    },
  };
});

import { tick, __resetBudgetWindow, type SourceFeed } from "@/lib/notify/runner";
import { rulesStore } from "@/lib/notify/rules";
import { observationsStore } from "@/lib/notify/observations";
import { MAX_PER_AREA_HOUR } from "@/lib/notify/budget";
import { WORLD_AREA_ID, type AreaRule, type ObservedRow } from "@/lib/notify/types";

const rule = (id: string, channels: NotifyChannels): AreaRule => ({
  id,
  areaId: WORLD_AREA_ID,
  sourceId: "earthquakes",
  params: { kind: "appears" },
  channels,
  enabled: true,
  createdAt: 1,
});

const rows = (n: number): ObservedRow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `q${i}`, lat: 51.5, lon: -0.13, scalars: { mag: 5 }, title: `quake ${i}`,
  }));

const reader = (r: ObservedRow[]): ((s: string) => SourceFeed | null) =>
  () => ({ rows: r, ok: true, lastOk: 1_000, label: "Earthquakes" });

beforeEach(() => {
  sent.length = 0;
  rulesStore.hydrate(new Set(), new Set()); // node persist is a no-op → empties the store
  observationsStore.__reset();
  __resetBudgetWindow();
});

describe("tick — each event goes out on ITS OWN rule's channels", () => {
  it("does not leak a Browser-only rule onto Telegram because another rule on the same area has Telegram armed", () => {
    rulesStore.add(rule("rule:browser", { browser: true, telegram: false, discord: false }));
    rulesStore.add(rule("rule:telegram", { browser: false, telegram: true, discord: false }));

    tick(reader(rows(1)), 10_000); // G1 — the first look seeds, silently
    expect(sent).toHaveLength(0);

    tick(reader(rows(2)), 20_000); // one new row, two armed rules → two events

    expect(sent).toHaveLength(2);
    expect(sent.filter((s) => s.channels.telegram)).toHaveLength(1);
    expect(sent.filter((s) => s.channels.browser)).toHaveLength(1);
    // The failure this pins: one event fanned out on the UNION would put a
    // Browser-only rule's text into someone's Telegram.
    expect(sent.some((s) => s.channels.browser && s.channels.telegram)).toBe(false);
  });

  it("words every line with the area, so a World rule does not send a bare row title", () => {
    rulesStore.add(rule("rule:browser", { browser: true, telegram: false, discord: false }));
    tick(reader(rows(1)), 10_000);
    tick(reader(rows(2)), 20_000);
    expect(sent[0].text).toMatch(/^World · Earthquakes · /);
  });
});

describe("tick — the budget's closing line", () => {
  it("goes to the union of the area's channels and names the area by label, because it belongs to the area rather than to any one rule", () => {
    rulesStore.add(rule("rule:browser", { browser: true, telegram: false, discord: false }));
    rulesStore.add(rule("rule:telegram", { browser: false, telegram: true, discord: false }));

    tick(reader(rows(1)), 10_000); // seed
    tick(reader(rows(MAX_PER_AREA_HOUR + 4)), 20_000); // far over the ceiling

    const closing = sent[sent.length - 1];
    expect(closing.text).toMatch(/held/i);
    expect(closing.text).toContain("World");
    expect(closing.text).not.toContain(WORLD_AREA_ID);
    expect(closing.channels).toEqual({ browser: true, telegram: true, discord: false });
  });

  it("sends nothing beyond the ceiling plus that one line, so a storm cannot outrun the cap", () => {
    rulesStore.add(rule("rule:browser", { browser: true, telegram: false, discord: false }));
    tick(reader(rows(1)), 10_000);
    tick(reader(rows(MAX_PER_AREA_HOUR + 4)), 20_000);
    expect(sent).toHaveLength(MAX_PER_AREA_HOUR + 1);
  });
});
