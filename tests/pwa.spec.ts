import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(__dirname, ".tmp"), { recursive: true });
const fs = { writeFileSync };

const STORES = [
  "pipelines",
  "stages",
  "companies",
  "leadTypes",
  "contacts",
  "tags",
  "contactTags",
  "projects",
  "projectColumns",
  "projectTodos",
  "deals",
  "tasks",
  "activities",
  "ledger",
  "payments",
];

/** Read every data store straight from IndexedDB (independent of app code). */
async function dumpDb(page: Page): Promise<Record<string, unknown[]>> {
  return page.evaluate(async (stores) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open("covison-pocket");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const out: Record<string, unknown[]> = {};
    for (const s of stores) {
      out[s] = await new Promise((res, rej) => {
        const req = db.transaction(s, "readonly").objectStore(s).getAll();
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
    }
    db.close();
    return out;
  }, STORES);
}

/** Canonical form: sort rows and drop undefined-valued keys (JSON has no undefined). */
function canonical(d: Record<string, unknown[]>) {
  const key = (r: Record<string, unknown>) => String(r.id ?? `${r.contactId}|${r.tagId}`);
  const out: Record<string, unknown[]> = {};
  for (const [t, rows] of Object.entries(d))
    out[t] = JSON.parse(JSON.stringify([...(rows as Record<string, unknown>[])].sort((a, b) => key(a).localeCompare(key(b)))));
  return out;
}

async function addSampleData(page: Page) {
  await page.goto("./#/settings");
  await page.getByText("Add sample data", { exact: true }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Add sample data", exact: true }).click();
  await expect(page.getByText("Sample data added")).toBeVisible();
}

async function waitForSw(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Reload once so the page is controlled by the active worker.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test.describe.configure({ mode: "serial" });

test("security: strict CSP meta, no inline scripts, no CSP violations, no remote requests", async ({ page }) => {
  const violations: string[] = [];
  const remote: string[] = [];
  page.on("console", (m) => /Content Security Policy|Refused to/i.test(m.text()) && violations.push(m.text()));
  page.on("request", (r) => !r.url().startsWith("http://localhost:4174/") && !r.url().startsWith("data:") && !r.url().startsWith("blob:") && remote.push(r.url()));
  await page.goto("./");
  await expect(page.getByText("Open pipeline")).toBeVisible();
  const html = readFileSync(join(__dirname, "../dist/index.html"), "utf8");
  expect(html).toContain('http-equiv="Content-Security-Policy"');
  expect(html).toMatch(/script-src 'self';/);
  expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/); // every script is external
  for (const tab of ["Contacts", "Pipeline", "Money", "More"]) {
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: tab }).click();
    await page.waitForTimeout(450);
  }
  expect(violations).toEqual([]);
  expect(remote).toEqual([]);
});

test("service worker precaches every built file", async ({ page }) => {
  await page.goto("./");
  await waitForSw(page);
  const manifest = JSON.parse(readFileSync(join(__dirname, "../dist/precache-manifest.json"), "utf8")) as { version: string; files: string[] };
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls: string[] = [];
    for (const k of keys) for (const r of await (await caches.open(k)).keys()) urls.push(new URL(r.url).pathname);
    return { keys, urls };
  });
  expect(cached.keys).toEqual([`covison-pocket-${manifest.version}`]);
  const expected = manifest.files.map((f) => new URL(f, "http://x/covison/").pathname).sort();
  expect(cached.urls.sort()).toEqual(expected);
  // sanity: the app shell, JS, CSS, manifest and all icons are in there
  for (const f of ["/covison/index.html", "/covison/manifest.webmanifest", "/covison/icons/icon-180.png", "/covison/icons/icon-512-maskable.png"]) expect(cached.urls).toContain(f);
  expect(cached.urls.some((u) => u.endsWith(".js"))).toBe(true);
  expect(cached.urls.some((u) => u.endsWith(".css"))).toBe(true);
});

test("works fully offline after first load (airplane mode)", async ({ page, context }) => {
  await page.goto("./");
  await waitForSw(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("Open pipeline")).toBeVisible();
  // Deep link while offline
  await page.goto("./#/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  // Create a contact while offline
  await page.goto("./#/contacts");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "New contact", exact: true }).click();
  await page.getByLabel("Name").fill("Offline Olivia");
  await page.getByRole("dialog").last().getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Offline Olivia" })).toBeVisible();
  const db = await dumpDb(page);
  expect((db.contacts as { name: string }[]).some((c) => c.name === "Offline Olivia")).toBe(true);
  await context.setOffline(false);
});

test("export → erase → import round-trips with zero data loss, and stays XSS-safe", async ({ page }) => {
  await page.goto("./");
  await addSampleData(page);

  // Add ~200 extra records with hostile / unicode strings straight into IndexedDB.
  await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res) => {
      const r = indexedDB.open("covison-pocket");
      r.onsuccess = () => res(r.result);
    });
    const all = <T,>(s: string) =>
      new Promise<T[]>((res) => {
        const q = db.transaction(s).objectStore(s).getAll();
        q.onsuccess = () => res(q.result as T[]);
      });
    const stages = await all<{ id: string; pipelineId: string }>("stages");
    const evil = `<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>`;
    const t = new Date().toISOString();
    const tx = db.transaction(["contacts", "companies", "deals", "tasks", "activities", "tags", "contactTags", "ledger", "payments"], "readwrite");
    for (let i = 0; i < 15; i++) {
      tx.objectStore("ledger").put({ id: `l-${i}`, direction: i % 2 ? "out" : "in", kind: i % 3 ? "loan" : "credit", personName: `Person ${i} ${evil}`, phone: "0300 1112233", contactId: i < 5 ? `c-${i}` : undefined, amount: 1000 * (i + 1), currency: "PKR", date: "2026-10-01", dueDate: i % 4 ? "2026-12-01" : undefined, note: `Loan 💸 ${i}`, createdAt: t, updatedAt: t });
      tx.objectStore("payments").put({ id: `p-${i}`, entryId: `l-${i}`, amount: 100 * i, date: "2026-10-15", createdAt: t });
    }
    for (let i = 0; i < 60; i++) {
      const cid = `c-${i}`;
      tx.objectStore("companies").put({ id: `co-${i}`, name: `Firma ${i} 🚀 ${i % 7 === 0 ? evil : ""}`, website: i % 5 === 0 ? "javascript:alert(1)" : `https://f${i}.example`, createdAt: t, updatedAt: t });
      tx.objectStore("contacts").put({
        id: cid,
        name: `${["Zoë", "Łukasz", "محمد", "王芳", "José"][i % 5]} ${i} ${i % 9 === 0 ? evil : ""}`,
        email: `p${i}@example.com`,
        status: ["new", "qualified", "connected", "attempted", "won"][i % 5],
        companyId: `co-${i}`,
        customFields: { note: `multi\nline "quoted", comma ${i}`, n: i, ok: i % 2 === 0 },
        expectedRevenue: i * 1000.5,
        createdAt: t,
        updatedAt: t,
      });
      tx.objectStore("deals").put({ id: `d-${i}`, pipelineId: stages[0].pipelineId, stageId: stages[i % stages.length].id, name: `Deal ${i} ${evil}`, value: i * 333.33, currency: "EUR", contactId: cid, createdAt: t, updatedAt: t });
      if (i < 20) tx.objectStore("tasks").put({ id: `t-${i}`, title: `Task ${i} ✅`, status: i % 2 ? "done" : "open", dueAt: t, contactId: cid, createdAt: t, updatedAt: t });
    }
    tx.objectStore("tags").put({ id: "tag-x", name: `Évil ${evil}`, color: "danger", createdAt: t });
    for (let i = 0; i < 10; i++) tx.objectStore("contactTags").put({ contactId: `c-${i}`, tagId: "tag-x" });
    for (let i = 0; i < 10; i++) tx.objectStore("activities").put({ id: `a-${i}`, type: "note", body: `Note ${i}\n${evil}`, contactId: `c-${i}`, occurredAt: t, createdAt: t });
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
  });

  const before = canonical(await dumpDb(page));
  const total = Object.values(before).reduce((a, r) => a + r.length, 0);
  expect(total).toBeGreaterThan(200);

  // Render hostile strings in lists: nothing may execute.
  await page.goto("./#/contacts");
  await page.reload();
  await expect(page.getByText(/Zoë 0/)).toBeVisible();
  await page.goto("./#/companies");
  await page.goto("./#/pipeline");
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  // javascript: URLs never reach an href
  expect(await page.evaluate(() => [...document.querySelectorAll("a[href]")].filter((a) => a.getAttribute("href")!.startsWith("javascript:")).length)).toBe(0);

  // Export through the UI
  await page.goto("./#/settings");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByText("Export backup", { exact: true }).click()]);
  const path = join(__dirname, ".tmp/backup.json");
  await download.saveAs(path);
  const file = JSON.parse(readFileSync(path, "utf8"));
  expect(file.app).toBe("covison-pocket");
  await expect(page.getByText(/Last backed up/)).toBeVisible();

  // Erase everything
  await page.getByText("Erase all data", { exact: true }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Erase everything", exact: true }).click();
  await expect(page.getByText("All data erased")).toBeVisible();
  const erased = await dumpDb(page);
  expect(erased.contacts.length).toBe(0);
  expect(erased.deals.length).toBe(0);

  // A corrupted file must be rejected without touching data.
  const broken = { ...file, data: { ...file.data, deals: [{ id: "x", name: "bad" }] } };
  const brokenPath = join(__dirname, ".tmp/broken.json");
  writeFileSync(brokenPath, JSON.stringify(broken));
  const [fc1] = await Promise.all([page.waitForEvent("filechooser"), page.getByText("Restore from backup", { exact: true }).click()]);
  await fc1.setFiles(brokenPath);
  await expect(page.getByText("This backup can't be restored. Nothing was changed.")).toBeVisible();
  await page.getByRole("dialog").last().getByRole("button", { name: "Cancel", exact: true }).click();
  await page.waitForTimeout(400);

  // Restore the real backup through the UI (with confirm step)
  const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.getByText("Restore from backup", { exact: true }).click()]);
  await fc.setFiles(path);
  await page.getByRole("dialog").last().getByRole("button", { name: "Replace all data", exact: true }).click();
  await expect(page.getByText("Backup restored")).toBeVisible();

  const after = canonical(await dumpDb(page));
  for (const t of STORES) expect.soft(after[t], `table ${t}`).toEqual(before[t]);
  expect(after).toEqual(before);
});

test("import from existing CRM: web CSV exports map correctly", async ({ page }) => {
  await page.goto("./#/settings");
  const dir = join(__dirname, ".tmp");
  fs.writeFileSync(
    join(dir, "contacts-2026-11-01.csv"),
    'Name,Email,Phone,Job title,Status,Tags,Company,Owner\nAda Lovelace,ada@engine.io,+44 20 1234,Countess,Qualified,VIP; Math,Analytical Ltd,Someone\n"Grace, Hopper",grace@navy.mil,,Admiral,Won,,"Navy, US",x\n',
  );
  fs.writeFileSync(join(dir, "deals-2026-11-01.csv"), "Name,Stage,Value,Currency,Contact,Company,Owner\nEngine build,Proposal,12500,GBP,Ada Lovelace,Analytical Ltd,\nCOBOL,Custom Stage,99,USD,,,\n");
  fs.writeFileSync(join(dir, "tickets-2026-11-01.csv"), "Title,Contact,Category,Priority,Status,Assigned to\nBroken,Ada,bug,high,open,\n");

  const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.getByText("Import from existing CRM", { exact: true }).click()]);
  await fc.setFiles([join(dir, "contacts-2026-11-01.csv"), join(dir, "deals-2026-11-01.csv"), join(dir, "tickets-2026-11-01.csv")]);
  await expect(page.getByText(/tickets is a dropped feature/)).toBeVisible();
  await page.getByRole("dialog").last().getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText(/Imported:/)).toBeVisible();

  const db = (await dumpDb(page)) as Record<string, Record<string, unknown>[]>;
  const ada = db.contacts.find((c) => c.email === "ada@engine.io")!;
  expect(ada).toMatchObject({ name: "Ada Lovelace", jobTitle: "Countess", status: "qualified", phone: "+44 20 1234" });
  const grace = db.contacts.find((c) => c.email === "grace@navy.mil")!;
  expect(grace).toMatchObject({ name: "Grace, Hopper", status: "won" });
  const company = db.companies.find((c) => c.id === ada.companyId)!;
  expect(company.name).toBe("Analytical Ltd");
  const tagNames = db.contactTags.filter((l) => l.contactId === ada.id).map((l) => db.tags.find((t) => t.id === l.tagId)!.name).sort();
  expect(tagNames).toEqual(["Math", "VIP"]);
  const deal = db.deals.find((d) => d.name === "Engine build")!;
  expect(deal).toMatchObject({ value: 12500, currency: "GBP", contactId: ada.id, companyId: company.id });
  expect(db.stages.find((s) => s.id === deal.stageId)!.name).toBe("Proposal");
  const cobol = db.deals.find((d) => d.name === "COBOL")!;
  expect(db.stages.find((s) => s.id === cobol.stageId)!.name).toBe("Custom Stage");

  // Importing the same contacts again updates instead of duplicating.
  const [fc2] = await Promise.all([page.waitForEvent("filechooser"), page.getByText("Import from existing CRM", { exact: true }).click()]);
  await fc2.setFiles([join(dir, "contacts-2026-11-01.csv")]);
  await page.getByRole("dialog").last().getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText(/Imported:/).last()).toBeVisible();
  const db2 = (await dumpDb(page)) as Record<string, Record<string, unknown>[]>;
  expect(db2.contacts.filter((c) => c.email === "ada@engine.io").length).toBe(1);
});

test("launch splash fades into the app (no blank screen)", async ({ page }) => {
  await page.goto("./");
  // The splash is static HTML, visible before the bundle runs.
  await expect(page.locator("#boot .boot-logo")).toHaveCount(1);
  await expect(page.getByText("People owe you")).toBeVisible();
  await expect(page.locator("#boot")).toHaveCount(0, { timeout: 4000 });
});

test("money: Home totals, WhatsApp links, and won-on-credit receivable", async ({ page }) => {
  await page.goto("./#/settings");
  await page.getByText("Erase all data", { exact: true }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Erase everything", exact: true }).click();
  await addSampleData(page);
  await page.goto("./#/");
  // Sample: owed to me 250,000-100,000 + 50,000 = 200,000; I owe 38,000 + (100,000-40,000) = 98,000
  await expect(page.locator(".money-card.in .mc-value")).toHaveText(/Rs\s?200,000/, { timeout: 4000 });
  await expect(page.locator(".money-card.out .mc-value")).toHaveText(/Rs\s?98,000/, { timeout: 4000 });

  // WhatsApp opens the chat directly with the number in international format
  await page.goto("./#/contacts");
  await page.getByText("Amara Okafor", { exact: true }).click();
  await expect(page.locator("a.qa.wa")).toHaveAttribute("href", "whatsapp://send?phone=923001234510");

  // Record a payment on a loan
  await page.goto("./#/money");
  await page.getByText("Bilal (cousin)").click();
  await page.getByRole("button", { name: "Payment received" }).click();
  const sheet = page.getByRole("dialog").last();
  await sheet.getByLabel("Amount (Rs)").fill("20000");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Payment recorded")).toBeVisible();
  await expect(page.locator(".hero .h-value")).toHaveText(/30,000/);

  // New lead who pays on credit -> win the deal -> offered as a receivable
  await page.goto("./#/pipeline");
  await page.getByRole("button", { name: "New lead" }).click();
  const lead = page.getByRole("dialog").last();
  await lead.getByLabel("Name", { exact: true }).fill("Credit Kamran");
  await lead.getByLabel("Phone").fill("0312 5550001");
  await lead.getByLabel("Pays").selectOption("credit");
  await lead.getByLabel("Value (Rs)").fill("75000");
  await lead.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Lead added to/)).toBeVisible();
  await page.getByText("Credit Kamran").first().click();
  await page.getByRole("button", { name: "Won" }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Add to receivables", exact: true }).click();
  await expect(page.getByText("Added to People owe you")).toBeVisible();
  const db = (await dumpDb(page)) as Record<string, Record<string, unknown>[]>;
  const entry = db.ledger.find((e) => e.personName === "Credit Kamran")!;
  expect(entry).toMatchObject({ direction: "in", kind: "credit", amount: 75000, currency: "PKR", phone: "0312 5550001" });
  expect(entry.dealId).toBeTruthy();
});

test("contact form: typing a new company adds it to Companies, an existing one is reused", async ({ page }) => {
  await page.goto("./#/contacts");
  const addContact = async (name: string, company: string) => {
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByRole("dialog").last().getByRole("button", { name: "New contact", exact: true }).click();
    const sheet = page.getByRole("dialog").last();
    await sheet.getByLabel("Name", { exact: true }).fill(name);
    await sheet.getByLabel("Company", { exact: true }).fill(company);
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await page.goto("./#/contacts");
  };
  await addContact("Sana Malik", "Zeta Traders");
  await expect(page.getByText("“Zeta Traders” added to Companies")).toBeVisible();
  await addContact("Usman Tariq", "zeta traders "); // same company, different case/spacing
  const db = (await dumpDb(page)) as Record<string, Record<string, unknown>[]>;
  const zetas = db.companies.filter((c) => String(c.name).toLowerCase().trim() === "zeta traders");
  expect(zetas.length).toBe(1);
  const sana = db.contacts.find((c) => c.name === "Sana Malik")!;
  const usman = db.contacts.find((c) => c.name === "Usman Tariq")!;
  expect(sana.companyId).toBe(zetas[0].id);
  expect(usman.companyId).toBe(zetas[0].id);
});
