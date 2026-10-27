"use client";
// The camera's road, in the camera detail (CameraDetail.tsx): what the road operators
// say about the road this camera looks at. The words come from lib/roads/nearCamera.ts,
// the answer from the page-wide store (lib/roads/cameraRoadStore.ts).
//
// A notice is never a speed, so this block never says how traffic moves. Where no
// operator's notices are read, it says that, rather than "no notice".

import { useMemo } from "react";
import { useNow } from "@/lib/shell/useNow";
import { fetchedText } from "@/lib/roads/notice";
import { cameraRoadWords, type CameraAt } from "@/lib/roads/nearCamera";
import { useCameraRoads } from "@/lib/roads/cameraRoadStore";

export function CameraRoad({ id, lat, lon }: CameraAt) {
  const cams = useMemo(() => [{ id, lat, lon }], [id, lat, lon]);
  const roadOf = useCameraRoads(cams);
  const now = useNow(30_000);
  const road = roadOf(id);

  if (!road) {
    return (
      <div className="cam-road" data-tone="none" data-testid="camera-road">
        <p className="cam-road-detail">Reading road notices…</p>
      </div>
    );
  }
  const words = cameraRoadWords(road, now);
  if (!words) {
    return (
      <div className="cam-road" data-tone="none" data-testid="camera-road">
        <p className="cam-road-detail">Road notices: no road operator&apos;s notices are read for this place yet.</p>
      </div>
    );
  }
  const credits = road.state === "notice" || road.state === "none" ? road.credits : [];
  return (
    <div className="cam-road" data-tone={words.tone} data-testid="camera-road">
      <p className="cam-road-head">
        <i className="cam-road-mark" aria-hidden="true" />
        <b>{words.head}</b>
        {words.when && <time>{words.when}</time>}
      </p>
      <p className="cam-road-detail">{words.detail}</p>
      {words.more && <p className="cam-road-detail">{words.more}</p>}
      <p className="cam-road-credit">
        {"readAt" in road ? `Road notices ${fetchedText(road.readAt, now)}. ` : ""}
        {credits.join(". ")}
      </p>
    </div>
  );
}
