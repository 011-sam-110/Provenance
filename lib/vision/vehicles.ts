// What the vehicle tracker looks for, and how each kind is drawn.
//
// The model is trained on COCO's 80 classes. Five of them are road vehicles; every
// other class is dropped in decode.ts before NMS, so a person or a traffic light can
// never take an ID. People are left out on purpose: this is a vehicle counter, and a
// person class on public cameras is a different product with different questions.

export type VehicleKind = "car" | "truck" | "bus" | "motorcycle" | "bicycle";

/** COCO class index -> vehicle kind. */
export const COCO_VEHICLES: ReadonlyMap<number, VehicleKind> = new Map([
  [1, "bicycle"],
  [2, "car"],
  [3, "motorcycle"],
  [5, "bus"],
  [7, "truck"],
]);

export const VEHICLE_KINDS: readonly VehicleKind[] = ["car", "truck", "bus", "motorcycle", "bicycle"];

/** On-video label, sentence case: "Car 14". */
export const KIND_NAME: Record<VehicleKind, string> = {
  car: "Car",
  truck: "Truck",
  bus: "Bus",
  motorcycle: "Motorbike",
  bicycle: "Bike",
};

/** Plural, for the counts line. */
export const KIND_PLURAL: Record<VehicleKind, string> = {
  car: "cars",
  truck: "trucks",
  bus: "buses",
  motorcycle: "motorbikes",
  bicycle: "bikes",
};

/**
 * TWO hues, not five. A busy motorway carries fifty outlines at once, and five
 * hues over that read as confetti; the label already names the kind. The split
 * that matters at a glance is light against heavy. Both stay readable over grey
 * daylight asphalt and over night video, and neither is red (brake lights) or
 * yellow (lane paint, sodium lamps), so an outline never sinks into the scene.
 */
const LIGHT = "#5eead4";
const HEAVY = "#a5b4fc";
export const KIND_COLOUR: Record<VehicleKind, string> = {
  car: LIGHT,
  motorcycle: LIGHT,
  bicycle: LIGHT,
  truck: HEAVY,
  bus: HEAVY,
};
