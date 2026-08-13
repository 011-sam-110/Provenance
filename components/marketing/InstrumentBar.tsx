"use client";

import { useEffect, useState } from "react";
import { BRAND } from "@/lib/brand";

interface Coverage {
  total?: number;
  online?: number;
  feeds?: { answered?: number; total?: number };
}

/**
 * The site wears the app's own status bar, and the first claim it makes is a
 * measured one. Counts come from /api/coverage — the same endpoint the console
 * uses — never from a number typed into the markup.
 *
 * If the fetch fails, the slot stays empty. A stale hardcoded figure on the one
 * page arguing for trustworthiness is worse than no figure.
 */
export default function InstrumentBar() {
  const [cov, setCov] = useState<Coverage | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/coverage", { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCov(d as Coverage))
      .catch(() => {});
    return () => ac.abort();
  }, []);

  const cams = cov?.total;
  const feeds = cov?.feeds;
  const live =
    typeof cams === "number" && cams > 0
      ? `${cams.toLocaleString()} cameras${
          feeds?.answered && feeds?.total ? ` · ${feeds.answered} of ${feeds.total} feeds answering` : ""
        }`
      : "";

  return (
    <div className="pv-bar">
      <a className="pv-wordmark" href="#top">
        <span className="pv-dot" />
        {BRAND.name}
      </a>
      <span className="pv-bar-live">{live}</span>
      <span className="pv-bar-links">
        <a href="#sources">Sources</a>
        {/* The ledger, not the repo. The bar's job is to get you to the two things
            that back the claim it is making one slot to the left — every source,
            and what each of them is doing right now. The repo link is in the
            footer and in the hero's second button. */}
        <a href="#ledger">Status</a>
        <a href="/app">Open the map →</a>
      </span>
    </div>
  );
}
