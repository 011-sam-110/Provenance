/**
 * The maintenance gate's session and its helpers. Pure, no Next imports, so the same
 * functions run in the Edge middleware, the Node route handler, vitest and the
 * Playwright config.
 *
 * THERE IS NO SERVER STATE. The cookie is a SHA-256 of the current access code, so:
 * every deployment validates it with nothing but the env var; changing the code logs
 * every browser out at once; and clearing the env var switches the gate off without a
 * deploy of code. The code itself never goes into the cookie.
 *
 * What this is NOT: authentication. The code is six digits and there is no lockout
 * beyond the site's existing attack-challenge firewall. It is a curtain that keeps
 * the public and the crawlers out during a rebuild, and the cookie is scoped to
 * exactly that.
 */

/** Cookie the gate sets once the code has been presented. `pv` = Provenance. */
export const GATE_COOKIE = "pv_gate";

/**
 * Domain-separates the hash so the cookie value is not simply sha256(code), which a
 * rainbow table already knows for every six-digit string. Bump the version to log
 * everyone out without changing the code.
 */
export const GATE_TOKEN_PREFIX = "provenance-gate-v1:";

/** Thirty days. Long enough to survive a maintenance window, short enough to rot. */
export const GATE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/** Query key + value the unlock route appends when a code is refused. */
export const GATE_QUERY = "gate";
export const GATE_DENIED = "denied";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The cookie value that proves `password` was presented. Deterministic per code. */
export function gateToken(password: string): Promise<string> {
  return sha256Hex(GATE_TOKEN_PREFIX + password);
}

/**
 * Equality without an early exit on the first differing character. Both sides are
 * hashed first so the comparison is always over 64 characters, whatever the inputs'
 * lengths - a length check would itself be the leak.
 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

/**
 * Where to send someone after the form: the page they were trying to reach, and only
 * that. Refuses anything that is not a same-origin path - `//evil.example`,
 * `/\evil.example` and absolute URLs all fall back to `/` - and strips a previous
 * `?gate=denied` so a second attempt does not carry the first refusal with it.
 */
export function safeNext(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  let url: URL;
  try {
    url = new URL(raw, "http://gate.invalid");
  } catch {
    return "/";
  }
  if (url.origin !== "http://gate.invalid") return "/";
  url.searchParams.delete(GATE_QUERY);
  return url.pathname + url.search;
}

/** `next` with the refusal flag on it, for the redirect back to the curtain. */
export function withDenied(next: string): string {
  const url = new URL(next, "http://gate.invalid");
  url.searchParams.set(GATE_QUERY, GATE_DENIED);
  return url.pathname + url.search;
}

/**
 * The Set-Cookie header value for a fresh session.
 *
 * `maxAge` exists for TEMPORARY KEYS, and defaulting it to the permanent lifetime is
 * the only safe default: a thirty-minute key issued with the thirty-DAY cookie would
 * work forever, and nothing would look wrong — it would simply never stop working.
 *
 * Note that Max-Age is only the FIRST of two stops, and the weaker one: it is a request
 * to the browser. The second is that a temporary cookie's VALUE is the signed key
 * itself, so a browser that keeps it anyway, or a cookie copied to another machine, is
 * still refused at the edge. See lib/gate/tempkey.ts.
 */
export function gateCookieHeader(
  token: string,
  secure: boolean,
  maxAge: number = GATE_COOKIE_MAX_AGE,
): string {
  const parts = [
    `${GATE_COOKIE}=${token}`,
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
