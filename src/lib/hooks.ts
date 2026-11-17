import { liveQuery } from "dexie";
import { useEffect, useRef, useState } from "preact/hooks";

/** Subscribe to a Dexie live query. `undefined` while the first result loads. */
export function useLive<T>(query: () => Promise<T> | T, deps: unknown[] = []): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({
      next: (v) => setValue(() => v),
      error: (e) => console.error("liveQuery failed", e),
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Animated number count-up (ease-out-expo), skipped under reduced motion. */
export function useCountUp(target: number, duration = 1100): number {
  const [v, setV] = useState(prefersReducedMotion() ? target : 0);
  const from = useRef(0);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setV(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      const cur = a + (target - a) * e;
      // Animate in whole rupees (or paisa for amounts that have them), so the
      // number never flickers through random decimals; land exactly on target.
      setV(p === 1 ? target : Number.isInteger(target) ? Math.round(cur) : Math.round(cur * 100) / 100);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return v;
}

/** Remembered per-list filter (replaces the web CRM's server-side saved views). */
export function useStoredState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`covison.${key}`);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (next: T) => {
    setV(next);
    try {
      localStorage.setItem(`covison.${key}`, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  return [v, set];
}
