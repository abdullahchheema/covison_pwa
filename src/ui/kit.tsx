// Reusable UI primitives.
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Icon, type IconName } from "./icons";
import { back } from "../lib/router";
import { initials } from "../lib/format";
import type { Tone } from "../lib/options";

// ---------------- Screen (nav bar + large title) ----------------
export function Screen({
  title,
  subtitle,
  backLabel,
  backTo,
  right,
  left,
  large = true,
  children,
  titleAccessory,
}: {
  title: string;
  subtitle?: ComponentChildren;
  backLabel?: string;
  backTo?: string;
  right?: ComponentChildren;
  left?: ComponentChildren;
  large?: boolean;
  children: ComponentChildren;
  titleAccessory?: ComponentChildren;
}) {
  const navRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const scroller = nav?.closest(".screen") as HTMLElement | null;
    if (!nav || !scroller) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = scroller.scrollTop;
      nav.dataset.scrolled = String(large ? y > 38 : y > 2);
      const t = titleRef.current;
      if (t) {
        // iOS-style: large title grows a little when pulled down.
        const s = y < 0 ? Math.min(1.12, 1 + -y / 600) : 1;
        t.style.transform = s === 1 ? "" : `scale(${s})`;
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [large]);

  return (
    <>
      <div ref={navRef} class={`navbar ${large ? "" : "always-title"}`} data-scrolled="false">
        <div class="nav-left">
          {left ??
            (backLabel !== undefined && (
              <button class="nav-btn back press" onClick={() => back(backTo)} aria-label={`Back to ${backLabel}`}>
                <Icon name="chevronLeft" size={28} stroke={2.4} />
                <span class="truncate" style="max-width:110px">{backLabel}</span>
              </button>
            ))}
        </div>
        <div class="nav-title truncate">{title}</div>
        <div class="nav-right">{right}</div>
      </div>
      {large && (
        <div class="large-title">
          <div class="grow">
            <h1 ref={titleRef} class="t-large truncate">
              {title}
            </h1>
            {subtitle && <div class="subtitle">{subtitle}</div>}
          </div>
          {titleAccessory}
        </div>
      )}
      {children}
    </>
  );
}

// ---------------- Lists ----------------
export function Group({ label, footer, children, class: cls }: { label?: string; footer?: ComponentChildren; children: ComponentChildren; class?: string }) {
  return (
    <div class={cls}>
      {label && <div class="group-label">{label}</div>}
      <div class="group">{children}</div>
      {footer && <div class="group-foot">{footer}</div>}
    </div>
  );
}

export function Row({
  title,
  sub,
  value,
  lead,
  trail,
  onClick,
  href,
  chevron = !!(onClick || href),
  class: cls,
  i,
  danger,
}: {
  title: ComponentChildren;
  sub?: ComponentChildren;
  value?: ComponentChildren;
  lead?: ComponentChildren;
  trail?: ComponentChildren;
  onClick?: () => void;
  href?: string;
  chevron?: boolean;
  class?: string;
  i?: number;
  danger?: boolean;
}) {
  const inner = (
    <>
      {lead}
      <div class="grow col">
        <div class={`lr-title truncate ${danger ? "c-danger" : ""}`}>{title}</div>
        {sub && <div class="lr-sub truncate">{sub}</div>}
      </div>
      {value !== undefined && <div class="lr-value truncate">{value}</div>}
      {trail}
      {chevron && <Icon name="chevronRight" size={18} stroke={2.4} class="chev" />}
    </>
  );
  const className = `lrow ${lead ? "has-lead" : ""} ${i !== undefined ? "rise" : ""} ${cls ?? ""}`;
  const style = i !== undefined ? { "--i": i } : undefined;
  if (href)
    return (
      <a class={className} style={style as never} href={href} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    );
  if (onClick)
    return (
      <button class={className} style={style as never} onClick={onClick}>
        {inner}
      </button>
    );
  return (
    <div class={className} style={style as never}>
      {inner}
    </div>
  );
}

// Swipe a row left to reveal actions (iOS mail style). Full swipe triggers the
// last action. Horizontal intent is detected so vertical scroll stays smooth.
export interface SwipeAction {
  label: string;
  icon: IconName;
  tone: "danger" | "success" | "brand";
  run: () => void;
}
export function SwipeRow({ actions, children, i }: { actions: SwipeAction[]; children: ComponentChildren; i?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const st = useRef({ x0: 0, y0: 0, x: 0, base: 0, mode: "" as "" | "h" | "v", id: -1 });
  const width = actions.length * 84;

  const set = (x: number, animate: boolean) => {
    const row = wrap.current?.querySelector<HTMLElement>(".lrow");
    if (!row) return;
    row.style.transition = animate ? "transform 420ms cubic-bezier(0.32,0.72,0,1)" : "none";
    row.style.transform = x ? `translate3d(${x}px,0,0)` : "";
    st.current.x = x;
  };

  useEffect(() => {
    const close = (e: Event) => {
      if (st.current.x && !wrap.current?.contains(e.target as Node)) set(0, true);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, []);

  return (
    <div
      ref={wrap}
      class={`lrow-wrap ${i !== undefined ? "rise" : ""}`}
      style={i !== undefined ? ({ "--i": i } as never) : undefined}
      onPointerDown={(e) => {
        st.current = { ...st.current, x0: e.clientX, y0: e.clientY, base: st.current.x, mode: "", id: e.pointerId };
      }}
      onPointerMove={(e) => {
        const s = st.current;
        if (s.id !== e.pointerId) return;
        const dx = e.clientX - s.x0;
        const dy = e.clientY - s.y0;
        if (!s.mode) {
          if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
            s.mode = "h";
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } else if (Math.abs(dy) > 8) s.mode = "v";
        }
        if (s.mode !== "h") return;
        let x = Math.min(0, s.base + dx);
        if (x < -width) x = -width + (x + width) * 0.35; // rubber band
        set(x, false);
      }}
      onPointerUp={() => {
        const s = st.current;
        s.id = -1;
        if (s.mode !== "h") return;
        if (s.x < -width - 70) {
          set(0, true);
          actions[actions.length - 1].run();
        } else set(s.x < -width / 2 ? -width : 0, true);
      }}
      onPointerCancel={() => set(0, true)}
      onClickCapture={(e) => {
        if (st.current.mode === "h") {
          e.stopPropagation();
          e.preventDefault();
          st.current.mode = "";
        }
      }}
    >
      <div class="swipe-actions" aria-hidden={st.current.x === 0}>
        {actions.map((a) => (
          <button
            key={a.label}
            class={`swipe-act ${a.tone}`}
            onClick={() => {
              set(0, true);
              a.run();
            }}
          >
            <Icon name={a.icon} size={20} />
            {a.label}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}

// ---------------- Small things ----------------
export function Badge({ tone = "neutral", children, dot }: { tone?: Tone; children: ComponentChildren; dot?: boolean }) {
  return (
    <span class={`badge ${tone}`}>
      {dot && <span class="dot" />}
      {children}
    </span>
  );
}

const AVATAR_GRADS = [
  ["#6d4aff", "#a78bfa"],
  ["#4f46e5", "#818cf8"],
  ["#0e9f6e", "#42d39a"],
  ["#d97706", "#f1bb5c"],
  ["#2878d9", "#69a8ff"],
  ["#c2367a", "#f472b6"],
  ["#0891b2", "#67e8f9"],
  ["#a8843f", "#d4b878"],
];
export function gradFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const [a, b] = AVATAR_GRADS[Math.abs(h) % AVATAR_GRADS.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

export function Avatar({ name, size, square, icon }: { name: string; size?: "lg"; square?: boolean; icon?: IconName }) {
  return (
    <div class={`avatar ${size ?? ""} ${square ? "sq" : ""}`} style={{ background: gradFor(name || "?") }} aria-hidden="true">
      {icon ? <Icon name={icon} size={size === "lg" ? 38 : 20} /> : initials(name)}
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ComponentChildren }) {
  return (
    <div class="empty pop-in">
      <div class="e-ico">
        <Icon name={icon} size={34} />
      </div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action && <div class="mt8">{action}</div>}
    </div>
  );
}

export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div class="group" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div class="lrow has-lead" key={i}>
          <div class="skel" style="width:40px;height:40px;border-radius:20px" />
          <div class="grow col gap8">
            <div class="skel" style={{ width: `${55 + ((i * 17) % 35)}%`, height: "14px" }} />
            <div class="skel" style={{ width: `${30 + ((i * 11) % 25)}%`, height: "11px" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div class="segmented" role="group">
      <div
        class="seg-thumb"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${idx * 100}%)` }}
      />
      {options.map((o) => (
        <button key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SearchField({ value, onInput, placeholder = "Search" }: { value: string; onInput: (v: string) => void; placeholder?: string }) {
  return (
    <label class="search">
      <Icon name="search" size={18} />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
      />
      {value && (
        <button aria-label="Clear" onClick={() => onInput("")} class="c3">
          <Icon name="x" size={16} />
        </button>
      )}
    </label>
  );
}

// ---------------- Form fields ----------------
type FieldProps = { label: string; error?: boolean };

export function TextField({
  label,
  value,
  onInput,
  type = "text",
  placeholder,
  inputMode,
  autoFocus,
  error,
  stack,
  maxLength = 300,
  list,
}: FieldProps & {
  value: string;
  onInput: (v: string) => void;
  type?: string;
  placeholder?: string;
  inputMode?: JSX.HTMLAttributes["inputMode"];
  autoFocus?: boolean;
  stack?: boolean;
  maxLength?: number;
  /** id of a <datalist> with suggestions (free text still allowed). */
  list?: string;
}) {
  const id = useRef(`f${Math.random().toString(36).slice(2)}`).current;
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) setTimeout(() => ref.current?.focus(), 380);
  }, []);
  return (
    <div class={`field ${stack ? "stack" : ""} ${error ? "error" : ""}`}>
      <label for={id}>{label}</label>
      <input
        ref={ref}
        id={id}
        type={type}
        value={value}
        placeholder={placeholder ?? (stack ? "" : "Optional")}
        inputMode={inputMode}
        maxLength={maxLength}
        autoComplete="off"
        list={list}
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
      />
    </div>
  );
}

export function TextArea({ label, value, onInput, placeholder, maxLength = 20000 }: FieldProps & { value: string; onInput: (v: string) => void; placeholder?: string; maxLength?: number }) {
  const id = useRef(`f${Math.random().toString(36).slice(2)}`).current;
  return (
    <div class="field stack">
      <label for={id}>{label}</label>
      <textarea id={id} value={value} placeholder={placeholder} maxLength={maxLength} onInput={(e) => onInput((e.target as HTMLTextAreaElement).value)} />
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  placeholder = "None",
}: FieldProps & { value: T | ""; onChange: (v: T | "") => void; options: { value: T; label: string }[]; placeholder?: string | false }) {
  const id = useRef(`f${Math.random().toString(36).slice(2)}`).current;
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value as T | "")}>
        {placeholder !== false && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SwitchField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useRef(`f${Math.random().toString(36).slice(2)}`).current;
  return (
    <div class="field">
      <label for={id} class="grow">
        {label}
      </label>
      <input id={id} type="checkbox" class="switch" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
    </div>
  );
}

/** Lets a sheet's header "Save" button call into the form inside it. */
export function useSubmitBinding(binding: { current: (() => Promise<boolean | void>) | null }, fn: () => Promise<boolean | void>) {
  binding.current = fn;
}

export function useDebounced<T>(value: T, ms = 120): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Wrap anything that should go away with an upward swipe (banners, toasts).
 * Follows the finger upward with a little resistance downward; past ~40px
 * (or a quick flick) it flies off and calls onDismiss. A tap still works.
 */
export function SwipeUpDismiss({ onDismiss, children, class: cls }: { onDismiss: () => void; children: ComponentChildren; class?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest callback without re-attaching listeners: a parent that
  // re-renders mid-swipe (count-up animations) must not reset the gesture.
  const cb = useRef(onDismiss);
  cb.current = onDismiss;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let y0 = 0;
    let x0 = 0;
    let t0 = 0;
    let dy = 0;
    let active = false;
    let swiped = false;
    const start = (e: TouchEvent) => {
      y0 = e.touches[0].clientY;
      x0 = e.touches[0].clientX;
      t0 = performance.now();
      dy = 0;
      active = false;
      swiped = false;
      el.style.transition = "none";
    };
    const move = (e: TouchEvent) => {
      const d = e.touches[0].clientY - y0;
      const dx = e.touches[0].clientX - x0;
      if (!active) {
        if (d > -6 || Math.abs(dx) > Math.abs(d)) return; // only an upward swipe
        active = true;
      }
      e.preventDefault();
      dy = d < 0 ? d : d * 0.2;
      el.style.transform = `translate3d(0, ${dy}px, 0)`;
      el.style.opacity = String(Math.max(0.2, 1 + dy / 160));
    };
    const end = () => {
      el.style.transition = "transform 280ms cubic-bezier(0.32,0.72,0,1), opacity 280ms";
      const v = dy / Math.max(1, performance.now() - t0);
      if (active && (dy < -40 || v < -0.45)) {
        swiped = true;
        el.style.transform = "translate3d(0, -140%, 0)";
        el.style.opacity = "0";
        setTimeout(() => cb.current(), 220);
      } else {
        el.style.transform = "";
        el.style.opacity = "";
      }
    };
    const click = (e: Event) => {
      if (swiped) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    el.addEventListener("click", click, true);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
      el.removeEventListener("click", click, true);
    };
  }, []);
  return (
    <div ref={ref} class={cls} style="will-change:transform">
      {children}
    </div>
  );
}
