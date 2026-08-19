/**
 * Every camera network that discovery proposed and a human admitted.
 *
 * THIS FILE IS THE GATE. `lib/sources/discovered.ts` serves exactly what is listed
 * here and nothing else, and the only way a row lands here is a reviewer working
 * through `/admin/verify` one camera at a time and then running
 * `node scripts/promote-candidates.mjs`. There is no automatic path from a crawl to a
 * pin on the map, by construction rather than by policy.
 *
 * HOW TO READ A ROW. `review` says who admitted it, when, and on how many cameras
 * they actually looked at — `sampled: 12` means twelve pictures were opened, not that
 * twelve rows validated. `blocked` lists native ids a reviewer rejected individually.
 * `license` is copied from what the operator or its catalogue states; where nothing is
 * stated it says so in those words, because a licence nobody granted is worse than an
 * absent one.
 *
 * WHY IT IS EMPTY. Discovery has been run and its candidates are in
 * `data/discovery/candidates.json`, but an admitted feed needs a person to look at the
 * pictures, and this file records people rather than intentions. An empty array here
 * is the honest state of the review queue, not an unfinished feature — the pipeline,
 * the queue and the reviewer are all shipped and working. Everything else in this repo
 * would let you write a plausible row; this comment exists so nobody does.
 */

import type { AdmittedFeed } from "@/lib/discovery/types";

export const ADMITTED_FEEDS: AdmittedFeed[] = [];
