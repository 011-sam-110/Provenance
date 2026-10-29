// The vessels the God's eye view can be asked for, server only: AISStream's whole
// world (the long-lived socket in lib/signals/ais.ts), Digitraffic, and BarentsWatch
// once its client exists, merged to the newest report per ship.
//
// Why a holder and not a fetch per request: the view asks every minute and again after
// each pan, from every open tab. Digitraffic and BarentsWatch are other people's
// servers, so each is read at most once a minute for the whole deployment, serve-then-
// refresh (the answer is the last good list and the refresh runs behind it, so nobody
// waits on them, except the very first request after a start). A failed refresh keeps
// the last good list for as long as it is inside the vessel TTL; a cold failure is
// "down". The merged list is built at most once every 5 s, whatever the request rate.
//
// It lives on globalThis behind Symbol.for, not in module scope: Next bundles each
// route separately, so module state is per bundle (ais.ts says the same of its socket).
// aisBarentswatch.ts is untouched: its box is a parameter it already takes, and it
// returns null until BARENTSWATCH_CLIENT_ID and BARENTSWATCH_CLIENT_SECRET exist.

import { VESSEL_TTL_MS, aisHeard, newestPerMmsi, type AisVessel, type StreamState } from "@/lib/signals/ais";
import { fetchDigitraffic } from "@/lib/signals/aisDigitraffic";
import { fetchBarentswatch } from "@/lib/signals/aisBarentswatch";

/** Norway's coast and sea, [[swLat, swLon], [neLat, neLon]]: the box BarentsWatch is asked for. */
export const NORWAY_BOX: [[number, number], [number, number]] = [[56, -10], [82, 35]];

/** Each REST feed is read at most this often. */
const FEED_HOLD_MS = 60_000;
/** The merged list is rebuilt at most this often. */
const MERGE_HOLD_MS = 5_000;

interface Held {
  /** The last good list and when it was read. */
  rows: AisVessel[] | null;
  rowsAt: number;
  /** When a read was last tried (good or not): a failing feed is not asked again inside the hold. */
  triedAt: number;
  inflight: Promise<void> | null;
}

export interface WorldVessels {
  vessels: AisVessel[];
  state: StreamState;
  digitraffic: "ok" | "down";
  barentswatch: "off" | "ok" | "down";
}

interface Feeds {
  digitraffic: Held;
  barentswatch: Held;
  merged: { at: number; value: WorldVessels } | null;
  building: Promise<WorldVessels> | null;
}

const FEEDS = Symbol.for("provenance.eye.vesselFeed");
type Holder = { [FEEDS]?: Feeds };

const held = (): Held => ({ rows: null, rowsAt: 0, triedAt: 0, inflight: null });

function feeds(): Feeds {
  const holder = globalThis as Holder;
  return (holder[FEEDS] ??= { digitraffic: held(), barentswatch: held(), merged: null, building: null });
}

/** Test hook: forget everything held. */
export function resetVesselFeed(): void {
  delete (globalThis as Holder)[FEEDS];
}

/**
 * The feed's list: the last good one while it is inside the vessel TTL, else null. A
 * stale list starts one refresh behind the answer; the first read (nothing held) is
 * waited for.
 */
async function read(h: Held, load: () => Promise<AisVessel[] | null>, now: number): Promise<AisVessel[] | null> {
  const due = h.triedAt === 0 || now - h.triedAt >= FEED_HOLD_MS;
  if (due && !h.inflight) {
    h.inflight = load()
      .then((rows) => {
        h.triedAt = Date.now();
        if (rows) {
          h.rows = rows;
          h.rowsAt = h.triedAt;
        }
      })
      .catch(() => {
        h.triedAt = Date.now();
      })
      .finally(() => {
        h.inflight = null;
      });
  }
  if (h.rows == null && h.inflight) await h.inflight;
  return h.rows && now - h.rowsAt <= VESSEL_TTL_MS ? h.rows : null;
}

const barentswatchConfigured = (): boolean =>
  Boolean((process.env.BARENTSWATCH_CLIENT_ID ?? "").trim() && (process.env.BARENTSWATCH_CLIENT_SECRET ?? "").trim());

async function build(): Promise<WorldVessels> {
  const f = feeds();
  const now = Date.now();
  const [heard, digitraffic, barentswatch] = await Promise.all([
    aisHeard(),
    read(f.digitraffic, () => fetchDigitraffic(VESSEL_TTL_MS), now),
    barentswatchConfigured()
      ? read(f.barentswatch, () => fetchBarentswatch(NORWAY_BOX, VESSEL_TTL_MS), now)
      : Promise.resolve<AisVessel[] | null>(null),
  ]);
  return {
    vessels: newestPerMmsi([heard.vessels, digitraffic, barentswatch]),
    state: heard.state,
    digitraffic: digitraffic ? "ok" : "down",
    barentswatch: !barentswatchConfigured() ? "off" : barentswatch ? "ok" : "down",
  };
}

/**
 * Every vessel any feed has heard in the last 20 minutes, one row per ship (its newest
 * report), with the state of each feed. Built at most once every 5 s.
 */
export async function worldVessels(): Promise<WorldVessels> {
  const f = feeds();
  if (f.merged && Date.now() - f.merged.at < MERGE_HOLD_MS) return f.merged.value;
  if (!f.building) {
    f.building = build()
      .then((value) => {
        f.merged = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        f.building = null;
      });
  }
  return f.building;
}
