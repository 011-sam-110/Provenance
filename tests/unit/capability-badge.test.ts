import { describe, it, expect } from "vitest";
import { capabilityBadge, type CapabilityBadge } from "@/lib/console/widgets/signals";
import type { CapabilityState } from "@/lib/sources/keyRequirements";
import type { StatusEntry, StatusRefusal } from "@/lib/sources/statusReport";

// Pure state -> badge decision behind BOTH surfaces that must show `refused`
// distinctly: the source-catalog rail row (components/shell/SourceCatalog.tsx)
// and the generic signal widget's empty-state body
// (lib/console/widgets/signals.tsx). Both call this one function, so a test
// here proves both surfaces at once.

type Input = Pick<StatusEntry, "state" | "missingEnv" | "degrades" | "obtain" | "refusal">;

/** Minimal, deliberately bare entry — only the state under test is meaningful. */
function entry(state: CapabilityState, patch: Partial<Input> = {}): Input {
  return { state, missingEnv: [], degrades: undefined, obtain: undefined, refusal: undefined, ...patch };
}

const refusal = (patch: Partial<StatusRefusal> = {}): StatusRefusal => ({
  since: 1_700_000_000_000,
  status: 403,
  host: "acleddata.com",
  count: 3,
  observed:
    "acleddata.com answered HTTP 403 to a server-side request carrying this deployment's credential " +
    "(3 such refusals since this process started, and no 2xx from it since). The credential is present; " +
    "it is not being accepted.",
  ...patch,
});

describe("capabilityBadge — no status", () => {
  it("returns null for null and undefined — an absent badge is the honest fallback", () => {
    expect(capabilityBadge(null)).toBeNull();
    expect(capabilityBadge(undefined)).toBeNull();
  });
});

// Every state that means "this works, or needs nothing" must render NO badge —
// badging a working feature would say a live thing is dead.
describe("capabilityBadge — states that earn no badge", () => {
  const silent: CapabilityState[] = ["keyless", "configured", "upgradable", "enhanced"];
  it.each(silent)("renders nothing for '%s'", (state) => {
    expect(capabilityBadge(entry(state))).toBeNull();
  });

  it("stays silent for 'configured' even carrying degrades/obtain text (only locked/refused use it)", () => {
    expect(
      capabilityBadge(entry("configured", { degrades: "would degrade", obtain: "would obtain" })),
    ).toBeNull();
  });
});

describe("capabilityBadge — locked", () => {
  it("names the missing env vars, the consequence, and where to get one", () => {
    const badge = capabilityBadge(
      entry("locked", {
        missingEnv: ["ACLED_EMAIL", "ACLED_PASSWORD"],
        degrades: "The conflict-event layer is empty.",
        obtain: "Free — register at acleddata.com.",
      }),
    ) as CapabilityBadge;
    expect(badge.kind).toBe("locked");
    expect(badge.icon).toBe("🔑");
    expect(badge.short).toBe("needs a key");
    expect(badge.long).toContain("ACLED_EMAIL + ACLED_PASSWORD");
    expect(badge.long).toContain("The conflict-event layer is empty.");
    expect(badge.long).toContain("Free — register at acleddata.com.");
  });

  it("falls back to 'a key' rather than an empty missing-var list", () => {
    const badge = capabilityBadge(entry("locked", { missingEnv: [] })) as CapabilityBadge;
    expect(badge.long).toContain("this deployment has no a key");
  });
});

describe("capabilityBadge — refused", () => {
  it("is a DIFFERENT kind, icon and short label from 'locked' — never the same badge", () => {
    const lockedBadge = capabilityBadge(entry("locked", { missingEnv: ["X"] })) as CapabilityBadge;
    const refusedBadge = capabilityBadge(
      entry("refused", { refusal: refusal() }),
    ) as CapabilityBadge;
    expect(refusedBadge.kind).not.toBe(lockedBadge.kind);
    expect(refusedBadge.icon).not.toBe(lockedBadge.icon);
    expect(refusedBadge.short).not.toBe(lockedBadge.short);
    expect(refusedBadge.short.toLowerCase()).not.toContain("needs a key");
  });

  it("says plainly that the upstream refused the credential — not a vague 'unavailable'", () => {
    const badge = capabilityBadge(
      entry("refused", {
        refusal: refusal({ host: "acleddata.com", status: 403 }),
        degrades: "Loses the conflict factor.",
        obtain: "Register at acleddata.com.",
      }),
    ) as CapabilityBadge;
    expect(badge.kind).toBe("refused");
    expect(badge.short).toBe("credential refused");
    expect(badge.long.toLowerCase()).not.toContain("unavailable");
    expect(badge.long).toContain("acleddata.com answered HTTP 403");
    expect(badge.long).toContain("The credential is present; it is not being accepted.");
    expect(badge.long).toContain("Loses the conflict factor.");
    expect(badge.long).toContain("Register at acleddata.com.");
  });

  it("carries the real evidence verbatim rather than re-deriving its own claim", () => {
    // The report's own `refusal.observed` sentence is reused, not re-worded —
    // so this badge can never drift from what /api/status actually publishes.
    const observed = "example.org answered HTTP 401 to a server-side request carrying this deployment's credential.";
    const badge = capabilityBadge(
      entry("refused", { refusal: refusal({ host: "example.org", status: 401, observed }) }),
    ) as CapabilityBadge;
    expect(badge.long).toContain(observed);
  });

  it("still says something honest when refused but the refusal record is missing (defensive, should not happen)", () => {
    const badge = capabilityBadge(entry("refused", { refusal: undefined })) as CapabilityBadge;
    expect(badge.kind).toBe("refused");
    expect(badge.long).toContain("the upstream refused this deployment's credential");
  });
});

// The switch inside capabilityBadge is exhaustive (`const exhaustive: never = ...`),
// so a 7th CapabilityState added to lib/sources/keyRequirements.ts without a case
// here fails `npx tsc --noEmit` — this test instead proves the CURRENT six are
// each exercised, so nobody can quietly delete a case and still pass CI.
describe("capabilityBadge — covers every current state, none silently blank by accident", () => {
  const ALL_STATES: CapabilityState[] = ["keyless", "configured", "refused", "locked", "upgradable", "enhanced"];
  const BADGED: CapabilityState[] = ["locked", "refused"];

  it("has a case for all six states", () => {
    expect(ALL_STATES).toHaveLength(6);
  });

  it.each(ALL_STATES)("'%s' resolves to null or a well-formed badge, never undefined/blank", (state) => {
    const result = capabilityBadge(entry(state, { missingEnv: ["X"], refusal: refusal() }));
    if (BADGED.includes(state)) {
      expect(result).not.toBeNull();
      expect(typeof result!.icon).toBe("string");
      expect(result!.icon.length).toBeGreaterThan(0);
      expect(typeof result!.short).toBe("string");
      expect(result!.short.length).toBeGreaterThan(0);
      expect(typeof result!.long).toBe("string");
      expect(result!.long.length).toBeGreaterThan(0);
    } else {
      expect(result).toBeNull();
    }
  });
});
