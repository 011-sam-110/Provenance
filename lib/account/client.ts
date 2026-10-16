"use client";
// ONE browser client, made on first use. The library is imported dynamically, so a visitor
// who never signs in and never opens the Account tab does not download it. Returns null
// when accounts are not configured, on the server, or when the import fails.

import type { SupabaseClient } from "@supabase/supabase-js";
import { accountsConfig, SESSION_STORAGE_KEY } from "@/lib/account/config";

let pending: Promise<SupabaseClient | null> | null = null;

export function getSupabase(): Promise<SupabaseClient | null> {
  if (pending) return pending;
  const cfg = accountsConfig();
  if (!cfg || typeof window === "undefined") return Promise.resolve(null);
  pending = import("@supabase/supabase-js")
    .then(({ createClient }) =>
      createClient(cfg.url, cfg.publishableKey, {
        auth: {
          storageKey: SESSION_STORAGE_KEY,
          persistSession: true,
          autoRefreshToken: true,
          // Email links carry a token_hash that /account/confirm verifies itself.
          detectSessionInUrl: false,
        },
      }),
    )
    .catch(() => {
      pending = null;
      return null;
    });
  return pending;
}
