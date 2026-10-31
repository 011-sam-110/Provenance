import { beforeEach, describe, expect, it, vi } from "vitest";
import { NEAR_MAX } from "@/lib/eye/cameras";

const nearestTo = vi.fn();

vi.mock("@/lib/sources/registry", () => ({
  getRegistry: vi.fn(),
  nearestTo: (...args: unknown[]) => nearestTo(...args),
}));
vi.mock("@/lib/liveness/playcheck", () => ({
  isLiveCamera: () => false,
  liveGate: () => ({}),
}));
vi.mock("@/lib/liveness/playcheck.server", () => ({ ensurePlayCheck: () => {} }));

const row = (km: number) => ({
  camera: { id: `c${km}`, name: `Camera ${km}`, lat: 51.5, lon: -0.1, available: true, source: "tfl" },
  km,
});

async function ask(query: string): Promise<{ count: number; cameras: { km: number }[] }> {
  const { GET } = await import("@/app/api/near/route");
  const res = await GET(new Request(`https://x.test/api/near?lat=51.5&lon=-0.12${query}`));
  return res.json();
}

describe("/api/near", () => {
  beforeEach(() => {
    nearestTo.mockReset();
    nearestTo.mockResolvedValue([row(0.3), row(2), row(4), row(287)]);
  });

  it("gives eight by default, as the console's Near me expects", async () => {
    await ask("");
    expect(nearestTo).toHaveBeenCalledWith(51.5, -0.12, 8);
  });

  it("lets the God's eye view ask for every camera of a dense city, and no more", async () => {
    await ask(`&n=${NEAR_MAX}`);
    expect(nearestTo).toHaveBeenLastCalledWith(51.5, -0.12, NEAR_MAX);
    await ask(`&n=${NEAR_MAX * 10}`);
    expect(nearestTo).toHaveBeenLastCalledWith(51.5, -0.12, NEAR_MAX);
  });

  it("stops at `km`, so an empty city does not get 600 far cameras", async () => {
    const body = await ask("&n=25&km=4");
    expect(body.cameras.map((c) => c.km)).toEqual([0.3, 2, 4]);
    expect(body.count).toBe(3);
  });

  it("ignores a `km` that is not a positive number", async () => {
    for (const bad of ["&km=0", "&km=-1", "&km=abc"]) {
      expect((await ask(bad)).cameras).toHaveLength(4);
    }
  });
});
