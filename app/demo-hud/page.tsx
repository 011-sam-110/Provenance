"use client";
// /demo-hud — the HUD feature demo, following the standalone-page pattern of
// /locate: a full-viewport client page that mounts the REAL WorldMap (read-only —
// the HUD only reads the map camera, it never steers it) and overlays the HUD
// with the three variant options. The HUD itself is also mounted in the console
// (components/console/StageHost.tsx) and toggled from the Map settings page; this
// page is the isolated playground for it.
//
// THE 'H' HOTKEY LIVES HERE, AND ONLY HERE. The listener is bound for the life of
// this page component, so the demo-page scope is structural: the console's own
// keymap (lib/shell/...) is not touched and 'H' means nothing on /app.

import dynamic from "next/dynamic";
import { useEffect } from "react";
import Hud from "@/components/hud/Hud";
import styles from "@/components/hud/hud.module.css";
import { hudStore, useHudPrefs } from "@/lib/hud/store";
import { viewModeStore } from "@/lib/shell/viewMode";
import { HUD_HOTKEY, HUD_VARIANTS, VARIANT_LABEL } from "@/lib/hud/model";

const WorldMap = dynamic(() => import("@/components/WorldMap"), {
  ssr: false,
  loading: () => <div className={styles.demoLoading}>Loading map…</div>,
});

export default function DemoHudPage() {
  const prefs = useHudPrefs();

  useEffect(() => {
    // The globe is the demo's stage, matching how /app opens.
    viewModeStore.set("explore");

    // 'H' toggles the HUD — demo-page scope only (this component's lifetime).
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === HUD_HOTKEY.toLowerCase() && !e.ctrlKey && !e.metaKey && !e.altKey) {
        hudStore.setEnabled(!hudStore.get().enabled);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className={styles.demo}>
      <div className={styles.demoMap}>
        <WorldMap />
      </div>

      <Hud />

      <div className={styles.demoVariants} role="radiogroup" aria-label="HUD variant">
        {HUD_VARIANTS.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={prefs.variant === v}
            data-tn-variant={v}
            className={prefs.variant === v ? `${styles.demoVariantBtn} ${styles.demoVariantOn}` : styles.demoVariantBtn}
            onClick={() => hudStore.setVariant(v)}
          >
            {VARIANT_LABEL[v]}
          </button>
        ))}
      </div>

      <p className={styles.demoHint}>
        Press <kbd>{HUD_HOTKEY}</kbd> to toggle the HUD · drag the globe and the readout follows
      </p>
    </main>
  );
}
