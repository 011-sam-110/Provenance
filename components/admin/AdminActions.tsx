"use client";

import { useCallback, useState } from "react";
import type { EstateStats } from "@/lib/discovery/analytics";

/**
 * The two buttons that change something, and the estate panel that does not.
 *
 * A discovery run is minutes long, so it streams its progress lines into the page
 * rather than spinning: a reviewer needs to be able to tell "still working through
 * data.gov.uk" from "hung", and a spinner cannot say which.
 *
 * Promotion is separated from admission on purpose. Admitting a feed is a judgement
 * about cameras; promoting writes SOURCE CODE that changes what production serves, and
 * collapsing the two would mean the last card of a review session silently edited the
 * repository.
 */

export function AdminActions({ queued, camerasWaiting }: { queued: number; camerasWaiting: number }) {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    setLog(["Asking the catalogues. This takes a few minutes — requests are deliberately spaced so we do not hammer a national open-data portal."]);
    try {
      const res = await fetch("/api/admin/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 40 }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "The run failed with " + res.status);
        return;
      }
      setLog(json.log ?? []);
      const c = json.counts;
      setResult(
        `${c.catalogueHits} datasets offered, ${c.plausible} plausibly cameras, ${c.fetchable} endpoints fetched, ` +
          `${c.parsed} parsed into cameras, ${c.admissible} past the gates. ${json.queued} added to the queue, ` +
          `${json.keptDecided} already-decided candidates left alone.` +
          (json.registryNote ? " " + json.registryNote : ""),
      );
      // The queue is server-rendered, so the numbers above it are stale until reload.
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, []);

  const promote = useCallback(async () => {
    const by = window.localStorage.getItem("provenance.reviewer") ?? "";
    if (!by) {
      setError("Review at least one camera first — promotion is signed with the reviewer's name.");
      return;
    }
    if (!window.confirm("Write lib/sources/discovered.data.ts from the admitted feeds? Read the diff before committing.")) {
      return;
    }
    setError(null);
    try {
      const res = await fetch("/api/admin/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ by }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Promotion failed with " + res.status);
        return;
      }
      const skipped = (json.skipped ?? []) as Array<{ id: string; why: string }>;
      setResult(
        `Wrote ${json.written} feed(s) covering ${(json.countries ?? []).join(", ") || "no country"}.` +
          (skipped.length ? " Skipped " + skipped.length + ": " + skipped.map((s) => s.id + " — " + s.why).join("; ") : "") +
          (json.note ? " " + json.note : ""),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <>
      <div className="adm-stats" style={{ marginBottom: 16 }}>
        <div className="adm-stat">
          <span className="adm-stat-n">{queued}</span>
          <span className="adm-stat-k">candidates queued</span>
        </div>
        <div className="adm-stat">
          <span className="adm-stat-n">{camerasWaiting}</span>
          <span className="adm-stat-k">cameras to review</span>
          <p className="adm-stat-note">sampled from feeds nobody has ruled on</p>
        </div>
      </div>

      <div className="adm-actions">
        <button className="adm-btn" onClick={() => void run()} disabled={running} style={{ display: "inline-flex" }}>
          {running ? "Running…" : "Run discovery"}
        </button>
        <button className="adm-btn" onClick={() => void promote()} style={{ display: "inline-flex" }}>
          Promote admitted feeds
        </button>
      </div>

      {error && <div className="adm-note">{error}</div>}
      {result && <div className="adm-note">{result}</div>}
      {log.length > 0 && <pre className="adm-log">{log.join("\n")}</pre>}
    </>
  );
}

/** The live estate, loaded only when asked for. */
function Estate() {
  const [stats, setStats] = useState<EstateStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/estate");
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Failed with " + res.status);
        return;
      }
      setStats(json.stats as EstateStats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  if (!stats) {
    return (
      <div className="adm-actions">
        <button className="adm-btn" onClick={() => void load()} disabled={loading} style={{ display: "inline-flex" }}>
          {loading ? "Reading fourteen feeds…" : "Read the live estate"}
        </button>
        {error && <span className="adm-note">{error}</span>}
      </div>
    );
  }

  return (
    <>
      <div className="adm-stats">
        <div className="adm-stat">
          <span className="adm-stat-n">{stats.total.toLocaleString()}</span>
          <span className="adm-stat-k">cameras</span>
          <p className="adm-stat-note">one instance, one moment</p>
        </div>
        <div className="adm-stat">
          <span className="adm-stat-n">{stats.byCountry.length}</span>
          <span className="adm-stat-k">countries</span>
        </div>
        <div className="adm-stat">
          <span className="adm-stat-n">{stats.bySource.length}</span>
          <span className="adm-stat-k">feeds answering</span>
        </div>
        <div className="adm-stat">
          <span className="adm-stat-n">{stats.unlicensed.toLocaleString()}</span>
          <span className="adm-stat-k">no stated licence</span>
          <p className="adm-stat-note">said plainly, not invented</p>
        </div>
        <div className="adm-stat">
          <span className="adm-stat-n">{stats.insecureMedia.toLocaleString()}</span>
          <span className="adm-stat-k">http media</span>
          <p className="adm-stat-note">blocked as mixed content</p>
        </div>
      </div>

      <h2 className="adm-h2">By feed</h2>
      <table className="adm-table">
        <thead>
          <tr>
            <th>Feed</th>
            <th style={{ textAlign: "right" }}>Cameras</th>
            <th style={{ textAlign: "right" }}>Share</th>
          </tr>
        </thead>
        <tbody>
          {stats.bySource.map((s) => (
            <tr key={s.source}>
              <td>{s.source}</td>
              <td className="adm-num">{s.n.toLocaleString()}</td>
              <td className="adm-num">{stats.total ? Math.round((s.n / stats.total) * 100) : 0}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="adm-h2">By country</h2>
      <table className="adm-table">
        <thead>
          <tr>
            <th>Country</th>
            <th style={{ textAlign: "right" }}>Cameras</th>
          </tr>
        </thead>
        <tbody>
          {stats.byCountry.map((c) => (
            <tr key={c.country}>
              <td>{c.country}</td>
              <td className="adm-num">{c.n.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

AdminActions.Estate = Estate;
