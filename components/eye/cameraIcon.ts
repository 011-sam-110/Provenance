"use client";
// One camera icon in the God's eye view, the DOM half of a camera while previews are
// off: a small plate holding the console's own camera pictogram, on a short stalk that
// ends on the camera's white ground ring. It fetches nothing. A tap hands the camera's
// id to the overlay, which opens that one camera's card (cameraCard.ts) in its place.
// Its size is the CSS's (the phone line is a media query); the overlay stands it in a
// box of ICON_WIDE or ICON_PHONE (lib/eye/previews.ts) to match.
//
// Built with createElement; the pictogram is a constant from lib/icons/svg.ts. The
// camera's name reaches the DOM only through setAttribute and title, never innerHTML.

import { ICON_SVG } from "@/lib/icons/svg";
import type { NearCamera } from "@/lib/eye/cameras";
import { showLabel } from "@/lib/eye/previews";
import styles from "./eye.module.css";

export class CameraIcon {
  readonly el: HTMLButtonElement;

  constructor(cam: Pick<NearCamera, "id" | "name">, opts: { onOpen: (id: string) => void }) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = styles.camIcon;
    el.setAttribute("aria-label", showLabel(cam.name));
    el.setAttribute("aria-expanded", "false");
    el.setAttribute("data-cam-icon", "");
    el.title = cam.name;

    const plate = document.createElement("span");
    plate.className = styles.camIconPlate;
    plate.setAttribute("aria-hidden", "true");
    plate.innerHTML = ICON_SVG["cam-still"];
    const stalk = document.createElement("span");
    stalk.className = styles.camIconStalk;
    stalk.setAttribute("aria-hidden", "true");
    el.append(plate, stalk);

    // The map also listens for a click (a vessel pick): a tap on an icon is not one.
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      opts.onOpen(cam.id);
    });
    this.el = el;
  }

  focus(): void {
    this.el.focus();
  }
}
