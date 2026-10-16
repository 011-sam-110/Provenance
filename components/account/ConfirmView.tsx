"use client";
// Where every email link lands. The link carries token_hash and type; verifyOtp in THIS
// browser turns it into a session, so the link works even when it opens in a different
// browser from the one that signed up (a PKCE code link would not).

import { useEffect, useRef, useState } from "react";
import { accountsConfigured } from "@/lib/account/config";
import { verifyEmailLink, setNewPassword } from "@/lib/account/auth";
import { GENERIC_ERROR } from "@/lib/account/errors";

type Phase = "checking" | "confirmed" | "new-password" | "done" | "failed";

export default function ConfirmView() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  // The phases replace each other, so a live region would unmount with its text. Move the
  // focus to each new heading instead: a screen reader then reads the result.
  useEffect(() => {
    if (phase !== "checking") heading.current?.focus();
  }, [phase]);

  useEffect(() => {
    // A token can be spent once. A second run (StrictMode, re-render) must do nothing.
    if (started.current) return;
    started.current = true;
    const q = new URLSearchParams(window.location.search);
    const tokenHash = q.get("token_hash");
    const type = q.get("type");
    // The token leaves the address bar first, on every path. Keep history.state so the
    // App Router back/forward still works.
    window.history.replaceState(window.history.state, "", "/account/confirm");
    // That call is the native one: the App Router patches history in its own effect, which
    // runs after this child effect. Call again on the next task, through the patch, so the
    // router's own copy of the URL (useSearchParams, and the URL it writes back on its next
    // state change) loses the token too.
    window.setTimeout(() => window.history.replaceState(null, "", "/account/confirm"), 0);
    if (!accountsConfigured() || !tokenHash || (type !== "email" && type !== "signup" && type !== "recovery")) {
      setPhase("failed");
      return;
    }
    void verifyEmailLink(tokenHash, type).then((r) => {
      if (!r.ok) { setError(r.error); setPhase("failed"); return; }
      setPhase(type === "recovery" ? "new-password" : "confirmed");
    });
  }, []);

  if (phase === "checking") return <p className="pv-lede" aria-live="polite">Checking your link.</p>;
  if (phase === "failed") {
    // GENERIC_ERROR = the check itself failed (network). The token was not spent, but it has
    // left the address bar, so a reload cannot retry: the email link can.
    if (error === GENERIC_ERROR) {
      return (
        <div className="pv-account">
          <h1 className="pv-h2" ref={heading} tabIndex={-1}>We could not check your link.</h1>
          <p className="pv-prose">Open the link in the email again. It works once, within one hour.</p>
        </div>
      );
    }
    // A reset link also confirms an unconfirmed address (measured on the dev project), so
    // "Forgot your password?" is the way to a new link for both kinds of email.
    return (
      <div className="pv-account">
        <h1 className="pv-h2" ref={heading} tabIndex={-1}>This link does not work.</h1>
        <p className="pv-prose">It is used already, or it is older than one hour.</p>
        <p className="pv-prose">
          For a new link, open the console, choose Account, then Forgot your password. That link also
          confirms a new account.
        </p>
        <p className="pv-cta-row"><a className="pv-cta" href="/app">Open the console</a></p>
      </div>
    );
  }
  if (phase === "confirmed" || phase === "done") {
    return (
      <div className="pv-account">
        <h1 className="pv-h2" ref={heading} tabIndex={-1}>{phase === "done" ? "Your password is changed." : "Your email is confirmed."}</h1>
        <p className="pv-prose">You are signed in on this browser.</p>
        <p className="pv-cta-row"><a className="pv-cta" href="/app">Open the console</a></p>
      </div>
    );
  }
  return (
    <form className="pv-account" onSubmit={(e) => {
      e.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(null);
      void setNewPassword(password).then((r) => {
        setBusy(false);
        if (r.ok) setPhase("done"); else setError(r.error);
      });
    }}>
      <h1 className="pv-h2" ref={heading} tabIndex={-1}>Set a new password.</h1>
      <div className="pv-account-field">
        <label className="pv-account-label" htmlFor="pv-account-password">New password</label>
        <input className="pv-account-input" id="pv-account-password" type="password" value={password}
          minLength={10} required autoComplete="new-password" aria-describedby="pv-account-password-hint"
          onChange={(e) => setPassword(e.target.value)} />
        <span className="pv-account-hint" id="pv-account-password-hint">10 characters or more.</span>
      </div>
      {error && <p className="pv-account-error" role="alert">{error}</p>}
      <p className="pv-cta-row">
        <button type="submit" className="pv-cta" disabled={busy}>{busy ? "Saving" : "Save password"}</button>
      </p>
    </form>
  );
}
