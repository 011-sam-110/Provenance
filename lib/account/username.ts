// The username is a display name. Nobody signs in with it. The database enforces the same
// rule (supabase/migrations/20261015000000_accounts.sql); this copy exists so the form can
// say what is wrong before a round trip.

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** The name the database gives a sign-up whose chosen name was missing, invalid or taken. */
export const PLACEHOLDER_USERNAME = /^u_[0-9a-f]{22}$/;

/** PURE: true for a database placeholder, so the UI asks the person to choose a name. */
export function isPlaceholderUsername(name: string | null | undefined): boolean {
  return typeof name === "string" && PLACEHOLDER_USERNAME.test(name);
}

/** PURE: one sentence naming the problem, or null when the name is valid. */
export function usernameProblem(raw: string): string | null {
  const name = normalizeUsername(raw);
  if (name.length < 3 || name.length > 24) return "Use 3 to 24 characters.";
  if (!/^[a-z0-9_]+$/.test(name)) return "Use only letters, numbers and _.";
  if (PLACEHOLDER_USERNAME.test(name)) return "That name is reserved. Choose another.";
  return null;
}
