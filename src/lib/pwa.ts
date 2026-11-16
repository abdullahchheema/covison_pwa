// Service worker registration with an opt-in update flow, plus persistent
// storage. No push, no notifications, no other permissions.
import { toast } from "../ui/overlay";
import { getMeta, setMeta } from "../db/repo";

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
  // Reload only when the user tapped "Update". The very first install also
  // fires controllerchange (clients.claim), and that must not reload the page.
  let updateRequested = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!updateRequested) return;
    updateRequested = false;
    location.reload();
  });

  const promptUpdate = (worker: ServiceWorker) => {
    toast("A new version is ready", {
      icon: "sparkles",
      ms: 60_000,
      action: {
        label: "Update",
        run: () => {
          updateRequested = true;
          worker.postMessage("SKIP_WAITING");
        },
      },
    });
  };

  navigator.serviceWorker
    .register("./sw.js", { scope: "./" })
    .then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w?.addEventListener("statechange", () => {
          // Only prompt for real updates, not the very first install.
          if (w.state === "installed" && navigator.serviceWorker.controller) promptUpdate(w);
        });
      });
      // Check for updates when the app comes back to the foreground.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && navigator.onLine) reg.update().catch(() => {});
      });
    })
    .catch((e) => console.warn("SW registration failed", e));
}

/** Ask the browser not to evict our IndexedDB under storage pressure. */
export async function requestPersistence(): Promise<boolean | undefined> {
  if (!navigator.storage?.persist) return undefined;
  try {
    const already = await navigator.storage.persisted();
    if (already) {
      await setMeta("persistGranted", true);
      return true;
    }
    const asked = await getMeta("persistAsked", false);
    const granted = await navigator.storage.persist();
    await setMeta("persistGranted", granted);
    if (!asked) await setMeta("persistAsked", true);
    return granted;
  } catch {
    return undefined;
  }
}

export function isStandalone(): boolean {
  return (
    matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
