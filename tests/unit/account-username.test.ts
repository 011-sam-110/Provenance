import { describe, it, expect } from "vitest";
import { normalizeUsername, usernameProblem, isPlaceholderUsername } from "@/lib/account/username";

describe("username rules", () => {
  it("lower-cases and trims", () => {
    expect(normalizeUsername("  Sam_01 ")).toBe("sam_01");
  });
  it("accepts 3 to 24 of a-z, 0-9 and _", () => {
    expect(usernameProblem("abc")).toBeNull();
    expect(usernameProblem("A_b_9")).toBeNull();
    expect(usernameProblem("x".repeat(24))).toBeNull();
  });
  it("names the problem in one sentence", () => {
    expect(usernameProblem("ab")).toBe("Use 3 to 24 characters.");
    expect(usernameProblem("x".repeat(25))).toBe("Use 3 to 24 characters.");
    expect(usernameProblem("sam smith")).toBe("Use only letters, numbers and _.");
    expect(usernameProblem("sám")).toBe("Use only letters, numbers and _.");
  });
  it("refuses the shape the database keeps for placeholders", () => {
    expect(usernameProblem("u_0123456789abcdef012345")).toBe("That name is reserved. Choose another.");
    expect(usernameProblem("U_0123456789ABCDEF012345")).toBe("That name is reserved. Choose another.");
    expect(usernameProblem("u_alice")).toBeNull();
  });
  it("recognises a placeholder exactly, never by the u_ prefix alone", () => {
    expect(isPlaceholderUsername("u_0123456789abcdef012345")).toBe(true);
    expect(isPlaceholderUsername("u_alice")).toBe(false);
    expect(isPlaceholderUsername("u_0123456789abcdef01234")).toBe(false);
    expect(isPlaceholderUsername("u_0123456789abcdef0123456")).toBe(false);
    expect(isPlaceholderUsername(null)).toBe(false);
    expect(isPlaceholderUsername(undefined)).toBe(false);
  });
});
