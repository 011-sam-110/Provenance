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
export default function InstrumentBar({ repoUrl }: { repoUrl: string }) {
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
        <a href={repoUrl} target="_blank" rel="noreferrer noopener">
          Source code
        </a>
        <a href="/app">Open the map →</a>
      </span>
    </div>
  );
}
