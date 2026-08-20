import { NextResponse } from "next/server";
import { isProduction } from "@/lib/discovery/devOnly";
import { readCandidates, readLedger } from "@/lib/discovery/store";

/**
 * The review queue and the verdicts recorded against it.
 *
 * DEV ONLY. Returns 404 when NODE_ENV is production — see `app/admin/layout.tsx` for
 * why the gate is the whole security model here, and
 * `tests/unit/discovery-admin-gate.test.ts` for the test that stops a new route under
 * `app/api/admin` from shipping without one.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  if (isProduction()) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.json({ candidates: readCandidates(), ledger: readLedger() });
}
