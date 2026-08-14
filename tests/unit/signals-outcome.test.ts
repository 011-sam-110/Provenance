import { describe, it, expect, vi, afterEach } from "vitest";
import { SIGNALS } from "@/lib/signals/registry";
import {
  degraded,
  markOutcome,
  observed,
  publishOutcome,
  readOutcome,
} from "@/lib/signals/outcome";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("outcome side-channel", () => {
  it("survives the array operations the pipeline actually performs", () => {
    const rows = observed([{ id: "a" }, { id: "b" }]);
    expect(readOutcome(rows)?.ok).toBe(true);
    expect(rows).toHaveLength(2);
    // Non-enumerable and symbol-keyed, so the wire format is byte-identical.
    expect(JSON.stringify(rows)).toBe('[{"id":"a"},{"id":"b"}]');
    expect(Object.keys(rows)).toEqual(["0", "1"]);
  });

  it("does NOT survive a JSON round trip, which is why the API publishes real fields", () => {
    const revived = JSON.parse(JSON.stringify(observed([{ id: "a" }])));
    expect(readOutcome(revived)).toBeUndefined();
  });

  it("treats an empty success as different from a failure", () => {
    // The distinction the old code could not express, and the whole point.
    expect(readOutcome(observed([]))).toMatchObject({ ok: true });
    expect(readOutcome(degraded("http 503"))).toMatchObject({ ok: false, reason: "http 503" });
    expect(degraded("http 503")).toHaveLength(0);
  });

  it("rejects a malformed record rather than trusting it", () => {
    const rows: unknown[] = [];
    markOutcome(rows, { ok: "yes" as unknown as boolean, at: 1 });
    expect(readOutcome(rows)).toBeUndefined();
  });
});

describe("publishOutcome — absence is never health", () => {
  it("reports an undeclared array as not-ok, not as fine", () => {
    // An adapter that has not been converted must not assert health it never
    // measured. The registry guard below is what keeps this state out of prod, but
    // the runtime default has to agree with it.
    expect(publishOutcome([], 1234)).toEqual({
      ok: false,
      observedAt: 1234,
      degradedReason: "not declared",
    });
  });

  it("carries the adapter's own read instant, not the moment of publishing", () => {
    // observedAt must be the age of the DATA. A cached body stamped at request time
    // looks perpetually fresh no matter how old the reading behind it is.
    const rows = observed([{ id: "a" }], 1_000);
    expect(publishOutcome(rows, 9_999)).toEqual({ ok: true, observedAt: 1_000 });
  });

  it("always emits ok and observedAt, so a missing field means a pre-contract payload", () => {
    // The client relies on this: `typeof body.ok === "undefined"` must mean "an old
    // edge-cached body minted before this shipped", never "a failure". Those are
    // different facts and only one of them is worth alarming a visitor about.
    for (const sample of [observed([]), degraded("x"), []]) {
      const published = publishOutcome(sample);
      expect(published).toHaveProperty("ok");
      expect(published).toHaveProperty("observedAt");
      expect(typeof published.observedAt).toBe("number");
    }
  });

  it("supplies a reason even when a failure forgot to give one", () => {
    const rows: unknown[] = [];
    markOutcome(rows, { ok: false, at: 5 });
    expect(publishOutcome(rows).degradedReason).toBe("upstream failed");
  });
});

// ---------------------------------------------------------------------------
// THE BUILD GATE.
//
// Every registered adapter must declare an outcome on its FAILURE path. Partial
// adoption is the danger this whole change exists to remove: an adapter still
// returning a bare [] reports as a quiet layer rather than a broken one, and on the
// public landing page that is indistinguishable from health.
//
// Forcing the failure is what makes this checkable without a network: stub fetch to
// reject, call every adapter, and require each to say so. An adapter that swallows
// the rejection into a bare [] fails here by name.
// ---------------------------------------------------------------------------
describe("every registered adapter declares a failure outcome", () => {
  it.each(SIGNALS.map((s) => [s.id, s] as const))(
    "%s declares ok:false when its upstream refuses",
    async (id, source) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("network refused (test)");
        }),
      );

      let rows: unknown;
      try {
        rows = await source.fetch();
      } catch (err) {
        // An adapter is allowed to throw — the route catches it and reports
        // "adapter threw", which is itself an honest degraded state. What is not
        // allowed is resolving to a bare array with nothing said.
        expect(err).toBeInstanceOf(Error);
        return;
      }

      expect(Array.isArray(rows), `${id} did not resolve to an array`).toBe(true);
      const outcome = readOutcome(rows);
      expect(
        outcome,
        `${id} returned a bare array on failure — it will read as a quiet layer, not a broken one. Return degraded("...") instead of [].`,
      ).toBeDefined();
      expect(outcome!.ok, `${id} reported ok:true while its upstream was refusing`).toBe(false);
      expect(typeof outcome!.reason, `${id} gave no reason`).toBe("string");
      expect(outcome!.reason!.length, `${id} gave an empty reason`).toBeGreaterThan(0);
    },
    20_000,
  );

  it("no adapter's failure reason leaks a URL, a token or an error body", async () => {
    // Reasons reach the API envelope and may be rendered to a visitor, so they are
    // a disclosure surface. Checked against the REAL reasons every adapter emits,
    // not against a hand-written sample.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network refused (test)");
      }),
    );

    const leaks: string[] = [];
    for (const source of SIGNALS) {
      let rows: unknown;
      try {
        rows = await source.fetch();
      } catch {
        continue; // throwing is handled by the route, nothing published from here
      }
      const reason = readOutcome(rows)?.reason;
      if (!reason) continue;
      if (/https?:\/\//i.test(reason)) leaks.push(`${source.id}: URL in reason -> ${reason}`);
      if (/bearer\s|sk-[a-z0-9]|api[_-]?key\s*=/i.test(reason)) {
        leaks.push(`${source.id}: credential-shaped text in reason -> ${reason}`);
      }
      if (reason.length > 80) leaks.push(`${source.id}: reason too long (${reason.length}), likely an upstream body`);
    }

    expect(leaks, leaks.join("\n")).toEqual([]);
  }, 60_000);
});
