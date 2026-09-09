import { expect, test } from "vitest";
import { classifyPlane, classifyPlaneDetailed } from "@/lib/planes/classify";

test("on-ground aircraft are 'ground' regardless of speed", () => {
  expect(classifyPlane({ altKm: 0, velocityMs: 5, onGround: true })).toBe("ground");
});

test("high + fast is an airliner", () => {
  expect(classifyPlane({ altKm: 11, velocityMs: 230, onGround: false })).toBe("airliner");
});

test("low + slow airborne is a helicopter", () => {
  expect(classifyPlane({ altKm: 0.6, velocityMs: 40, onGround: false })).toBe("helicopter");
});

test("mid band or fast-but-lower is regional", () => {
  expect(classifyPlane({ altKm: 4.5, velocityMs: 130, onGround: false })).toBe("regional");
  expect(classifyPlane({ altKm: 2, velocityMs: 140, onGround: false })).toBe("regional");
});

test("low and modest speed is a light aircraft", () => {
  expect(classifyPlane({ altKm: 1.2, velocityMs: 85, onGround: false })).toBe("light");
});

test("null speed is treated as zero (no crash)", () => {
  expect(classifyPlane({ altKm: 0.5, velocityMs: null, onGround: false })).toBe("helicopter");
});

test("ADS-B category wins over the profile heuristic", () => {
  // A7 = rotorcraft even though the profile (high+fast) looks like an airliner.
  expect(classifyPlane({ altKm: 11, velocityMs: 230, onGround: false, category: "A7" })).toBe("helicopter");
  // A5 = heavy → airliner.
  expect(classifyPlane({ altKm: 2, velocityMs: 90, onGround: false, category: "A5" })).toBe("airliner");
  // On-ground still overrides any category.
  expect(classifyPlane({ altKm: 0, velocityMs: 5, onGround: true, category: "A5" })).toBe("ground");
  // Unknown category falls back to the profile.
  expect(classifyPlane({ altKm: 11, velocityMs: 230, onGround: false, category: "A0" })).toBe("airliner");
});

// --- trust flag: this is the actual regression, since the UI used to show
// "· est." unconditionally regardless of which branch produced the category ---

test("classifyPlaneDetailed reports trusted:true only for a recognised broadcast category", () => {
  expect(classifyPlaneDetailed({ altKm: 11, velocityMs: 230, onGround: false, category: "A7" })).toEqual({
    category: "helicopter",
    trusted: true,
  });
});

test("classifyPlaneDetailed reports trusted:false for the altitude/speed heuristic", () => {
  expect(classifyPlaneDetailed({ altKm: 11, velocityMs: 230, onGround: false })).toEqual({
    category: "airliner",
    trusted: false,
  });
  // An unrecognised category string also falls through to the heuristic, untrusted.
  expect(classifyPlaneDetailed({ altKm: 11, velocityMs: 230, onGround: false, category: "A0" })).toEqual({
    category: "airliner",
    trusted: false,
  });
});

test("classifyPlaneDetailed reports trusted:false for on-ground, even with a category present", () => {
  // On-ground overrides the category (see the existing ADS-B-wins test above), and
  // help.ts's TYPE sentence already groups on-ground with the guess bucket, not the
  // broadcast-category bucket — trusted must stay false here, not a special case.
  expect(classifyPlaneDetailed({ altKm: 0, velocityMs: 5, onGround: true, category: "A5" })).toEqual({
    category: "ground",
    trusted: false,
  });
});

test("classifyPlane (the category-only shorthand) still matches classifyPlaneDetailed's category", () => {
  const profile = { altKm: 2, velocityMs: 90, onGround: false, category: "A5" as const };
  expect(classifyPlane(profile)).toBe(classifyPlaneDetailed(profile).category);
});
