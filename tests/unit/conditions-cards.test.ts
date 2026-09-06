import { describe, it, expect } from "vitest";
import {
  airCard,
  airQualityCard,
  clockOf,
  compass8,
  daylightCard,
  rainCard,
  shortDuration,
  windCard,
} from "@/lib/cameras/conditionsCards";
import { BANNED_IN_DERIVED, DERIVED_MARK } from "@/lib/console/widgets/camslot.conditions";
import type { PointWeather } from "@/lib/weather/pointWeather";
import type { AirQuality } from "@/lib/weather/airQuality";

const base: PointWeather = {
  key: "51.51,-0.13",
  tempC: 14.2,
  code: 3, // Overcast
  isDay: true,
  precipMm: 0.6,
  rainMm: 0.6,
  snowMm: 0,
  timeZone: "Europe/London",
  utcOffsetSeconds: 3600,
  feelsC: 12.4,
  windKmh: 18.2,
  windFromDeg: 225,
  gustKmh: 31.4,
  sunrise: "2026-09-06T06:22",
  sunset: "2026-09-06T19:31",
  gridKm: 1.4,
};

describe("compass8", () => {
  it("names the direction the wind blows FROM", () => {
    expect(compass8(0)).toBe("N");
    expect(compass8(225)).toBe("SW");
    expect(compass8(359)).toBe("N"); // wraps
    expect(compass8(-45)).toBe("NW"); // negative wraps too
  });
});

describe("shortDuration", () => {
  it("drops a zero hour rather than printing '0 h 50 m'", () => {
    expect(shortDuration(50)).toBe("50 m");
    expect(shortDuration(230)).toBe("3 h 50 m");
  });
});

describe("clockOf", () => {
  it("takes the wall clock straight out of the upstream's local string", () => {
    expect(clockOf("2026-09-06T19:31")).toBe("19:31");
  });

  it("returns nothing for anything that is not that shape", () => {
    expect(clockOf(undefined)).toBe("");
    expect(clockOf("not a time")).toBe("");
  });
});

describe("every card refuses to invent a value", () => {
  it("returns null rather than a card when the reading is absent", () => {
    expect(airCard(undefined)).toBeNull();
    expect(windCard(undefined)).toBeNull();
    expect(rainCard(undefined)).toBeNull();
    expect(daylightCard(undefined, "12:00")).toBeNull();
    expect(airQualityCard(undefined, "GB")).toBeNull();
  });

  it("drops the wind card when the upstream sent no wind, rather than showing 0 km/h", () => {
    // 0 km/h is a real, still evening. Absent means nobody said. A card reading "0 km/h"
    // would turn our silence into their measurement.
    const { windKmh, gustKmh, windFromDeg, ...noWind } = base;
    void windKmh;
    void gustKmh;
    void windFromDeg;
    expect(windCard(noWind as PointWeather)).toBeNull();
    expect(windCard({ ...noWind, windKmh: 0 } as PointWeather)?.value).toBe("0 km/h");
  });

  it("drops the rain card when precipitation is NaN, and keeps it at a true zero", () => {
    expect(rainCard({ ...base, precipMm: NaN })).toBeNull();
    expect(rainCard({ ...base, precipMm: 0 })?.value).toBe("0 mm");
  });

  it("drops the daylight card when the daily block never arrived", () => {
    const { sunrise, sunset, ...noDaily } = base;
    void sunrise;
    void sunset;
    expect(daylightCard(noDaily as PointWeather, "12:00")).toBeNull();
  });
});

describe("airCard", () => {
  it("names the condition and the apparent temperature", () => {
    const card = airCard(base)!;
    expect(card.value).toBe("14.2°C");
    expect(card.sub).toBe("Overcast · feels 12°C");
  });

  it("says the number is modelled, and how far away the model read", () => {
    // The whole page rests on this distinction. A temperature beside a picture of a road
    // reads as a measurement at that road unless something says otherwise.
    expect(airCard(base)!.title).toContain("Modelled by Open-Meteo");
    expect(airCard(base)!.title).toContain("1.4 km away");
    expect(airCard(base)!.title).toContain("not measured at the camera");
  });

  it("still says where it read from when the upstream echoed no coordinate", () => {
    const { gridKm, ...noGrid } = base;
    void gridKm;
    expect(airCard(noGrid as PointWeather)!.title).toContain("nearest model grid point");
  });
});

describe("rainCard — the card most likely to be misread as a road verdict", () => {
  const card = rainCard(base)!;

  it("says 1h, because the upstream number is a preceding-hour sum and not a rate", () => {
    expect(card.label).toBe("Rain 1h");
    expect(card.title).toContain("preceding hour");
    expect(card.value).toBe("0.6 mm");
  });

  it("never says 'now'", () => {
    expect(`${card.label} ${card.value} ${card.sub} ${card.title}`.toLowerCase()).not.toContain("now");
  });

  it("carries the derived mark and disclaims the surface explicitly", () => {
    expect(card.sub).toContain(DERIVED_MARK);
    expect(card.sub).toContain("not a surface state");
  });

  it("uses no surface word anywhere a reader can see", () => {
    // Same rule camslot enforces on the derived road line: "wet"/"dry"/"icy" belong only
    // to an operator's measured reading. The title says "wet or dry" deliberately, as a
    // denial, so only the tile-facing strings are checked here.
    expect(BANNED_IN_DERIVED.test(card.value)).toBe(false);
    expect(BANNED_IN_DERIVED.test(card.sub)).toBe(false);
    expect(BANNED_IN_DERIVED.test(card.label)).toBe(false);
  });
});

describe("daylightCard", () => {
  it("counts down to sunset during the day", () => {
    const card = daylightCard(base, "15:41")!;
    expect(card.value).toBe("19:31");
    expect(card.sub).toBe("sunset · in 3 h 50 m");
  });

  it("counts down to sunrise before it", () => {
    const card = daylightCard(base, "05:22")!;
    expect(card.value).toBe("06:22");
    expect(card.sub).toBe("sunrise · in 1 h 0 m");
  });

  it("says how long ago the sun set once it has", () => {
    const card = daylightCard(base, "21:31")!;
    expect(card.sub).toBe("sunset · 2 h 0 m ago");
  });

  it("says sunset, never dusk", () => {
    // Civil dusk is roughly half an hour later and is a different quantity that
    // Open-Meteo was not asked for.
    for (const at of ["05:22", "15:41", "21:31"]) {
      expect(daylightCard(base, at)!.sub).not.toContain("dusk");
      expect(daylightCard(base, at)!.title).not.toContain("dusk");
    }
  });

  it("falls back to both times when the local clock is unknown", () => {
    const card = daylightCard(base, "")!;
    expect(card.sub).toContain("rose 06:22");
    expect(card.sub).toContain("sets 19:31");
  });
});

describe("airQualityCard", () => {
  const aq: AirQuality = { key: "51.51,-0.13", europeanAqi: 38, usAqi: 43, pm25: 7.1 };

  it("puts the scale in the value, not in a tooltip nobody opens", () => {
    // An unlabelled "AQI 42" is read against whichever scale the reader knows, and the
    // two disagree about what 42 means.
    expect(airQualityCard(aq, "GB")!.value).toBe("EAQI 38");
    expect(airQualityCard(aq, "US")!.value).toBe("US AQI 43");
  });

  it("uses each publisher's own band wording for the same air", () => {
    const forty = { ...aq, europeanAqi: 40, usAqi: 40 };
    expect(airQualityCard(forty, "GB")!.sub).toContain("Fair");
    expect(airQualityCard(forty, "US")!.sub).toContain("Good");
  });

  it("says the value is modelled, not an instrument at the camera", () => {
    const title = airQualityCard(aq, "GB")!.title;
    expect(title).toContain("Copernicus CAMS");
    expect(title).toContain("not measured");
  });

  it("shows PM2.5 when it came, and omits the clause when it did not", () => {
    expect(airQualityCard(aq, "GB")!.sub).toContain("PM2.5 7.1 µg/m³");
    const { pm25, ...noPm } = aq;
    void pm25;
    expect(airQualityCard(noPm as AirQuality, "GB")!.sub).not.toContain("PM2.5");
  });
});
