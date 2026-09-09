"use client";

import { useEffect, useState } from "react";
import type { WorldObject } from "@/lib/world";
import { TypeIcon } from "@/lib/icons/Icon";
import type { FlightEnrichment, FlightAirport } from "@/lib/sources/adsbdb";

interface Props {
  object: WorldObject;
}

// ---------------------------------------------------------------------------
// Unit converters
// ---------------------------------------------------------------------------

function msToKmh(ms: number): number {
  return Math.round(ms * 3.6);
}

function msToKnots(ms: number): number {
  return Math.round(ms * 1.944);
}

function mToFt(m: number): number {
  return Math.round(m * 3.28084);
}

function headingToCompass(deg: number): string {
  const dirs = [
    "N", "NNE", "NE", "ENE",
    "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW",
    "W", "WNW", "NW", "NNW",
  ];
  return dirs[Math.round(deg / 22.5) % 16];
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  primary,
  secondary,
  primaryColor = "var(--tn-plane)",
}: {
  label: string;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  primaryColor?: string;
}) {
  return (
    <div
      style={{
        background: "var(--tn-surface-2)",
        borderRadius: 8,
        padding: "12px 14px",
        minHeight: 72,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--tn-accent)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 4,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: primaryColor, lineHeight: 1.2 }}>
        {primary}
      </div>
      {secondary && (
        <div style={{ fontSize: 12, color: "var(--tn-text-faint)", marginTop: 2 }}>{secondary}</div>
      )}
    </div>
  );
}

/** One end of a route: the airport code (bold) over its city/name. */
function Endpoint({
  port,
  fallback,
  align = "left",
}: {
  port: FlightAirport | null;
  fallback: string;
  align?: "left" | "right";
}) {
  const code = port ? port.iata || port.icao : "";
  const sub = port ? port.municipality || port.name : "";
  return (
    <div style={{ flex: 1, textAlign: align, minWidth: 0 }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: "var(--tn-text)", letterSpacing: "0.04em" }}>
        {code || fallback}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 11,
            color: "var(--tn-text-faint)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlaneDetail — renders inside an existing overlay panel body
// No full-screen layout, no fixed positioning.
// ---------------------------------------------------------------------------

/**
 * Renders flight information for a clicked plane {@link WorldObject}.
 * Designed to sit inside an existing overlay panel — emits body content only.
 *
 * @param object - A WorldObject with kind "plane". Reads meta keys:
 *   callsign, country, velocityMs, altKm, verticalRateMs, onGround.
 */
export default function PlaneDetail({ object }: Props) {
  const meta = object.meta ?? {};

  const callsign = (meta.callsign as string | undefined) ?? object.label;
  const country = (meta.country as string | undefined) ?? "—";
  const hex = object.id.startsWith("plane:") ? object.id.slice("plane:".length) : "";

  // Enrich with adsbdb (origin/destination + airframe) server-side. Optional —
  // the dossier shows the live telemetry immediately and grafts this in if/when
  // it resolves; a miss or failure leaves the panel exactly as it was.
  const [flight, setFlight] = useState<FlightEnrichment | null>(null);
  useEffect(() => {
    setFlight(null);
    const cs = callsign && callsign !== hex ? callsign : "";
    if (!cs && !hex) return;
    const params = new URLSearchParams();
    if (cs) params.set("callsign", cs);
    if (hex && hex !== "unknown") params.set("hex", hex);
    let alive = true;
    fetch(`/api/flight?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: FlightEnrichment | null) => {
        if (alive) setFlight(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [callsign, hex]);

  const route = flight?.route ?? null;
  const aircraft = flight?.aircraft ?? null;
  const registration =
    aircraft?.registration ?? (meta.registration as string | undefined) ?? null;
  const airframe = [aircraft?.manufacturer, aircraft?.type].filter(Boolean).join(" ") || aircraft?.icaoType || null;
  const altKm = (meta.altKm as number | undefined) ?? 0;
  const altM = altKm * 1000;
  const velocityMs = meta.velocityMs as number | null | undefined;
  const verticalRateMs = meta.verticalRateMs as number | null | undefined;
  const onGround = (meta.onGround as boolean | undefined) ?? false;
  // adsb.lol broadcasts a real ADS-B emitter category for most rows, which
  // lib/planes/classify.ts trusts as a fact; only the altitude/speed/on-ground
  // fallback is actually a guess. Absent (older cached snapshots, or the
  // OpenSky-shaped fallback in lib/sources/opensky.ts) defaults to "not
  // trusted" — the honest assumption when the flag was never set.
  const categoryTrusted = (meta.categoryTrusted as boolean | undefined) ?? false;
  const headingDeg = object.heading ?? 0;

  // Classify climb/descent with a dead-band of ±0.5 m/s
  let climbLabel: React.ReactNode = null;
  let climbColor = "#94a3b8";
  if (verticalRateMs != null) {
    if (verticalRateMs > 0.5) {
      climbLabel = `+${Math.round(verticalRateMs)} m/s`;
      climbColor = "var(--tn-accent)"; // accent for climb
    } else if (verticalRateMs < -0.5) {
      climbLabel = `${Math.round(verticalRateMs)} m/s`;
      climbColor = "var(--tn-plane)"; // amber for descent
    } else {
      climbLabel = "Level";
      climbColor = "var(--tn-text-faint)";
    }
  }

  const mutedColor = "var(--tn-text-faint)";
  const altPrimary = onGround
    ? "On ground"
    : altM < 50
    ? "—"
    : `${Math.round(altM).toLocaleString()} m`;

  const altSecondary =
    !onGround && altM >= 50
      ? `${mToFt(altM).toLocaleString()} ft`
      : undefined;

  return (
    <div
      style={{
        color: "var(--tn-text)",
        fontFamily: "var(--tn-sans)",
      }}
    >
      {/* ── Header ── */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 4,
          }}
        >
          {object.icon ? (
            <TypeIcon icon={object.icon} color={object.color ?? "#f59e0b"} size={20} />
          ) : (
            <span style={{ fontSize: 18, color: "#f59e0b", lineHeight: 1 }}>✈</span>
          )}
          <span
            style={{
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "0.06em",
              color: "var(--tn-text)",
            }}
          >
            {callsign}
          </span>
          {object.typeLabel && (
            <span
              title={
                categoryTrusted
                  ? "Type from the aircraft's own broadcast category"
                  : "Type estimated from the live flight profile"
              }
              style={{
                background: "var(--tn-chip-bg)",
                color: object.color ?? "#b45309",
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 4,
                fontWeight: 600,
                letterSpacing: "0.04em",
              }}
            >
              {object.typeLabel}
              {!categoryTrusted && " · est."}
            </span>
          )}
          {onGround && (
            <span
              style={{
                background: "var(--tn-chip-bg)",
                color: "var(--tn-text-muted)",
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 4,
                fontWeight: 600,
                letterSpacing: "0.05em",
              }}
            >
              ON GROUND
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: "var(--tn-text-muted)" }}>{country}</div>
      </div>

      {/* ── Stat grid ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}
      >
        <StatCard
          label="Altitude"
          primary={altPrimary}
          secondary={altSecondary}
          primaryColor={onGround || altM < 50 ? mutedColor : "var(--tn-plane)"}
        />

        <StatCard
          label="Ground Speed"
          primary={
            velocityMs != null
              ? `${msToKmh(velocityMs)} km/h`
              : "—"
          }
          secondary={velocityMs != null ? `${msToKnots(velocityMs)} kn` : undefined}
          primaryColor={velocityMs != null ? "var(--tn-plane)" : mutedColor}
        />

        <StatCard
          label="Heading"
          primary={`${Math.round(headingDeg)}°`}
          secondary={headingToCompass(headingDeg)}
        />

        <StatCard
          label="Vertical"
          primary={climbLabel ?? "—"}
          secondary={
            verticalRateMs != null && Math.abs(verticalRateMs) > 0.5
              ? verticalRateMs > 0 ? "Climbing" : "Descending"
              : undefined
          }
          primaryColor={climbColor}
        />
      </div>

      {/* ── Route (adsbdb) ── */}
      {route && (route.origin || route.destination) && (
        <div
          style={{
            marginTop: 12,
            background: "var(--tn-surface-2)",
            borderRadius: 8,
            padding: "12px 14px",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "var(--tn-accent)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 8,
              fontWeight: 600,
            }}
          >
            Route{route.airline ? ` · ${route.airline}` : ""}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Endpoint port={route.origin} fallback="—" />
            <span style={{ color: "var(--tn-text-faint)", fontSize: 16 }}>→</span>
            <Endpoint port={route.destination} fallback="—" align="right" />
          </div>
        </div>
      )}

      {/* ── Aircraft (adsbdb) ── */}
      {(airframe || registration || aircraft?.owner) && (
        <div style={{ marginTop: 10, fontSize: 13, color: "var(--tn-text-muted)", lineHeight: 1.5 }}>
          {airframe && (
            <div>
              <span style={{ color: "var(--tn-text)", fontWeight: 600 }}>{airframe}</span>
              {registration ? <span style={{ color: "var(--tn-text-faint)" }}> · {registration}</span> : null}
            </div>
          )}
          {!airframe && registration && (
            <div style={{ color: "var(--tn-text)", fontWeight: 600 }}>{registration}</div>
          )}
          {aircraft?.owner && <div style={{ color: "var(--tn-text-faint)" }}>{aircraft.owner}</div>}
        </div>
      )}

      {/* ── Source (clickable upstream) ── */}
      <div style={{ marginTop: 14, borderTop: "1px solid var(--tn-border)", paddingTop: 10 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--tn-accent)",
            marginBottom: 6,
          }}
        >
          Source
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <a
            href={hex && hex !== "unknown" ? `https://globe.adsb.lol/?icao=${encodeURIComponent(hex)}` : "https://adsb.lol/"}
            target="_blank"
            rel="noreferrer noopener"
            style={sourceLinkStyle}
          >
            {hex && hex !== "unknown" ? "Track on adsb.lol" : "adsb.lol"} ↗
          </a>
          {(route || aircraft) && (
            <a href="https://www.adsbdb.com/" target="_blank" rel="noreferrer noopener" style={sourceLinkStyle}>
              adsbdb ↗
            </a>
          )}
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--tn-text-faint)", lineHeight: 1.5 }}>
          Live ADS-B position © adsb.lol{route || aircraft ? " · route / airframe © adsbdb.com" : ""}
        </div>
      </div>
    </div>
  );
}

const sourceLinkStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--tn-accent-strong)",
  textDecoration: "none",
  border: "1px solid var(--tn-border)",
  borderRadius: 999,
  padding: "3px 10px",
  whiteSpace: "nowrap",
};
