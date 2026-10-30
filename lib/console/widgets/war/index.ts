// lib/console/widgets/war/index.ts
// The war sources' own widget bodies. Each source's file may export `Card` (the body of
// the card that the rail's + places) and `Detail` (its expanded view). Either left
// undefined falls back to the generic signal card or expanded view, so a source works
// before its own widget exists. Read by signals.tsx and signals.detail.tsx.
import type { ComponentType } from "react";
import type { WidgetBodyProps, WidgetDetailProps } from "@/lib/console/registry";
import * as frontlineChanges from "./frontline-changes";
import * as forcesNearNato from "./forces-near-nato";
import * as lossesRu from "./losses-ru";
import * as lossesUa from "./losses-ua";
import * as warNews from "./war-news";
import * as warZones from "./war-zones";

export interface WarWidget {
  Card?: ComponentType<WidgetBodyProps>;
  Detail?: ComponentType<WidgetDetailProps>;
}

export const WAR_WIDGETS: Readonly<Record<string, WarWidget>> = {
  "war-zones": warZones,
  "frontline-changes": frontlineChanges,
  "losses-ru": lossesRu,
  "losses-ua": lossesUa,
  "forces-near-nato": forcesNearNato,
  "war-news": warNews,
};
