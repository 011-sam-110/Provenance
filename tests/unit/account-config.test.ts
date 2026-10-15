import { describe, it, expect } from "vitest";
import { accountsConfigFrom, hasStoredSession, SESSION_STORAGE_KEY } from "@/lib/account/config";

describe("accountsConfigFrom", () => {
  it("is null when either value is missing or blank", () => {
    expect(accountsConfigFrom(undefined, "k")).toBeNull();
    expect(accountsConfigFrom("https://x.supabase.co", undefined)).toBeNull();
    expect(accountsConfigFrom("  ", "k")).toBeNull();
    expect(accountsConfigFrom("https://x.supabase.co", " ")).toBeNull();
  });
  it("trims and returns both values", () => {
    expect(accountsConfigFrom(" https://x.supabase.co ", " sb_publishable_a ")).toEqual({
      url: "https://x.supabase.co",
      publishableKey: "sb_publishable_a",
    });
  });
});

describe("hasStoredSession", () => {
  it("is true only when the session key holds a value", () => {
    const empty = { getItem: () => null };
    const full = { getItem: (k: string) => (k === SESSION_STORAGE_KEY ? "{}" : null) };
    expect(hasStoredSession(empty)).toBe(false);
    expect(hasStoredSession(full)).toBe(true);
  });
  it("is false when storage throws", () => {
    const broken = { getItem: () => { throw new Error("SecurityError"); } };
    expect(hasStoredSession(broken)).toBe(false);
  });
  it("uses the tn.account.session key", () => {
    expect(SESSION_STORAGE_KEY).toBe("tn.account.session");
  });
});
