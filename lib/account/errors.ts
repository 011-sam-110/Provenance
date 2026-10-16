// EVERY account error a visitor can see is one of these sentences. An upstream message is
// never shown: it can change without notice, it can leak whether an address has an account,
// and it is not written for the people who read this console. Codes come from Supabase Auth
// (AuthError.code) and Postgres (23505 = unique violation on profiles.username).

export const GENERIC_ERROR = "Something went wrong. Try again in a minute.";

const BY_CODE: Record<string, string> = {
  invalid_credentials: "Email or password is wrong.",
  // A reset link also confirms the address, so "Forgot your password?" replaces a lost link.
  email_not_confirmed: "Confirm your email first. If you do not have a working link, use Forgot your password.",
  over_request_rate_limit: "Too many tries. Wait a minute and try again.",
  over_email_send_rate_limit: "Too many emails. Wait a few minutes and try again.",
  weak_password: "Use a longer password. 10 characters is the minimum.",
  same_password: "Use a password that is different from the old one.",
  otp_expired: "This link has expired. Ask for a new one.",
  email_address_invalid: "That email address does not look right.",
  "23505": "That username is taken.",
};

export function authErrorMessage(err: unknown): string {
  const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  // Own keys only: "constructor" or "toString" must not read Object.prototype.
  return Object.hasOwn(BY_CODE, code) ? BY_CODE[code] : GENERIC_ERROR;
}
