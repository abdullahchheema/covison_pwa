// A vertical board: stages stacked top to bottom. Each stage section is a
// drop target for the long-press drag in ui/drag.tsx, and lights up while a
// card is held over it.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { useDragOver } from "./drag";

export function StageSection({
  id,
  head,
  right,
  empty,
  children,
  count,
  limit,
}: {
  id: string;
  head: ComponentChildren;
  right?: ComponentChildren;
  empty: ComponentChildren;
  children: ComponentChildren[];
  count: number;
  /** Show only this many cards until "Show all" is tapped (e.g. for Won). */
  limit?: number;
}) {
  const drag = useDragOver();
  const [all, setAll] = useState(false);
  const over = drag.dragging && drag.over === id;
  const home = drag.dragging && drag.from === id;
  const shown = limit && !all ? children.slice(0, limit) : children;
  return (
    <section class={`stage-sec ${over ? "drop-target" : ""} ${drag.dragging && !home ? "droppable" : ""}`} data-zone={id} aria-label={typeof head === "string" ? head : undefined}>
      <div class="stage-sec-head">
        <span class="row gap8">
          {head}
          <span class="t-subhead c3 num">{count}</span>
        </span>
        {right}
      </div>
      <div class="stage-sec-body">
        {count === 0 ? <div class="stage-empty">{over ? "Drop here" : empty}</div> : shown}
        {limit && !all && count > limit && (
          <button class="link t-subhead" style="padding:6px 4px" onClick={() => setAll(true)}>
            Show all {count}
          </button>
        )}
      </div>
    </section>
  );
}
