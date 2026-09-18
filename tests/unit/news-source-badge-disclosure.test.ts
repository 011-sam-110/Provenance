import { expect, test } from "vitest";
import {
  disclosureClosed,
  disclosureReduce,
  isOpen,
  type Disclosure,
  type DisclosureEvent,
} from "@/components/news/useDisclosure";

/** Replay a run of events from closed and report whether the panel ended open. */
function replay(...events: DisclosureEvent[]): boolean {
  let s: Disclosure = disclosureClosed;
  for (const e of events) s = disclosureReduce(s, e);
  return isOpen(s);
}

test("it starts closed", () => {
  expect(isOpen(disclosureClosed)).toBe(false);
});

test("hovering opens it and leaving closes it again", () => {
  expect(replay("enter")).toBe(true);
  expect(replay("enter", "leave")).toBe(false);
});

// THE MOUSE REGRESSION. A single toggled boolean opens on pointerenter and then
// closes on the click, so clicking the panel you are reading makes it vanish.
test("clicking while hovering keeps the panel open", () => {
  expect(replay("enter", "click")).toBe(true);
  expect(replay("enter", "focus", "click")).toBe(true);
});

// THE TOUCH REGRESSION, and the one that matters most: a phone has no hover, so
// the tap is the only route to the ownership record. Chrome fires pointerenter
// AND focus AND click for one tap, and a toggled boolean cancels itself out.
test("a tap opens the panel, and it survives the pointer leaving", () => {
  expect(replay("enter", "focus", "click")).toBe(true);
  // pointerleave arrives at the end of a tap, before anything else is touched
  expect(replay("enter", "focus", "click", "leave")).toBe(true);
});

test("tapping the next thing dismisses it, because the button loses focus", () => {
  expect(replay("enter", "focus", "click", "leave", "blur")).toBe(false);
});

test("a second click unpins, so a mouse user can put it away", () => {
  expect(replay("enter", "click", "click", "leave")).toBe(false);
});

test("keyboard focus opens it and tabbing away closes it", () => {
  expect(replay("focus")).toBe(true);
  expect(replay("focus", "blur")).toBe(false);
});

test("dismiss closes a pinned panel outright", () => {
  expect(replay("enter", "click", "dismiss")).toBe(false);
});
