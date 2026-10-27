"use client";
// One camera card in the God's eye view, the DOM half: the operator's picture through
// the closed proxy, what that picture is, and how old. Words come from
// lib/eye/cameras.ts. Built with textContent only: no camera name reaches innerHTML.
//
// THE CHIP NAMES WHAT IS ON SCREEN. A card asks for a stream, then a clip, then a
// still (preferredMedia), shows whichever loads, and labels THAT. A stream that never
// plays leaves the still on screen labelled "Still"; it is never "Live" until a frame
// of the stream is playing.
//
// THE AGE IS THE OPERATOR'S. A still or a clip is fetched as a blob so the response's
// Last-Modified can be read: /api/proxy passes the operator's own time through
// (lib/proxy/clip.ts). With no such header the card states only the cadence.
//
// A CLIP PLAYS WHEN THE OVERLAY SAYS SO (setPlay, decided by clipsToPlay): several
// clips playing at once cost the moving view half its frames. In a film
// (clock=manual) no clip plays by itself: each step of the film moves every clip on
// by the same time (stepClips), so a clip runs at its own speed in the film. A film
// also keeps each card's first picture (no refresh while it is drawn), and the age
// reads the film's clock. A card that first appears during a film fetches its picture
// then, so that picture can be newer than the film's clock; its age then reads
// "just now".

import {
  cardMeta,
  isStale,
  mediaLabel,
  preferredMedia,
  type CardMedia,
  type NearCamera,
} from "@/lib/eye/cameras";
import type { EyeClock } from "@/lib/eye/motion";
import type { cameraRoadTileWords } from "@/lib/roads/nearCamera";
import styles from "./eye.module.css";

/** The clips on screen in a film, moved on by stepClips. */
const filmed = new Set<HTMLVideoElement>();
let filmSettled: Promise<unknown> = Promise.resolve();

/** Resolves when the video shows the frame at its time (or seek), fails, or after 3 s. */
function frameReady(v: HTMLVideoElement, seek?: number): Promise<void> {
  return new Promise((resolve) => {
    const event = seek === undefined ? "loadeddata" : "seeked";
    const done = () => {
      clearTimeout(timer);
      v.removeEventListener(event, done);
      v.removeEventListener("error", done);
      resolve();
    };
    const timer = setTimeout(done, 3000);
    v.addEventListener(event, done);
    v.addEventListener("error", done);
    if (seek !== undefined) v.currentTime = seek;
  });
}

/**
 * One step of a film: every clip on screen moves on by `ms`, looping. clipsSettled()
 * resolves once each one shows its new frame, so the film's picture waits for it.
 */
export function stepClips(ms: number): void {
  const waits: Promise<void>[] = [];
  for (const v of filmed) {
    if (!v.isConnected || v.error) {
      filmed.delete(v);
      continue;
    }
    // Not loaded yet: it starts at its first frame, once that has arrived.
    if (v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !(v.duration > 0) || !Number.isFinite(v.duration)) {
      waits.push(frameReady(v));
      continue;
    }
    waits.push(frameReady(v, (v.currentTime + ms / 1000) % v.duration));
  }
  filmSettled = Promise.all(waits);
}

/** The film's clips show the frames of the last step. */
export function clipsSettled(): Promise<void> {
  return filmSettled.then(() => undefined);
}

interface Loaded {
  media: "clip" | "still";
  url: string;
  takenAt: number | null;
  fetchedAt: number;
}

/**
 * Loaded pictures, by camera. A card that leaves the screen while the view turns and
 * comes back within its cadence reuses its picture instead of fetching it again.
 * Object URLs are owned here and revoked on replacement or on releaseCardMedia().
 */
const loaded = new Map<string, Loaded>();

/** Drop every loaded picture. Called when the view unmounts. */
export function releaseCardMedia(): void {
  for (const l of loaded.values()) URL.revokeObjectURL(l.url);
  loaded.clear();
  filmed.clear();
}

/** No camera refreshes faster than this here, whatever its feed says. */
const MIN_REFRESH_MS = 60_000;
/** A stream that has not played a frame by now falls back to the still. */
const STREAM_TIMEOUT_MS = 10_000;

function cadenceMs(cam: NearCamera): number {
  return Math.max(MIN_REFRESH_MS, (cam.refreshSeconds ?? 300) * 1000);
}

async function fetchPicture(cam: NearCamera, media: "clip" | "still", signal: AbortSignal, film: boolean): Promise<Loaded | null> {
  const cached = loaded.get(cam.id);
  // A film keeps the picture it has: a newer one would be newer than the film's clock.
  if (cached && cached.media === media && (film || Date.now() - cached.fetchedAt < cadenceMs(cam))) return cached;
  try {
    const res = await fetch(`/api/proxy?id=${encodeURIComponent(cam.id)}${media === "clip" ? "&clip=1" : ""}`, { signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size === 0) return null;
    const lm = res.headers.get("last-modified");
    const t = lm ? Date.parse(lm) : Number.NaN;
    const next: Loaded = { media, url: URL.createObjectURL(blob), takenAt: Number.isFinite(t) ? t : null, fetchedAt: Date.now() };
    const prev = loaded.get(cam.id);
    loaded.set(cam.id, next);
    // The previous picture may still be on screen in this card; it goes after the swap.
    if (prev) setTimeout(() => URL.revokeObjectURL(prev.url), 2000);
    return next;
  } catch {
    return null;
  }
}

export class CameraCard {
  readonly el: HTMLAnchorElement;
  private readonly frame: HTMLDivElement;
  private readonly chip: HTMLElement;
  private readonly meta: HTMLElement;
  /** The camera's road (lib/roads/nearCamera.ts), under the words; hidden until set. */
  private readonly road: HTMLElement;
  private shown: HTMLElement | null = null;
  private showing: CardMedia | null = null;
  private takenAt: number | null = null;
  private hls: { destroy(): void } | null = null;
  private readonly abort = new AbortController();
  private refresh: ReturnType<typeof setTimeout> | null = null;
  private dead = false;
  private readonly phone: boolean;
  /** The wall clock, or a film's own (lib/eye/motion.ts): what the age is counted from. */
  private readonly clock: EyeClock;
  /** A film (clock=manual): no stream, no refresh, and the clip follows the film's clock. */
  private readonly film: boolean;
  /** Told when the picture on screen changes, so the overlay can decide what plays. */
  private readonly onMedia: () => void;

  constructor(
    private readonly cam: NearCamera,
    opts: { phone: boolean; clock: EyeClock; onMedia: () => void },
  ) {
    this.phone = opts.phone;
    this.clock = opts.clock;
    this.film = opts.clock.film;
    this.onMedia = opts.onMedia;
    // The card is a link to the camera's own page, in a new tab so the view stays.
    const el = document.createElement("a");
    el.className = styles.cam;
    el.href = `/camera/${encodeURIComponent(cam.id)}`;
    el.target = "_blank";
    el.rel = "noopener noreferrer";
    this.el = el;

    const plate = document.createElement("div");
    plate.className = styles.camPlate;
    this.frame = document.createElement("div");
    this.frame.className = styles.camImg;
    const text = document.createElement("div");
    text.className = styles.camText;
    const name = document.createElement("b");
    name.textContent = cam.name;
    const line = document.createElement("span");
    this.chip = document.createElement("i");
    this.chip.className = styles.kind;
    this.meta = document.createElement("em");
    this.meta.textContent = "Loading";
    line.append(this.chip, this.meta);
    text.append(name, line);
    this.road = document.createElement("p");
    this.road.className = styles.road;
    this.road.hidden = true;
    plate.append(this.frame, text, this.road);
    const stalk = document.createElement("i");
    stalk.className = styles.stalk;
    el.append(plate, stalk);

    void this.load(preferredMedia(cam, this.film));
  }

  /**
   * What the road operators say about this camera's road, in the camera wall's one-line
   * words. Null hides the line: no operator's notices are read here.
   */
  setRoad(words: ReturnType<typeof cameraRoadTileWords>): void {
    if (!words) {
      this.road.hidden = true;
      return;
    }
    const mark = document.createElement("i");
    mark.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = words.text;
    const parts: HTMLElement[] = [mark, text];
    if (words.aside) {
      const aside = document.createElement("em");
      aside.textContent = words.aside;
      parts.push(aside);
    }
    this.road.replaceChildren(...parts);
    this.road.dataset.tone = words.tone;
    this.road.title = words.title;
    this.road.hidden = false;
  }

  /** What the card shows now, or null while it loads. */
  get media(): CardMedia | null {
    return this.showing;
  }

  /**
   * Play or hold this card's clip, as clipsToPlay decided. A held clip keeps its frame
   * and its words: it is still the operator's clip, of the age it states. A stream is
   * never held, and in a film the clip follows the film's clock instead.
   */
  setPlay(on: boolean): void {
    const v = this.shown;
    if (this.film || this.showing !== "clip" || !(v instanceof HTMLVideoElement)) return;
    if (on && v.paused) void v.play().catch(() => undefined);
    else if (!on && !v.paused) v.pause();
  }

  private async load(want: CardMedia): Promise<void> {
    if (want === "stream") {
      // The still first, so the card has a picture at once and an honest label; the
      // stream replaces it only once a frame of it is actually playing.
      await this.load("still");
      if (!this.dead) this.tryStream();
      return;
    }
    const pic = await fetchPicture(this.cam, want, this.abort.signal, this.film);
    if (this.dead) return;
    if (!pic) {
      if (want === "clip") return this.load("still");
      this.meta.textContent = "No picture";
      this.chip.textContent = "";
      this.schedule("still");
      return;
    }
    this.mount(pic);
    this.schedule(want);
  }

  private mount(pic: Loaded): void {
    let node: HTMLElement;
    if (pic.media === "clip") {
      // Not autoplay: it starts when setPlay says so, or steps with a film.
      const v = document.createElement("video");
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = "auto";
      v.setAttribute("aria-hidden", "true");
      v.src = pic.url;
      if (this.film) filmed.add(v);
      node = v;
    } else {
      const img = document.createElement("img");
      img.alt = "";
      img.src = pic.url;
      node = img;
    }
    this.swapIn(node, pic.media, pic.takenAt);
  }

  private swapIn(node: HTMLElement, showing: CardMedia, takenAt: number | null): void {
    node.classList.remove(styles.pending);
    if (this.shown && this.shown !== node) {
      if (this.shown instanceof HTMLVideoElement) filmed.delete(this.shown);
      this.shown.remove();
    }
    if (node.parentElement !== this.frame) this.frame.append(node);
    this.shown = node;
    this.showing = showing;
    this.takenAt = takenAt;
    this.el.dataset.media = showing;
    this.chip.textContent = mediaLabel(showing);
    this.tick(this.clock.now());
    this.onMedia();
  }

  private tryStream(): void {
    const video = document.createElement("video");
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute("aria-hidden", "true");
    // In the card but invisible behind the still until it plays: a browser may not
    // start a video that is not in the document.
    video.className = styles.pending;
    this.frame.append(video);
    const src = `/api/hls?id=${encodeURIComponent(this.cam.id)}`;
    const giveUp = setTimeout(() => this.dropStream(), STREAM_TIMEOUT_MS);
    // Swapped in on the first PLAYING frame, not on load: "Live" means moving pictures.
    video.addEventListener(
      "playing",
      () => {
        clearTimeout(giveUp);
        if (!this.dead) this.swapIn(video, "stream", null);
      },
      { once: true },
    );
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src; // Safari plays HLS natively
      void video.play().catch(() => this.dropStream());
      return;
    }
    void import("hls.js").then(({ default: Hls }) => {
      if (this.dead || !Hls.isSupported()) return this.dropStream();
      const h = new Hls({ enableWorker: true });
      this.hls = h;
      h.loadSource(src);
      h.attachMedia(video);
      h.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) this.dropStream();
      });
      void video.play().catch(() => undefined);
    });
  }

  /** The stream failed or never played: the still stays, labelled as a still. */
  private dropStream(): void {
    this.hls?.destroy();
    this.hls = null;
    for (const v of this.frame.querySelectorAll(`.${styles.pending}`)) v.remove();
    if (this.showing === "stream" && !this.dead) void this.load("still");
  }

  /** Fetch the same kind of picture again after one of the operator's cycles. */
  private schedule(media: CardMedia): void {
    if (this.dead || media === "stream" || this.film) return;
    if (this.refresh) clearTimeout(this.refresh);
    this.refresh = setTimeout(() => {
      // A stream that took over from the still needs no refresh: it is moving.
      if (this.showing === "stream") return;
      void this.load(media);
    }, cadenceMs(this.cam));
  }

  /** Re-word the age line. Cheap: one text write, only when it changes. */
  tick(now: number): void {
    if (!this.showing) return;
    const text = cardMeta({
      showing: this.showing,
      takenAt: this.takenAt,
      refreshSeconds: this.cam.refreshSeconds,
      now,
      phone: this.phone,
    });
    if (this.meta.textContent !== text) this.meta.textContent = text;
    const stale = this.showing !== "stream" && isStale(this.takenAt, this.cam.refreshSeconds, now);
    if (stale) this.el.dataset.stale = "1";
    else delete this.el.dataset.stale;
  }

  destroy(): void {
    this.dead = true;
    this.abort.abort();
    if (this.refresh) clearTimeout(this.refresh);
    this.hls?.destroy();
    this.hls = null;
    if (this.shown instanceof HTMLVideoElement) {
      filmed.delete(this.shown);
      this.shown.pause();
      this.shown.removeAttribute("src");
      this.shown.load();
    }
  }
}
