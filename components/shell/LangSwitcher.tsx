"use client";
// Compact UI-language switcher for the top status bar — mirrors the basemap
// segmented control. Drives langStore; every chrome string routed through
// useT()/t() re-renders in the chosen language. English is the source of truth,
// so any not-yet-translated key falls back to English (never a raw key in practice).

import { LANGS } from "@/lib/i18n/catalog";
import { useLang, useT, langStore } from "@/lib/i18n/store";

export default function LangSwitcher() {
  const lang = useLang();
  const t = useT();
  return (
    <div className="tn-lang" role="group" aria-label="Interface language" title={t("langScopeNote")}>
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          className="tn-lang-btn"
          aria-pressed={lang === l.code}
          title={l.name}
          onClick={() => langStore.set(l.code)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
