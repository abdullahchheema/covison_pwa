// Long-press-to-drag for kanban cards on a phone. Press and hold a card
// (~350ms without moving) and it lifts; a dock of drop targets slides up from
// the bottom; drag onto a target and let go. A short tap still opens the card,
// and a quick swipe still scrolls, so there are no gesture conflicts.
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
  const st = useRef<{ timer: number; x: number; y: number; dragging: boolean; avatar?: HTMLElement; dx: number; dy: number; moved: boolean } | null>(null);
  const [lifting, setLifting] = useState(false);
  const [ghost, setGhost] = useState(false);

  const blockScroll = (e: TouchEvent) => {
    if (st.current?.dragging) e.preventDefault();
  };
  useEffect(() => {
    document.addEventListener("touchmove", blockScroll, { passive: false });
    return () => document.removeEventListener("touchmove", blockScroll);
  }, []);

  const end = (drop: boolean) => {
    const s = st.current;
    if (!s) return;
    clearTimeout(s.timer);
    if (s.dragging) {
      s.avatar?.remove();
      const target = active?.over;
      const cb = active?.onDrop;
      active = null;
      notify();
      setGhost(false);
      if (drop && target && target !== currentZone) cb?.(target);
    }
    setLifting(false);
    st.current = null;
  };

  const startDrag = (x: number, y: number) => {
    const el = ref.current;
    const s = st.current;
    if (!el || !s) return;
    s.dragging = true;
    const r = el.getBoundingClientRect();
    s.dx = x - r.left;
    s.dy = y - r.top;
    const av = el.cloneNode(true) as HTMLElement;
    av.classList.add("drag-avatar");
    av.style.width = `${r.width}px`;
    av.style.left = `${r.left}px`;
    av.style.top = `${r.top}px`;
    av.style.margin = "0";
    document.body.appendChild(av);
    s.avatar = av;
    setGhost(true);
    active = { itemId, zones, currentZone, onDrop };
    notify();
  };

  return (
    <div
      ref={ref}
      class={`kcard ${lifting ? "lifting" : ""} ${ghost ? "ghost" : ""} ${cls ?? ""}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onTap()}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const x = e.clientX;
        const y = e.clientY;
        st.current = {
          x,
          y,
          dragging: false,
          dx: 0,
          dy: 0,
          moved: false,
          timer: window.setTimeout(() => {
            if (!st.current || st.current.moved) return;
            setLifting(true);
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            startDrag(st.current.x, st.current.y);
          }, 350),
        };
      }}
      onPointerMove={(e) => {
        const s = st.current;
        if (!s) return;
        if (!s.dragging) {
          if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) {
            s.moved = true;
            clearTimeout(s.timer);
          }
          return;
        }
        s.x = e.clientX;
        s.y = e.clientY;
        if (s.avatar) {
          s.avatar.style.left = `${e.clientX - s.dx}px`;
          s.avatar.style.top = `${e.clientY - s.dy}px`;
        }
        const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-zone]");
        const over = hit?.dataset.zone;
        if (active && active.over !== over) {
          active.over = over;
          notify();
        }
      }}
      onPointerUp={() => {
        const s = st.current;
        if (s && !s.dragging && !s.moved) {
          clearTimeout(s.timer);
          st.current = null;
          setLifting(false);
          onTap();
          return;
        }
        end(true);
      }}
      onPointerCancel={() => end(false)}
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
