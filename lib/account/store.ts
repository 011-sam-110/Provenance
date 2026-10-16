"use client";
// The account's UI state. Same shape as every lib/shell store: module state, a listener
// set, useSyncExternalStore. Not persisted: the session itself is supabase-js's job
// (tn.account.session), and the cached username lives in tn.account.sync.v1 (M3).

import { useSyncExternalStore } from "react";
import { accountsConfigured } from "@/lib/account/config";

export type AccountStatus = "off" | "loading" | "signed-out" | "signed-in";
export type SyncStatus = "idle" | "syncing" | "synced" | "offline";

export interface AccountState {
  status: AccountStatus;
  userId: string | null;
  email: string | null;
  username: string | null;
  sync: SyncStatus;
  lastSyncedAt: number | null;
  /** One sentence the Account tab shows, such as a pending reload. */
  notice: string | null;
  /** Signed out in the UI, but a session is still stored: the boot check could not refresh
   *  it (offline, Supabase down). The next online reload signs that person back in, so the
   *  Account tab offers "Sign out of this browser" for a shared computer. */
  heldSession: boolean;
}

const OFF: AccountState = {
  status: "off", userId: null, email: null, username: null, sync: "idle", lastSyncedAt: null, notice: null,
  heldSession: false,
};
// A build with accounts starts at "loading", so the header button renders from the first
// paint (label ACCOUNT) instead of appearing after the boot effect and moving its neighbours.
// accountsConfigured() is fixed at build time, so the server and the client agree.
const INITIAL: AccountState = accountsConfigured() ? { ...OFF, status: "loading" } : OFF;

let state: AccountState = INITIAL;
const listeners = new Set<() => void>();

export const accountStore = {
  get(): AccountState {
    return state;
  },
  set(patch: Partial<AccountState>) {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useAccount(): AccountState {
  return useSyncExternalStore(accountStore.subscribe, accountStore.get, () => INITIAL);
}
