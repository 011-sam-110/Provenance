import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { VISIT_KEY } from "@/lib/analytics/returnFlag";
import { OPT_OUT_KEY } from "@/lib/analytics/optOut";
import { DEFAULT_BEACON_HOST } from "@/lib/analytics/beacon";

// The /privacy page makes public factual claims about what the deployed software
// does. Three of those claims are cheap to break by accident and expensive to have
// wrong in public, so they are pinned here.
//
// This is a COPY guard, not a behaviour test. It cannot tell you whether the page is
// truthful — only a human reading the code can — but it catches the three regressions
// that would make it silently untruthful or unreachable:
//
//   1. the page is orphaned (nothing links to it),
//   2. the AGPL-3.0 §13 source links are dropped out of the site footer while
//      someone is editing that same footer to add or move a link,
//   3. the "last updated" date drifts out of the copy, so a reader cannot tell how
//      old the description is.
//
// Plus the repo's standing user-facing copy rule: hyphens, never em dashes.

const PRIVACY = join("app", "(site)", "privacy", "page.tsx");
const LANDING = join("app", "(site)", "page.tsx");

/** The visible copy only: strip block comments and JSX comment expressions. */
function stripComments(src: string): string {
  return src.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("privacy page", () => {
  it("exists at /privacy inside the (site) route group", () => {
    expect(existsSync(PRIVACY), `${PRIVACY} is missing`).toBe(true);
  });

  it("declares its canonical URL and a title", () => {
    const src = readFileSync(PRIVACY, "utf8");
    expect(src).toContain('canonical: "/privacy"');
    expect(src).toMatch(/export const metadata: Metadata/);
  });

  it("states the date it was last checked against the code", () => {
    const copy = stripComments(readFileSync(PRIVACY, "utf8"));
    // Both the machine-readable attribute and the human-readable text, because a
    // reader needs the second and a crawler reads the first.
    expect(copy).toContain(`dateTime="2026-10-05"`);
    expect(copy).toContain("5 October 2026");
    // The date before this one, in the two shapes it was printed in. Not the bare
    // "4 October 2026": that string is inside "14 October 2026" too.
    expect(copy).not.toContain(`dateTime="2026-10-04"`);
    expect(copy).not.toContain("deployed on 4 October 2026");
    expect(copy).not.toContain("15 September 2026");
  });

  it("uses hyphens, not em dashes, in user-facing copy", () => {
    const copy = stripComments(readFileSync(PRIVACY, "utf8"));
    const offenders = copy
      .split(/\r?\n/)
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /[—–]/.test(line))
      .map(([n, line]) => `${PRIVACY}:${n}: ${line.trim()}`);
    expect(offenders, `em/en dashes in privacy copy:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("is linked from the site footer, so it is not orphaned", () => {
    const src = readFileSync(LANDING, "utf8");
    expect(src).toContain('href="/privacy"');
  });
});

describe("privacy page: the IP claim", () => {
  // This is the regression that actually happened, so it gets a test.
  //
  // The page used to say "no route reads a cookie, a session or your IP address".
  // That was true when it was written and stopped being true the moment
  // app/api/feedback/route.ts landed and read `x-forwarded-for` for rate limiting.
  // Nobody was careless: the two changes were in flight at the same time, and
  // nothing connected the new route to the sentence it falsified.
  //
  // So the connection is made here. The page names exactly one route that reads an
  // identifying header. If a second one appears, this fails and says which file,
  // because the fix is to update the page, not to delete the test.

  const IDENTITY = /x-forwarded-for|x-real-ip|\bcookies\(\)|next\/headers/;
  const EXPECTED = ["app/api/feedback/route.ts"];

  function apiRoutes(dir = join("app", "api"), out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) apiRoutes(p, out);
      else if (/^route\.tsx?$/.test(name)) out.push(p);
    }
    return out;
  }

  it("names every API route that reads an identifying header", () => {
    const readers = apiRoutes()
      .filter((f) => IDENTITY.test(stripComments(readFileSync(f, "utf8"))))
      .map((f) => f.split("\\").join("/"))
      .sort();

    expect(
      readers,
      "An API route reads an identifying header. The /privacy page states which " +
        "routes do that, so update app/(site)/privacy/page.tsx to match before " +
        "changing this list.",
    ).toEqual(EXPECTED);
  });

  it("says out loud that the feedback endpoint reads an address", () => {
    const copy = stripComments(readFileSync(PRIVACY, "utf8"));
    expect(copy).toMatch(/IP address/);
    expect(copy.toLowerCase()).toContain("feedback");
  });
});

describe("AGPL-3.0 section 13 source offer", () => {
  // A hosted AGPL program must offer its Corresponding Source to anyone who
  // interacts with it over a network. Both pages a visitor can land on therefore
  // carry the repo link and the licence link. Removing them is a licence breach,
  // not a styling decision, so it fails the build instead of shipping.
  for (const page of [LANDING, PRIVACY]) {
    it(`${page} links the repository and the licence`, () => {
      const src = readFileSync(page, "utf8");
      expect(src).toMatch(/REPO_URL|BRAND\.repoUrl/);
      expect(src).toContain("BRAND.license.url");
    });
  }
});

describe("privacy page: the return flag", () => {
  // Three sentences became false when the beacon learned to tell a return from a new visit.
  // If any of them comes back, or a storage key is renamed without the page, this fails.
  const copy = stripComments(readFileSync(PRIVACY, "utf8"));

  it("names both storage keys", () => {
    expect(copy).toContain(VISIT_KEY);
    expect(copy).toContain(OPT_OUT_KEY);
  });

  it("no longer promises that nothing links one visit to the next", () => {
    expect(copy).not.toContain("nothing that links this visit to your next one");
    expect(copy).not.toContain("nothing that survives your tab");
    expect(copy).not.toContain("neither follows you");
  });

  it("states the 13 months, both browser signals and the German time zone", () => {
    expect(copy).toContain("13 months");
    expect(copy).toContain("Global Privacy Control");
    expect(copy).toContain("Germany&rsquo;s time zone");
  });

  it("never claims the dates are deleted on a timer, which localStorage cannot do", () => {
    expect(copy).not.toMatch(/deleted (13 months|after 13)/);
  });

  it("renders the opt-out control", () => {
    expect(copy).toContain("<CountingToggle />");
  });

  it("says that the week of the first visit is sent, and no longer that no date is", () => {
    // lib/analytics/returnFlag.ts sends cohort_week, the Monday of the week of the first
    // visit. "The dates are not sent" was true until then and is false after it.
    expect(copy).not.toContain("The dates are not sent");
    expect(copy).toContain("which week you first came");
    expect(copy).toContain("your first visit of each day");
  });

  it("says that a count of visit days is kept, and that only a rough size of it is sent", () => {
    // lib/analytics/returnFlag.ts keeps `days` beside the two dates and sends visit_days, a
    // bucket. "keeps two dates" alone was true until then and is short by one item after it.
    expect(copy).toContain("how many days you have come");
    expect(copy).toContain("7 to 14");
    expect(copy).not.toContain("Your browser keeps two dates in its");
  });
});

describe("privacy page: where PostHog keeps the data", () => {
  // The region is fixed when the PostHog project is made, and the page tells visitors
  // which one it is. On 2026-09-15 the project was found in the US region while this page
  // said "European servers" twice. So the page and the default host are pinned together:
  // to move region, change lib/analytics/beacon.ts and both sentences in one commit.
  const copy = stripComments(readFileSync(PRIVACY, "utf8"));

  it("names the region the default beacon host is in", () => {
    expect(DEFAULT_BEACON_HOST).toBe("https://us.i.posthog.com");
    expect(copy.match(/servers in the United States/g) ?? []).toHaveLength(2);
    expect(copy).not.toMatch(/Europe/);
  });
});

describe("privacy page: PostHog is listed with the hosts that see your IP", () => {
  // The beacon went live on 2026-09-15 with no card here, so the section that lists who
  // sees a visitor's IP address left out a host that sees it on every page. This pins the
  // card. It cannot check the PostHog project's "Discard client IP data" setting, which the
  // card relies on: that setting lives in PostHog, not in this repo.
  const copy = stripComments(readFileSync(PRIVACY, "utf8"));
  const section = copy.slice(
    copy.indexOf("Who sees your IP address."),
    copy.indexOf("Most camera imagery does not work this way."),
  );

  it("has a PostHog card that names both hosts and the discard setting", () => {
    expect(section).toContain('<h3 className="pv-h3">PostHog</h3>');
    expect(section).toContain("us.i.posthog.com");
    expect(section).toContain("us-assets.i.posthog.com");
    expect(section).toContain("does not store it with the event");
  });
});

describe("privacy page: the front page loads no map", () => {
  // From 2026-09-08 to 2026-10-05 the front page's globe was MapLibre on OpenFreeMap tiles,
  // and the OpenFreeMap card said so: "on the landing page it sees you without your opening
  // anything". The rebuild of 2026-10-05 replaced that globe with a 2D canvas drawing one
  // committed file, so the sentence became false: it named a third party that no longer sees
  // a front-page visitor. Both cards now say the front page loads no map tiles.
  //
  // That is a claim about code, so the second case connects it to the code, the same way
  // the IP claim above is connected to the API routes. It is a source guard on the four
  // files that ARE the landing page's globe. It cannot see a tile request made some other
  // way; tests/e2e/landing.spec.ts watches the network for that, and no workflow runs it.
  const copy = stripComments(readFileSync(PRIVACY, "utf8"));
  const section = copy.slice(
    copy.indexOf("Who sees your IP address."),
    copy.indexOf("Most camera imagery does not work this way."),
  );

  it("no longer says a map host sees a front-page visitor, and says when that stopped", () => {
    expect(copy).not.toContain("serves the globe on the FRONT page");
    expect(copy).not.toContain("it sees you without your");
    expect(copy).not.toContain("the globe there moved");
    expect(section).toContain("so the front page loads no map tiles and OpenFreeMap no longer sees you there");
    expect(section).toContain("since 5 October 2026 it loads no map tiles from");
    // The console half of both cards is unchanged and must stay: it still loads these.
    expect(section).toContain("serves the Streets map");
    expect(section).toContain("serves the label fonts");
  });

  it("is true of the code: nothing that draws the landing globe imports MapLibre or a basemap", () => {
    const MAP_IMPORT =
      /(?:from\s+|import\s*\(\s*)["'](?:maplibre-gl|@\/lib\/basemaps|@\/components\/WorldMap|@\/components\/marketing\/(?:GlobeStage|HeroGlobe))["']/;
    const files = [
      LANDING,
      join("components", "marketing", "LandingStage.tsx"),
      join("lib", "marketing", "landingGlobe.ts"),
      join("lib", "marketing", "landingGlobeGL.ts"),
    ];
    const offenders = files.filter((f) => MAP_IMPORT.test(readFileSync(f, "utf8")));
    expect(
      offenders,
      "The landing page imports a map again. /privacy says the front page loads no map " +
        "tiles, so update the OpenFreeMap and CARTO cards in app/(site)/privacy/page.tsx " +
        "before changing this list.",
    ).toEqual([]);
  });

  it("says every typeface is self-hosted, now that there is more than one", () => {
    expect(copy).toContain("Every typeface is self-hosted.");
    expect(copy).toContain("your browser never contacts Google Fonts");
    expect(copy).not.toContain("The typeface is self-hosted");
    // The landing face is loaded through next/font, which is what makes the sentence true.
    // A <link> to fonts.googleapis.com would make it false with no other test noticing.
    const landing = readFileSync(LANDING, "utf8");
    expect(landing).toMatch(/from\s+["']next\/font\/google["']/);
    expect(stripComments(landing)).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });
});
