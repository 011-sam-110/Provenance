"use client";
// The row "Open this spot elsewhere" in a detail panel: the same coordinates in five
// outside tools, and a button that copies them. Links only. Nothing is embedded and
// nothing is requested from those services until the reader clicks.
//
// All the logic is in lib/map/elsewhere.ts (pure, unit-tested). This file only draws
// it, in the same pill style as the panel's Source row.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { coordsText, elsewhereLinks, SPOT_WORDING, type SpotKind } from "@/lib/map/elsewhere";

const pill: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--tn-accent-strong)",
  textDecoration: "none",
  border: "1px solid var(--tn-border)",
  borderRadius: 999,
  padding: "3px 10px",
  whiteSpace: "nowrap",
};

/** Copy with the Clipboard API, else with a selected textarea. True when it worked. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused (permission, an insecure origin). Try the older way below.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export default function SpotElsewhere({ lat, lon, kind }: { lat: number; lon: number; kind: SpotKind }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const links = elsewhereLinks(lat, lon, kind);
  const text = coordsText(lat, lon);
  // Not a coordinate: no row. A link to nowhere is worse than no link.
  if (links.length === 0 || !text) return null;
  const wording = SPOT_WORDING[kind];

  const onCopy = async () => {
    const ok = await copyText(text);
    setCopied(ok ? "done" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied("idle"), 1800);
  };

  return (
    <div style={{ marginTop: 14 }} data-testid="spot-elsewhere" data-spot-kind={kind}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--tn-accent)",
          marginBottom: 6,
        }}
      >
        {wording.heading}
      </div>
      {wording.note && (
        <div
          data-testid="spot-elsewhere-note"
          style={{ fontSize: 12, lineHeight: 1.4, color: "var(--tn-text-muted)", marginBottom: 8 }}
        >
          {wording.note}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {links.map((l) => (
          <a key={l.label} href={l.href} target="_blank" rel="noreferrer noopener" title={l.hint} style={pill}>
            {l.label} ↗
          </a>
        ))}
        <button
          type="button"
          onClick={onCopy}
          data-testid="spot-elsewhere-copy"
          title={text}
          style={{
            ...pill,
            fontFamily: "inherit",
            lineHeight: "inherit",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          <span aria-live="polite">
            {copied === "done" ? `Copied ${text}` : copied === "failed" ? "Copy failed" : wording.copy}
          </span>
        </button>
      </div>
    </div>
  );
}
