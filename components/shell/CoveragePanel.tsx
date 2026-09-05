"use client";
// Honest coverage panel (M6, the trust theme). A calm modal that lists, per camera
// source, the live online/total counts — a factual per-region coverage statement
// instead of one inflated headline number. Counts come from /api/coverage (a tiny
// grouped rollup of the registry); camera freshness comes from the existing store.
//
// Reachable from the layer rail's "Coverage details" button and the command palette.

import { useEffect, useState } from "react";
import { coverageStore, useCoverageOpen } from "@/lib/shell/coverage";
import { useFreshness, classifyFreshness, freshnessAgeMs } from "@/lib/freshness";
import { useNow, formatAge } from "@/lib/shell/useNow";
import { CAMERA_REGIONS, cameraRegionColor } from "@/lib/icons/svg";
import type { Coverage } from "@/lib/coverage";

const REGION_LABEL: Record<string, string> = Object.fromEntries(
  CAMERA_REGIONS.map((r) => [r.source, r.label]),
);

function sourceLabel(source: string): string {
  return REGION_LABEL[source] ?? source.replace(/^\w/, (c) => c.toUpperCase());
}

export default function CoveragePanel({ docked = false }: { docked?: boolean } = {}) {
  const open = useCoverageOpen();
  const active = open || docked; // docked = rendered as a workspace tile
  const [data, setData] = useState<Coverage | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  const fresh = useFreshness();
  const now = useNow(1000);
  const camFresh = fresh.find((r) => r.id === "cameras");
  const camState = camFresh ? classifyFreshness(camFresh, now) : "unknown";
  const camAge = camFresh ? freshnessAgeMs(camFresh, now) : null;

  // Fetch once per open/dock (the registry rollup is cheap + cached server-side).
  useEffect(() => {
    if (!active) return;
    let alive = true;
    setStatus("loading");
    fetch("/api/coverage")
      .then((r) => r.json())
      .then((d: Coverage) => {
        if (!alive) return;
        setData(d);
        setStatus("idle");
      })
      .catch(() => {
        if (!alive) return;
        setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [active]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") coverageStore.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!active) return null;

  const inner = (
    <div className={`tn-coverage${docked ? " tn-docked" : ""}`}>
        <header className="tn-coverage-head">
          <div>
            <h2 className="tn-coverage-title">Camera coverage</h2>
            <p className="tn-coverage-sub">
              {data
                ? `${data.online.toLocaleString()} online of ${data.total.toLocaleString()} cameras across ${data.sources.length} sources`
                : "Live counts per source"}
            </p>
          </div>
          {!docked && (
            <button
              type="button"
              className="tn-coverage-close"
              onClick={() => coverageStore.close()}
              aria-label="Close"
            >
              ×
            </button>
          )}
        </header>

        <p className="tn-coverage-note">
          Counts are per source, not one combined headline. “Online” means the feed was
          reachable on the last refresh —{" "}
          {camFresh && !camFresh.local && camState !== "unknown" && camAge != null
            ? `updated ${formatAge(camAge)} ago.`
            : "checked each refresh."}
        </p>

        {status === "error" && (
          <p className="tn-coverage-status">Coverage is unavailable right now.</p>
        )}
        {status === "loading" && !data && (
          <p className="tn-coverage-status">Counting cameras…</p>
        )}

        {data && (
          <ul className="tn-coverage-list">
            {data.sources.map((s) => {
              const pct = s.total > 0 ? Math.round((s.online / s.total) * 100) : 0;
              return (
                <li key={s.source} className="tn-coverage-row">
                  <span
                    className="tn-coverage-dot"
                    style={{ background: cameraRegionColor(s.source) }}
                    aria-hidden
                  />
                  <span className="tn-coverage-name">{sourceLabel(s.source)}</span>
                  <span className="tn-coverage-bar" aria-hidden>
                    <span className="tn-coverage-bar-fill" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="tn-coverage-count tn-num">
                    {s.online.toLocaleString()}
                    <span className="tn-coverage-count-total"> / {s.total.toLocaleString()}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <p className="tn-coverage-foot">
          Every source is a real, live, attributable public feed. Nothing here is synthetic.
        </p>
    </div>
  );

  if (docked) return inner;

  return (
    <div className="tn-coverage-root" role="dialog" aria-modal="true" aria-label="Camera coverage">
      <div className="tn-coverage-backdrop" onClick={() => coverageStore.close()} />
      {inner}
    </div>
  );
}
