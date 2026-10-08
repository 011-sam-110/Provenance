import { expect, test, vi } from "vitest";

// The /api/signals/<id> payload is what the map, the widgets and the detail panel
// read. Every feature in it must carry its precision level, so no consumer has to
// know the registry to say how precise a place is.

const fake = vi.hoisted(() => ({
  source: {
    id: "fake-country-layer",
    precision: "country",
    refreshMs: 60_000,
    fetch: async () => [
      { id: "f:1", lat: 33, lon: 65, title: "Afghanistan", signalId: "fake-country-layer" },
      // One feature that sets its own level: the layer default must not replace it.
      { id: "f:2", lat: 48.85, lon: 2.35, title: "Paris", signalId: "fake-country-layer", precision: "area" },
    ],
  },
}));

vi.mock("@/lib/signals/registry", () => ({
  getSignal: (id: string) => (id === fake.source.id ? fake.source : undefined),
}));

import { GET } from "@/app/api/signals/[id]/route";

const call = (id: string) =>
  GET(new Request(`https://provenance-online.com/api/signals/${id}`), { params: Promise.resolve({ id }) });

test("every feature in the payload carries its precision level", async () => {
  const res = await call(fake.source.id);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { count: number; features: { id: string; precision?: string }[] };
  expect(body.count).toBe(2);
  expect(body.features.map((f) => [f.id, f.precision])).toEqual([
    ["f:1", "country"],
    ["f:2", "area"],
  ]);
});

test("a cache hit serves the same levels", async () => {
  const body = (await (await call(fake.source.id)).json()) as { features: { precision?: string }[] };
  expect(body.features.map((f) => f.precision)).toEqual(["country", "area"]);
});
