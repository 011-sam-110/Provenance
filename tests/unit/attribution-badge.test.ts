import { describe, it, expect } from "vitest";
import { attributionParts } from "@/components/AttributionBadge";

describe("attributionParts — the bottom-right camera credit", () => {
  it("returns both parts when both are present", () => {
    expect(attributionParts("TfL", "OGL v3.0")).toEqual(["TfL", "OGL v3.0"]);
  });

  it("drops an empty licence rather than leaving a dangling separator", () => {
    expect(attributionParts("TfL", "")).toEqual(["TfL"]);
  });

  it("drops an empty attribution the same way", () => {
    expect(attributionParts("", "OGL v3.0")).toEqual(["OGL v3.0"]);
  });

  it("returns nothing for two empty strings — camslot's case", () => {
    expect(attributionParts("", "")).toEqual([]);
  });

  it("trims whitespace-only fields to nothing", () => {
    expect(attributionParts("  ", "\t")).toEqual([]);
  });

  it("trims real values", () => {
    expect(attributionParts("  TfL  ", " OGL ")).toEqual(["TfL", "OGL"]);
  });
});
