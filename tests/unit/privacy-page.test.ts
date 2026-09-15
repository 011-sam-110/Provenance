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
    expect(copy).toContain(`dateTime="2026-09-15"`);
    expect(copy).toContain("15 September 2026");
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
