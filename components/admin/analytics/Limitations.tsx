// components/admin/analytics/Limitations.tsx
// Section 5: what this dashboard cannot tell you, and what it would cost to change.
//
// Everything here is either a refusal we received verbatim or a line transcribed from
// Vercel's published pricing table. No inference, no recommendation: the reader is
// the one paying, and the only useful thing this panel can do is put the boundary and
// the price in the same place and then stop talking.

import { MEASURED_REFUSALS, PLAN_TABLE, PRO_PRICE_NOTE, SHARED_ALLOWANCE_NOTE } from "@/lib/analytics/limits";

export function Limitations({ windowDays }: { windowDays: number }) {
  return (
    <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
      <p style={{ marginTop: 0, maxWidth: "78ch", color: "var(--adm-ink-dim)" }}>
        This page shows pageviews, routes, referrers, countries, devices and browsers, over a
        rolling {windowDays}-day window. That is the whole of it. It cannot tell you what anyone
        <em> did</em> once they arrived — not a layer toggled, a camera opened, a board switched or
        a tour abandoned — because none of that is collected. Custom events are the mechanism for
        it, and this plan does not include them.
      </p>

      <h3 style={{ fontSize: 12.5, margin: "18px 0 4px", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--adm-ink-faint)" }}>
        What we asked for and were refused
      </h3>
      <p style={{ fontSize: 12, color: "var(--adm-ink-faint)", margin: "0 0 8px" }}>
        Measured against the live API, quoted exactly as it answered.
      </p>
      <table className="adm-table">
        <thead>
          <tr>
            <th style={{ width: "32%" }}>Asked for</th>
            <th style={{ width: 60 }}>Status</th>
            <th>Vercel&apos;s answer</th>
          </tr>
        </thead>
        <tbody>
          {MEASURED_REFUSALS.map((r) => (
            <tr key={r.asked}>
              <td>{r.asked}</td>
              <td className="adm-num">{r.status}</td>
              <td>
                <span style={{ fontStyle: "italic", color: "var(--adm-ink-dim)" }}>
                  &ldquo;{r.message}&rdquo;
                </span>
                <span style={{ color: "var(--adm-ink-faint)", fontSize: 12 }}> — measured {r.measuredOn}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ fontSize: 12.5, margin: "24px 0 4px", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--adm-ink-faint)" }}>
        What a paid plan would add
      </h3>
      <table className="adm-table">
        <thead>
          <tr>
            <th>Feature</th>
            <th>Hobby (current)</th>
            <th>Pro</th>
            <th>Pro + Analytics Plus</th>
          </tr>
        </thead>
        <tbody>
          {PLAN_TABLE.map((row) => (
            <tr key={row.feature}>
              <td>{row.feature}</td>
              <td style={{ color: "var(--adm-ink-faint)" }}>{row.hobby}</td>
              <td>{row.pro}</td>
              <td>{row.proPlus}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="adm-note" style={{ marginTop: 14 }}>
        {PRO_PRICE_NOTE}
        <div style={{ marginTop: 6 }}>{SHARED_ALLOWANCE_NOTE}</div>
      </div>

      <p style={{ fontSize: 11.5, color: "var(--adm-ink-faint)", marginTop: 10, marginBottom: 0 }}>
        Plan table transcribed from vercel.com/docs/analytics/limits-and-pricing, read 2026-08-19.
        Prices are list prices on that date and are worth re-reading before anyone spends money.
      </p>
    </div>
  );
}
