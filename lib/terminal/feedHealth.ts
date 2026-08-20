// The pure roll-up behind the Terminal shell's 22px FEED HEALTH strip: one cell
// per registered signal layer, each one telling the truth about that layer.
//
// WHY THIS IS A PURE MODULE AND NOT A HOOK. A strip that lights up 37 cells is
// the single easiest place in this product to tell a lie, so the decision — what
// colour does this layer get, and on what evidence — is a pure function with a
// unit test rather than JSX. Vitest here is the NODE environment with no jsdom
// and no React Testing Library, so anything that needs coverage has to live in
// lib/ as an exported function; this is that function. Nothing in this file
// touches window, document or React, at module scope or anywhere else.
//
// WHERE THE THREE INPUTS COME FROM, AND WHAT EACH ONE CAN AND CANNOT SAY:
//
//   `on`      — signalsStore (lib/signals/store.ts). Signals DEFAULT ALL OFF, so
//               on a first visit this set is EMPTY and all 37 cells are dormant.
//               That is the honest render. A layer nobody switched on has never
//               been fetched, and an unfetched layer is not green.
//
//   `fresh`   — the signal freshness store (lib/signals/freshness.ts), which is
//               written ONLY by <SignalFeed> inside components/WorldMap.tsx and
//               therefore holds a record only while a layer is toggled ON. A
//               stale entry left behind for a layer that has since been switched
//               off must NOT resurface as a live cell — hence `on` is checked
//               before `fresh` below.
//
//   `status`  — one memoised GET /api/status per page (lib/sources/useStatus.ts).
//               This is the ONLY client-side source of "needs a key": SignalSource
//               carries no key field, and capabilityState() needs the server env
//               bag. When /api/status has not answered, useStatus() returns null
//               and we show NO key badge — an absent badge is the honest fallback,
//               and guessing "needs a key" from an empty layer would be a fabrication.
//
// WHAT THIS DELIBERATELY DOES NOT READ. /api/status also publishes a per-layer
// `flow` block (last server-side fetch, rows, ok). It is per-process, and on a
// serverless deployment the instance that fetched an upstream and the instance
// answering /api/status are usually different processes — verified in prod
// 2026-08-11 (app/api/status/route.ts:52-63). So `flow.observed` commonly reads
// false and `flow.ok`/`flow.rows` read null for a layer that is perfectly fine.
// A null there means "not observed by this instance", never down and never live,
// and the safest way to honour that in a 22px strip with no room for a caveat is
// to not colour anything from it at all. Only the capability half of the report
// (state: locked / refused) is deployment-scoped fact, and that is all we use.
//
// AND IT MUST NOT START ANY FETCH. useSignalFeed floors its cadence at 60s per
// id; subscribing the strip to all 37 layers would open 37 concurrent polling
// loops against upstreams we do not own — the exact denial-of-service-on-our-own-
// providers pattern /api/status was written to avoid. The strip is a READER of
// state other components already produce.
//
// FOR THE COMPONENT THAT RENDERS THIS: the strip re-derives on a timer, so it
// must be aria-hidden or sit outside any live region — tests/unit/shell-a11y.test.ts
// asserts the announced status line contains no digits.

import type { FreshKind } from "@/lib/sources/freshKind";
import { chipLabel } from "@/lib/console/freshChip";

/** What one cell in the strip knows about itself. */
export interface FeedCell {
  id: string;
  title: string;
  /** The honest state. "refused" is deliberately distinct from a locked (needs-key) layer. */
  kind: FreshKind | "refused";
  /** Cell fill colour, a CSS custom property reference or hex from the terminal palette. */
  color: string;
  /** 0..1 — dormant and needs-key cells are dimmed. */
  opacity: number;
  /** The state in four words, upper-cased, e.g. "GDACS ALERTS · LIVE". Rendered as
   *  the first line of the cell's tooltip, above the prose in `tip` — the fast read
   *  a glance wants before the explanation it may not. */
  readout: string;
  /** Full tooltip: the layer, its state, and the evidence behind that claim. */
  tip: string;
  /**
   * True when GET /api/status reports this layer `locked` — a required credential
   * this deployment does not hold.
   *
   * ADDITIVE to the agreed contract, and load-bearing: such a layer's honest
   * freshness IS "off" (nothing was ever attempted), so `kind` alone cannot tell
   * "dormant because nobody switched it on" from "dormant because we hold no
   * key" — and feedCounts() has to put those in different buckets. Optional so a
   * hand-built cell in a test or another agent's mock still type-checks.
   */
  locked?: boolean;
}

export interface FeedCounts {
  live: number;
  lag: number;
  down: number;
  key: number;
  dormant: number;
}

/** The tally bucket a cell falls into. Exactly the keys of FeedCounts. */
export type FeedBucket = keyof FeedCounts;

/**
 * The five palette tokens the CSS integrator defines on the Terminal shell.
 * Referenced as custom properties rather than hexes so the scoped token block on
 * the shell stays the single place the palette is decided, and so light/dark
 * both work without this module knowing which is active.
 */
export const FEED_COLOR: Record<FeedBucket, string> = {
  live: "var(--tnx-live)",
  lag: "var(--tnx-lag)",
  down: "var(--tnx-down)",
  key: "var(--tnx-key)",
  dormant: "var(--tnx-dormant)",
};

// Opacity is the strip's second channel, and it carries meaning: a full-strength
// cell is a layer we are actually watching. `empty` borrows the live colour at
// reduced strength exactly as app/globals.css already does for the freshness dot
// (.tn-fresh-empty .tn-fresh-dot { background: var(--tn-live); opacity: 0.45 }) —
// connected, but with nothing in it.
const FULL_OPACITY = 1;
const EMPTY_OPACITY = 0.45;
const KEY_OPACITY = 0.5;
const DORMANT_OPACITY = 0.3;

/**
 * The three layers that publish ONE labelled placeholder feature instead of an
 * empty array when they break: conflict and protests (lib/signals/gdelt.ts
 * `dormantNotice`) and food-security (lib/signals/food-security.ts
 * `foodSecurityNotice`). Their broken payload is `count: 1, ok: true`, which the
 * freshness classifier — correctly, on the evidence it has — calls "live".
 *
 * So for these three, count > 0 does not mean healthy, and the strip says so:
 * a live/empty cell here carries the caveat in its tooltip, and a caller that
 * can actually see the payload passes the id in `placeholderOnly` to have the
 * cell reported as down. We do not downgrade them on suspicion alone — that
 * would be the mirror-image lie.
 */
export const PLACEHOLDER_NOTICE_LAYERS: ReadonlySet<string> = new Set([
  "conflict",
  "protests",
  "food-security",
]);

/** One /api/status entry, structurally — StatusEntry satisfies this. */
interface FeedStatusEntryLike {
  id?: string;
  state?: string;
}

/**
 * The status report, widened.
 *
 * The agreed contract named `sources?: Record<id, { state }>`, but what
 * useStatus() actually returns is a StatusReport with `layers` and
 * `capabilities` ARRAYS (lib/sources/statusReport.ts). Both shapes are accepted
 * so the real hook can be passed straight in and a caller holding a
 * pre-flattened map still works.
 */
export interface FeedStatusLike {
  layers?: readonly FeedStatusEntryLike[];
  capabilities?: readonly FeedStatusEntryLike[];
  sources?: Record<string, FeedStatusEntryLike | undefined>;
}

export interface BuildFeedCellsInput {
  signals: readonly { id: string; title: string }[];
  /** From useStatus(); null when /api/status has not answered. */
  status: FeedStatusLike | null;
  /** From the signal freshness store: per-id classification for layers that are ON. */
  fresh: Readonly<Record<string, FreshKind | undefined>>;
  /** Ids currently switched on in signalsStore. */
  on: ReadonlySet<string>;
  /**
   * ADDITIVE, optional: ids whose current payload has been OBSERVED to be nothing
   * but the layer's labelled "no data" placeholder (see PLACEHOLDER_NOTICE_LAYERS
   * and isPlaceholderOnly). Only a caller that can see the features can know this;
   * omitting it costs nothing but the tooltip caveat.
   */
  placeholderOnly?: ReadonlySet<string>;
}

/** Pure: the capability state /api/status publishes for an id, or undefined. */
function statusStateFor(status: FeedStatusLike | null, id: string): string | undefined {
  if (!status) return undefined;
  const mapped = status.sources?.[id];
  if (mapped?.state) return mapped.state;
  const inLayers = status.layers?.find((l) => l.id === id);
  if (inLayers?.state) return inLayers.state;
  return status.capabilities?.find((c) => c.id === id)?.state;
}

/**
 * Pure: which tally a cell belongs to.
 *
 * `stale` folds into DOWN rather than LAG on purpose. The strip has five buckets
 * and the real state set has eight; of the two places stale could go, LAG is the
 * one that lies — a feed that stopped answering six or more refresh cycles ago is
 * not "a bit behind", and lib/console/freshChip.ts already refuses to excuse it
 * ("a feed that stopped answering hours ago must not be excused as 'nothing
 * happening right now'"). The cell keeps `kind: "stale"`, so the hover readout
 * still says STALE rather than DOWN — only the tally rounds against us.
 *
 * `refused` folds into DOWN and NEVER into KEY. Holding no credential (locked) and
 * holding one the upstream rejects (refused) are different facts with different
 * fixes, and merging them is precisely the class of lie this product exists not
 * to tell.
 *
 * `unknown` sits with `off` in DORMANT: switched on but nothing has come back yet
 * is not a failure, and calling it DOWN would invent one. It matches the shared
 * ordering in lib/sources/freshKind.ts, where off and unknown share a rank.
 */
export function feedBucket(cell: Pick<FeedCell, "kind" | "locked">): FeedBucket {
  if (cell.locked) return "key";
  switch (cell.kind) {
    case "live":
    case "empty":
      return "live";
    case "lagging":
      return "lag";
    case "stale":
    case "down":
    case "refused":
      return "down";
    case "off":
    case "unknown":
      return "dormant";
  }
  // Exhaustive: a new FreshKind fails `tsc --noEmit` here rather than silently
  // landing in whichever bucket happened to be last.
  const exhaustive: never = cell.kind;
  return exhaustive;
}

function opacityFor(cell: Pick<FeedCell, "kind" | "locked">): number {
  if (cell.locked) return KEY_OPACITY;
  if (cell.kind === "off" || cell.kind === "unknown") return DORMANT_OPACITY;
  if (cell.kind === "empty") return EMPTY_OPACITY;
  return FULL_OPACITY;
}

/**
 * The short word for a state. Taken from chipLabel() rather than re-invented, so
 * the strip can never drift from the vocabulary the widget headers and the rail
 * already use. "needs a key" is the one word not in that vocabulary — it is the
 * capability badge's wording (lib/console/widgets/signals.tsx), kept verbatim.
 */
function stateWord(kind: FeedCell["kind"], locked: boolean): string {
  return locked ? "needs a key" : chipLabel(kind, null);
}

function tipFor(
  title: string,
  kind: FeedCell["kind"],
  o: { locked: boolean; statusKnown: boolean; placeholderSeen: boolean; noticeLayer: boolean },
): string {
  const parts: string[] = [];
  if (o.locked) {
    parts.push(
      `${title} needs an API key this deployment does not hold, so it is never fetched. ` +
        `GET /api/status reports it as "locked" — dormant by configuration, not broken.`,
    );
  } else if (kind === "refused") {
    parts.push(
      `${title}: this deployment HOLDS a credential for this layer and the upstream rejected it ` +
        `(401/402/403), observed server-side by /api/status. That is not the same as needing a key — ` +
        `we have one, it is not being accepted.`,
    );
  } else {
    switch (kind) {
      case "off":
        parts.push(
          `${title} is switched off, so it has never been fetched in this session and nothing is ` +
            `known about it. Off is not a fault — and it is not a clean bill of health either.`,
        );
        break;
      case "unknown":
        parts.push(
          `${title} is switched on, but no fetch has completed yet. Nothing has failed; there is ` +
            `simply no reading to report.`,
        );
        break;
      case "live":
        parts.push(
          `${title} is delivering: the last fetch succeeded within two refresh cycles and returned rows.`,
        );
        break;
      case "empty":
        parts.push(
          `${title} is connected and there is genuinely nothing to report right now. An empty feed ` +
            `is a real answer, not a failure.`,
        );
        break;
      case "lagging":
        parts.push(`${title}: the last successful fetch is more than two refresh cycles old.`);
        break;
      case "stale":
        parts.push(
          `${title}: nothing has arrived for more than six refresh cycles. Counted with DOWN rather ` +
            `than LAG, because a feed that stopped answering hours ago must not be excused as ` +
            `"nothing happening right now".`,
        );
        break;
      case "down":
        parts.push(
          `${title}: the last attempt failed. Anything still on the map for this layer is last-good data.`,
        );
        break;
    }
  }
  if (o.placeholderSeen) {
    parts.push(
      `The payload is this layer's labelled "no data" placeholder rather than readings — one feature ` +
        `saying the layer is unavailable, which is why it is not counted as delivering.`,
    );
  } else if (o.noticeLayer && (kind === "live" || kind === "empty")) {
    parts.push(
      `Caveat: this layer publishes ONE labelled placeholder feature when it breaks, so a small ` +
        `non-zero count is not on its own proof of health.`,
    );
  }
  if (!o.statusKnown && !o.locked && kind !== "refused") {
    parts.push(
      `GET /api/status has not answered, so whether this layer needs a key is unknown — no key badge ` +
        `is shown rather than a guess.`,
    );
  }
  return parts.join(" ");
}

/** PURE. One cell per registered signal, in registry order. */
export function buildFeedCells(input: BuildFeedCellsInput): FeedCell[] {
  const statusKnown = input.status != null;
  return input.signals.map((s) => {
    const state = statusStateFor(input.status, s.id);
    const locked = state === "locked";
    const refused = state === "refused";
    const isOn = input.on.has(s.id);
    const placeholderSeen = !locked && !refused && isOn && input.placeholderOnly?.has(s.id) === true;

    // Order of precedence, worst-and-most-specific first:
    //   refused — an observed deployment-level rejection. True whether or not the
    //             user has the layer switched on, and it is what they will hit the
    //             moment they do.
    //   locked  — we hold no credential, so nothing is ever attempted. Every
    //             key-gated signal layer is `kind: "required"`, so a locked layer
    //             cannot be delivering and this cannot mask real data.
    //   off     — nobody switched it on. Checked BEFORE `fresh`, because the
    //             freshness store can hold a record from a layer that has since
    //             been toggled off, and reviving it as live would be a lie.
    //   then whatever the freshness store observed, defaulting to `unknown` (never
    //   to `live`) for a layer that is on but has not reported yet.
    let kind: FeedCell["kind"];
    if (refused) kind = "refused";
    else if (locked) kind = "off";
    else if (!isOn) kind = "off";
    else if (placeholderSeen) kind = "down";
    else kind = input.fresh[s.id] ?? "unknown";

    const bucket = feedBucket({ kind, locked });
    return {
      id: s.id,
      title: s.title,
      kind,
      color: FEED_COLOR[bucket],
      opacity: opacityFor({ kind, locked }),
      readout: `${s.title.toUpperCase()} · ${stateWord(kind, locked).toUpperCase()}`,
      tip: tipFor(s.title, kind, {
        locked,
        statusKnown,
        placeholderSeen,
        noticeLayer: PLACEHOLDER_NOTICE_LAYERS.has(s.id),
      }),
      locked,
    };
  });
}

/** PURE. The strip's four tallies. Fold "refused" into down, never into key. */
export function feedCounts(cells: readonly FeedCell[]): FeedCounts {
  const counts: FeedCounts = { live: 0, lag: 0, down: 0, key: 0, dormant: 0 };
  for (const cell of cells) counts[feedBucket(cell)] += 1;
  return counts;
}

/**
 * PURE. Is this feature one of the labelled "no data" placeholders rather than a
 * reading? Both emitters use the `<signalId>:unavailable` id and a `props.status`
 * that announces itself ("unavailable", "STATUS NOTICE — not a measurement").
 */
export function isPlaceholderFeature(
  f: { id?: string; props?: Record<string, unknown> } | null | undefined,
): boolean {
  if (!f) return false;
  if (typeof f.id === "string" && f.id.endsWith(":unavailable")) return true;
  const status = f.props?.status;
  return (
    typeof status === "string" &&
    (status.startsWith("unavailable") || status.startsWith("STATUS NOTICE"))
  );
}

/**
 * PURE. Does this payload consist of nothing but placeholders? That — not a bare
 * count — is what a caller should put in `placeholderOnly`. An empty payload is
 * NOT placeholder-only: zero features is the honest `empty` state and has its own
 * colour already.
 */
export function isPlaceholderOnly(
  features: readonly ({ id?: string; props?: Record<string, unknown> } | null | undefined)[] | null | undefined,
): boolean {
  if (!features || features.length === 0) return false;
  return features.every((f) => isPlaceholderFeature(f));
}
