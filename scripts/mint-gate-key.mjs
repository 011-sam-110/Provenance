#!/usr/bin/env node
/**
 * Mint a temporary access key for the maintenance gate.
 *
 *   node scripts/mint-gate-key.mjs            # 30 minutes
 *   node scripts/mint-gate-key.mjs 90         # 90 minutes
 *
 * Runs on Node's built-in TypeScript stripping (Node 22.18+), so it imports the SAME
 * module the edge runs rather than reimplementing the HMAC. A second implementation
 * would drift, and the failure mode of drift here is a key that mints cleanly and is
 * refused in production.
 *
 * THERE IS NO --count. A key is a pure function of (master code, expiry second), so
 * minting twice in the same second returns the identical string - a "batch" would print
 * the same key N times. That is not a bug to paper over: without storage there is no
 * per-key identity, so handing a key to five people IS handing out one key five times,
 * and the tool should not imply otherwise.
 *
 * Needs the master code in the environment:
 *
 *   MAINTENANCE_PASSWORD=... node scripts/mint-gate-key.mjs
 *   vercel env pull .env.production.local && node --env-file=.env.production.local scripts/mint-gate-key.mjs
 *
 * WHY THIS IS A SCRIPT AND NOT AN ENDPOINT. A `/api/gate/mint` route would be more
 * convenient — mint a key from a phone, paste it into Discord — but it would put a
 * second password-checking door on a site that has no rate limiting, during exactly the
 * month when nobody is watching it. This runs on a machine that already has the code,
 * so it adds no attack surface at all. If the convenience turns out to matter more than
 * the surface, the endpoint is a small change and this file already has the logic.
 *
 * The key is verified before it is printed. Minting and checking share one
 * implementation (lib/gate/tempkey.ts) — the same file the edge runs — so a key that
 * prints here cannot fail in production for a reason this script could have caught.
 */

import { mintTempKey, verifyTempKey, tempKeyTtlSeconds, TEMP_KEY_DEFAULT_MINUTES }
  from "../lib/gate/tempkey.ts";

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const minutes = positional.length ? Number(positional[0]) : TEMP_KEY_DEFAULT_MINUTES;

const secret = process.env.MAINTENANCE_PASSWORD ?? "";
if (!secret) {
  die(
    "MAINTENANCE_PASSWORD is not set, and a key signed with an empty code would be\n" +
    "  accepted by a deployment that has no code set at all. Pull it first:\n\n" +
    "    vercel env pull .env.production.local\n" +
    "    node --env-file=.env.production.local scripts/mint-gate-key.mjs",
  );
}
let ttl;
try {
  ttl = tempKeyTtlSeconds(minutes);
} catch (err) {
  die(err.message);
}

const now = Math.floor(Date.now() / 1000);
const expiresAt = now + ttl;

const key = await mintTempKey(secret, expiresAt);

// Verified before it is printed, with the same function the edge will use. A key that
// prints here cannot then fail in production for a reason this script could have caught.
const check = await verifyTempKey(secret, key, now);
if (!check.ok) die(`Minted a key that does not verify (${check.reason}). This is a bug.`);

console.log(
  `\n  Key, valid ${minutes} minute${minutes === 1 ? "" : "s"}, ` +
  `until ${new Date(expiresAt * 1000).toISOString().replace("T", " ").slice(0, 16)} UTC:\n\n` +
  `    ${key}\n`,
);

console.log(
  "\n  Paste one into the access-code box on the maintenance page.\n" +
  "  It stops working at the time above, wherever it has been forwarded to.\n" +
  "  To kill every outstanding key early, change MAINTENANCE_PASSWORD — which also\n" +
  "  logs out every existing session, because nothing is stored per key.\n",
);
