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
 * THE "WHY" MATTERS AS MUCH AS THE "WHAT". An adapter is dormant-safe, so a layer
 * gated behind a credential we do not hold returns `[]` — identical on the wire to
 * a feed that is simply quiet. Reporting both as "live · none right now" would tell
 * the reader a locked feed is working, which is precisely the class of comfortable
 * lie this whole page argues against. So the count is joined against /api/status
 * (the app's own capability model: keyless / configured / locked / refused) and a
 * gated layer says it is gated, naming the variable it wants.
 *
 * The concurrency cap is not a nicety either. Firing forty cold upstream fetches at
 * once because a marketing page scrolled into view is the sort of thing this
 * product exists to not do. Six at a time, once per page view, and the route's own
 * per-id cache absorbs repeats.
 */

export interface LedgerSource {
  id: string;
  label: string;
  group: string;
}

type State = "checking" | "live" | "empty" | "locked" | "refused" | "down";

interface Row extends LedgerSource {
  state: State;
  count: number;
  missingEnv: string[];
}

interface StatusLayer {
  id: string;
  state?: string;
  missingEnv?: string[];
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

const LABEL: Record<State, string> = {
  checking: "checking",
  live: "live",
  empty: "live · none right now",
  locked: "needs a key",
  refused: "key refused upstream",
  down: "no answer",
};

/** Which dot colour the shared .pv-status styling should use. */
function tone(state: State): string {
  if (state === "locked" || state === "refused") return "key";
  if (state === "down") return "down";
  return state;
}

export default function HonestLedger({ sources }: { sources: LedgerSource[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    sources.map((s) => ({ ...s, state: "checking" as State, count: 0, missingEnv: [] })),
  );
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const holder = useRef<HTMLDivElement>(null);

  const check = useCallback(
    async (ac: AbortController) => {
      // Gating first, and only once: it is a single cheap call and it decides how
      // an empty count should be READ.
      const gating = new Map<string, { state: string; missingEnv: string[] }>();
      try {
        const res = await fetch("/api/status", { signal: ac.signal, cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { layers?: StatusLayer[] };
          for (const l of body.layers ?? []) {
            gating.set(l.id, { state: l.state ?? "keyless", missingEnv: l.missingEnv ?? [] });
          }
        }
      } catch {
        /* no gating info — fall back to reporting counts alone, never to guessing */
      }
      if (ac.signal.aborted) return;

      await pool(sources, CONCURRENCY, async (s) => {
        const gate = gating.get(s.id);
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
        // A gated layer with nothing in it is gated, not quiet. A gated layer that
        // is somehow returning rows is reported as live — the gate is the
        // explanation for emptiness, not an override of observed data.
        if (count === 0 && gate) {
          if (gate.state === "locked") state = "locked";
          else if (gate.state === "refused") state = "refused";
        }
        if (ac.signal.aborted) return;
        setRows((prev) =>
          prev.map((r) => (r.id === s.id ? { ...r, state, count, missingEnv: gate?.missingEnv ?? [] } : r)),
        );
      });
      if (ac.signal.aborted) return;

      // Ask about gating a SECOND time, now that we have probed every layer.
      //
      // `locked` is derived from environment variables and is known immediately.
      // `refused` is not: it means a credential we DO hold was rejected upstream,
      // which the server can only know once something has actually tried. On a
      // cold process nothing has, so the first call reports such a layer as
      // configured and its empty result reads as "quiet" — the exact
      // misattribution this section exists to avoid. Our own probes just produced
      // that evidence, so re-reading it now turns "quiet" into the truth.
      try {
        const res = await fetch("/api/status", { signal: ac.signal, cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { layers?: StatusLayer[] };
          const after = new Map(
            (body.layers ?? []).map((l) => [l.id, { state: l.state ?? "keyless", missingEnv: l.missingEnv ?? [] }]),
          );
          if (!ac.signal.aborted) {
            setRows((prev) =>
              prev.map((r) => {
                if (r.count > 0) return r;
                const g = after.get(r.id);
                if (!g) return r;
                if (g.state === "locked") return { ...r, state: "locked", missingEnv: g.missingEnv };
                if (g.state === "refused") return { ...r, state: "refused", missingEnv: g.missingEnv };
                return r;
              }),
            );
          }
        }
      } catch {
        /* keep the first pass's labels */
      }

      if (!ac.signal.aborted) setDone(true);
    },
    [sources],
  );

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

  const live = rows.filter((r) => r.state === "live").length;
  const quiet = rows.filter((r) => r.state === "empty").length;
  const gated = rows.filter((r) => r.state === "locked" || r.state === "refused").length;
  const downs = rows.filter((r) => r.state === "down").length;
  const answered = rows.filter((r) => r.state !== "checking").length;

  const headline = !started
    ? `${rows.length} layers, unchecked`
    : done
      ? `${live} of ${rows.length} returning data right now`
      : `Checking ${rows.length} layers · ${answered} answered`;

  // Anything that is NOT returning data comes first: those rows are the section.
  const order: Record<State, number> = { locked: 0, refused: 1, down: 2, empty: 3, checking: 4, live: 5 };
  const sorted = [...rows].sort(
    (a, b) => order[a.state] - order[b.state] || a.label.localeCompare(b.label),
  );

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
          feed is correctly empty. Some are gated behind a credential we do not hold, and say so
          rather than looking broken. Some are simply down. None of them fills the gap with a
          plausible number.
        </p>
        {done && (
          <p className="pv-note">
            {quiet} quiet · {gated} waiting on a key · {downs} no answer. Every row below was
            measured in your browser just now, against the endpoints the map itself uses.
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
                  <span className="pv-status" data-state={tone(r.state)}>
                    <i />
                    {LABEL[r.state]}
                    {r.state === "locked" && r.missingEnv.length > 0 && (
                      <em className="pv-env">{r.missingEnv.join(" + ")}</em>
                    )}
                  </span>
                </td>
                <td className="pv-num">{r.state === "live" ? r.count.toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
