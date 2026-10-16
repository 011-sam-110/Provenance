import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/midrive-cameras.json";
import { normalizeMiDrive, parseCountyLink, stillUrl } from "@/lib/sources/midrive";
import { isAllowed } from "@/lib/proxy/allowlist";
import { CameraArray } from "@/lib/types";

// Four rows captured 2026-10-16: two /thumbs/ stills, one MDOT weather-station still
// and one `?bucket=ftp` still.
test("normalizes every captured row into a valid Camera", () => {
  const cams = normalizeMiDrive(fixture as never);
  expect(() => CameraArray.parse(cams)).not.toThrow();
  expect(cams).toHaveLength(4);
});

test("reads the coordinate and id out of the Go-to link, latitude first", () => {
  const [a] = normalizeMiDrive(fixture as never);
  expect(a.id).toBe("midrive:1129");
  expect(a.lat).toBeCloseTo(42.491304, 6);
  expect(a.lon).toBeCloseTo(-83.04479, 5);
  expect(a.name).toBe("11 Mile @ Mound NB");
  expect(a.road).toBe("11 Mile");
  expect(a.direction).toBe("North");
  expect(a.region).toBe("Michigan");
});

test("stores the still the /thumbs/ URL redirects to, and every still passes the proxy", () => {
  const cams = normalizeMiDrive(fixture as never);
  expect(cams[0].imageUrl).toBe("https://micamerasimages.net/semtoc_cam_253.jpg?item=1");
  for (const c of cams) expect(isAllowed(new URL(c.imageUrl!)), c.imageUrl).toBe(true);
  expect(cams.some((c) => c.imageUrl?.includes("bucket=ftp"))).toBe(true);
  expect(cams.some((c) => c.imageUrl?.startsWith("https://mdotjboss.state.mi.us/docs/drive/camfiles/"))).toBe(true);
});

test("drops a row whose link has no coordinate, rather than guessing one", () => {
  expect(parseCountyLink('Kent County <a href="/MiDrive/map?cameras=true&zoom=15&id=7">Go to</a>')).toBeNull();
  expect(parseCountyLink("Kent County")).toBeNull();
  const row = { ...(fixture as never[])[0] as object, county: "Wayne County" };
  expect(normalizeMiDrive([row])).toEqual([]);
});

test("refuses a still that is not https or has no src", () => {
  expect(stillUrl('<img src="http://micamerasimages.net/thumbs/a.flv.jpg">')).toBeUndefined();
  expect(stillUrl("<div>no picture</div>")).toBeUndefined();
});
