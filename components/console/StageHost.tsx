"use client";
import dynamic from "next/dynamic";
import { useEffect } from "react";
import type { StageId } from "@/lib/console/types";
import { viewModeStore } from "@/lib/shell/viewMode";
import { useShellLayout } from "@/lib/console/store";
import { getWidgetType } from "@/lib/console/registry";
import WidgetDetail from "@/components/console/WidgetDetail";

// The map is the product's centre stage, so give it a real loading state. It used
// to fall back to `null`, which meant any failure to mount rendered a silent grey
// rectangle — indistinguishable from a working-but-slow map. That is precisely how
// an infinite-render regression (see lib/geolocate/useGeolocate.ts) shipped to
// production unnoticed: the stage was blank with no error and no failed request.
const WorldMap = dynamic(() => import("@/components/WorldMap"), {
  ssr: false,
  loading: () => (
    <div className="tn-stage-loading" role="status" aria-live="polite">
      Loading map…
    </div>
  ),
});

export default function StageHost({ stage }: { stage: StageId }) {
  const { focusedWidgetId, widgets } = useShellLayout();
  // The map reads viewModeStore for its MapLibre projection: 3D=globe(explore), 2D=flat(console).
  useEffect(() => {
    if (stage === "map3d") viewModeStore.set("explore");
    else if (stage === "map2d") viewModeStore.set("console");
  }, [stage]);

  const focused = focusedWidgetId
    ? widgets.find((w) => w.id === focusedWidgetId && getWidgetType(w.type))
    : undefined;
  if (focused) return <WidgetDetail instance={focused} />;
  // The old full-screen "clock" stage is retired (the world clock is an ambient map
  // overlay now); a persisted clock stage falls back to the map.
  return <WorldMap />;
}
