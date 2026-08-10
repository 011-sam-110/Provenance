import { describe, expect, test } from "vitest";
import {
  composeHeuristicBrief,
  formatBriefDate,
  listPhrase,
  parseBriefResponse,
  buildBriefPrompt,
  type BriefSnapshot,
} from "@/lib/brief";

// Shape mirrors what app/api/brief/route.ts builds from INSTABILITY_SOURCE:
// country + 0-100 score + the " › "-joined driver labels, ranked densest first.
const SNAPSHOT: BriefSnapshot = {
  topInstability: [
    { country: "Sudan", score: 62, drivers: ["displacement", "food insecurity"] },
    { country: "Syria", score: 55, drivers: ["displacement", "food insecurity"] },
    { country: "Afghanistan", score: 48, drivers: ["displacement"] },
    { country: "Somalia", score: 31, drivers: ["food insecurity"] },
  ],
  totalRanked: 37,
  factorsMissing: ["armed conflict"],
  dateIso: "2026-08-10",
};

describe("formatBriefDate", () => {
  test("formats an ISO date locale-free", () => {
    expect(formatBriefDate("2026-08-10")).toBe("10 August 2026");
    expect(formatBriefDate("2026-01-01")).toBe("1 January 2026");
  });

  test("returns null for anything that is not a plain ISO date", () => {
    expect(formatBriefDate(undefined)).toBeNull();
    expect(formatBriefDate("")).toBeNull();
    expect(formatBriefDate("10/08/2026")).toBeNull();
    expect(formatBriefDate("2026-13-01")).toBeNull();
  });
});

describe("listPhrase", () => {
  test("joins with an Oxford-free 'and'", () => {
    expect(listPhrase(["a"])).toBe("a");
    expect(listPhrase(["a", "b"])).toBe("a and b");
    expect(listPhrase(["a", "b", "c"])).toBe("a, b and c");
    expect(listPhrase([])).toBe("");
  });
});

describe("composeHeuristicBrief — keyless, and every clause is arithmetic", () => {
  const brief = composeHeuristicBrief(SNAPSHOT)!;

  test("produces text without any key or network", () => {
    expect(typeof brief).toBe("string");
    expect(brief.length).toBeGreaterThan(80);
  });

  test("leads with the date and the real count above the floor", () => {
    expect(brief).toContain("10 August 2026: 37 countries are above the Country Instability Index reporting floor.");
  });

  test("names the top three with their scores, in rank order", () => {
    expect(brief).toContain("Pressure is heaviest in Sudan (62/100), Syria (55/100) and Afghanistan (48/100).");
  });

  test("counts the most common driver rather than asserting a cause", () => {
    // displacement 3, food insecurity 3 → tie broken alphabetically for determinism.
    expect(brief).toContain("Across the 4 highest-scoring countries, displacement is the most common driver, present in 3.");
  });

  test("states the spread of the ranked group", () => {
    expect(brief).toContain("Scores in that group run from 62 down to 31 out of 100.");
  });

  test("declares missing factors and which way they bias the score", () => {
    expect(brief).toContain("no armed conflict data reached the index today");
    expect(brief).toContain("understate rather than overstate");
  });

  test("says nothing at all when there is nothing to say", () => {
    expect(composeHeuristicBrief({ topInstability: [] })).toBeNull();
    expect(composeHeuristicBrief({ topInstability: [{ country: "", score: 50 }] })).toBeNull();
    expect(composeHeuristicBrief({ topInstability: [{ country: "X", score: Number.NaN }] })).toBeNull();
  });

  test("omits the coverage note when every factor has data", () => {
    const full = composeHeuristicBrief({ ...SNAPSHOT, factorsMissing: [] })!;
    expect(full).not.toContain("Coverage note");
  });

  test("handles a single ranked country without broken grammar", () => {
    const one = composeHeuristicBrief({
      topInstability: [{ country: "Yemen", score: 44, drivers: ["food insecurity"] }],
      totalRanked: 1,
      dateIso: "2026-08-10",
    })!;
    expect(one).toContain("1 country is above");
    expect(one).toContain("Pressure is heaviest in Yemen (44/100).");
    expect(one).not.toContain("run from");
  });

  test("never invents an event, a casualty figure or a forecast", () => {
    expect(brief).not.toMatch(/killed|casualt|expected to|likely|forecast|will /i);
  });
});

describe("model path helpers are unchanged", () => {
  test("the prompt still grounds on the same snapshot", () => {
    const prompt = buildBriefPrompt(SNAPSHOT);
    expect(prompt).toContain("Sudan (62/100)");
    expect(prompt).toContain("Do not invent specific events");
  });

  test("parseBriefResponse extracts content or null", () => {
    expect(parseBriefResponse({ choices: [{ message: { content: "  hello  " } }] })).toBe("hello");
    expect(parseBriefResponse({ choices: [{ message: { content: "   " } }] })).toBeNull();
    expect(parseBriefResponse({})).toBeNull();
    expect(parseBriefResponse(null)).toBeNull();
  });
});
