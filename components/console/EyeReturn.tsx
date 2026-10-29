"use client";
// The way back to God's eye view, for a console opened from its Sources link. A PLAIN
// <a> and a full page load, never next/link: /eye sets its own layers in memory, and
// every way in must start it from a fresh module state (EyeApp.tsx, CameraDetail.tsx).
// Top left of the map, mirroring the mark legend; below the HUD readout when it is on.

import { useLayoutEffect, useRef } from "react";
import { EYE_RETURN_LABEL, eyeReturnHint, eyeReturnName, useEyeReturn } from "@/lib/console/eyeReturn";
import { useHudPrefs } from "@/lib/hud/store";

export default function EyeReturn() {
  const back = useEyeReturn();
  const hud = useHudPrefs();
  const ref = useRef<HTMLAnchorElement>(null);

  useLayoutEffect(() => {
    const a = ref.current;
    if (!a) return;
    const hudEl = a.closest(".tn-cw-stage")?.querySelector<HTMLElement>("[data-tn-hud]") ?? null;
    const place = () => {
      if (hudEl) {
        a.style.setProperty("--tn-eye-return-top", `${hudEl.offsetTop + hudEl.offsetHeight + 8}px`);
        a.style.setProperty("--tn-eye-return-left", `${hudEl.offsetLeft}px`);
      } else {
        a.style.removeProperty("--tn-eye-return-top");
        a.style.removeProperty("--tn-eye-return-left");
      }
    };
    place();
    if (!hudEl) return;
    const ro = new ResizeObserver(place);
    ro.observe(hudEl);
    return () => ro.disconnect();
  }, [back, hud.enabled, hud.variant]);

  if (!back) return null;
  return (
    <a ref={ref} className="tn-eye-return" href={back.href} aria-label={eyeReturnName(back)}>
      <span className="tn-eye-return-arrow" aria-hidden="true">←</span>
      <span className="tn-eye-return-text">
        <span className="tn-eye-return-label">{EYE_RETURN_LABEL}</span>
        <span className="tn-eye-return-where">{eyeReturnHint(back)}</span>
      </span>
    </a>
  );
}
