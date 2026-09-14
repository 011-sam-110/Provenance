import { afterEach, expect, test, vi } from "vitest";

// Concurrent cache misses for one signal id must share ONE adapter fetch. Before this
// guard, the cache was written only after the fetch finished, so every request that
// arrived during a slow upstream call started its own call. The landing page asks for
// every layer for every visitor, so a traffic spike multiplied upstream load by the
// number of visitors who arrived inside that window.

const fake = vi.hoisted(() => {
  const state = { calls: 0, fail: false, delayMs: 10 };
  return {
    state,
    source: {
      id: "fake-layer",
      refreshMs: 60_000,
      fetch: async () => {
        state.calls += 1;
        await new Promise((r) => setTimeout(r, state.delayMs));
        if (state.fail) throw new Error("upstream down");
        return [];
      },
    },
  };
});

vi.mock("@/lib/signals/registry", () => ({
  getSignal: (id: string) => (id === fake.source.id ? fake.source : undefined),
}));

import { GET } from "@/app/api/signals/[id]/route";

let nextId = 0;
// Each test uses its own id so the route's module-level cache cannot leak between tests.
function useFreshId(): string {
  fake.source.id = `fake-layer-${nextId++}`;
  fake.state.calls = 0;
  fake.state.fail = false;
  return fake.source.id;
}
const call = (id: string) =>
  GET(new Request(`https://provenance-online.com/api/signals/${id}`), { params: Promise.resolve({ id }) });

afterEach(() => {
  vi.restoreAllMocks();
});

test("three concurrent misses make ONE adapter call and all get the same payload", async () => {
  const id = useFreshId();
  const responses = await Promise.all([call(id), call(id), call(id)]);
  expect(fake.state.calls).toBe(1);
  for (const r of responses) {
    expect(r.status).toBe(200);
    expect((await r.json()).count).toBe(0);
  }
});

test("a thrown adapter is shared too: one call, every caller still gets a 200", async () => {
  const id = useFreshId();
  fake.state.fail = true;
  const responses = await Promise.all([call(id), call(id)]);
  expect(fake.state.calls).toBe(1);
  for (const r of responses) {
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(false);
  }
});

test("the in-flight entry clears, so a later miss asks the adapter again", async () => {
  const id = useFreshId();
  const base = Date.now();
  const now = vi.spyOn(Date, "now").mockReturnValue(base);
  await call(id);
  now.mockReturnValue(base + 24 * 60 * 60 * 1000);
  await call(id);
  expect(fake.state.calls).toBe(2);
});

test("unknown id is still a 404", async () => {
  const res = await call("no-such-layer");
  expect(res.status).toBe(404);
});
