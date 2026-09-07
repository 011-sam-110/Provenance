import { describe, expect, it } from "vitest";
import { playsVideo } from "@/lib/console/widgets/camslot.video";

const live = (id: string) => id === "caltrans:d11-C052";

describe("playsVideo", () => {
  it("plays a road camera whose stream our proxy can serve", () => {
    expect(playsVideo({ k: "cam", id: "caltrans:d11-C052" }, live)).toBe(true);
  });

  it("does NOT play a road camera with no playable stream", () => {
    expect(playsVideo({ k: "cam", id: "tfl:JamCams_00001" }, live)).toBe(false);
  });

  it("never plays a Windy webcam — there is no stream behind one", () => {
    expect(playsVideo({ k: "webcam", id: "windy:1420893641" }, live)).toBe(false);
  });

  it("never plays a YouTube ref — that is an iframe, not our player", () => {
    expect(playsVideo({ k: "yt", videoId: "aaaaaaaaaaa" }, live)).toBe(false);
  });

  it("says no for a camera we have not loaded yet, rather than guessing", () => {
    expect(playsVideo({ k: "cam", id: "unknown" }, () => false)).toBe(false);
  });
});
