// components/admin/analytics/Panel.tsx
// The shell every analytics panel renders inside, and — more importantly — the one
// place that decides what an ABSENCE looks like.
//
// There are four different reasons a panel can have no numbers, and on a chart they
// look identical:
//   no-credentials — we never asked. Fix: set three env vars.
//   refused        — we asked and the plan said no. Fix: money, or nothing.
//   unreachable    — we asked and something broke. Fix: probably transient.
//   empty          — we asked, we were answered, and the answer was genuinely nothing.
// Only the last one is a fact about Provenance's traffic. The other three are facts
// about our access, and rendering them as a flat line at zero would be a lie told in
// a very convincing format. So each gets its own visible treatment, and a refusal is
// QUOTED rather than summarised, so the reader can see it came from Vercel.
//
// Styling is the shared .adm-* skin from app/admin/admin.css, which the admin layout
// imports. The warn-tinted .adm-note is deliberate for all three non-answers: they
// should not read as data.

import type { ReactNode } from "react";
import type { AnalyticsFailure } from "@/lib/analytics/vercelApi";

export function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="adm-h2">{title}</h2>
      {subtitle && (
        <p style={{ color: "var(--adm-ink-dim)", fontSize: 12.5, margin: "-6px 0 12px", maxWidth: "78ch" }}>
          {subtitle}
        </p>
      )}
      {children}
    </section>
  );
}

/**
 * What to show instead of a chart. Never returns null and never returns an empty
 * container: a panel that renders nothing is indistinguishable from a panel that is
 * still loading, which is the third way to imply a zero by accident.
 */
export function FailureNotice({ failure }: { failure: AnalyticsFailure }) {
  if (failure.kind === "no-credentials") {
    return (
      <div className="adm-note">
        <strong>Not asked.</strong> No Vercel API credentials are set, so this panel has requested
        nothing. This is not a statement about traffic.
        <div style={{ color: "var(--adm-ink-faint)", fontSize: 12, marginTop: 6 }}>
          Missing: {failure.missing.join(", ")} — see docs/API_KEYS.md.
        </div>
      </div>
    );
  }
  if (failure.kind === "refused") {
    return (
      <div className="adm-note">
        <strong>Refused by Vercel (HTTP {failure.status}).</strong> The data exists or does not;
        this plan will not serve it either way.
        <blockquote
          style={{
            margin: "8px 0 0",
            paddingLeft: 10,
            borderLeft: "2px solid var(--adm-line)",
            fontSize: 12.5,
            color: "var(--adm-ink-dim)",
            fontStyle: "italic",
          }}
        >
          {failure.message}
        </blockquote>
      </div>
    );
  }
  return (
    <div className="adm-note">
      <strong>Could not reach the analytics API.</strong> No numbers were returned, and none are
      shown. This is our own diagnosis, not Vercel&apos;s wording.
      <div style={{ color: "var(--adm-ink-faint)", fontSize: 12, marginTop: 6 }}>{failure.detail}</div>
    </div>
  );
}

/** A genuine, measured nothing — we asked, we were answered, the answer was zero. */
export function EmptyNotice({ what, since, until }: { what: string; since: string; until: string }) {
  return (
    <div className="adm-empty">
      <strong>None recorded.</strong> Vercel answered this query and returned no {what} between{" "}
      {since} and {until}.
      <div style={{ fontSize: 12.5, marginTop: 6, color: "var(--adm-ink-faint)" }}>
        This one is a fact about the site&apos;s traffic, not about our access to it.
      </div>
    </div>
  );
}
