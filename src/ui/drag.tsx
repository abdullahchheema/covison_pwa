// Long-press-to-drag for board cards (deals and projects) on a phone.
//
// Press and hold a card (~0.35 s without moving): it lifts and a dock of drop
// targets slides up from the bottom. Drag onto a target and let go.
// A quick swipe still scrolls the board, and a tap still opens the card.
//
// Touch input uses touch events, not pointer events: iOS fires pointercancel
// as soon as it decides a touch might be a scroll, which killed the drag.
// With touch events, once the card has lifted every touchmove is
// preventDefault-ed, so the page can't scroll away from under the finger.
// A mouse uses pointer events.
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

export interface DropZone {
  id: string;
  label: string;
  sub?: string;
}

interface DragState {
  itemId: string;
  zones: DropZone[];
  currentZone?: string;
  over?: string;
  onDrop: (zoneId: string) => void;
}

let active: DragState | null = null;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

const HOLD_MS = 350;
const SLOP = 10;

interface Gesture {
  timer: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  dragging: boolean;
  moved: boolean;
  avatar?: HTMLElement;
  dx: number;
  dy: number;
}

export function Draggable({
  itemId,
  zones,
  currentZone,
  onDrop,
  onTap,
  children,
  class: cls,
}: {
  itemId: string;
  zones: DropZone[];
  currentZone?: string;
  onDrop: (zoneId: string) => void;
  onTap: () => void;
  children: ComponentChildren;
  class?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const g = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef({ itemId, zones, currentZone, onDrop });
  latest.current = { itemId, zones, currentZone, onDrop };
  const [lifting, setLifting] = useState(false);
  const [ghost, setGhost] = useState(false);

  const lift = () => {
    const el = ref.current;
    const s = g.current;
    if (!el || !s || s.moved) return;
    s.dragging = true;
    setLifting(true);
    const r = el.getBoundingClientRect();
    s.dx = s.x - r.left;
    s.dy = s.y - r.top;
    const av = el.cloneNode(true) as HTMLElement;
    av.classList.add("drag-avatar");
    av.classList.remove("lifting", "ghost");
    av.style.width = `${r.width}px`;
    av.style.left = `${r.left}px`;
    av.style.top = `${r.top}px`;
    av.style.margin = "0";
    document.body.appendChild(av);
    s.avatar = av;
    setGhost(true);
    const { itemId: id, zones: z, currentZone: cz, onDrop: od } = latest.current;
    active = { itemId: id, zones: z, currentZone: cz, onDrop: od };
    notify();
  };

  const track = (x: number, y: number) => {
    const s = g.current;
    if (!s) return;
    s.x = x;
    s.y = y;
    if (!s.dragging) {
      if (Math.hypot(x - s.x0, y - s.y0) > SLOP) {
        s.moved = true; // it's a scroll, not a hold
        clearTimeout(s.timer);
      }
      return;
    }
    if (s.avatar) {
      s.avatar.style.left = `${x - s.dx}px`;
      s.avatar.style.top = `${y - s.dy}px`;
    }
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-zone]");
    const over = hit?.dataset.zone;
    if (active && active.over !== over) {
      active.over = over;
      notify();
    }
  };

  const finish = (drop: boolean) => {
    const s = g.current;
    g.current = null;
    if (!s) return;
    clearTimeout(s.timer);
    setLifting(false);
    if (!s.dragging) return;
    suppressClick.current = true; // the click that follows a drag isn't a tap
    setTimeout(() => (suppressClick.current = false), 400);
    s.avatar?.remove();
    const target = active?.over;
    const cb = active?.onDrop;
    const cur = active?.currentZone;
    active = null;
    notify();
    setGhost(false);
    if (drop && target && target !== cur) cb?.(target);
  };

  const start = (x: number, y: number, target: EventTarget | null) => {
    if ((target as HTMLElement | null)?.closest("[data-nodrag]")) return;
    g.current = { timer: window.setTimeout(lift, HOLD_MS), x0: x, y0: y, x, y, dragging: false, moved: false, dx: 0, dy: 0 };
  };

  // Touch (iPhone)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ts = (e: TouchEvent) => {
      if (e.touches.length !== 1) return finish(false);
      start(e.touches[0].clientX, e.touches[0].clientY, e.target);
    };
    const tm = (e: TouchEvent) => {
      const s = g.current;
      if (!s) return;
      if (s.dragging) e.preventDefault(); // keep the board from scrolling under the finger
      track(e.touches[0].clientX, e.touches[0].clientY);
    };
    const te = () => finish(true);
    const tc = () => finish(false);
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", te);
    el.addEventListener("touchcancel", tc);
    return () => {
      el.removeEventListener("touchstart", ts);
      el.removeEventListener("touchmove", tm);
      el.removeEventListener("touchend", te);
      el.removeEventListener("touchcancel", tc);
    };
  }, []);

  // Mouse (desktop testing)
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    start(e.clientX, e.clientY, e.target);
    const move = (ev: PointerEvent) => track(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      finish(true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={ref}
      class={`kcard ${lifting ? "lifting" : ""} ${ghost ? "ghost" : ""} ${cls ?? ""}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onTap()}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={onPointerDown}
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        onTap();
      }}
    >
      {children}
    </div>
  );
}

/** The drop dock. Mount once per board screen. */
export function DropDock() {
  const [, force] = useState(0);
  useEffect(() => {
    const s = () => force((n) => n + 1);
    subs.add(s);
    return () => void subs.delete(s);
  }, []);
  if (!active) return null;
  return (
    <div class="drop-dock" aria-hidden="true">
      {active.zones.map((z) => (
        <div key={z.id} data-zone={z.id} class={`dz ${active!.over === z.id ? "over" : ""} ${active!.currentZone === z.id ? "current" : ""}`}>
          <span class="truncate" style="max-width:100%;padding:0 6px">{z.label}</span>
          {z.sub && <span class="t-caption" style="opacity:.75">{z.sub}</span>}
        </div>
      ))}
    </div>
  );
}
