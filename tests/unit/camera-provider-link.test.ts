import { expect, test } from "vitest";
import { cameraProviderLink } from "@/lib/cameras/providerLink";

test("resolves the real camera-network attributions the app ingests", () => {
  expect(cameraProviderLink("Powered by TfL Open Data")?.url).toBe(
    "https://tfl.gov.uk/info-for/open-data-users/",
  );
  expect(cameraProviderLink("Live traffic data © Caltrans (California DOT)")?.label).toBe("Caltrans");
  expect(cameraProviderLink("Live weather-camera data © Fintraffic / Digitraffic")?.url).toBe(
    "https://www.digitraffic.fi/en/",
  );
  expect(cameraProviderLink("Live traffic-camera data © NZ Transport Agency Waka Kotahi (NZTA)")?.label).toBe(
    "NZTA Waka Kotahi",
  );
  expect(cameraProviderLink("Live traffic-camera data © Oregon DOT (ODOT) / TripCheck.com")?.url).toBe(
    "https://tripcheck.com/",
  );
});

// Each new US network's own attribution line, as its adapter writes it. These sit above
// the generic "511" row; a reorder would send all of them to the FHWA page.
test("resolves the 2026-10-16 US networks to their own operators, not the generic 511 page", () => {
  expect(cameraProviderLink("Live traffic camera data © NYSDOT (511NY)")?.url).toBe("https://511ny.org/");
  expect(cameraProviderLink("Live traffic camera data © MnDOT (511MN)")?.url).toBe("https://511mn.org/");
  expect(cameraProviderLink("Live traffic camera data © Iowa DOT (511IA)")?.url).toBe("https://511ia.org/");
  expect(cameraProviderLink("Live traffic camera data © INDOT (TrafficWise 511IN)")?.url).toBe("https://511in.org/");
  expect(cameraProviderLink("Live traffic camera data © KDOT and KC Scout (KanDrive)")?.url).toBe("https://www.kandrive.gov/");
  expect(cameraProviderLink("Live traffic camera data © Colorado DOT (COtrip)")?.url).toBe("https://www.cotrip.org/");
  expect(cameraProviderLink("Live traffic camera data © Virginia DOT (511 Virginia)")?.url).toBe("https://511.vdot.virginia.gov/");
  expect(cameraProviderLink("Live traffic camera data © Washington State DOT")?.label).toBe("WSDOT");
  expect(cameraProviderLink("Live traffic camera data © Michigan DOT (Mi Drive)")?.label).toBe("Mi Drive (MDOT)");
  expect(cameraProviderLink("Live traffic camera data © Texas DOT (TxDOT ITS)")?.url).toBe("https://its.txdot.gov/");
});

test("returns an https link with a non-empty label whenever it matches", () => {
  const l = cameraProviderLink("Live traffic data © SCDOT / 511sc.org");
  expect(l).not.toBeNull();
  expect(l!.url.startsWith("https://")).toBe(true);
  expect(l!.label.length).toBeGreaterThan(0);
});

test("unknown operators yield null (no fabricated link)", () => {
  expect(cameraProviderLink("Some brand-new source © Nowhere")).toBeNull();
  expect(cameraProviderLink("")).toBeNull();
  expect(cameraProviderLink(undefined)).toBeNull();
});
