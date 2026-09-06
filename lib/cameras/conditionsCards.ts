// The conditions grid on a camera page, as data.
//
// Pure, so the WORDING is testable. Everything here is a claim about a place made from
// somebody else's numbers, and the house rule is that the upstream-to-domain mapping
// lives in a pure exported function with a unit test rather than inside a component.
//
// THE RULE THAT SHAPES EVERY CARD: absent is not zero, and modelled is not measured.
// A card returns null when its input did not arrive, so the grid renders one fewer card
// rather than a card reading "0". `camslot.conditions.ts` already owns the harder half
// of this — what may be said about the ROAD — and the surface card defers to it rather
// than re-deciding.

import type { PointWeather } from "@/lib/weather/pointWeather";
import { readAqi, type AirQuality } from "@/lib/weather/airQuality";
import { weatherCodeLabel } from "@/lib/signals/weather";
import { DERIVED_MARK } from "@/lib/console/widgets/camslot.conditions";

export interface ConditionCard {
  /** React key and test handle. */
  key: string;
  /** The small caps heading, e.g. "WIND". */
  label: string;
  /** The big value, e.g. "18 km/h". */
  value: string;
  /** The muted line under it. Empty string renders no line. */
  sub: string;
  /** Hover text. Always says where the number came from. */
  title: string;
}

/** Eight-point compass name for a meteorological bearing (the direction wind blows FROM). */
export function compass8(deg: number): string {
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const i = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return names[i];
}

/** "3 h 50 m" / "50 m". Minutes only below an hour, because "0 h 50 m" reads as broken. */
export function shortDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} h ${m % 60} m` : `${m} m`;
}

/** "2026-09-06T19:36" -> "19:36". Returns "" for anything that is not that shape. */
export function clockOf(iso: string | undefined): string {
  const m = /T(\d{2}:\d{2})/.exec(iso ?? "");
  return m ? m[1] : "";
}

/** "19:36" -> 1176. NaN for anything else, which every caller checks. */
function minutesOf(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/** Where the reading is from, for every tooltip. Names the model AND the distance. */
function provenance(pw: PointWeather): string {
  const gap =
    pw.gridKm !== undefined
      ? ` for a model grid point ${round1(pw.gridKm)} km away`
      : " for the nearest model grid point";
  return `Modelled by Open-Meteo${gap}, not measured at the camera.`;
}

export function airCard(pw: PointWeather | undefined): ConditionCard | null {
  if (!pw || !Number.isFinite(pw.tempC)) return null;
  const { label } = weatherCodeLabel(pw.code);
  const feels = pw.feelsC !== undefined ? `feels ${Math.round(pw.feelsC)}°C` : "";
  return {
    key: "air",
    label: "Air",
    value: `${round1(pw.tempC)}°C`,
    sub: [label === "Unknown" ? "" : label, feels].filter(Boolean).join(" · "),
    title: `Air temperature. ${provenance(pw)}`,
  };
}

export function windCard(pw: PointWeather | undefined): ConditionCard | null {
  if (!pw || pw.windKmh === undefined) return null;
  const dir = pw.windFromDeg !== undefined ? compass8(pw.windFromDeg) : "";
  const gust = pw.gustKmh !== undefined ? `gusts ${Math.round(pw.gustKmh)} km/h` : "";
  return {
    key: "wind",
    label: "Wind",
    value: `${Math.round(pw.windKmh)} km/h`,
    sub: [dir, gust].filter(Boolean).join(" · "),
    title:
      `Sustained wind at 10 m${dir ? `, blowing from the ${dir}` : ""}. ${provenance(pw)}`,
  };
}

/**
 * Rainfall in the PRECEDING HOUR, and the label says so.
 *
 * Open-Meteo's `current` precipitation fields are sums over the last hour, not
 * instantaneous rates. Writing "now" would be a factual regression, not a rewording —
 * the same rule camslot.conditions.ts enforces for the derived road line. The sub-line
 * carries DERIVED_MARK and an explicit disclaimer, because a millimetre figure next to a
 * picture of a road is exactly the number a reader would otherwise take as a verdict on
 * the surface.
 */
export function rainCard(pw: PointWeather | undefined): ConditionCard | null {
  if (!pw) return null;
  const mm = Number.isFinite(pw.precipMm) ? pw.precipMm : NaN;
  if (!Number.isFinite(mm)) return null;
  return {
    key: "rain",
    label: "Rain 1h",
    value: `${round1(mm)} mm`,
    sub: `${DERIVED_MARK} · not a surface state`,
    title:
      "Total precipitation over the preceding hour, from the air-weather model. " +
      "It is not a measurement of the road and says nothing about whether the surface is " +
      `wet or dry. ${provenance(pw)}`,
  };
}

/**
 * Sunrise and sunset at the camera.
 *
 * `nowLocal` is the camera's own wall clock as "HH:MM" (from `formatLocalClock`), which
 * is why this takes a string rather than an epoch: the upstream's sunrise/sunset are
 * offset-less local strings, and comparing two wall clocks avoids inventing a timezone
 * conversion that could put the answer an hour out across a DST boundary.
 *
 * Says "sunset", never "dusk". Civil dusk is roughly half an hour later and is a
 * different quantity that Open-Meteo was not asked for.
 */
export function daylightCard(
  pw: PointWeather | undefined,
  nowLocal: string,
): ConditionCard | null {
  if (!pw) return null;
  const rise = clockOf(pw.sunrise);
  const set = clockOf(pw.sunset);
  if (!rise || !set) return null;

  const now = minutesOf(nowLocal);
  const riseMin = minutesOf(rise);
  const setMin = minutesOf(set);
  const both = `rose ${rise} · sets ${set}`;

  if (!Number.isFinite(now)) {
    return {
      key: "daylight",
      label: "Daylight",
      value: set,
      sub: `sunset · ${both}`,
      title: "Sunrise and sunset at this camera, in its own local time. From Open-Meteo.",
    };
  }

  if (now < riseMin) {
    return {
      key: "daylight",
      label: "Daylight",
      value: rise,
      sub: `sunrise · in ${shortDuration(riseMin - now)}`,
      title: `Before sunrise. The sun rises at ${rise} and sets at ${set}, camera local time. From Open-Meteo.`,
    };
  }

  if (now < setMin) {
    return {
      key: "daylight",
      label: "Daylight",
      value: set,
      sub: `sunset · in ${shortDuration(setMin - now)}`,
      title: `Daylight. The sun rose at ${rise} and sets at ${set}, camera local time. From Open-Meteo.`,
    };
  }

  return {
    key: "daylight",
    label: "Daylight",
    value: set,
    sub: `sunset · ${shortDuration(now - setMin)} ago`,
    title: `After sunset. The sun rose at ${rise} and set at ${set}, camera local time. From Open-Meteo.`,
  };
}

/**
 * Air quality, on the scale that means something where the camera is.
 *
 * The scale is always named in the VALUE, not hidden in a tooltip, because an unlabelled
 * "AQI 42" is read against whichever scale the reader already knows and the two disagree
 * about what 42 means. See `aqiScaleFor`.
 */
export function airQualityCard(
  aq: AirQuality | undefined,
  iso2: string,
): ConditionCard | null {
  const band = readAqi(aq, iso2);
  if (!band) return null;
  const pm = aq?.pm25 !== undefined ? `PM2.5 ${round1(aq.pm25)} µg/m³` : "";
  return {
    key: "air-quality",
    label: "Air quality",
    value: `${band.scaleLabel} ${band.value}`,
    sub: [band.label, pm].filter(Boolean).join(" · "),
    title:
      `${band.value} on the ${band.scaleLabel} scale, which its publisher calls "${band.label}". ` +
      "Modelled by the Copernicus CAMS atmospheric model through Open-Meteo, not measured " +
      "by an instrument at the camera.",
  };
}
