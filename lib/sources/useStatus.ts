"use client";
// One shared fetch of GET /api/status for the whole client.
//
// The report is deployment-scoped configuration (which layers are key-gated, which
// keys this deployment holds), so it changes only on redeploy — a module-level
// promise is exactly right, and it means every rail row, badge and panel that
// wants to know "is this locked?" costs one request per page load rather than one
// per component.
//
// Dormant-safe: if /api/status itself fails we return null and callers render
// nothing. An absent badge is the honest fallback — better to say nothing than to
// assert "locked" or "fine" on no evidence.

import { useEffect, useState } from "react";
import type { StatusEntry, StatusReport } from "@/lib/sources/statusReport";

let cached: Promise<StatusReport | null> | null = null;

function load(): Promise<StatusReport | null> {
  cached ??= fetch("/api/status")
    .then((r) => (r.ok ? (r.json() as Promise<StatusReport>) : null))
    .catch(() => null);
  return cached;
}

/** Test/HMR seam — drops the memoised report so the next caller refetches. */
export function resetStatusCache() {
  cached = null;
}

export function useStatus(): StatusReport | null {
  const [report, setReport] = useState<StatusReport | null>(null);
  useEffect(() => {
    let alive = true;
    void load().then((r) => {
      if (alive) setReport(r);
    });
    return () => {
      alive = false;
    };
  }, []);
  return report;
}

/** The entry for one layer or capability id, or null while loading / on failure. */
export function useCapabilityStatus(id: string): StatusEntry | null {
  const report = useStatus();
  if (!report) return null;
  return report.layers.find((l) => l.id === id) ?? report.capabilities.find((c) => c.id === id) ?? null;
}
