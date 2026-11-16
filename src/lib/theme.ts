export type ThemePref = "system" | "light" | "dark";

const KEY = "covison.theme";

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function isDark(): boolean {
  const pref = getThemePref();
  if (pref === "system") return matchMedia("(prefers-color-scheme: dark)").matches;
  return pref === "dark";
}

/** Apply a theme preference, cross-fading with the View Transitions API when available. */
export function setThemePref(pref: ThemePref) {
  const apply = () => {
    try {
      if (pref === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, pref);
    } catch {
      /* ignore */
    }
    if (pref === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", pref);
    syncThemeColor();
  };
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (doc.startViewTransition && !reduce) doc.startViewTransition(apply);
  else apply();
}

/** Keep the status-bar / theme-color meta in sync with a manual override. */
export function syncThemeColor() {
  const dark = isDark();
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    const media = m.getAttribute("media") ?? "";
    if (getThemePref() === "system") {
      m.setAttribute("content", media.includes("dark") ? "#09090b" : "#f8f7f4");
    } else {
      m.setAttribute("content", dark ? "#09090b" : "#f8f7f4");
    }
  });
}
