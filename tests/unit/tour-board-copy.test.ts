import { expect, test } from "vitest";
import { TOUR_CHAPTERS } from "@/lib/console/tour";
import { BUILTIN_PRESETS } from "@/lib/console/presets";

// THE GUARD THAT WAS MISSING.
//
// lib/console/tour.ts opens with the rule "counts are DERIVED, never typed", and it
// held that rule for signal layers. Boards were never covered by it: the chapter
// said "Six boards" and listed six by name, so adding a seventh would have shipped a
// guided tour that told every new visitor the wrong number and never mentioned the
// board they were being shown. Nothing failed, because nothing looked.
//
// These tests do not check the wording. They check that the wording cannot disagree
// with the console.

const boardsChapter = TOUR_CHAPTERS.find((c) => c.id === "boards");
const allText = () =>
  (boardsChapter?.steps ?? []).flatMap((s) => [s.title, s.body, boardsChapter?.summary ?? ""]).join(" ");

test("the boards chapter exists at all", () => {
  expect(boardsChapter, "the tour has no 'boards' chapter").toBeDefined();
  expect(boardsChapter!.steps.length).toBeGreaterThan(0);
});

test("every built-in board is named in the tour", () => {
  const text = allText();
  for (const p of BUILTIN_PRESETS) {
    expect(text, `the tour never mentions the "${p.title}" board`).toContain(p.title);
  }
});

test("the tour never states a board count that disagrees with the lineup", () => {
  const text = allText().toLowerCase();
  const n = BUILTIN_PRESETS.length;
  const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  // Any spelled number immediately before the word "boards"/"workspaces" has to be
  // the real one. This is what catches a hardcoded "Six boards" after a seventh
  // lands — the failure mode this file exists for.
  const claims = [...text.matchAll(/\b([a-z]+)\s+(boards|ready-made workspaces)\b/g)];
  for (const m of claims) {
    const word = m[1];
    const idx = WORDS.indexOf(word);
    if (idx === -1) continue; // "the boards", "your boards" — not a count
    expect(idx, `the tour claims "${word} ${m[2]}" but there are ${n}`).toBe(n);
  }
});
