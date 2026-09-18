// components/news/useDisclosure.ts
// When a hover panel is open, as a pure state machine.
//
// A panel that opens on hover AND on click cannot store one boolean and toggle
// it, which is the obvious thing to write and is wrong in both directions:
//
//   mouse — pointerenter opens it, then the click toggles it shut, so clicking
//           the thing you are reading makes it vanish.
//   touch — a tap fires pointerenter AND click, so the two cancel and the panel
//           never opens at all. Tap is the only route a phone has to this
//           information, so that is the case that matters most.
//
// So hover and intent are tracked separately and the panel is open if either
// says so. Hover follows the pointer; a click pins the panel open and leaving
// the control entirely (blur) unpins it, which is what dismisses it after a tap.

export interface Disclosure {
  /** The pointer is over the control, or it holds the keyboard focus. */
  hovered: boolean;
  /** The reader asked for it explicitly — a click, or a tap on a phone. */
  pinned: boolean;
}

export type DisclosureEvent = "enter" | "leave" | "focus" | "blur" | "click" | "dismiss";

export const disclosureClosed: Disclosure = { hovered: false, pinned: false };

export function isOpen(s: Disclosure): boolean {
  return s.hovered || s.pinned;
}

export function disclosureReduce(s: Disclosure, e: DisclosureEvent): Disclosure {
  switch (e) {
    case "enter":
    case "focus":
      return s.hovered ? s : { ...s, hovered: true };
    case "leave":
      return s.hovered ? { ...s, hovered: false } : s;
    // Blur means the control lost the reader entirely — the pin goes with it.
    // On a phone this is what closes the panel when the next thing is tapped,
    // because a tap elsewhere takes the focus away from this button.
    case "blur":
    case "dismiss":
      return disclosureClosed;
    case "click":
      return { ...s, pinned: !s.pinned };
  }
}
