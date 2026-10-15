// THE ACCOUNTS SWITCH. Accounts exist on a deployment only when both public Supabase
// values were present at BUILD time. Next.js inlines a NEXT_PUBLIC_* read into the client
// bundle only when the read is spelled out as a literal property access, which is why the two
// reads below are literals and not a lookup. tests/unit/sources-status.test.ts finds
// credential gates by that same literal text, and KEY_REQUIREMENTS declares both.
//
// Unset, every account feature is dormant: no UI, no network call, no library download.
// That is how self-hosters and preview builds see the site.

/** Where supabase-js keeps the session. localStorage, never a cookie. */
export const SESSION_STORAGE_KEY = "tn.account.session";

export interface AccountsConfig {
  url: string;
  publishableKey: string;
}

/** PURE: both values present and non-blank, or null. */
export function accountsConfigFrom(
  url: string | undefined,
  key: string | undefined,
): AccountsConfig | null {
  const u = url?.trim();
  const k = key?.trim();
  if (!u || !k) return null;
  return { url: u, publishableKey: k };
}

export function accountsConfig(): AccountsConfig | null {
  return accountsConfigFrom(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function accountsConfigured(): boolean {
  return accountsConfig() !== null;
}

/** Is there a stored session? A cheap localStorage read that loads no library. */
export function hasStoredSession(storage?: Pick<Storage, "getItem">): boolean {
  try {
    const s = storage ?? (typeof window === "undefined" ? null : window.localStorage);
    return !!s?.getItem(SESSION_STORAGE_KEY);
  } catch {
    return false;
  }
}
