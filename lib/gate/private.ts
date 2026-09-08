/**
 * The PRIVATE ENDPOINT gate: one unlisted path, behind one password.
 *
 * Not the same thing as the maintenance gate next door, and deliberately not sharing
 * its cookie. That one is a curtain over the WHOLE site during a rebuild — everyone
 * who has the code is meant to get in, and getting in means seeing the ordinary
 * public site. This one is the opposite shape: a single path that the public site
 * does not link, does not sitemap and does not admit exists, holding work that is not
 * released. Sharing `pv_gate` between them would mean anyone let through a
 * maintenance window silently acquired the unreleased surface too, which is exactly
 * the kind of privilege leak nobody would think to look for.
 *
 * THE PATH IS A SECRET AND THEREFORE CANNOT BE IN THIS FILE. The repository is
 * public (AGPL-3.0-only, on GitHub), so a slug written into the source is not hidden
 * from anyone — it is published, with a commit date. Both halves come from the
 * environment and neither has a default.
 *
 * FAIL CLOSED, AND FAIL AS A 404. With either variable unset the path simply does not
 * exist: not a 401, not a login form, nothing that distinguishes "you guessed the
 * secret path but it is unconfigured" from "there is no such page". An unconfigured
 * deployment is the normal state for every preview build and every fork, so this has
 * to be the safe direction rather than the exceptional one.
 *
 * What this is NOT: an account system. There are no users, no lockout and no audit
 * trail. It is one shared password over one unlisted path, which is proportionate to
 * "let a few people look at an unreleased board" and is not proportionate to
 * anything holding personal data. Do not put anything behind it that needs more.
 */

/** Cookie proving the password was presented. Distinct from the maintenance `pv_gate`. */
export const PRIVATE_COOKIE = "pv_private";

/**
 * Domain-separates this hash from the maintenance gate's. Two consequences worth
 * stating: the same password used for both produces two DIFFERENT cookie values, so
 * neither cookie can be replayed against the other gate; and bumping the version
 * here logs every private-endpoint browser out without touching the maintenance one.
 */
export const PRIVATE_TOKEN_PREFIX = "provenance-private-v1:";

/** Seven days. Shorter than the maintenance gate's thirty: this guards unreleased
 *  work shown to a handful of people, and a link handed out once should go stale. */
export const PRIVATE_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/**
 * The slug is the FIRST factor, so it has to be unguessable on its own. Sixteen
 * characters of the allowed alphabet is far past anything that can be enumerated
 * against a site behind a CDN, and short enough to paste into a message.
 */
export const MIN_SLUG_LENGTH = 16;

/** The password is the second factor and is typed by a human, so this is lower.
 *  It exists to refuse "test" and "1234" being set in a hurry, not to grade. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * A slug must be one path segment of URL-safe characters. Rejecting `/`, `.` and `%`
 * outright is what keeps a mis-set variable from becoming a path-traversal shape or
 * a matcher that swallows more of the site than one route.
 */
const SLUG_RE = /^[A-Za-z0-9_-]+$/;

export interface PrivateConfig {
  slug: string;
  password: string;
}

/**
 * Read the configuration, or null when this deployment has no private endpoint.
 *
 * Takes the environment as an ARGUMENT rather than reading `process.env` so the same
 * function is testable and runs unchanged in Edge middleware and a Node route.
 * Whitespace is trimmed because these are pasted into a dashboard field by hand, and
 * a trailing newline is the single most common way to set a variable to something
 * that looks right and is not.
 */
export function readPrivateConfig(env: Record<string, string | undefined>): PrivateConfig | null {
  const slug = (env.PRIVATE_PREVIEW_SLUG ?? "").trim();
  const password = (env.PRIVATE_PREVIEW_PASSWORD ?? "").trim();
  if (slug.length < MIN_SLUG_LENGTH || !SLUG_RE.test(slug)) return null;
  if (password.length < MIN_PASSWORD_LENGTH) return null;
  return { slug, password };
}

/**
 * Whether a request path belongs to the private endpoint.
 *
 * Matches the slug itself and everything under it, so the console's own client-side
 * routes stay inside the gate. Compared case-SENSITIVELY: the slug is a secret, and
 * folding case would hand an attacker a free reduction in the search space.
 */
export function isPrivatePath(pathname: string, slug: string): boolean {
  return pathname === `/${slug}` || pathname.startsWith(`/${slug}/`);
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The cookie value that proves `password` was presented. Deterministic per password,
 *  so there is no server state and every instance validates it with the env var alone. */
export function privateToken(password: string): Promise<string> {
  return sha256Hex(PRIVATE_TOKEN_PREFIX + password);
}

/** The Set-Cookie header for a private session. `Path=/` so a client-side navigation
 *  inside the console does not fall outside the cookie and re-prompt. */
export function privateCookieHeader(token: string, secure: boolean): string {
  const parts = [
    `${PRIVATE_COOKIE}=${token}`,
    "Path=/",
    `Max-Age=${PRIVATE_COOKIE_MAX_AGE}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Clears the cookie — used by the sign-out path and by a refused attempt, so a stale
 *  value from a rotated password cannot sit there being re-sent and re-refused. */
export function privateClearCookieHeader(secure: boolean): string {
  const parts = [`${PRIVATE_COOKIE}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Lax"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
