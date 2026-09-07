// Lightweight i18n seam for the UI chrome — a typed string catalog, no heavy dep.
//
// worldmonitor.app ships ~24 languages. This is an honest SEAM, not full coverage:
// a REPRESENTATIVE set of chrome strings (status-bar metrics, section titles,
// buttons) is translated into English + Spanish + French to prove the wiring is
// real and extensible. Untranslated UI stays English until more keys are added.
//
// Completeness is enforced two ways: `es`/`fr` are typed `Record<StringKey,string>`
// (so tsc fails if a key is missing or misspelled), and a unit test re-checks at
// runtime. translate() always falls back to English, then to the raw key.

export type Lang = "en" | "es" | "fr";

/** Selectable languages (code + short switcher label + endonym). */
export const LANGS: { code: Lang; label: string; name: string }[] = [
  { code: "en", label: "EN", name: "English" },
  { code: "es", label: "ES", name: "Español" },
  { code: "fr", label: "FR", name: "Français" },
];

export const DEFAULT_LANG: Lang = "en";

// English is the source of truth; its keys define the StringKey union.
const en = {
  appTagline: "travel the planet, live",
  metricCamerasOnline: "cameras online",
  metricPlanes: "planes",
  metricSatellites: "satellites",
  healthLive: "Live",
  healthDegraded: "Degraded",
  healthConnecting: "Connecting",
  healthLagging: "Lagging",
  btnShare: "Share",
  btnCopied: "Copied",
  railLayers: "Layers",
  sectionPresets: "Presets",
  presetsCoreLayers: "Core layers",
  sectionGlobalSignals: "Global signals",
  sectionSaved: "Saved places",
  btnSaveCurrentView: "Save current view",
  btnCoverage: "Coverage details — live counts per source",
  btnMarkets: "Markets — live crypto prices",
  palettePlaceholder: "Search layers, presets, basemaps, regions…",
  emptyWatchlist: "No saved places yet. Compose a view and save it.",
} as const;

export type StringKey = keyof typeof en;

const es: Record<StringKey, string> = {
  appTagline: "viaja por el planeta, en vivo",
  metricCamerasOnline: "cámaras en línea",
  metricPlanes: "aviones",
  metricSatellites: "satélites",
  healthLive: "En vivo",
  healthDegraded: "Degradado",
  healthConnecting: "Conectando",
  healthLagging: "Retrasado",
  btnShare: "Compartir",
  btnCopied: "Copiado",
  railLayers: "Capas",
  sectionPresets: "Preajustes",
  presetsCoreLayers: "Capas principales",
  sectionGlobalSignals: "Señales globales",
  sectionSaved: "Lugares guardados",
  btnSaveCurrentView: "Guardar vista actual",
  btnCoverage: "Detalles de cobertura — recuentos en vivo por fuente",
  btnMarkets: "Mercados — precios cripto en vivo",
  palettePlaceholder: "Buscar capas, ajustes, mapas base, regiones…",
  emptyWatchlist: "Aún no hay lugares guardados. Compón una vista y guárdala.",
};

const fr: Record<StringKey, string> = {
  appTagline: "parcourez la planète, en direct",
  metricCamerasOnline: "caméras en ligne",
  metricPlanes: "avions",
  metricSatellites: "satellites",
  healthLive: "En direct",
  healthDegraded: "Dégradé",
  healthConnecting: "Connexion",
  healthLagging: "En retard",
  btnShare: "Partager",
  btnCopied: "Copié",
  railLayers: "Couches",
  sectionPresets: "Préréglages",
  presetsCoreLayers: "Calques principaux",
  sectionGlobalSignals: "Signaux mondiaux",
  sectionSaved: "Lieux enregistrés",
  btnSaveCurrentView: "Enregistrer la vue actuelle",
  btnCoverage: "Détails de couverture — comptes en direct par source",
  btnMarkets: "Marchés — prix crypto en direct",
  palettePlaceholder: "Rechercher couches, préréglages, fonds de carte, régions…",
  emptyWatchlist: "Aucun lieu enregistré. Composez une vue et enregistrez-la.",
};

/** The full catalog, keyed by language. */
export const CATALOG: Record<Lang, Record<StringKey, string>> = { en, es, fr };

/** Pure lookup with English → raw-key fallback. Safe for any (untrusted) lang/key. */
export function translate(lang: Lang, key: StringKey): string {
  return CATALOG[lang]?.[key] ?? CATALOG.en[key] ?? key;
}
