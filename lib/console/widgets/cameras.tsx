"use client";
/**
 * Cameras widget — shows a live thumbnail grid of the cameras currently
 * loaded on the map and alerts on any that go offline.
 *
 * Field-mapping notes (real LoadedCamera shape vs brief assumed fields):
 * - LoadedCamera: { id, name, lat, lon, available, live }
 * - `available` is a REAL field → CameraLite.available = c.available (direct).
 * - `attribution` is NOT a field → falls back to "".
 * - `license` is NOT a field → falls back to "".
 * - `refreshSeconds` is NOT a field → falls back to 30.
 * - loadedCamerasStore now has subscribe(); we use useSyncExternalStore so the
 *   widget rerenders whenever WorldMap publishes cameras (instead of reading once
 *   on mount and showing an empty grid forever if it mounts first).
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { loadedCamerasStore } from "@/lib/cameras/loaded";
import { useFreshness } from "@/lib/freshness";
import { observeCoreSource } from "@/lib/console/freshChip";
import { CameraVideo } from "@/components/CameraVideo";
import { CameraImage } from "@/components/CameraImage";
import { registerWidget, type WidgetBodyProps } from "@/lib/console/registry";
import { useWidgetReport } from "@/components/console/WidgetFrame";
import { runAlertRule } from "@/lib/console/alerts";
import { cameraAlerts, type CameraLite } from "@/lib/console/widgets/cameras.rules";
import CamerasDetail from "./cameras.detail";

function CamerasBody({ config }: WidgetBodyProps) {
  // Reactive: rerenders whenever WorldMap calls loadedCamerasStore.set().
  const cams = useSyncExternalStore(loadedCamerasStore.subscribe, loadedCamerasStore.get, loadedCamerasStore.get);

  // Map to CameraLite for the alert rule.
  // available is a real field on LoadedCamera; attribution/license/refreshSeconds are not.
  const lite: CameraLite[] = useMemo(
    () => cams.map((c) => ({ id: c.id, name: c.name, available: c.available })),
    [cams],
  );

  // Real freshness, not a hardcoded word: WorldMap's camera loader already records
  // every success/failure into freshnessStore, so the chip ages honestly when the
  // upstream stops answering.
  const fresh = useFreshness().find((r) => r.id === "cameras");

  const report = useWidgetReport();
  useEffect(() => {
    report({
      alerts: runAlertRule(cameraAlerts, lite, config),
      count: cams.length,
      fresh: observeCoreSource(fresh),
    });
  }, [lite, report, config, fresh]);

  return (
    <div className="tn-cam-grid">
      {cams.length === 0 && <p className="tn-cam-empty">No cameras loaded yet…</p>}
      {cams.slice(0, 6).map((c) => (
        <div key={c.id} className="tn-cam-cell">
          {/* `live` decides the player, exactly as the focus view already did.
              The grid used CameraVideo for EVERY camera, so every still-image
              camera fired /api/hls and took a 403 back — the proxy's allowlist
              covers only the two genuine HLS networks, and a TfL JamCam is an MP4
              clip on a host that is not on it. Six failed requests per board load,
              and six cells that showed nothing while the camera was fine. */}
          {c.live ? (
            <CameraVideo id={c.id} alt={c.name} attribution="" license="" refreshSeconds={30} />
          ) : (
            <CameraImage id={c.id} alt={c.name} attribution="" license="" refreshSeconds={30} />
          )}
          <span className="tn-cam-label">{c.name}</span>
        </div>
      ))}
    </div>
  );
}

export const CAMERAS_WIDGET = {
  id: "cameras",
  title: "Cameras",
  icon: "📷",
  category: "Cameras",
  defaultHeight: 260,
  defaultConfig: {},
  component: CamerasBody,
  detail: CamerasDetail,
  help: {
    what: "A thumbnail grid of the public road cameras the map has loaded — a look at conditions on the ground, with any feed the operator marks unavailable flagged as offline.",
    source: "11 public transport-agency camera feeds across 7 countries (keyless)",
  },
  capabilities: { filter: true, sort: true },
};
registerWidget(CAMERAS_WIDGET);
