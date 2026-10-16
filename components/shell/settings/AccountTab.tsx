"use client";
// The Account tab. Signed out: one of three forms (sign in, create account, forgot
// password). Signed in: two sections, the account (email, username) and this browser
// (sync status, sign-out). M4 adds delete.
// Every string is ASD-STE100 Strict; every error comes from lib/account/errors.ts.

import { useId, useState } from "react";
import { useAccount } from "@/lib/account/store";
import { signIn, signUp, signOut, requestReset, renameUser } from "@/lib/account/auth";
import { isPlaceholderUsername, normalizeUsername } from "@/lib/account/username";

type Mode = "sign-in" | "create" | "forgot" | "check-email";
/** Which button is working. Only that button shows its busy label; all of them are disabled. */
type Busy = null | "submit" | "rename" | "sign-out";
type Result = { ok: true } | { ok: false; error: string };

function ago(ms: number | null): string {
  if (!ms) return "";
  const m = Math.round((Date.now() - ms) / 60_000);
  return m < 1 ? "just now" : m === 1 ? "1 min ago" : `${m} min ago`;
}

const NAME_RULE = "3 to 24 letters, numbers or _. Other people do not see it.";

export default function AccountTab() {
  const acct = useAccount();
  const [mode, setMode] = useState<Mode>("sign-in");
  // What the last "check-email" screen is about: the copy differs, because a reset link
  // goes only to an address that has an account.
  const [sentFor, setSentFor] = useState<"create" | "forgot">("create");
  // Create-form username only. The signed-in rename field has its own state below.
  const [username, setUsername] = useState("");
  // null = untouched: the field shows the saved name. "" is a real, clearable value.
  const [renameTo, setRenameTo] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const uid = useId();
  const nameHintId = `${uid}-name-hint`;
  const passHintId = `${uid}-pass-hint`;
  const renameHintId = `${uid}-rename-hint`;

  const run = async (key: Exclude<Busy, null>, action: () => Promise<Result>, next?: Mode) => {
    setBusy(key);
    setError(null);
    const r = await action();
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setPassword("");
    if (next) setMode(next);
  };

  const go = (next: Mode) => { setError(null); setMode(next); };

  if (acct.status === "loading") {
    return <section className="tn-settings-sec"><p className="tn-settings-hint">Checking your sign-in.</p></section>;
  }

  if (acct.status === "signed-in") {
    const placeholder = isPlaceholderUsername(acct.username);
    const shownName = renameTo ?? (placeholder ? "" : acct.username ?? "");
    const unchanged = !placeholder && normalizeUsername(shownName) === acct.username;
    const syncLine =
      acct.sync === "offline" ? ["Not synced.", acct.lastSyncedAt ? `Last synced ${ago(acct.lastSyncedAt)}.` : ""].filter(Boolean).join(" ")
      : acct.sync === "syncing" ? "Syncing."
      : acct.lastSyncedAt ? `Synced ${ago(acct.lastSyncedAt)}.` : "Your settings sync to this account.";
    return (
      <>
        <section className="tn-settings-sec tn-account">
          <h3 className="tn-settings-sec-title">{placeholder ? "Choose a username" : "Signed in"}</h3>
          {placeholder && <p className="tn-settings-hint">Your account does not have a username yet. Choose one.</p>}
          <p className="tn-account-email">{acct.email}</p>
          <form className="tn-account-form" onSubmit={(e) => {
            e.preventDefault();
            void run("rename", async () => {
              const r = await renameUser(shownName);
              if (r.ok) { setSaved("Username saved."); setRenameTo(null); }
              return r;
            });
          }}>
            <div className="tn-account-field">
              <label className="tn-settings-field">
                <span className="tn-settings-field-label">Username</span>
                <input className="tn-settings-input" value={shownName} maxLength={24} autoComplete="username"
                  aria-describedby={renameHintId}
                  onChange={(e) => { setRenameTo(e.target.value); setSaved(null); setError(null); }} />
              </label>
              <span className="tn-settings-hint" id={renameHintId}>{NAME_RULE}</span>
            </div>
            {error && <p className="tn-settings-tg-err" role="alert">{error}</p>}
            <div className="tn-account-actions">
              <button type="submit" className="tn-account-btn" disabled={busy !== null || unchanged}>
                {busy === "rename" ? "Saving" : "Save username"}
              </button>
              {saved && <span className="tn-settings-tg-ok" role="status">{saved}</span>}
            </div>
          </form>
        </section>
        <section className="tn-settings-sec tn-account">
          <h3 className="tn-settings-sec-title">This browser</h3>
          <p className="tn-account-sync" aria-live="polite">{syncLine}</p>
          {acct.notice && <p className="tn-settings-hint">{acct.notice}</p>}
          <button type="button" className="tn-account-btn" disabled={busy !== null} onClick={async () => {
            setBusy("sign-out");
            try { await signOut(); } finally { setBusy(null); }
            setEmail(""); setPassword(""); setUsername(""); setRenameTo(null);
            setSaved(null); setError(null); setMode("sign-in");
          }}>{busy === "sign-out" ? "Signing out" : "Sign out"}</button>
          <p className="tn-settings-hint">If you sign out, this browser keeps its settings.</p>
        </section>
      </>
    );
  }

  if (mode === "check-email") {
    return (
      <section className="tn-settings-sec tn-account">
        <h3 className="tn-settings-sec-title">Check your email</h3>
        {sentFor === "create" ? (
          <>
            <p className="tn-account-lead">
              If <strong>{email}</strong> is a new address, we sent a link to it. Open the link to confirm your email. The link works once, within one hour.
            </p>
            <p className="tn-settings-hint">
              If no email comes in 5 minutes, the address can have an account already. Sign in, or reset your password.
            </p>
          </>
        ) : (
          <p className="tn-account-lead">
            If <strong>{email}</strong> has an account, we sent a link to it. Open the link to set a new password. The link works once, within one hour.
          </p>
        )}
        <div className="tn-account-switch">
          <button type="button" className="tn-account-link" onClick={() => go("sign-in")}>Sign in</button>
          {sentFor === "create" && <button type="button" className="tn-account-link" onClick={() => go("forgot")}>Forgot your password?</button>}
        </div>
      </section>
    );
  }

  const submitLabel =
    mode === "create" ? (busy ? "Creating account" : "Create account")
    : mode === "forgot" ? (busy ? "Sending link" : "Send reset link")
    : busy ? "Signing in" : "Sign in";

  return (
    <>
      {acct.heldSession && (
        <section className="tn-settings-sec tn-account">
          <h3 className="tn-settings-sec-title">This browser</h3>
          <p className="tn-account-lead">
            This browser keeps a sign-in, but we could not check it now. It comes back when you reload online.
          </p>
          <button type="button" className="tn-account-btn" disabled={busy !== null} onClick={async () => {
            setBusy("sign-out");
            try { await signOut(); } finally { setBusy(null); }
          }}>{busy === "sign-out" ? "Signing out" : "Sign out of this browser"}</button>
          <p className="tn-settings-hint">On a shared computer, sign out of this browser before you leave.</p>
        </section>
      )}
      <section className="tn-settings-sec tn-account">
        <h3 className="tn-settings-sec-title">
          {mode === "create" ? "Create an account" : mode === "forgot" ? "Reset your password" : "Sign in"}
        </h3>
        <p className="tn-settings-hint">
          {mode === "forgot"
            ? "Write the email address of your account. We send you a link to set a new password."
            : "You do not need an account to use the map. An account keeps your boards, places and alerts on every device."}
        </p>
        <form className="tn-account-form" onSubmit={(e) => {
          e.preventDefault();
          if (mode === "sign-in") void run("submit", () => signIn(email, password));
          if (mode === "create") { setSentFor("create"); void run("submit", () => signUp({ username, email, password }), "check-email"); }
          if (mode === "forgot") { setSentFor("forgot"); void run("submit", () => requestReset(email), "check-email"); }
        }}>
          {mode === "create" && (
            <div className="tn-account-field">
              <label className="tn-settings-field">
                <span className="tn-settings-field-label">Username</span>
                <input className="tn-settings-input" value={username} maxLength={24} required
                  autoComplete="username" aria-describedby={nameHintId} onChange={(e) => setUsername(e.target.value)} />
              </label>
              <span className="tn-settings-hint" id={nameHintId}>{NAME_RULE}</span>
            </div>
          )}
          <label className="tn-settings-field">
            <span className="tn-settings-field-label">Email</span>
            <input className="tn-settings-input" type="email" value={email} required
              autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
          </label>
          {mode !== "forgot" && (
            <div className="tn-account-field">
              <label className="tn-settings-field">
                <span className="tn-settings-field-label">Password</span>
                <input className="tn-settings-input" type="password" value={password} required
                  minLength={mode === "create" ? 10 : undefined}
                  autoComplete={mode === "create" ? "new-password" : "current-password"}
                  aria-describedby={mode === "create" ? passHintId : undefined}
                  onChange={(e) => setPassword(e.target.value)} />
              </label>
              {mode === "create" && <span className="tn-settings-hint" id={passHintId}>10 characters or more.</span>}
            </div>
          )}
          {error && <p className="tn-settings-tg-err" role="alert">{error}</p>}
          <button type="submit" className="tn-account-btn is-primary" disabled={busy !== null}>{submitLabel}</button>
        </form>
        <div className="tn-account-switch">
          {mode !== "sign-in" && <button type="button" className="tn-account-link" onClick={() => go("sign-in")}>Sign in</button>}
          {mode !== "create" && <button type="button" className="tn-account-link" onClick={() => go("create")}>Create an account</button>}
          {mode !== "forgot" && <button type="button" className="tn-account-link" onClick={() => go("forgot")}>Forgot your password?</button>}
        </div>
      </section>
    </>
  );
}
