// The flag a ship's MMSI implies, for the God's eye view's vessel panel.
//
// DERIVED, NEVER REPORTED. AIS carries no flag. The first three digits of a ship
// station's MMSI (the MID) name the administration that issued the number, which is
// usually the flag state, and a ship can be re-flagged without its number changing. So
// the panel words this "Flag (from MMSI)": a reading of a number, not a thing the ship
// said. Pure, and pinned by tests/unit/eye-mid.test.ts.

import { MID } from "./mid.data";

/**
 * The MID of a ship station's MMSI, or null when the number is not one. A ship station
 * is nine digits starting 2 to 7 (ITU-R M.585): the MID is its first three. Everything
 * else has no MID in that place, so reading three digits off it would be a wrong flag:
 *   00MIDxxxx coast station and 0MIDxxxxx group (their leading zeros are lost in a
 *   number, so they are not nine digits), 111MIDxxx SAR aircraft, 8xxxxxxxx handheld
 *   VHF, 970/972/974 beacons, 98MIDxxxx and 99MIDxxxx aids to navigation.
 */
export function midOf(mmsi: number | null | undefined): string | null {
  if (typeof mmsi !== "number" || !Number.isInteger(mmsi)) return null;
  const digits = String(mmsi);
  if (digits.length !== 9) return null;
  if (digits[0] < "2" || digits[0] > "7") return null;
  return digits.slice(0, 3);
}

/** "United Kingdom", or "A, B or C" where one MID is shared (306); null when unknown. */
export function flagFromMmsi(mmsi: number | null | undefined): string | null {
  const mid = midOf(mmsi);
  if (!mid) return null;
  const names = MID[mid];
  if (!names || names.length === 0) return null;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}
