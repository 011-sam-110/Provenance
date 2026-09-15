"use client";
// In-overlay camera body. Rendered in the Sources rail's Inspector tab.
// Reuses the SSRF-safe image proxy via <CameraImage>, shows the MANDATORY
// attribution, name/coords/status, and a deep-link to the full /camera/[id]
// page (which stays as a standalone fallback).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { WorldObject } from "@/lib/world";
import { CameraImage } from "@/components/CameraImage";
import { CameraVideo } from "@/components/CameraVideo";
import { useNow, formatAge } from "@/lib/shell/useNow";
import { msUntilRefresh, refreshProgress, formatCountdown, sampledAgeMs } from "@/lib/cameras/freshness";

type CamInfo = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  region?: string;
  country: string;
  available: boolean;
  attribution: string;
  license: string;
  refreshSeconds: number;
  live: boolean;
  lastSampledAt?: string;
};

export function CameraDetail({ object }: { object: WorldObject }) {
  // The globe only carries a thin WorldObject; fetch the full record (for the
  // attribution / license / refresh interval the live image needs).
  const [cam, setCam] = useState<CamInfo | null>(null);
  const [err, setErr] = useState(false);
  // When this camera's record arrived — anchors the still-image refresh countdown
  // to the same cycle <CameraImage> busts its URL on.
  const loadedAtRef = useRef(0);

  useEffect(() => {
    let alive = true;
    setCam(null);
    setErr(false);
    fetch(`/api/camera/${encodeURIComponent(object.id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then((d) => {
        if (!alive) return;
        loadedAtRef.current = Date.now();
        setCam(d.camera as CamInfo);
      })
      .catch(() => {
        if (alive) setErr(true);
      });
    return () => {
      alive = false;
    };
  }, [object.id]);

  const now = useNow(1000);
  const available =
    (object.meta?.available as boolean | undefined) ?? cam?.available ?? false;
  const href = `/camera/${encodeURIComponent(object.id)}`;

  // Per-camera freshness (the honesty signal): a countdown to the next still
  // frame + how long ago the upstream sample was taken. Only stills refresh on a
  // cycle; live video is continuous, and an offline feed shows neither.
  const isStill = Boolean(cam && !cam.live && available);
  const remainingMs = isStill ? msUntilRefresh(loadedAtRef.current, cam!.refreshSeconds, now) : 0;
  const progress = isStill ? refreshProgress(loadedAtRef.current, cam!.refreshSeconds, now) : 0;
  const sampledAge = cam?.lastSampledAt ? sampledAgeMs(cam.lastSampledAt, now) : null;

  return (
    <div className="cam-detail">
      <h2>{object.label}</h2>
      <p className="cam-sub">
        {cam ? `${cam.region ? `${cam.region}, ` : ""}${cam.country}` : "Live traffic camera"}
      </p>

      {cam ? (
        cam.live ? (
          <CameraVideo
            id={cam.id}
            alt={cam.name}
            attribution={cam.attribution}
            license={cam.license}
            refreshSeconds={cam.refreshSeconds}
          />
        ) : (
          <CameraImage
            id={cam.id}
            alt={cam.name}
            attribution={cam.attribution}
            license={cam.license}
            refreshSeconds={cam.refreshSeconds}
          />
        )
      ) : err ? (
        <div className="cam-loading">Could not load this camera.</div>
      ) : (
        <div className="cam-loading">Loading live image…</div>
      )}

      <div className="cam-meta">
        <span className="cam-status">
          <span className={`dot ${available ? "on" : "off"}`} aria-hidden />
          {available ? (cam?.live ? "Live" : "Available") : "Feed offline"}
        </span>
        <span>
          {object.lat.toFixed(4)}, {object.lon.toFixed(4)}
        </span>
        {cam && available && cam.live && <span>● Streaming</span>}
        {cam && isStill && (
          <span title={`Refreshes every ${cam.refreshSeconds}s`}>
            Next frame in {formatCountdown(remainingMs)}
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 34,
                height: 3,
                marginLeft: 6,
                verticalAlign: "middle",
                borderRadius: 2,
                background: "var(--tn-border, #d6dee6)",
              }}
            >
              <span
                style={{
                  display: "block",
                  width: `${Math.round(progress * 100)}%`,
                  height: "100%",
                  borderRadius: 2,
                  background: "var(--tn-accent, #0ea5e9)",
                }}
              />
            </span>
          </span>
        )}
        {sampledAge != null && <span>Updated {formatAge(sampledAge)} ago</span>}
      </div>

      <Link className="cam-open" href={href}>
        Open full page ↗
      </Link>
    </div>
  );
}
