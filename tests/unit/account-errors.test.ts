import { describe, it, expect } from "vitest";
import { authErrorMessage, GENERIC_ERROR } from "@/lib/account/errors";

describe("authErrorMessage", () => {
  it("maps known Supabase auth codes to fixed sentences", () => {
    expect(authErrorMessage({ code: "invalid_credentials" })).toBe("Email or password is wrong.");
    expect(authErrorMessage({ code: "email_not_confirmed" })).toBe("Confirm your email first. If you do not have a working link, use Forgot your password.");
    expect(authErrorMessage({ code: "over_request_rate_limit" })).toBe("Too many tries. Wait a minute and try again.");
    expect(authErrorMessage({ code: "over_email_send_rate_limit" })).toBe("Too many emails. Wait a few minutes and try again.");
    expect(authErrorMessage({ code: "weak_password" })).toBe("Use a longer password. 10 characters is the minimum.");
    expect(authErrorMessage({ code: "same_password" })).toBe("Use a password that is different from the old one.");
    expect(authErrorMessage({ code: "otp_expired" })).toBe("This link has expired. Ask for a new one.");
    expect(authErrorMessage({ code: "email_address_invalid" })).toBe("That email address does not look right.");
  });
  it("maps a Postgres unique violation to the username sentence", () => {
    expect(authErrorMessage({ code: "23505" })).toBe("That username is taken.");
  });
  it("never echoes an unknown message", () => {
    expect(authErrorMessage({ code: "something_new", message: "secret upstream text" })).toBe(GENERIC_ERROR);
    expect(authErrorMessage(new Error("boom"))).toBe(GENERIC_ERROR);
    expect(authErrorMessage(null)).toBe(GENERIC_ERROR);
  });
  it("does not read inherited object keys as codes", () => {
    expect(authErrorMessage({ code: "constructor" })).toBe(GENERIC_ERROR);
    expect(authErrorMessage({ code: "toString" })).toBe(GENERIC_ERROR);
    expect(authErrorMessage({ code: "__proto__" })).toBe(GENERIC_ERROR);
  });
  it("uses no dash characters in any sentence a visitor can see", () => {
    const codes = ["invalid_credentials", "email_not_confirmed", "over_request_rate_limit", "over_email_send_rate_limit",
      "weak_password", "same_password", "otp_expired", "email_address_invalid", "23505"];
    for (const code of codes) expect(authErrorMessage({ code }), code).not.toMatch(/[–—]/);
    expect(GENERIC_ERROR).not.toMatch(/[–—]/);
  });
});
