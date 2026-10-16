"use client";
// The console's door to the Account tab. Renders NOTHING when accounts are off, so a
// self-hosted build's header is unchanged. Same `.tnx-hdr-btn` family as its neighbours,
// and its label collapses under 900px like SHORTCUTS and SETTINGS, so the mark alone must
// say "account" on a phone: a person, outlined when signed out and filled when signed in.

import { useEffect, useRef } from "react";
import { useAccount } from "@/lib/account/store";
import { takeReopenFlag } from "@/lib/account/auth";
import { isPlaceholderUsername } from "@/lib/account/username";

function PersonMark({ filled }: { filled: boolean }) {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden focusable="false"
      fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.3}>
      <circle cx="6" cy="3.6" r="2.3" />
      <path d="M1.4 11.2c.4-2.5 2.3-4 4.6-4s4.2 1.5 4.6 4z" strokeLinejoin="round" />
    </svg>
  );
}

export default function AccountButton({ onOpen }: { onOpen: () => void }) {
  const acct = useAccount();

  // Sign-in reloads the page. Open the Account tab again after that reload, so the person
  // lands where they signed in and sees the result. Checked once, on the first settled status:
  // `onOpen` is a new function on every header render.
  const reopenChecked = useRef(false);
  useEffect(() => {
    if (reopenChecked.current || acct.status === "loading" || acct.status === "off") return;
    reopenChecked.current = true;
    if (takeReopenFlag() && acct.status === "signed-in") onOpen();
  }, [acct.status, onOpen]);

  if (acct.status === "off") return null;
  const signedIn = acct.status === "signed-in";
  // Never show a database placeholder name in the header. While the boot check runs the
  // label is neutral: "SIGN IN" would flash for a person who is signed in.
  const name = acct.username && !isPlaceholderUsername(acct.username) ? acct.username : null;
  // A held session (see lib/account/store.ts) reads ACCOUNT: SIGN IN would tell a person on a
  // shared computer that nobody is signed in here.
  const offerSignIn = acct.status === "signed-out" && !acct.heldSession;
  const label = offerSignIn ? "SIGN IN" : (name ?? "ACCOUNT");
  return (
    <button
      type="button"
      className="tnx-hdr-btn tn-account-trigger"
      onClick={onOpen}
      aria-label={signedIn ? `Account: ${name ?? acct.email ?? "signed in"}` : offerSignIn ? "Sign in" : "Account"}
      title={signedIn ? "Your account and sync" : "Sign in to sync your settings"}
    >
      <PersonMark filled={signedIn} />
      <span className="tnx-hdr-btn-label">{label}</span>
    </button>
  );
}
