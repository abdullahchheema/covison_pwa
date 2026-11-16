// Tiny hash router. Hash URLs (#/contacts/123) keep the app working from
// any subpath on any static host, with no server rewrites.
import { useEffect, useState } from "preact/hooks";

export type Direction = "push" | "pop" | "tab" | "none";

export interface RouteState {
  path: string;
  dir: Direction;
  key: number;
}

export const TAB_ROOTS = ["/", "/contacts", "/pipeline", "/money", "/more"];

const stack: string[] = [];
let state: RouteState = { path: currentPath(), dir: "none", key: 0 };
const listeners = new Set<(s: RouteState) => void>();
let pendingDir: Direction | null = null;

function currentPath(): string {
  const h = location.hash.replace(/^#/, "");
  return h.startsWith("/") ? h : "/";
}

export function tabOf(path: string): string {
  if (path === "/") return "/";
  const first = `/${path.split("/")[1]}`;
  if (TAB_ROOTS.includes(first)) return first;
  if (first === "/deals") return "/pipeline"; // a deal page belongs to the Pipeline tab
  return "/more"; // companies, projects, reports, settings... live under More
}

function onHashChange() {
  const path = currentPath();
  if (path === state.path) return;
  let dir: Direction;
  if (pendingDir) dir = pendingDir;
  else if (stack.length >= 2 && stack[stack.length - 2] === path) dir = "pop";
  else dir = "push";
  pendingDir = null;
  if (dir === "pop") stack.pop();
  else if (dir === "tab") stack.splice(0, stack.length, path);
  else stack.push(path);
  state = { path, dir, key: state.key + 1 };
  listeners.forEach((l) => l(state));
}

if (typeof window !== "undefined") {
  stack.push(state.path);
  window.addEventListener("hashchange", onHashChange);
}

export function navigate(path: string, dir: Direction = "push") {
  if (path === state.path) return;
  pendingDir = dir;
  location.hash = path;
}

/** Switch tab: replaces history so the back gesture never crosses tabs. */
export function switchTab(path: string) {
  if (path === state.path) {
    // Re-tapping the active tab scrolls to top, like iOS.
    document.querySelector<HTMLElement>(".screen.current")?.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  pendingDir = "tab";
  location.replace(`#${path}`);
}

export function back(fallback = "/") {
  if (stack.length > 1) history.back();
  else navigate(fallback, "pop");
}

export function useRoute(): RouteState {
  const [s, set] = useState(state);
  useEffect(() => {
    listeners.add(set);
    return () => void listeners.delete(set);
  }, []);
  return s;
}

/** Match "/contacts/:id" style patterns. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/");
  const a = path.split("/");
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}
