"use client";
// THE ACCOUNT'S BOOT STEP. ConsoleShell calls startAccount() once, in an effect that runs
// AFTER its hydrate effect. M2: find out who is signed in. M3 adds the sync pull here.

import { accountsConfigured, hasStoredSession } from "@/lib/account/config";
import { getSupabase } from "@/lib/account/client";
import { accountStore } from "@/lib/account/store";

let started = false;

// supabase-js keeps the stored session when a refresh fails for a reason that can pass (no
// network, Supabase down), and returns no session. Say signed out, but say also that this
// browser still holds a sign-in, so a person on a shared computer can remove it.
const signedOut = () => accountStore.set({ status: "signed-out", heldSession: hasStoredSession() });

export async function startAccount(): Promise<void> {
  if (started) return;
  started = true;
  if (!accountsConfigured()) return accountStore.set({ status: "off" });
  if (!hasStoredSession()) return accountStore.set({ status: "signed-out" });

  accountStore.set({ status: "loading" });
  try {
    const sb = await getSupabase();
    const session = sb ? (await sb.auth.getSession()).data.session : null;
    if (!sb || !session) return signedOut();

    const userId = session.user.id;
    const { data, error } = await sb.from("profiles").select("username").eq("user_id", userId).maybeSingle();
    accountStore.set({
      status: "signed-in",
      userId,
      email: session.user.email ?? null,
      username: error ? null : ((data?.username as string | undefined) ?? null),
      ...(error ? { notice: "Your username did not load. Reload the page to try again." } : {}),
    });
  } catch {
    signedOut();
  }
}
