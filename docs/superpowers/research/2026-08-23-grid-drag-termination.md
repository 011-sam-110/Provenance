# Console grid: why a downward drag cannot reorder

*Recorded 2026-08-23. Written up here rather than filed as an issue because issue creation was
refused by a permission gate. The analysis should travel with the PR rather than live in a chat log.*

A downward drag on the console grid cannot reorder cards, and the fix needs an API change rather
than an edit inside `layoutGrid.ts`. Two cheaper fixes were tried and **both were rejected with
evidence**. Neither should be retried as-is.

## What is actually wrong

`settle(items, pinnedId)` is `compact(resolveCollisions(items, pinnedId))`.

`resolveCollisions` honours the pin. `compact` does not: it takes no `pinnedId` at all, and its
loop floats every card up.

Measured at unit level. Board `[A(0,0,3,3), HELD(6,10,3,3)]`, `pinnedId = HELD`:

| stage | HELD.y |
| --- | --- |
| requested | 10 |
| after `resolveCollisions` | 10 — pin honoured |
| after `compact` | 0 — pin ignored |
| after `settle` | 0 |

Measured in a browser at 1440x900, default board `p1@56 p2@281 p3@531 p4@706`:

- the held card tracks the pointer exactly, 706 to 1066
- the dashed ghost **never moves** — it sits at 706 for the whole drag
- on release the card flies 360px back up to where it started

The frozen ghost is the proof, not the puzzle. `commit()` sets `ghostRect` from the store read
back **after** `settle`, and only after the `same` early-return. A ghost that exists but never
moves therefore proves `commit` fired, the store was written, and `settle` put the card back. Had
`commit` never fired there would be no ghost element at all — which is what a gesture blocked by
the boot overlay looks like, and is how the two states are told apart.

The same root cause makes the three-dot menu "move one row down" and ArrowDown inert.

Downward reorder was never uniformly dead, which is why it looked intermittent:

- held card moved **onto** a neighbour (overlapping): the neighbour is pushed below it, so the held
  card stays first in reading order and `compact` restores everything. **Inert.**
- held card moved **clear of** the neighbour: no overlap, reading order flips, the swap works.

One row can never clear a three-row neighbour, so the menu button is 100 percent dead while a long
drag occasionally appears to work.

## Rejected fix 1 — pin compact

Give `compact` the `pinnedId` and skip that card in the float-up loop.

Fixes the drag. **Breaks board restore.** `place()` is `settle(next, id)`, so it pins on every
programmatic placement, not just a live gesture, which exempts restored widgets from compaction and
fails `tests/unit/console-boards.test.ts > REGRESSION: a board switch no longer destroys the board
you came from`.

It also defers the jump rather than removing it. Exempting the held card leaves a hole, and the next
unpinned `settle` closes it, so the card relocates on its own the next time anything else is dragged.
And because downward moves then really move, the board grows past the row budget: two drags on a
900px viewport put two cards below the fold where they cannot be grabbed at all.

## Rejected fix 2 — lift the displaced card in resolveCollisions

When the held card lands on a neighbour, lift the neighbour into the gap above instead of pushing it
down, falling back to a push when it does not fit.

Hand-traces correctly and produces no hole. **It breaks the termination argument**, which that
function states about itself: since every pass either moves a widget down or exits, the bound is a
backstop rather than a real limit.

Every pass moving down is what makes progress monotonic. A lift moves a widget up, so a lift can push
a third card into space a previous pass just cleared, which pushes back. The loop ping-pongs until it
hits `LIMIT` and returns a board that **still overlaps**. The bound stops being a backstop and becomes
the thing that ends the loop.

Caught by the randomised pass, not by review:

```
seed 1      w4 overlaps w8
seed 7      w4 overlaps w8
seed 42     w4 overlaps w8
seed 1337   w5 overlaps w2
seed 90210  w0 overlaps w4
```

All five seeds fail the no-overlap invariant. **All 50 deterministic tests in that file passed.** Only
the randomised pass caught it. It must be kept and extended by whoever does this work.

## The fix this asks for

The swap has to be **one atomic exchange applied before the generic loop**, so the loop stays
push-down-only and keeps its monotonic guarantee.

That needs the held card pre-move rect, which `resolveCollisions` does not have: `settle(items,
pinnedId)` only ever sees the already-moved board, and `place()` discards the old rect on its first
line. So this is an API change threading the previous rect through `place`, `settle` and
`resolveCollisions`, touching a signature with other callers.

Acceptance criteria:

- [ ] dragging a card down onto a neighbour swaps them, with no hole
- [ ] `compact` unchanged, so density and idempotence are untouched
- [ ] existing `place()` callers keep current behaviour when no previous rect is supplied
- [ ] the `console-boards.test.ts` board-switch regression still passes
- [ ] the randomised pass is kept and extended with downward-swap moves
- [ ] the three-dot "move one row down" and ArrowDown work, since they share the cause

## What was shipped instead

Drawing the held card at the settled cell rather than free-tracking the pointer removes the jump
without touching the layout engine. Measured after: an upward drag ends at 281 having been drawn at
281, where before it was drawn at 406 and snapped 125px on release.

It does not make downward reordering work, and it is honest about that in a way worth knowing: a
downward drag now renders as **no movement at all** rather than as movement that is undone. That is
the correct rendering of an engine that refuses the move, and it is why the fix above is worth doing
rather than optional.

---

# Appendix: a pre-existing hydration mismatch in BoardTabs

Unrelated to the grid. Found while working nearby, on `main`, older than either branch.

`BoardTabs` in `components/terminal/TerminalHeader.tsx` calls `isBoardEdited(p.id)` directly during
render (around lines 197 and 221). `isBoardEdited` is `id in read()` in `lib/console/boards.ts`, and
`read()` hits `localStorage`.

There is no mount gate, so for any board the user has customised:

- the server renders `class="tnx-hdr-board"` — no `localStorage`, nothing is edited
- the client hydration pass renders `class="tnx-hdr-board is-edited"`, plus the dot

React reports a hydration mismatch and regenerates the tree on the client.

**Status of this claim.** The mechanism is verified by reading the code — the render-time
`localStorage` read and the absence of a mount gate are both confirmed here. The runtime error itself
was observed by the peer agent working the stage lane, not reproduced in this session.

**Shape of the fix.** Hold `edited` in state and fill it in an effect after mount, so the first client
render matches the server, and let the existing `useShellLayout()` subscription drive updates from
then on. That subscription is already present; the comment above it explains that its value is
deliberately unused and the re-render is the point.
