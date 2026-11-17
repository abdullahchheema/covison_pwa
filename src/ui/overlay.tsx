// Global overlays: toasts, bottom sheets, action sheets and confirms.
// A tiny store keeps them outside the screen tree so page transitions never
// interrupt an open sheet.
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon, type IconName } from "./icons";

// ---------------- store ----------------
type Listener = () => void;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l());
function useStore() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
}

// ---------------- toasts ----------------
interface ToastItem {
  id: number;
  text: string;
  icon: IconName;
  tone: "info" | "error";
  action?: { label: string; run: () => void };
  leaving?: boolean;
  ms: number;
}
let toasts: ToastItem[] = [];
let toastSeq = 0;

export function toast(
  text: string,
  opts: { icon?: IconName; error?: boolean; action?: { label: string; run: () => void }; ms?: number } = {},
) {
  const item: ToastItem = {
    id: ++toastSeq,
    text,
    icon: opts.icon ?? (opts.error ? "alert" : "checkCircle"),
    tone: opts.error ? "error" : "info",
    action: opts.action,
    ms: opts.ms ?? (opts.action ? 5000 : 2600),
  };
  toasts = [...toasts.slice(-2), item];
  emit();
  setTimeout(() => dismissToast(item.id), item.ms);
}

function dismissToast(id: number) {
  if (!toasts.some((t) => t.id === id && !t.leaving)) return;
  toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 260);
}

/** Toast with an Undo button that runs `undo` (used after every delete). */
export function undoToast(text: string, undo: () => Promise<void> | void) {
  toast(text, { icon: "trash", action: { label: "Undo", run: () => void undo() } });
}

function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} class={`toast ${t.tone === "error" ? "error" : ""} ${t.leaving ? "leaving" : ""}`}>
          <Icon name={t.icon} size={20} class="t-ico" />
          <span class="grow">{t.text}</span>
          {t.action && (
            <button
              class="t-action press"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------- sheets ----------------
export interface SheetOptions {
  title?: string;
  full?: boolean;
  /** Left header button (defaults to "Cancel"). */
  cancelLabel?: string;
  /** Right header button. */
  done?: { label: string; run: () => boolean | void | Promise<boolean | void>; disabled?: boolean };
}
interface SheetItem {
  id: number;
  render: (close: () => void) => ComponentChildren;
  opts: SheetOptions & { bare?: boolean; onClose?: () => void };
  closing?: boolean;
}
let sheets: SheetItem[] = [];
let sheetSeq = 0;

export function openSheet(
  render: (close: () => void) => ComponentChildren,
  opts: SheetOptions & { bare?: boolean; onClose?: () => void } = {},
): () => void {
  const id = ++sheetSeq;
  sheets = [...sheets, { id, render, opts }];
  emit();
  return () => closeSheet(id);
}

export function closeSheet(id: number) {
  const item = sheets.find((s) => s.id === id && !s.closing);
  if (!item) return;
  item.opts.onClose?.();
  sheets = sheets.map((s) => (s.id === id ? { ...s, closing: true } : s));
  emit();
  setTimeout(() => {
    sheets = sheets.filter((s) => s.id !== id);
    emit();
  }, 300);
}

export function closeAllSheets() {
  sheets.forEach((s) => closeSheet(s.id));
}

function Sheet({ item }: { item: SheetItem }) {
  const ref = useRef<HTMLDivElement>(null);
  // Swipe down to dismiss, from anywhere on the sheet (like iOS): a downward
  // swipe closes it when the content is already scrolled to the top; when the
  // content is scrolled down, the swipe scrolls it instead. Touch events are
  // used for fingers (pointer events get cancelled by iOS scrolling); pointer
  // events only for a mouse.
  const drag = useRef<{ x0: number; y0: number; y: number; t0: number; active: boolean; fromBody: boolean; moved: boolean } | null>(null);
  const close = () => closeSheet(item.id);
  const [busy, setBusy] = useState(false);

  const begin = (x: number, y: number, target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (el?.closest("input, textarea, select")) return; // let fields work normally
    drag.current = { x0: x, y0: y, y: 0, t0: performance.now(), active: false, fromBody: !!el?.closest(".sheet-body"), moved: false };
  };
  const move = (x: number, y: number): boolean => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return false;
    const dy = y - d.y0;
    const dx = x - d.x0;
    if (!d.active) {
      if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(dx)) return false;
      const body = el.querySelector<HTMLElement>(".sheet-body");
      const atTop = !body || body.scrollTop <= 0;
      if (dy < 0 || (d.fromBody && !atTop)) {
        drag.current = null; // a normal scroll
        return false;
      }
      d.active = true;
      d.y0 = y;
      el.style.transition = "none";
    }
    const off = y - d.y0;
    const yy = off < 0 ? -Math.sqrt(-off) * 2 : off;
    d.y = yy;
    d.moved = true;
    el.style.transform = `translate3d(0, ${yy}px, 0)`;
    return true;
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    const el = ref.current;
    if (!d || !el || !d.active) return;
    const v = d.y / Math.max(1, performance.now() - d.t0);
    if (d.y > 110 || (v > 0.5 && d.y > 30)) {
      el.style.setProperty("--drag-y", `${d.y}px`);
      el.style.transform = "";
      el.style.transition = "";
      close();
    } else {
      el.style.transition = "transform 420ms cubic-bezier(0.34,1.56,0.64,1)";
      el.style.transform = "";
    }
    // Swallow the click that would follow the drag.
    const swallow = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 350);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ts = (e: TouchEvent) => begin(e.touches[0].clientX, e.touches[0].clientY, e.target);
    const tm = (e: TouchEvent) => {
      if (move(e.touches[0].clientX, e.touches[0].clientY)) e.preventDefault();
    };
    const te = () => end();
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", te);
    el.addEventListener("touchcancel", te);
    return () => {
      el.removeEventListener("touchstart", ts);
      el.removeEventListener("touchmove", tm);
      el.removeEventListener("touchend", te);
      el.removeEventListener("touchcancel", te);
    };
  }, []);

  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || (e.target as HTMLElement).closest("button")) return;
    begin(e.clientX, e.clientY, e.target);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && drag.current) move(e.clientX, e.clientY);
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerType === "mouse") end();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { opts } = item;
  return (
    <div class={`sheet-layer ${item.closing ? "closing" : ""}`}>
      <div class="sheet-scrim" onClick={close} />
      <div
        ref={ref}
        class={`sheet ${opts.full ? "full" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={opts.title ?? "Sheet"}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        <div>
          <div class="sheet-grabber" />
          {!opts.bare && (
            <div class="sheet-head">
              <div>
                <button class="nav-btn" onClick={close}>
                  {opts.cancelLabel ?? "Cancel"}
                </button>
              </div>
              <h2 class="truncate">{opts.title}</h2>
              <div style="justify-self:end">
                {opts.done && (
                  <button
                    class="nav-btn strong"
                    disabled={busy || opts.done.disabled}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const r = await opts.done!.run();
                        if (r !== false) close();
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {opts.done.label}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <div class="sheet-body">{item.render(close)}</div>
      </div>
    </div>
  );
}

// ---------------- action sheet / confirm ----------------
export interface ActionItem {
  label: string;
  icon?: IconName;
  destructive?: boolean;
  run: () => void;
}

export function actionSheet(actions: ActionItem[], title?: string, onDismiss?: () => void) {
  let chosen = false;
  openSheet(
    (close) => (
      <div class="actions">
        {title && <p class="t-footnote c3" style="text-align:center;padding:4px 0 8px">{title}</p>}
        <div class="action-group">
          {actions.map((a) => (
            <button
              key={a.label}
              class={`action ${a.destructive ? "destructive" : ""}`}
              onClick={() => {
                chosen = true;
                close();
                setTimeout(a.run, 120);
              }}
            >
              {a.icon && <Icon name={a.icon} size={20} />}
              {a.label}
            </button>
          ))}
        </div>
        <div class="action-group">
          <button class="action bold" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    ),
    { bare: true, onClose: () => !chosen && onDismiss?.() },
  );
}

export function confirmSheet(opts: { title: string; message?: string; confirm: string; destructive?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v: boolean) => {
      if (answered) return;
      answered = true;
      resolve(v);
    };
    openSheet(
      (close) => (
        <div class="actions">
          <div class="action-group" style="padding:16px 20px;text-align:center">
            <p class="t-headline">{opts.title}</p>
            {opts.message && <p class="t-subhead c2 mt8 pre">{opts.message}</p>}
          </div>
          <div class="action-group">
            <button
              class={`action bold ${opts.destructive ? "destructive" : ""}`}
              onClick={() => {
                done(true);
                close();
              }}
            >
              {opts.confirm}
            </button>
          </div>
          <div class="action-group">
            <button
              class="action"
              onClick={() => {
                done(false);
                close();
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ),
      // Dismissing by drag/scrim counts as cancel.
      { bare: true, onClose: () => done(false) },
    );
  });
}

export function Overlays(): JSX.Element {
  useStore();
  return (
    <>
      {sheets.map((s) => (
        <Sheet key={s.id} item={s} />
      ))}
      <Toasts />
    </>
  );
}
