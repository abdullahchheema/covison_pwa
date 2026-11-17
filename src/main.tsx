import { render } from "preact";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/motion.css";
import { App } from "./app";
import { db } from "./db/schema";
import { ensureSeeded } from "./db/seed";
import { runMigrations } from "./db/migrations";
import { registerServiceWorker, requestPersistence } from "./lib/pwa";
import { syncThemeColor } from "./lib/theme";

const MIN_SPLASH_MS = 450; // long enough to read as intentional, short enough to never feel slow
const started = performance.now();

function bootMessage(text: string) {
  const el = document.getElementById("boot-msg");
  if (el) el.textContent = text;
}

/** Fade the static splash (index.html #boot) into the rendered app. */
function hideSplash() {
  const boot = document.getElementById("boot");
  if (!boot) return;
  const wait = Math.max(0, MIN_SPLASH_MS - (performance.now() - started));
  setTimeout(() => {
    requestAnimationFrame(() => {
      boot.classList.add("done");
      setTimeout(() => boot.remove(), 600);
    });
  }, wait);
}

async function boot() {
  syncThemeColor();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeColor);

  // If anything stalls (e.g. iOS slow to open IndexedDB on a cold start), say so
  // instead of showing a frozen screen.
  const slow = setTimeout(() => bootMessage("Opening your data…"), 2500);

  try {
    // Open the database and seed the default pipeline before the first screen
    // renders, so every screen's first frame already has data (no blank flash).
    await Promise.race([
      db.open().then(ensureSeeded).then(runMigrations),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
    ]);
  } catch (e) {
    console.error("Database init failed", e);
    bootMessage("Still starting… if this persists, close and reopen the app.");
  }
  clearTimeout(slow);

  render(<App />, document.getElementById("app")!);
  hideSplash();

  // Non-critical work after the first frame.
  setTimeout(() => {
    registerServiceWorker();
    void requestPersistence(); // first run: ask the browser to keep our data (no prompt on iOS)
  }, 800);
}

window.addEventListener("error", () => bootMessage("Something went wrong while starting. Close and reopen the app."));
void boot();
