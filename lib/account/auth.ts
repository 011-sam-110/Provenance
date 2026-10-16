"use client";
// Every account action the UI can take. Each returns { ok } or { ok: false, error } with a
// fixed sentence from lib/account/errors.ts, never an upstream message. No action throws:
// each body is in a try/catch, and a caught error is never put in a result.

import { getSupabase } from "@/lib/account/client";
import { hasStoredSession, SESSION_STORAGE_KEY } from "@/lib/account/config";
import { accountStore } from "@/lib/account/store";
import { authErrorMessage, GENERIC_ERROR } from "@/lib/account/errors";
import { normalizeUsername, usernameProblem } from "@/lib/account/username";

export type AuthResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): AuthResult => ({ ok: false, error });
const OK: AuthResult = { ok: true };

function confirmUrl(): string {
  return `${window.location.origin}/account/confirm`;
}

const codeOf = (error: unknown): string | undefined => (error as { code?: string } | null)?.code;

// signIn reloads the page. This flag tells the header (components/account/AccountButton.tsx)
// to open the Account tab again after the reload. sessionStorage, so it never outlives the
// tab, and it holds only "1".
const REOPEN_KEY = "tn.account.reopen";

/** Reads and removes the flag that signIn sets before its reload. */
export function takeReopenFlag(): boolean {
  try {
    const set = window.sessionStorage.getItem(REOPEN_KEY) === "1";
    if (set) window.sessionStorage.removeItem(REOPEN_KEY);
    return set;
  } catch {
    return false;
  }
}

export async function signUp(input: { username: string; email: string; password: string }): Promise<AuthResult> {
  try {
    const problem = usernameProblem(input.username);
    if (problem) return fail(problem);
    const sb = await getSupabase();
    if (!sb) return fail(GENERIC_ERROR);
    const username = normalizeUsername(input.username);
    const free = await sb.rpc("username_available", { name: username });
    if (free.error) return fail(GENERIC_ERROR);
    if (free.data === false) return fail("That username is taken.");
    const { error } = await sb.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: { data: { username }, emailRedirectTo: confirmUrl() },
    });
    // With "Confirm email" on, Supabase answers an existing address like a new one, and the
    // profile trigger never fails a sign-up (a bad or taken name gets a placeholder). The UI
    // says "Check your email" in both cases.
    // Supabase's per-address email limit fails a quick second sign-up only for an address it
    // knows, so it is shown as success too (the same code also covers the project-wide limit).
    if (error && codeOf(error) === "over_email_send_rate_limit") return OK;
    return error ? fail(authErrorMessage(error)) : OK;
  } catch {
    return fail(GENERIC_ERROR);
  }
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  try {
    const sb = await getSupabase();
    if (!sb) return fail(GENERIC_ERROR);
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return fail(authErrorMessage(error));
    // A full reload runs the console's ordered hydrate sequence from the start. From M3 the
    // boot step (lib/account/runtime.ts) reconciles this browser with the account first.
    try {
      window.sessionStorage.setItem(REOPEN_KEY, "1");
    } catch {
      // storage blocked: the page reloads with the drawer closed
    }
    window.location.reload();
    return OK;
  } catch {
    return fail(GENERIC_ERROR);
  }
}

export async function signOut(): Promise<void> {
  try {
    const sb = await getSupabase();
    await sb?.auth.signOut({ scope: "local" });
  } catch {
    // fall through: the stored session is removed below
  }
  // supabase-js keeps the stored session when the refresh fails offline, and on a shared
  // computer the next reload would sign the last person back in.
  if (hasStoredSession()) {
    try {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // storage blocked: nothing more to remove
    }
  }
  accountStore.set({ status: "signed-out", userId: null, email: null, username: null, sync: "idle", lastSyncedAt: null, notice: null, heldSession: false });
}

export async function requestReset(email: string): Promise<AuthResult> {
  try {
    const sb = await getSupabase();
    if (!sb) return fail(GENERIC_ERROR);
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: confirmUrl() });
    // Same answer whether or not the address has an account. Supabase limits emails per
    // address, so a second request soon after the first can fail only for a real account; that
    // failure is shown as success (the same code also covers the project-wide email limit).
    // Only the per-IP limit is shown, and a network failure, which does not depend on the address.
    if (error && codeOf(error) === "over_request_rate_limit") return fail(authErrorMessage(error));
    if (error && (error as { name?: string }).name === "AuthRetryableFetchError") return fail(GENERIC_ERROR);
    return OK;
  } catch {
    return fail(GENERIC_ERROR);
  }
}

export async function verifyEmailLink(tokenHash: string, type: "email" | "signup" | "recovery"): Promise<AuthResult> {
  try {
    const sb = await getSupabase();
    if (!sb) return fail(GENERIC_ERROR);
    const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: type === "signup" ? "email" : type });
    return error ? fail(authErrorMessage(error)) : OK;
  } catch {
    return fail(GENERIC_ERROR);
  }
}

export async function setNewPassword(password: string): Promise<AuthResult> {
  try {
    const sb = await getSupabase();
    if (!sb) return fail(GENERIC_ERROR);
    const { error } = await sb.auth.updateUser({ password });
    return error ? fail(authErrorMessage(error)) : OK;
  } catch {
    return fail(GENERIC_ERROR);
  }
}

export async function renameUser(raw: string): Promise<AuthResult> {
  try {
    const problem = usernameProblem(raw);
    if (problem) return fail(problem);
    const sb = await getSupabase();
    const userId = accountStore.get().userId;
    if (!sb || !userId) return fail(GENERIC_ERROR);
    const username = normalizeUsername(raw);
    const { data, error } = await sb
      .from("profiles")
      .update({ username })
      .eq("user_id", userId)
      .select("username")
      .maybeSingle();
    if (error) return fail(authErrorMessage(error));
    // No row changed: do not report success.
    if (!data) return fail(GENERIC_ERROR);
    accountStore.set({ username });
    return OK;
  } catch {
    return fail(GENERIC_ERROR);
  }
}
