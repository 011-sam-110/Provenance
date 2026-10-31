// The plane ids the pull mints (`adsbRowToWorldObject` in lib/sources/adsb.ts): `plane:` and the
// 24-bit address, `~` in front when it is not an ICAO one. Its own file so the browser's bundle
// and the server's route check one rule, and the browser does not load the server's store.

const TRACK_ID = /^plane:~?[0-9a-f]{6}$/;

export function isTrackId(id: unknown): id is string {
  return typeof id === "string" && TRACK_ID.test(id);
}
