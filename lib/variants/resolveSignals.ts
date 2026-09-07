import type { SignalSelection } from "@/lib/variants/types";
import type { SignalState } from "@/lib/signals/store";
import { MAP_SIGNALS } from "@/lib/signals/registry";

export function resolveSignals(sel?: SignalSelection): SignalState {
  if (!sel) return {};
  const on = new Set<string>();
  const groups = sel.groups ?? [];
  const all = groups.includes("*");
  for (const s of MAP_SIGNALS) {
    if (all || groups.includes(s.group)) on.add(s.id);
  }
  for (const id of sel.ids ?? []) on.add(id);
  for (const id of sel.exclude ?? []) on.delete(id);
  const out: SignalState = {};
  for (const id of on) out[id] = true;
  return out;
}
