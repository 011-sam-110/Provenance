"use client";
// AI daily brief block at the top of the Markets panel — a short, calm written
// summary of where global pressure is concentrated today, grounded in the live
// Country Instability Index. Dormant by default: until the freellmapi gateway is
// configured it shows a quiet one-liner about what would enable it (honest, not
// a fake summary). Reuses the markets panel's light tokens.

import { useEffect, useState } from "react";
import type { BriefPayload } from "@/lib/brief";

export default function DailyBrief({ docked = false }: { docked?: boolean } = {}) {
  const [data, setData] = useState<BriefPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/brief")
      .then((r) => r.json())
      .then((d: BriefPayload) => {
        if (alive) setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return null;

  // Dormant (no gateway key) — show the honest "what unlocks this" note, not a fake brief.
  if (!data || data.dormant) {
    return (
      <div className={`tn-brief tn-brief-dormant${docked ? " tn-docked" : ""}`}>
        <span className="tn-brief-label">AI daily brief</span>
        <p className="tn-brief-text">
          A written world brief appears here once the freellmapi gateway is configured
          (set <code>FREELLMAPI_BASE_URL</code> + <code>FREELLMAPI_KEY</code>). It summarises the live
          Country Instability Index — grounded in the data, no speculation.
        </p>
      </div>
    );
  }

  if (!data.brief) return null; // configured but nothing to say right now

  return (
    <div className={`tn-brief${docked ? " tn-docked" : ""}`}>
      {/* The brief now has a keyless path: without a model key the same numbers are
          assembled by plain arithmetic. Labelling that "AI" would be a lie about how
          it was produced, so the label follows `generatedBy` rather than being fixed. */}
      <span className="tn-brief-label">
        {data.generatedBy === "model"
          ? "AI daily brief · grounded in the Instability Index"
          : "World brief · computed from the Instability Index, no AI"}
      </span>
      <p className="tn-brief-text">{data.brief}</p>
    </div>
  );
}
