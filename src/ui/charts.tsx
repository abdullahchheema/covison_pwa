// Hand-rolled SVG / CSS charts. Animations: line draw-in via
// stroke-dashoffset, bars grow via scaleX/scaleY, donut sweeps in. All are
// transform/opacity/stroke animations and are disabled by reduced-motion CSS.
import { useEffect, useState } from "preact/hooks";
import { prefersReducedMotion } from "../lib/hooks";

export function Sparkline({ data, height = 76 }: { data: number[]; height?: number }) {
  const W = 320;
  const H = height;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / Math.max(1, data.length - 1)) * W, H - 8 - ((v - min) / span) * (H - 22)] as const);
  // Smooth curve (Catmull-Rom → cubic Bézier).
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  const area = `${d} L${W},${H} L0,${H} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg class="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} aria-hidden="true">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity="0.35" />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path class="spark-area" d={area} fill="url(#sparkFill)" />
      <path class="spark-line" d={d} pathLength={1} fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" style={{ "--len": 1 } as never} />
      <circle class="spark-dot" cx={last[0] - 5} cy={last[1]} r="4" fill="#fff" />
    </svg>
  );
}

export function BarList({ items }: { items: { label: string; value: number; display: string; sub?: string; kind?: "won" | "lost" }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div class="bars">
      {items.map((it, i) => {
        const pct = it.value > 0 ? Math.max(2, (it.value / max) * 100) : 0; // 2% floor, as on the web
        return (
          <div class="bar-row" key={it.label}>
            <div class="b-top">
              <span class="truncate">{it.label}</span>
              <span class="num c2">
                {it.display}
                {it.sub && <span class="c3"> · {it.sub}</span>}
              </span>
            </div>
            <div class="bar-track">
              <div class={`bar-fill ${it.kind ?? ""}`} style={{ width: `${pct}%`, animationDelay: `${120 + i * 70}ms` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ColumnChart({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div class="colchart" role="img" aria-label={items.map((i) => `${i.label}: ${i.value}`).join(", ")}>
      {items.map((it, i) => (
        <div class="cc-col" key={it.label}>
          <span class="cc-val">{it.value}</span>
          <div class="cc-bar" style={{ height: `${(it.value / max) * 78}%`, animationDelay: `${100 + i * 70}ms` }} />
          <span class="cc-label">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

const DONUT_COLORS = ["#6d4aff", "#2878d9", "#a78bfa", "#c88518", "#149a68", "#d13a46", "#68636f"];

export function Donut({ items, center }: { items: { label: string; value: number; color?: string }[]; center?: string }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  const [drawn, setDrawn] = useState(prefersReducedMotion());
  useEffect(() => {
    const t = requestAnimationFrame(() => requestAnimationFrame(() => setDrawn(true)));
    return () => cancelAnimationFrame(t);
  }, []);
  let acc = 0;
  return (
    <div class="donut-wrap">
      <svg class="donut" width="132" height="132" viewBox="0 0 132 132" role="img" aria-label={items.map((i) => `${i.label}: ${i.value}`).join(", ")}>
        <circle cx="66" cy="66" r={R} fill="none" stroke="var(--surface-3)" stroke-width="16" />
        {total > 0 &&
          items.map((it, i) => {
            const frac = it.value / total;
            const seg = (
              <circle
                key={it.label}
                class="seg"
                cx="66"
                cy="66"
                r={R}
                fill="none"
                stroke={it.color ?? DONUT_COLORS[i % DONUT_COLORS.length]}
                stroke-width="16"
                stroke-dasharray={`${drawn ? Math.max(0, frac * C - 2) : 0} ${C}`}
                stroke-dashoffset={-acc * C}
                transform="rotate(-90 66 66)"
                style={{ transitionDelay: `${i * 80}ms` }}
              />
            );
            acc += frac;
            return seg;
          })}
        <text x="66" y="62" text-anchor="middle" font-size="24" font-weight="700" fill="var(--text)" class="num">
          {center ?? total}
        </text>
        <text x="66" y="82" text-anchor="middle" font-size="11" fill="var(--text-3)">
          total
        </text>
      </svg>
      <div class="legend">
        {items.map((it, i) => (
          <div class="lg-row" key={it.label}>
            <span class="sw" style={{ background: it.color ?? DONUT_COLORS[i % DONUT_COLORS.length] }} />
            <span class="grow truncate">{it.label}</span>
            <span class="num c2">{it.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
