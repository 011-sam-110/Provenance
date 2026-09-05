"use client";
// Top-right profile avatar + popover. There is no real auth yet, so this is local
// identity: a display name (persisted via profileStore) that colours the avatar, plus
// a "Sign in" affordance that is a deliberate PLACEHOLDER — it reveals a sign-in form
// seam ("coming soon") rather than wiring a provider. Real OAuth (e.g. Sign in with
// Vercel) drops in here later. The popover also links into full Settings.

import { useEffect, useRef, useState } from "react";
import { profileStore, useProfile, avatarInitial, avatarColor } from "@/lib/shell/profile";

export default function ProfileMenu({ onOpenSettings }: { onOpenSettings: () => void }) {
  const profile = useProfile();
  const [open, setOpen] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [open]);

  // Reset the sign-in sub-view whenever the popover closes.
  useEffect(() => { if (!open) setSignIn(false); }, [open]);

  const name = profile.name.trim();

  return (
    <div className="tn-profile" ref={ref}>
      <button type="button" className="tn-profile-avatar" aria-haspopup="menu" aria-expanded={open}
        aria-label="Profile" onClick={() => setOpen((o) => !o)}
        style={{ background: avatarColor(profile.name) }}>
        {avatarInitial(profile.name)}
      </button>

      {open && (
        <div className="tn-profile-menu" role="menu">
          <div className="tn-profile-id">
            <span className="tn-profile-id-avatar" aria-hidden style={{ background: avatarColor(profile.name) }}>
              {avatarInitial(profile.name)}
            </span>
            <div className="tn-profile-id-text">
              <span className="tn-profile-id-name">{name || "Guest"}</span>
              <span className="tn-profile-id-sub">{name ? "Local profile" : "Not signed in"}</span>
            </div>
          </div>

          {signIn ? (
            <div className="tn-profile-signin">
              <p className="tn-profile-signin-note">🔒 Accounts are coming soon. For now your settings are saved on this device.</p>
              <input className="tn-profile-input" type="email" placeholder="you@example.com" disabled aria-label="Email (coming soon)" />
              <button type="button" className="tn-profile-btn is-primary" disabled>Continue</button>
              <button type="button" className="tn-profile-link" onClick={() => setSignIn(false)}>← Back</button>
            </div>
          ) : (
            <>
              <label className="tn-profile-field">
                <span className="tn-profile-field-label">Display name</span>
                <input className="tn-profile-input" type="text" value={profile.name} maxLength={40}
                  placeholder="Add your name" onChange={(e) => profileStore.setName(e.target.value)} />
              </label>
              <button type="button" className="tn-profile-btn is-primary" onClick={() => setSignIn(true)}>Sign in</button>
              {/* `tn-settings-trigger` is back on the header's own ⚙ button and is NOT
                  duplicated here. It travelled to this menu when the header had no
                  settings icon and a guided-tour step had to be able to click one;
                  the tour is gone, the header has the icon again, and two elements
                  carrying the selector the e2e suite drives would be an ambiguous
                  match the day anything renders this menu. */}
              <button type="button" className="tn-profile-btn" onClick={() => { setOpen(false); onOpenSettings(); }}>⚙ Settings</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
