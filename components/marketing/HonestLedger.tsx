"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The section no competitor will copy: what is empty right now, and why.
 *
 * It earns its claim by actually asking. When the section scrolls into view it
 * queries every signal layer through the same /api/signals/<id> route the console
 * uses, six at a time, and reports exactly what came back — including the ones
 * that returned nothing.
 *
 * The concurrency cap is not a nicety. Firing forty cold upstream fetches at once
 * because a marketing page scrolled into view would be the sort of thing this
 * product's whole argument is against. Six at a time, once per page view, and the
 * server route's own per-id cache absorbs repeats.
 *
 * "Empty" is reported as a fact, not an error. A quiet cyclone season is the feed
 * working correctly.
 */

export interface LedgerSource {
  id: string;
  label: string;
  group: string;
}

type State = "checking" | "live" | "empty" | "down";

interface Row extends LedgerSource {
  state: State;
  count: number;
}

const CONCURRENCY = 6;

async function pool<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await run(item);
    }
  });
  await Promise.all(workers);
}

export default function HonestLedger({ sources }: { sources: LedgerSource[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    sources.map((s) => ({ ...s, state: "checking" as State, count: 0 })),
  );
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const holder = useRef<HTMLDivElement>(null);

  const check = useCallback(async (ac: AbortController) => {
    await pool(sources, CONCURRENCY, async (s) => {
      let state: State = "down";
      let count = 0;
      try {
        const res = await fetch(`/api/signals/${s.id}`, { signal: ac.signal });
        if (res.ok) {
          const body = (await res.json()) as { count?: number };
          count = typeof body.count === "number" ? body.count : 0;
          state = count > 0 ? "live" : "empty";
        }
      } catch {
        if (ac.signal.aborted) return;
        state = "down";
      }
      if (ac.signal.aborted) return;
      setRows((prev) => prev.map((r) => (r.id === s.id ? { ...r, state, count } : r)));
    });
    if (!ac.signal.aborted) setDone(true);
  }, [sources]);

  useEffect(() => {
    const el = holder.current;
    if (!el || started) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setStarted(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -20% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    const ac = new AbortController();
    void check(ac);
    return () => ac.abort();
  }, [started, check]);

  const empty = rows.filter((r) => r.state === "empty");
  const live = rows.filter((r) => r.state === "live");
  const downs = rows.filter((r) => r.state === "down");
  const checking = rows.filter((r) => r.state === "checking").length;

  const headline = !started
    ? `${rows.length} layers, unchecked`
    : done
      ? `${live.length} of ${rows.length} returning data right now`
      : `Checking ${rows.length} layers · ${rows.length - checking} answered`;

  // Empties first: they are the point of the section. Then anything down, then live.
  const order: Record<State, number> = { empty: 0, down: 1, checking: 2, live: 3 };
  const sorted = [...rows].sort((a, b) => order[a.state] - order[b.state] || a.label.localeCompare(b.label));

  return (
    <section className="pv-block" ref={holder} id="ledger">
      <div>
        <p className="pv-eyebrow">
          <span>Status</span>
          <span>Checked live in your browser</span>
        </p>
        <h2 className="pv-h2">What&rsquo;s empty right now, and why.</h2>
        <p className="pv-lede">{headline}</p>
      </div>

      <div className="pv-prose">
        <p>
          Some layers are quiet because the world is quiet: no named storm today means the cyclone
          feed is correctly empty. Some are gated behind a key we do not have. Some are simply
          down. All of them say so, here and on the map, instead of showing you a plausible number.
        </p>
        {done && downs.length > 0 && (
          <p className="pv-note">
            {downs.length} {downs.length === 1 ? "layer" : "layers"} did not answer this check.
            That is reported as-is, not retried until it looks better.
          </p>
        )}
      </div>

      <div className="pv-ledger">
        <table>
          <thead>
            <tr>
              <th scope="col">Layer</th>
              <th scope="col">Group</th>
              <th scope="col">State</th>
              <th scope="col">Features</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id}>
                <td>{r.label}</td>
                <td>{r.group}</td>
                <td>
                  <span className="pv-status" data-state={r.state === "down" ? "down" : r.state}>
                    <i />
                    {r.state === "checking"
                      ? "checking"
                      : r.state === "live"
                        ? "live"
                        : r.state === "empty"
                          ? "live · none right now"
                          : "no answer"}
                  </span>
                </td>
                <td className="pv-num">{r.state === "live" ? r.count.toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {done && (
        <p className="pv-note">
          Measured just now, in your browser, against the same endpoints the map uses. Reload and
          the numbers will differ — that is what live means.
        </p>
      )}
    </section>
  );
}
