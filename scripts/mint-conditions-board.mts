// Mint a ?c= share link holding one camera tile per provenance tier, so a single
// screenshot is evidence for all of them at once.
//
// WHY A SHARE LINK RATHER THAN CLICKING THE PICKER. The seeded Streets board opens
// with NO camera tiles at all now (a bare map over a pre-drawn circle, asking the
// user to draw their own area — see lib/console/presets.ts), so there is nothing
// to demonstrate any tier from without adding tiles some other way. The tiers that
// carry the real risk — a measured reading, and a reading we refused — need
// specific cameras regardless, and driving the picker for four of them is a long,
// flaky script that tests the picker rather than the overlay. A ?c= link goes
// through decodeLayout -> sanitizeLayout, the same path any shared board takes, so
// this is not a back door: a layout that would not survive sharing will not render
// here either.
//
// The camera ids below were chosen from a LIVE /api/cameras response, each for the
// specific thing it proves. They will rot — a station's state changes with the
// weather, and a sensor gets repaired. Re-pick them from a fresh response rather
// than trusting this list.
//
//   npx tsx scripts/mint-conditions-board.mts
import { BUILTIN_PRESETS } from "../lib/console/presets";
import { encodeLayout } from "../lib/console/share";
import { addWidget } from "../lib/console/reducers";
import type { ShellLayout } from "../lib/console/types";

// Exactly four, because the Streets wall has four rects and reusing one would stack
// two tiles on top of each other — which is a layout artefact of this script, not
// something the product does, and it would make the evidence unreadable.
//
// These four are the half that had never been seen render: a measured reading from
// each country, and a refusal for each of the two reasons a reading can be refused.
// The DERIVED and NONE tiers were already observed on the OLD seeded board, back
// when Streets opened with three fixed webcams (London and Madrid derived; a
// placeless tile saying "no data") rather than today's empty one, so they are not
// spent here — this set is still the untested half.
const SETS: Record<string, { name: string; note: string; stream: { k: string; id: string } }[]> = {
  measured: [
    { name: "EE measured", note: "Saue: Wet, station 0.1 km away", stream: { k: "cam", id: "estonia:419" } },
    { name: "FI measured", note: "Helsinki Pirkkola: Moist, 0.8 km", stream: { k: "cam", id: "digitraffic:C01535" } },
    { name: "Refused: far", note: "Padasjoki: station is 20.2 km away", stream: { k: "cam", id: "digitraffic:C01626" } },
    { name: "Refused: fault", note: "Saterinsolmu: operator says the sensor is faulty", stream: { k: "cam", id: "digitraffic:C01600" } },
  ],
  derived: [
    { name: "Derived", note: "London webcam: no station anywhere", stream: { k: "webcam", id: "windy:1420893641" } },
    { name: "Derived 2", note: "Madrid webcam: the directory miss", stream: { k: "webcam", id: "windy:1606332744" } },
    { name: "No place", note: "YouTube: has no position by design", stream: { k: "yt", id: "jfKfPfyJRdk" } },
    { name: "EE dry", note: "Varja: Dry, 0.3 km", stream: { k: "cam", id: "estonia:86" } },
  ],
};
const TILES = SETS[process.argv[2] ?? "measured"] ?? SETS.measured;

const streets = BUILTIN_PRESETS.find((p) => p.id === "streets");
if (!streets) throw new Error("no streets preset — the id changed, which would orphan every shared board");

// Streets seeds NO camera walls any more (lib/console/presets.ts composes it with
// an empty card list), so there is no template widget left to copy
// segment/order/height/collapsed from. Copying `undefined` used to be legal and
// silent — `{...undefined}` is `{}` — so every minted tile came out missing all
// four fields, and the script printed a warning and shipped a malformed board
// anyway. Minting through `addWidget` (lib/console/reducers.ts) instead means
// each tile gets the SAME reducer every real "add a camera wall" call goes
// through, so there is nothing left to invent:
//   - segment "left" and height CAMSLOT_HEIGHT_PX (280px) are the two values
//     `createCamslot` (lib/console/widgets/camslot.create.ts) passes in;
//   - order and collapsed:false are `addWidget`'s own defaults;
//   - because Streets is a `mode: "wall"` board, `addWidget` also mints a
//     packed `rect` — a wall tile has no widget at all without one.
const CAMSLOT_HEIGHT_PX = 280; // matches lib/console/widgets/camslot.create.ts
let base: ShellLayout = JSON.parse(JSON.stringify(streets.build()));
base.widgets = base.widgets.filter((w) => w.type !== "camslot");
TILES.forEach((t, i) => {
  base = addWidget(base, "camslot", `cond${i}`, {
    segment: "left",
    height: CAMSLOT_HEIGHT_PX,
    config: { name: t.name, intervalMs: 8000, streams: [t.stream] },
  });
});

const c = encodeLayout(base);
console.log(`/app?c=${c}`);
console.error(`\n${TILES.length} tiles:`);
for (const t of TILES) console.error(`  ${t.name.padEnd(16)} ${t.note}`);
