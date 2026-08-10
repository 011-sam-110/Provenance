// Dynamic Open Graph card (1200x630) rendered on demand with next/og. This is what
// a pasted deep link unfurls into on Bluesky / Slack / iMessage / X, and what the
// future auto-poster attaches to an event. Purely presentational: the title (t),
// subtitle (s) and accent (c) are computed upstream by lib/share/shareMeta (unit-
// tested) or passed explicitly by a caller; this file only draws them, so there is
// no data logic to test here. Satori (next/og) only supports flexbox, so every
// container with >1 child sets display:flex.

import { ImageResponse } from "next/og";
import type { ReactElement } from "react";
import { BRAND, siteUrl } from "@/lib/brand";

export const runtime = "nodejs";

const WIDTH = 1200;
const HEIGHT = 630;
// Identical params always render the identical card and the route is CPU-heavy
// (Satori + rasterise), so cache hard: stops load amplification via varied t/s/c and
// lets the CDN serve crawlers instantly.
const CACHE = "public, max-age=86400, s-maxage=604800";

/** Code-point-aware clamp so truncating never splits an emoji / surrogate pair. */
function clamp(s: string, n: number): string {
  const chars = Array.from(s.trim());
  return chars.length > n ? `${chars.slice(0, n - 1).join("")}…` : chars.join("");
}

function safeAccent(raw: string | null): string {
  const c = (raw ?? "").replace(/[^0-9a-fA-F]/g, "");
  const hex = /^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c) ? c : BRAND.accent.replace("#", "");
  // Expand shorthand (#abc) to full (#aabbcc) so the 8-digit alpha concatenations
  // used in the glow (`${accent}55`) stay valid CSS colours.
  const full = hex.length === 3 ? hex.split("").map((d) => d + d).join("") : hex;
  return `#${full}`;
}

function card(title: string, subtitle: string, accent: string, host: string): ReactElement {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px",
        background: `linear-gradient(135deg, ${BRAND.ink} 0%, #0f172a 100%)`,
        color: "#ffffff",
        position: "relative",
        fontFamily: "sans-serif",
      }}
    >
      {/* accent glow, bottom-right — evokes a lit globe without needing a map raster */}
      <div
        style={{
          position: "absolute",
          right: "-160px",
          bottom: "-220px",
          width: "620px",
          height: "620px",
          borderRadius: "620px",
          background: `radial-gradient(circle, ${accent}55 0%, ${accent}00 68%)`,
        }}
      />

      {/* header: brand mark + wordmark, and a LIVE pill */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ width: "46px", height: "46px", borderRadius: "12px", background: accent, marginRight: "20px" }} />
          <div style={{ fontSize: "30px", fontWeight: 700, letterSpacing: "-0.5px" }}>{BRAND.name}</div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "8px 18px",
            borderRadius: "999px",
            border: `2px solid ${accent}`,
            color: accent,
            fontSize: "22px",
            fontWeight: 700,
            letterSpacing: "1px",
          }}
        >
          LIVE
        </div>
      </div>

      {/* headline + subtitle */}
      <div style={{ display: "flex", flexDirection: "column", maxWidth: "980px" }}>
        <div style={{ fontSize: "66px", fontWeight: 800, lineHeight: 1.05, color: "#ffffff" }}>{title}</div>
        <div style={{ display: "flex", marginTop: "20px", fontSize: "30px", color: "#93a4b3" }}>{subtitle}</div>
      </div>

      {/* footer: domain + honest descriptor */}
      <div style={{ display: "flex", alignItems: "center", fontSize: "26px" }}>
        <div style={{ color: accent, fontWeight: 700 }}>{host}</div>
        <div style={{ color: "#64748b", marginLeft: "16px" }}>· open data · no login</div>
      </div>
    </div>
  );
}

export function GET(req: Request): ImageResponse {
  const { searchParams } = new URL(req.url);
  const title = clamp(searchParams.get("t") || BRAND.headline, 88) || BRAND.name;
  const subtitle = clamp(searchParams.get("s") || BRAND.pitch, 64);
  const accent = safeAccent(searchParams.get("c"));
  let host = "worldmonitor.app";
  try {
    host = new URL(siteUrl()).host;
  } catch {
    /* keep fallback host */
  }

  const opts = { width: WIDTH, height: HEIGHT, headers: { "Cache-Control": CACHE } };
  try {
    return new ImageResponse(card(title, subtitle, accent, host), opts);
  } catch {
    // next/og ships a Latin default font; a glyph it can't render (CJK / emoji in a
    // caller-supplied t/s) can throw. Fall back to the text-safe brand card rather
    // than 500 — the app is dormant-safe, never a 5xx.
    return new ImageResponse(card(BRAND.headline, BRAND.pitch, BRAND.accent, host), opts);
  }
}
