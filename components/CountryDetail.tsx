"use client";
// In-overlay body for a clicked country.
//
// The country layer is a base reference (borders + names + a click target), but the
// dossier is the traveler / security-desk / analyst entry point for a place. It now
// shows three LIVE, sourced sections beneath the identity facts:
//   • Travel advisory — the UK FCDO's own advice for the country (gov.uk, keyless)
//     with a clickable deep link. Dormant-safe: a labelled placeholder on any miss.
//   • Instability index — the composite Country Instability Index we already compute,
//     honestly flagged as a derived estimate, with every contributing source linked.
//   • Active signals — the live country-coded layers (ransomware / connectivity /
//     displacement / food) that fall inside this country, each with a clickable
//     source, plus a deep link to the country's live ReliefWeb feed.
// No unsourced claims: every number carries a link to the upstream it came from.

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import type { WorldObject } from "@/lib/world";
import { useSignalFeatures, type SignalFeed } from "@/lib/widgets/useSignalFeatures";
import { resolveCountryInstability } from "@/lib/geo/countryInstability";
import { resolveSignalSources } from "@/lib/signals/sourceLink";
import type { AdvisoryView } from "@/lib/geo/travelAdvisory";
import { matchCountryFeature, activeEventLine, reliefwebCountryUrl } from "@/lib/geo/countryActive";

// Shared card + chip styling (matches the existing reserved-slot look, theme vars only).
const CARD_STYLE: CSSProperties = {
  padding: "10px",
  borderRadius: 8,
  background: "var(--tn-surface-2, rgba(148,163,184,0.10))",
};
const SLOT_TITLE_STYLE: CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--tn-text)" };
const SLOT_NOTE_STYLE: CSSProperties = { fontSize: 11, color: "var(--tn-text-muted)" };
const CHIP_STYLE: CSSProperties = {
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 700,
  border: "1px solid var(--tn-border)",
  borderRadius: 999,
  padding: "2px 7px",
  whiteSpace: "nowrap",
};
const SRC_LINK_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--tn-accent-strong)",
  textDecoration: "none",
  border: "1px solid var(--tn-border)",
  borderRadius: 999,
  padding: "2px 8px",
  whiteSpace: "nowrap",
};

/** A single-line status slot (loading / unavailable / placeholder). */
function StatusSlot({ title, note, chip, chipColor }: { title: string; note: string; chip: string; chipColor: string }) {
  return (
    <div style={{ ...CARD_STYLE, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div>
        <div style={SLOT_TITLE_STYLE}>{title}</div>
        <div style={SLOT_NOTE_STYLE}>{note}</div>
      </div>
      <span style={{ ...CHIP_STYLE, color: chipColor }}>{chip}</span>
    </div>
  );
}

// ── Travel advisory ─────────────────────────────────────────────────────────
/**
 * LIVE travel-advisory slot for the clicked country (keyless, UK FCDO).
 *
 * This is ONE government's advice to ITS OWN nationals, not a neutral world risk
 * index, and the card says so. It replaced an aggregator that had gone offline —
 * so the "no data" state now carries the server's reason, because "the FCDO does
 * not cover this territory" and "the lookup failed" are different facts and the
 * old code rendered them identically.
 */
function TravelAdvisorySlot({ iso2 }: { iso2?: string }) {
  const [state, setState] = useState<{ kind: "loading" | "none" | "ok"; view?: AdvisoryView; reason?: string }>({
    kind: "loading",
  });

  useEffect(() => {
    if (!iso2) {
      setState({ kind: "none" });
      return;
    }
    let alive = true;
    setState({ kind: "loading" });
    fetch(`/api/advisory?iso2=${encodeURIComponent(iso2)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const v = (d?.advisory as AdvisoryView | null) ?? null;
        setState(v ? { kind: "ok", view: v } : { kind: "none", reason: d?.reason as string | undefined });
      })
      .catch(() => alive && setState({ kind: "none" }));
    return () => {
      alive = false;
    };
  }, [iso2]);

  if (state.kind === "loading")
    return <StatusSlot title="Travel advisory" note="Checking government advisories…" chip="Loading" chipColor="var(--tn-text-faint)" />;
  if (state.kind === "none")
    return (
      <StatusSlot
        title="Travel advisory"
        note={state.reason ?? "No travel advice available for this country right now."}
        chip="No data"
        chipColor="var(--tn-text-faint)"
      />
    );

  const v = state.view!;
  return (
    <div style={{ ...CARD_STYLE, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={SLOT_TITLE_STYLE}>Travel advisory</div>
          <div style={{ ...SLOT_NOTE_STYLE, color: v.color, fontWeight: 700 }}>{v.label}</div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 2, color: v.color }}>
          <span className="tn-num" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{v.score}</span>
          <span style={{ fontSize: 11, color: "var(--tn-text-muted)" }}>/5</span>
        </div>
      </div>
      {v.message && (
        <div style={{ fontSize: 12, color: "var(--tn-text)", lineHeight: 1.45 }}>{v.message}</div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: "var(--tn-text-faint)" }}>
          {v.issuer}{v.updated ? ` · updated ${v.updated}` : ""} — advice to UK nationals, not a neutral risk index
        </span>
        <a href={v.source} target="_blank" rel="noreferrer noopener" style={SRC_LINK_STYLE}>
          gov.uk ↗
        </a>
      </div>
    </div>
  );
}

// ── Instability index ───────────────────────────────────────────────────────
/** LIVE Country Instability Index slot for the clicked country. */
function InstabilitySlot({ iso3, label }: { iso3: string | undefined; label: string }) {
  const { features, status } = useSignalFeatures("instability", true);
  const state = resolveCountryInstability(features, status, iso3, label);

  if (state.kind === "loading")
    return <StatusSlot title="Instability index" note="Assessing instability…" chip="Loading" chipColor="var(--tn-text-faint)" />;
  if (state.kind === "error")
    return <StatusSlot title="Instability index" note="Instability data is unavailable right now." chip="Unavailable" chipColor="var(--tn-text-faint)" />;
  if (state.kind === "empty")
    return <StatusSlot title="Instability index" note="Monitoring inputs are dormant right now." chip="No data" chipColor="var(--tn-text-faint)" />;
  if (state.kind === "below")
    return <StatusSlot title="Instability index" note="Stable — below the monitoring threshold." chip="Stable" chipColor="var(--tn-live)" />;

  const { view } = state;
  const sources = resolveSignalSources({ signalId: "instability" });
  return (
    <div style={{ ...CARD_STYLE, display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Title + score */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={SLOT_TITLE_STYLE}>Instability index</div>
          <div style={SLOT_NOTE_STYLE}>Composite estimate{view.coverage ? ` · ${view.coverage}` : ""}</div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 2, color: view.color }}>
          <span className="tn-num" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{view.score}</span>
          <span style={{ fontSize: 11, color: "var(--tn-text-muted)" }}>/100</span>
        </div>
      </div>

      {/* Top drivers */}
      {view.drivers.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {view.drivers.map((d) => (
            <span
              key={d}
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 999,
                background: "var(--tn-accent-soft)",
                color: "var(--tn-accent-strong)",
                border: "1px solid var(--tn-border)",
                textTransform: "capitalize",
                whiteSpace: "nowrap",
              }}
            >
              {d}
            </span>
          ))}
        </div>
      )}

      {/* Factor breakdown */}
      {view.factors.length > 0 && (
        <div style={{ display: "grid", gap: 7 }}>
          {view.factors.map((f) => (
            <div key={f.label}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                <span style={{ color: "var(--tn-text-muted)", textTransform: "capitalize" }}>{f.label}</span>
                <span className="tn-num" style={{ color: "var(--tn-text)" }}>{f.value}</span>
              </div>
              <div style={{ height: 5, borderRadius: 999, background: "var(--tn-border)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, f.pct))}%`, background: view.color, borderRadius: 999 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Contributing sources — clickable, honest about being a derived estimate. */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, color: "var(--tn-text-faint)" }}>Sources (derived):</span>
        {sources.map((s) => (
          <a key={s.href} href={s.href} target="_blank" rel="noreferrer noopener" style={SRC_LINK_STYLE}>
            {s.label} ↗
          </a>
        ))}
      </div>
      <div style={{ fontSize: 10, color: "var(--tn-text-faint)", lineHeight: 1.4 }}>
        Composite estimate — not an official government figure.
      </div>
    </div>
  );
}

// ── Active signals ──────────────────────────────────────────────────────────
// Country-coded layers this dossier summarises. Each entry costs one fixed
// useSignalFeatures() call below, so the list length and the hook list must move
// together -- see the comment there.
//
// "food-security" was a fourth entry until 2026-09-05. It was removed with the layer,
// and the symptom it left is worth recording: the layer was gone from the registry, so
// /api/signals/food-security began returning 404, and this component kept asking for it
// on every country click. Nothing threw and nothing turned red -- the row simply never
// resolved. A hardcoded id list does not fail loudly when the thing it names stops
// existing, so grep this file whenever a layer is retired.
const ACTIVE_LAYERS: { id: string; label: string; color: string }[] = [
  { id: "cyber-ransomware", label: "Ransomware", color: "#9333ea" },
  { id: "internet-outages", label: "Connectivity", color: "#b91c1c" },
  { id: "displacement", label: "Displacement", color: "#ea580c" },
];

/** Live country-coded signals that fall inside the clicked country + a ReliefWeb feed. */
function ActiveSignalsSlot({ iso2, iso3, name }: { iso2?: string; iso3?: string; name: string }) {
  // One feed per country-coded layer (fixed order → hook-safe).
  const feeds: SignalFeed[] = [
    useSignalFeatures(ACTIVE_LAYERS[0].id, true),
    useSignalFeatures(ACTIVE_LAYERS[1].id, true),
    useSignalFeatures(ACTIVE_LAYERS[2].id, true),
  ];
  const country = { iso2, iso3, name };
  const rows = ACTIVE_LAYERS.map((layer, i) => {
    const match = matchCountryFeature(feeds[i].features, country);
    if (!match) return null;
    const src = resolveSignalSources({ signalId: layer.id })[0];
    return { layer, line: activeEventLine(layer.id, match), src };
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  const loading = rows.length === 0 && feeds.some((f) => f.status === "loading");
  const reliefweb = reliefwebCountryUrl(iso3);

  return (
    <div style={{ ...CARD_STYLE, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={SLOT_TITLE_STYLE}>Active signals</div>

      {rows.length > 0 ? (
        <div style={{ display: "grid", gap: 6 }}>
          {rows.map(({ layer, line, src }) => (
            <div key={layer.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: layer.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: "var(--tn-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ color: "var(--tn-text-muted)" }}>{layer.label}:</span> {line}
                </span>
              </div>
              {src && (
                <a href={src.href} target="_blank" rel="noreferrer noopener" style={SRC_LINK_STYLE}>
                  {src.label} ↗
                </a>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={SLOT_NOTE_STYLE}>
          {loading ? "Checking active signals…" : "No flagged country-level signals right now."}
        </div>
      )}

      {/* Always a live, sourced situation feed for the country. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", borderTop: "1px solid var(--tn-border)", paddingTop: 8 }}>
        <span style={{ fontSize: 10, color: "var(--tn-text-faint)" }}>Live situation reports for {name}</span>
        <a href={reliefweb} target="_blank" rel="noreferrer noopener" style={SRC_LINK_STYLE}>
          ReliefWeb ↗
        </a>
      </div>
    </div>
  );
}

export default function CountryDetail({ object }: { object: WorldObject }) {
  const meta = object.meta ?? {};
  const flag = (meta.flag as string) || "";
  const iso2 = meta.iso2 as string | undefined;
  const iso3 = meta.iso3 as string | undefined;
  const region = meta.region as string | undefined;
  const continent = meta.continent as string | undefined;
  const population = meta.population as number | undefined;

  const facts: [string, string][] = [];
  if (iso2 || iso3) facts.push(["ISO code", [iso2, iso3].filter(Boolean).join(" · ")]);
  if (region) facts.push(["Region", region]);
  if (continent && continent !== region) facts.push(["Continent", continent]);
  if (population) facts.push(["Population", `≈ ${population.toLocaleString("en-US")}`]);

  return (
    <div style={{ color: "var(--tn-text)", fontFamily: "var(--tn-sans)" }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        {flag && <span aria-hidden style={{ fontSize: 34, lineHeight: 1 }}>{flag}</span>}
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2, color: "var(--tn-text)" }}>
            {object.label}
          </div>
          <div style={{ fontSize: 12, color: "var(--tn-text-muted)" }}>Country</div>
        </div>
      </div>

      {/* ── Known identity facts ── */}
      {facts.length > 0 && (
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", margin: 0, fontSize: 13 }}>
          {facts.map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt
                style={{
                  color: "var(--tn-accent)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  fontSize: 11,
                  fontWeight: 600,
                  alignSelf: "center",
                }}
              >
                {k}
              </dt>
              <dd style={{ margin: 0, color: "var(--tn-text)", fontWeight: 600 }}>{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* ── Live, sourced data slots ── */}
      <div style={{ marginTop: 16, borderTop: "1px solid var(--tn-border)", paddingTop: 12, display: "grid", gap: 8 }}>
        <TravelAdvisorySlot iso2={iso2} />
        <InstabilitySlot iso3={iso3} label={object.label} />
        <ActiveSignalsSlot iso2={iso2} iso3={iso3} name={object.label} />
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: "var(--tn-text-muted)" }}>
        {object.lat.toFixed(2)}, {object.lon.toFixed(2)}
      </div>
    </div>
  );
}
