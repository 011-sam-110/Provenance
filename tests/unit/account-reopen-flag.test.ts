// tests/unit/account-reopen-flag.test.ts
// signIn reloads the page and leaves a one-tab flag; the header reads it once to open the
// Account tab again. Read once means a later reload (or M3's second one) opens nothing.
import { describe, it, expect, afterEach, vi } from "vitest";
import { takeReopenFlag } from "@/lib/account/auth";

function fakeSession(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    has: (k: string) => m.has(k),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("takeReopenFlag", () => {
  it("is true once, and removes the flag", () => {
    const s = fakeSession({ "tn.account.reopen": "1" });
    vi.stubGlobal("window", { sessionStorage: s });
    expect(takeReopenFlag()).toBe(true);
    expect(s.has("tn.account.reopen")).toBe(false);
    expect(takeReopenFlag()).toBe(false);
  });
  it("is false with no flag", () => {
    vi.stubGlobal("window", { sessionStorage: fakeSession() });
    expect(takeReopenFlag()).toBe(false);
  });
  it("is false, and does not throw, when storage is blocked", () => {
    vi.stubGlobal("window", { get sessionStorage() { throw new Error("SecurityError"); } });
    expect(takeReopenFlag()).toBe(false);
  });
});
