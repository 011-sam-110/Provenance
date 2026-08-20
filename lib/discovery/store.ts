/**
 * Where the review queue and the verdicts live: two JSON files in the repository.
 *
 * WHY FILES AND NOT A DATABASE. This repository has no database, and the /privacy page
 * makes that a checkable claim about the deployed product rather than an implementation
 * note. Camera curation does not need one: the queue is hundreds of rows, it is written
 * by one person on one laptop, and the thing you most want from a curation record — to
 * see in a pull request that fourteen cameras were admitted and why — is what a JSON
 * file in git gives you and a hosted table does not.
 *
 * EVERYTHING HERE IS DEV-ONLY. `node:fs` in this repo is otherwise absent by design, so
 * this module is imported exclusively by routes under `app/api/admin/`, and every one
 * of those returns 404 when NODE_ENV is production. `tests/unit/discovery-admin-gate.test.ts`
 * pins that, because the gate is the only thing standing between a review tool and a
 * public write endpoint.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Candidate, CameraVerdict, FeedVerdict, ReviewLedger } from "@/lib/discovery/types";

const DATA_DIR = join(process.cwd(), "data", "discovery");
export const CANDIDATES_PATH = join(DATA_DIR, "candidates.json");
export const LEDGER_PATH = join(DATA_DIR, "ledger.json");

function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    // A half-written file must not take the review tool down; the reviewer can see
    // the empty queue and re-run discovery, which is a better failure than a 500.
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  // Two-space JSON with a trailing newline, so a verdict is a one-line diff in a PR
  // rather than a re-flow of the whole file.
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export function readCandidates(): Candidate[] {
  return readJson<Candidate[]>(CANDIDATES_PATH, []);
}

export function writeCandidates(candidates: Candidate[]): void {
  writeJson(CANDIDATES_PATH, candidates);
}

export function readLedger(): ReviewLedger {
  return readJson<ReviewLedger>(LEDGER_PATH, { feeds: [], cameras: [] });
}

export function writeLedger(ledger: ReviewLedger): void {
  writeJson(LEDGER_PATH, ledger);
}

/**
 * Record one camera verdict, replacing any earlier verdict on the same camera.
 *
 * Replacing rather than appending is deliberate: a reviewer who changes their mind is
 * the normal case, and a ledger that keeps both says two contradictory things about
 * the same camera with no rule for which wins. The undo in the review UI is this
 * function called again with the previous value, not a separate history.
 */
export function recordCameraVerdict(ledger: ReviewLedger, verdict: CameraVerdict): ReviewLedger {
  const cameras = ledger.cameras.filter(
    (v) => !(v.candidateId === verdict.candidateId && v.nativeId === verdict.nativeId),
  );
  cameras.push(verdict);
  return { ...ledger, cameras };
}

/** Record one feed verdict, replacing any earlier verdict on the same feed. */
export function recordFeedVerdict(ledger: ReviewLedger, verdict: FeedVerdict): ReviewLedger {
  const feeds = ledger.feeds.filter((v) => v.candidateId !== verdict.candidateId);
  feeds.push(verdict);
  return { ...ledger, feeds };
}

/** Drop a camera verdict entirely — the undo the review UI's back button needs. */
export function removeCameraVerdict(ledger: ReviewLedger, candidateId: string, nativeId: string): ReviewLedger {
  return {
    ...ledger,
    cameras: ledger.cameras.filter((v) => !(v.candidateId === candidateId && v.nativeId === nativeId)),
  };
}
