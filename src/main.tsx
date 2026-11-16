import { render } from "preact";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/motion.css";
import { App } from "./app";
import { ensureSeeded } from "./db/seed";
import { registerServiceWorker, requestPersistence } from "./lib/pwa";
import { syncThemeColor } from "./lib/theme";

async function boot() {
  syncThemeColor();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeColor);
  try {
    await ensureSeeded();
  } catch (e) {
    console.error("Database init failed", e);
  }
  render(<App />, document.getElementById("app")!);
  registerServiceWorker();
  // First run: ask the browser to keep our data (no prompt on iOS).
  void requestPersistence();
}

void boot();
