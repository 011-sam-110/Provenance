// components/admin/analytics/VercelPlanNotes.tsx
// The refusals Vercel's API gave us, and what a paid plan would have unlocked.
//
// THIS IS HISTORY NOW, AND IT IS KEPT BECAUSE IT IS EVIDENCE. It used to be section 5,
// the answer to "what can this dashboard not tell you", back when the dashboard read
// Vercel's API and the boundary was commercial. The boundary moved: the live source is
// this server's own access log, and no plan is involved. But the refusals below were
// measured against the live API and quoted verbatim, and the plan table was transcribed
// from the published pricing — that is the record of what leaving actually cost in
// capability, and deleting it would leave only the assertion that leaving was right.
//
// It also still applies to the archive above it: the 31-day window and the flat 400 on
// anything older are the reason that data has to be exported rather than left in place.

import { MEASURED_REFUSALS, PLAN_TABLE, PRO_PRICE_NOTE, SHARED_ALLOWANCE_NOTE } from "@/lib/analytics/limits";

export function VercelPlanNotes() {
  return (
    <div style={{ fontSize: 13.5, lineHeight: 1.6, marginTop: 22 }}>
      <h3
        style={{
          fontSize: 12.5,
          margin: "0 0 4px",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--adm-ink-faint)",
        }}
      >
        What we asked Vercel for and were refused
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
                <span style={{ color: "var(--adm-ink-faint)", fontSize: 12 }}>
                  {" "}
                  — measured {r.measuredOn}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3
        style={{
          fontSize: 12.5,
          margin: "24px 0 4px",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--adm-ink-faint)",
        }}
      >
        What a paid plan would have added
      </h3>
      <table className="adm-table">
        <thead>
          <tr>
            <th>Feature</th>
            <th>Hobby</th>
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
