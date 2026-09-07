"use client";
// What the rail is editing. THE LOAD-BEARING CONTROL OF THIS WHOLE FEATURE.
//
// With several source contexts, a toggle in the Sources tab writes whichever one is
// loaded. A user who flips Aircraft without knowing whether they changed the globe
// or the Kharkiv area has been handed a control that lies about its effect — and
// this codebase has shipped and then fixed two variants of that bug already. So this
// line is rendered in BOTH tabs, not just the Inspector, and it is never hidden.

import { inspectorStore, loadedArea, useInspector } from "@/lib/shell/inspector";
import { scopeStore, WORLD_SCOPE } from "@/lib/shell/scope";

export default function ContextBar() {
  const state = useInspector();
  const area = loadedArea(state);

  return (
    <div className="tn-ctxbar" data-area={area ? "" : undefined}>
      <span className="tn-ctxbar-glyph" aria-hidden>{area ? "▣" : "⌂"}</span>
      <span className="tn-ctxbar-name">{area ? area.label : "World"}</span>
      {area ? (
        <button
          type="button"
          className="tn-ctxbar-x"
          onClick={() => {
            inspectorStore.load(null);
            scopeStore.set(WORLD_SCOPE);
          }}
          title="Back to World"
          aria-label={`Unload ${area.label} and return to World`}
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
