import { beforeEach, describe, expect, it, vi } from "vitest";
import { parkView, resetViewMemory, restoreView, restoredInspector } from "@/lib/console/viewMemory";
import { overlay } from "@/lib/overlay";
import { inspectorRailStore } from "@/lib/console/inspectorRail";
import { railTabStore } from "@/lib/console/railTab";
import { sourcesRailStore } from "@/lib/console/sourcesRail";
import { setMapInstance } from "@/lib/map/instance";
import { bindBeacon } from "@/lib/analytics/track";
import type { WorldObject } from "@/lib/world";

// What each view remembers of the Inspector and the map for this visit. Node
// environment: the stores are plain module state; the map is a stub with the five
// calls viewMemory makes.

const camera: WorldObject = {
  kind: "camera",
  id: "tfl:JamCams_00001.07450",
  lat: 51.5174,
  lon: -0.2126,
  label: "A40 Westway/Woodger Rd",
};

function fakeMap(at: { lng: number; lat: number; zoom: number; bearing: number; pitch: number }) {
  const jumpTo = vi.fn();
  const map = {
    getCenter: () => ({ lng: at.lng, lat: at.lat }),
    getZoom: () => at.zoom,
    getBearing: () => at.bearing,
    getPitch: () => at.pitch,
    jumpTo,
  };
  return { map: map as unknown as import("maplibre-gl").Map, jumpTo };
}

beforeEach(() => {
  resetViewMemory();
  setMapInstance(null);
  bindBeacon(null);
  overlay.restore(null);
  inspectorRailStore.close();
  railTabStore.set("sources");
  sourcesRailStore.setOpen(false);
});

describe("restoredInspector", () => {
  it("gives a view that was never visited the fresh Inspector", () => {
    expect(restoredInspector(undefined)).toEqual({ object: null, tool: null, tab: "sources" });
  });

  it("gives back what was parked", () => {
    expect(
      restoredInspector({ object: camera, tool: "settings", tab: "inspector", camera: null }),
    ).toEqual({ object: camera, tool: "settings", tab: "inspector" });
  });
});

describe("overlay.restore", () => {
  it("puts the selection back and wakes subscribers", () => {
    const seen = vi.fn();
    const off = overlay.subscribe(seen);
    overlay.restore(camera);
    off();
    expect(overlay.get().object).toBe(camera);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("sends no analytics event: a restore is not the person opening anything", () => {
    const capture = vi.fn();
    bindBeacon({ capture });
    overlay.restore(camera);
    expect(capture).not.toHaveBeenCalled();
    overlay.open(camera); // and open() still does, so the spy is live
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("does not flip the rail tab, open the rail or close a tool", () => {
    railTabStore.set("sources");
    sourcesRailStore.setOpen(false);
    inspectorRailStore.open("settings");
    overlay.restore(camera);
    expect(railTabStore.get().tab).toBe("sources");
    expect(sourcesRailStore.get().open).toBe(false);
    expect(inspectorRailStore.get()).toBe("settings");
  });
});

describe("parkView / restoreView", () => {
  it("brings back the item, tool, tab and map position the view was left with", () => {
    const a = fakeMap({ lng: -0.12, lat: 51.5, zoom: 11, bearing: 20, pitch: 45 });
    setMapInstance(a.map);
    overlay.restore(camera);
    inspectorRailStore.open("settings");
    railTabStore.set("inspector");
    parkView("streets");

    // The person goes to another view, which looks at something else.
    overlay.restore(null);
    inspectorRailStore.close();
    railTabStore.set("sources");

    restoreView("streets");
    expect(overlay.get().object).toBe(camera);
    expect(inspectorRailStore.get()).toBe("settings");
    expect(railTabStore.get().tab).toBe("inspector");
    expect(a.jumpTo).toHaveBeenCalledWith({ center: [-0.12, 51.5], zoom: 11, bearing: 20, pitch: 45 });
  });

  it("each view keeps its own state", () => {
    overlay.restore(camera);
    railTabStore.set("inspector");
    parkView("streets");
    overlay.restore(null);
    railTabStore.set("sources");
    inspectorRailStore.open("draw");
    parkView("overview");

    restoreView("streets");
    expect(overlay.get().object).toBe(camera);
    expect(inspectorRailStore.get()).toBeNull();
    restoreView("overview");
    expect(overlay.get().object).toBeNull();
    expect(inspectorRailStore.get()).toBe("draw");
    expect(railTabStore.get().tab).toBe("sources");
  });

  it("a view never visited opens with nothing selected and leaves the map alone", () => {
    const a = fakeMap({ lng: 0, lat: 0, zoom: 2, bearing: 0, pitch: 0 });
    setMapInstance(a.map);
    overlay.restore(camera);
    inspectorRailStore.open("alerts");
    railTabStore.set("inspector");
    restoreView("news");
    expect(overlay.get().object).toBeNull();
    expect(inspectorRailStore.get()).toBeNull();
    expect(railTabStore.get().tab).toBe("sources");
    expect(a.jumpTo).not.toHaveBeenCalled();
  });

  it("a view parked with no map has no camera to jump to", () => {
    parkView("streets");
    const a = fakeMap({ lng: 1, lat: 1, zoom: 5, bearing: 0, pitch: 0 });
    setMapInstance(a.map);
    restoreView("streets");
    expect(a.jumpTo).not.toHaveBeenCalled();
  });

  it("restoring sends no analytics event", () => {
    overlay.restore(camera);
    parkView("streets");
    const capture = vi.fn();
    bindBeacon({ capture });
    restoreView("streets");
    expect(capture).not.toHaveBeenCalled();
  });
});
