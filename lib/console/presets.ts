"use client";
import { createDefaultLayout, type ShellLayout, type SegmentId } from "@/lib/console/types";
import { addWidget, seedRectsFromSegments, setStage } from "@/lib/console/reducers";
import { shellLayoutStore } from "@/lib/console/store";
import { layersStore } from "@/lib/layers";
import { signalsStore } from "@/lib/signals/store";
import { layersForLayout } from "@/lib/console/presetLayers";
import { activePresetStore } from "@/lib/console/activePreset";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";

// A preset is a persona: a curated workspace aimed at ONE kind of user. `blurb` is the
// short "who it's for" tag surfaced next to the title in the ⌘K Profiles section, so the
// list reads as an audience menu rather than a pile of domains.
export interface ConsolePreset {
  id: string;
  title: string;
  icon: string;
  blurb: string;
  build(): ShellLayout;
}

/** The board a fresh visitor lands on (ConsoleShell first-run seed + "Reset to default"). */
export const DEFAULT_PRESET_ID = "overview";

let seed = 0;
const id = () => `p${(seed += 1).toString(36)}`;
function compose(stage: ShellLayout["stage"], specs: { type: string; segment: SegmentId }[]): ShellLayout {
  let l = setStage(createDefaultLayout(), stage);
  for (const s of specs) l = addWidget(l, s.type, id(), { segment: s.segment });
  // addWidget packs each card into the first cell it fits, which is right for a
  // card the USER adds but loses the left/right/bottom intent these specs are
  // written in. Seeding from the segments at the end is what makes a preset's
  // authored shape the shape it renders as.
  return seedRectsFromSegments(l);
}

// FIVE broad boards — deliberately few. Each drops a curated set of widgets across the
// left / right / bottom segments; the *union* of the five touches every widget group (all
// seven core cards + every signal group), so the lineup exercises the whole catalogue while
// staying scannable in the central navbar pill. Widget `type`s are registered widget ids:
// core cards (events, cameras, aviation, satellites, markets, headlines, news) and per-signal
// cards (`signal:<sourceId>`). Switching a board re-skins BOTH the widgets and the map
// overlays via applyPreset → layersForLayout.
export const BUILTIN_PRESETS: ConsolePreset[] = [
  // ── World Overview — the calm landing board (a bit of everything) ────────
  { id: "overview", title: "World Overview", icon: "🌐", blurb: "a bit of everything", build: () => compose("map2d", [
      { type: "anomaly", segment: "left" }, { type: "signal:instability", segment: "left" }, { type: "events", segment: "left" }, { type: "signal:gdacs", segment: "left" },
      { type: "cameras", segment: "right" }, { type: "markets", segment: "right" }, { type: "locate", segment: "right" },
      { type: "headlines", segment: "bottom" },
  ]) },

  // ── Situation Room — conflict, intel & the human cost ───────────────────
  { id: "situation", title: "Situation Room", icon: "🎯", blurb: "conflict & intel", build: () => compose("map2d", [
      { type: "signal:instability", segment: "left" }, { type: "signal:conflict", segment: "left" }, { type: "signal:military-air", segment: "left" },
      { type: "signal:acled", segment: "right" }, { type: "signal:protests", segment: "right" }, { type: "signal:displacement", segment: "right" },
      { type: "news", segment: "bottom" },
  ]) },

  // ── Earth Systems — hazards, weather & climate ──────────────────────────
  { id: "earth", title: "Earth Systems", icon: "🌍", blurb: "hazards & climate", build: () => compose("map2d", [
      { type: "signal:gdacs", segment: "left" }, { type: "signal:earthquakes", segment: "left" }, { type: "signal:weather", segment: "left" },
      { type: "signal:wildfires", segment: "right" }, { type: "signal:floods", segment: "right" }, { type: "signal:airquality", segment: "right" },
      { type: "signal:tropical-cyclones", segment: "bottom" },
  ]) },

  // ── Air · Sea · Space — mobility & orbital (globe stage) ────────────────
  { id: "mobility", title: "Air · Sea · Space", icon: "🛰", blurb: "mobility & orbital", build: () => compose("map3d", [
      { type: "aviation", segment: "left" }, { type: "satellites", segment: "left" }, { type: "signal:launches", segment: "left" }, { type: "signal:cables", segment: "left" },
      { type: "signal:ais", segment: "right" }, { type: "signal:ports", segment: "right" }, { type: "signal:aurora", segment: "right" },
  ]) },

  // ── Markets & Cyber — economy & security ────────────────────────────────
  { id: "markets", title: "Markets & Cyber", icon: "📈", blurb: "economy & security", build: () => compose("map2d", [
      { type: "markets", segment: "left" }, { type: "headlines", segment: "left" }, { type: "signal:internet-outages", segment: "left" },
      { type: "signal:cyber-c2", segment: "right" }, { type: "signal:cyber-ransomware", segment: "right" }, { type: "signal:grid-load", segment: "right" },
  ]) },

  // ── Tools — passive OSINT recon (domain & IP intel), over a live cyber backdrop ──
  { id: "tools", title: "Tools", icon: "🔎", blurb: "domain & IP intel", build: () => compose("map2d", [
      { type: "recon:dns", segment: "left" }, { type: "recon:whois", segment: "left" }, { type: "recon:certs", segment: "left" },
      { type: "recon:ports", segment: "right" }, { type: "recon:threat", segment: "right" }, { type: "recon:bgp", segment: "right" },
      { type: "signal:cyber-ransomware", segment: "right" }, { type: "signal:internet-outages", segment: "right" },
      { type: "signal:cyber-c2", segment: "bottom" },
  ]) },
];

const KEY = "tn.console.presets.v1";
const VERSION = 1;
interface CustomPreset { id: string; title: string; layout: ShellLayout }

function loadCustom(): CustomPreset[] { return loadPersisted<CustomPreset[]>(KEY, VERSION) ?? []; }

export function applyPreset(presetId: string): void {
  const built = BUILTIN_PRESETS.find((p) => p.id === presetId);
  const layout = built ? built.build() : loadCustom().find((p) => p.id === presetId)?.layout;
  if (!layout) return;
  shellLayoutStore.replace(layout);
  // Drive the globe to match the board: the persona's widgets decide which core +
  // signal layers are lit, so switching persona actually re-skins the map (not just
  // the side rail). See lib/console/presetLayers.ts.
  const { core, signals } = layersForLayout(layout);
  layersStore.applyExact(core);
  signalsStore.applyExact(signals);
  // Record which board is now live so the central pill / Settings list reflect it.
  activePresetStore.set(presetId);
}

export function saveCustomPreset(title: string): void {
  const list = loadCustom();
  list.push({ id: `custom-${Date.now().toString(36)}`, title, layout: shellLayoutStore.get() });
  savePersisted(KEY, VERSION, list);
}

export function listPresets(): { id: string; title: string; icon: string; blurb: string }[] {
  return [...BUILTIN_PRESETS.map((p) => ({ id: p.id, title: p.title, icon: p.icon, blurb: p.blurb })),
          ...loadCustom().map((p) => ({ id: p.id, title: p.title, icon: "★", blurb: "saved" }))];
}
