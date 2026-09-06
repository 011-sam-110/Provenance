"use client";
import { useEffect, useMemo } from "react";
import { usePlanes } from "@/lib/planes/usePlanes";
import { registerWidget, type WidgetBodyProps } from "@/lib/console/registry";
import { useWidgetReport } from "@/components/console/WidgetFrame";
import { runAlertRule } from "@/lib/console/alerts";
import { aviationAlerts, type PlaneLite } from "@/lib/console/widgets/aviation.rules";
import { isBizjet } from "@/lib/planes/bizjet";
import { useFreshness } from "@/lib/freshness";
import { observeCoreSource } from "@/lib/console/freshChip";
import AviationDetail from "./aviation.detail";

/**
 * Aviation widget body.
 *
 * Field-mapping notes (real usePlanes() shape vs brief's assumed fields):
 * - usePlanes() returns PlanesLayer { objects: WorldObject[], trails: PlaneTrail[] }
 *   → we use .objects (not the top-level array the brief assumed).
 * - WorldObject.label  → callsign (lib/sources/adsb.ts sets label = the row's own
 *   `flight` callsign, falling back to its `hex` ICAO24 address when there is no
 *   callsign; opensky.ts's own version of this mapping is retained only as the
 *   shared type-shape contract — see that module's docblock — it is not live)
 * - WorldObject.altKm  → altitude in km (NOT feet; brief used p.altitude)
 * - WorldObject.typeLabel → human type ("Airliner", "Regional / jet", etc.)
 * - squawk            — lib/sources/adsb.ts reads the row's own `squawk` field
 *   directly and carries it on meta.squawk (opensky.ts's parseStates()/
 *   planeToWorldObject() defined this meta shape originally and are kept only as
 *   that contract, not as a live path), so the emergency-squawk alerts are LIVE:
 *   a plane squawking 7500/7600/7700 raises a critical alert.
 * - NO isMilitary     — classifyPlane() has no military category; military traffic
 *   comes from the separate military-air signal layer, not this civil feed.
 * - NO origin/destination — not present in the WorldObject schema (the dossier
 *   enriches those on demand from /api/flight by callsign+hex).
 */
function AviationBody({ config }: WidgetBodyProps) {
  const layer = usePlanes();
  const planes = layer.objects;

  // Map to PlaneLite for alert rules. squawk is threaded from meta so emergency-squawk
  // alerts fire; isBizjet/onGround feed the private-jet surge rule; isMilitary stays
  // unavailable (see notes above).
  const lite: PlaneLite[] = useMemo(
    () => planes.map((p) => ({
      callsign: p.label,
      squawk: (p.meta?.squawk as string) || undefined,
      isBizjet: isBizjet((p.meta?.typeCode as string) || undefined),
      onGround: Boolean(p.meta?.onGround),
    })),
    [planes],
  );

  const sortKey = (config.sort as string) ?? "alt";
  const rows = useMemo(() => {
    const r = [...planes];
    r.sort((a, b) =>
      sortKey === "alt"
        ? (b.altKm ?? 0) - (a.altKm ?? 0)
        : a.label.localeCompare(b.label),
    );
    return r.slice(0, 200);
  }, [planes, sortKey]);

  // The freshness chip's expected cadence for "planes" is 12s — this widget's own
  // POLL_INTERVAL_MS in lib/planes/usePlanes.ts, mirrored in lib/freshness.ts's
  // seed() and lib/sources/catalog.ts's "planes" entry. That is NOT an upstream
  // cadence, and it is not OpenSky's — opensky.ts no longer contacts OpenSky at
  // all; the sole source is adsb.lol's type pull (lib/sources/adsb.ts). It also
  // only catches a poll that stops SUCCEEDING (e.g. /api/planes starts erroring),
  // within ~24-72s of that happening. It does NOT catch a poll that keeps
  // returning 200 with an unchanged snapshot: the pull is cached for the whole
  // deployment and revalidated at most every REVALIDATE_S=240s (4 min, see
  // opensky.ts), so up to ~4 minutes of real staleness can hide behind an
  // unbroken "live" chip.
  const fresh = useFreshness().find((r) => r.id === "planes");

  const report = useWidgetReport();
  useEffect(() => {
    report({
      alerts: runAlertRule(aviationAlerts, lite, config),
      count: planes.length,
      fresh: observeCoreSource(fresh),
    });
  }, [lite, planes.length, report, config, fresh]);

  return (
    <table className="tn-w-table">
      <tbody>
        {rows.map((p) => (
          <tr key={p.id}>
            <td className="tn-w-strong">{p.label}</td>
            <td className="tn-w-muted">{p.typeLabel ?? ""}</td>
            <td className="tn-w-num">
              {p.altKm != null ? `${p.altKm.toFixed(1)} km` : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const AVIATION_WIDGET = {
  id: "aviation",
  title: "Aviation",
  icon: "✈",
  category: "Aviation",
  defaultHeight: 280,
  defaultConfig: { sort: "alt" },
  component: AviationBody,
  detail: AviationDetail,
  // NOTE: this used to promise "military types … are flagged". It never happened —
  // the PlaneLite mapping above sets no isMilitary because this general planes feed
  // (adsb.lol's type pull via lib/sources/adsb.ts, formerly OpenSky) carries no
  // military classification and does not ask for military types; military traffic
  // is a separate adsb.lol feed (lib/signals/military-air.ts), not this one. The ?
  // note now says where military traffic actually lives.
  help: {
    what: "Aircraft airborne right now, from open ADS-B, listed by altitude. An emergency squawk (7500/7600/7700) raises a critical alert; military traffic is its own signal layer, not this one.",
    source: "adsb.lol community ADS-B receivers, pulled worldwide by aircraft type (keyless)",
  },
  capabilities: { filter: true, sort: true },
};
registerWidget(AVIATION_WIDGET);
