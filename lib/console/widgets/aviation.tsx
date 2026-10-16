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
 * - usePlanes() returns PlanesLayer { objects: WorldObject[], trails: PlaneTrail[], fetchedAt }
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

  // The freshness chip for "planes" reads the age of the DATA since 2026-10-16:
  // WorldMap records it at the snapshot's own `fetchedAt` (the instant the server
  // pulled the positions), not at the moment the 12 s poll returned, and its
  // expected cadence is the 90 s upstream window (lib/freshness.ts seed(),
  // mirrored in lib/sources/catalog.ts). Before that the chip was stamped per
  // poll against a 12 s cadence, so a snapshot four minutes old read "live".
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
    source: "adsb.lol community ADS-B receivers, pulled worldwide by aircraft type, plus adsb.fi over thinly covered cities (keyless)",
  },
  capabilities: { filter: true, sort: true },
};
registerWidget(AVIATION_WIDGET);
