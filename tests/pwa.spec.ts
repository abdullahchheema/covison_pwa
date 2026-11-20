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
  "transactions",
  "accounts",
  "transfers",
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
  for (const tab of ["Pipeline", "Projects", "Money", "More"]) {
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
  await page.locator(".fab").click(); // on Contacts the + opens New contact directly
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
    const tx = db.transaction(["contacts", "companies", "deals", "tasks", "activities", "tags", "contactTags", "ledger", "payments", "transactions", "accounts", "transfers"], "readwrite");
    for (let i = 0; i < 4; i++) tx.objectStore("accounts").put({ id: `acc-${i}`, name: `Bank ${i} 🏦 ${evil}`, kind: ["bank", "wallet", "cash", "bank"][i], scope: i % 2 ? "personal" : "business", openingBalance: 1000 * i, openingDate: "2026-10-01", position: 10 + i, createdAt: t, updatedAt: t });
    for (let i = 0; i < 6; i++) tx.objectStore("transfers").put({ id: `tr-${i}`, fromAccountId: `acc-${i % 4}`, toAccountId: `acc-${(i + 1) % 4}`, amount: 111 * (i + 1), date: "2026-11-02", note: i ? `move ${i}` : undefined, createdAt: t });
    for (let i = 0; i < 15; i++) {
      tx.objectStore("ledger").put({ id: `l-${i}`, direction: i % 2 ? "out" : "in", kind: i % 3 ? "loan" : "credit", personName: `Person ${i} ${evil}`, phone: "0300 1112233", contactId: i < 5 ? `c-${i}` : undefined, amount: 1000 * (i + 1), currency: "PKR", date: "2026-10-01", dueDate: i % 4 ? "2026-12-01" : undefined, note: `Loan 💸 ${i}`, createdAt: t, updatedAt: t });
      tx.objectStore("payments").put({ id: `p-${i}`, entryId: `l-${i}`, amount: 100 * i, date: "2026-10-15", createdAt: t });
    }
    for (let i = 0; i < 25; i++)
      tx.objectStore("transactions").put({ id: `tx-${i}`, type: i % 3 ? "expense" : "income", scope: i % 2 ? "personal" : "business", amount: 250 * (i + 1), currency: "PKR", date: `2026-11-${String((i % 28) + 1).padStart(2, "0")}`, category: i % 2 ? "Food 🍛" : "Client payment", method: "Cash", accountId: `acc-${i % 4}`, note: `note ${evil}`, contactId: i < 5 ? `c-${i}` : undefined, dealId: i < 3 ? `d-${i}` : undefined, createdAt: t, updatedAt: t });
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

  // Snapshot right before exporting (start-up fixes may have linked loan people to contacts on reload)
  const before = canonical(await dumpDb(page));
  const total = Object.values(before).reduce((a, r) => a + r.length, 0);
  expect(total).toBeGreaterThan(200);

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
  await expect(page.getByText("Owed to you")).toBeVisible();
  await expect(page.locator("#boot")).toHaveCount(0, { timeout: 4000 });
});

test("money: Home balances and owed split, WhatsApp, loan repayment into an account", async ({ page }) => {
  await page.goto("./#/settings");
  await page.getByText("Erase all data", { exact: true }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Erase everything", exact: true }).click();
  await addSampleData(page);
  await page.goto("./#/");
  // Sample accounts: Meezan 250,000 (business), NayaPay 42,000, Cash 15,000 (personal), opened 30 days ago.
  // This month: +100,000 +45,000 −12,000 −3,500 (Meezan); −8,200 (NayaPay); −4,500 −1,800 (Cash); transfer 20,000 Meezan→NayaPay
  // Meezan = 250,000+145,000−15,500−20,000 = 359,500 · NayaPay = 42,000−8,200+20,000 = 53,800 · Cash = 15,000−6,300 = 8,700
  await expect(page.locator(".balance-hero .h-value")).toHaveText(/Rs\s?422,000/, { timeout: 4000 });
  await expect(page.locator(".balance-split")).toContainText(/Business\s*Rs\s?359,500/);
  await expect(page.locator(".balance-split")).toContainText(/Personal\s*Rs\s?62,500/);
  // Owed: business = Amara credit 150,000 + won project “Lumen pilot” 320,000 not yet paid; personal = Bilal 50,000; I owe 98,000
  await expect(page.locator(".money-card.in .mc-value")).toHaveText(/Rs\s?470,000/, { timeout: 4000 });
  await expect(page.locator(".money-card.personal .mc-value")).toHaveText(/Rs\s?50,000/, { timeout: 4000 });
  await expect(page.locator(".iowe-row")).toContainText(/98,000/);
  // Open pipeline = open deals 2,445,000 + won project “Lumen pilot” 320,000 not yet received
  await expect(page.locator(".hero:not(.balance-hero) .h-value")).toHaveText(/Rs\s?2,765,000/, { timeout: 4000 });
  await expect(page.locator(".hero:not(.balance-hero) .h-sub")).toContainText("still due on projects");

  // Money in / out this month per side (sample entries are dated within the last 5 days).
  if (new Date().getDate() >= 6) {
    const biz = page.locator(".flow-side.business");
    const per = page.locator(".flow-side.personal");
    // Business: in 100,000 + 45,000; out 12,000 + 3,500 + transfer 20,000 to personal NayaPay
    await expect(biz.locator(".flow-line.in")).toHaveText(/145,000/, { timeout: 4000 });
    await expect(biz.locator(".flow-line.out")).toHaveText(/35,500/);
    // Personal: in = the 20,000 transfer; out 8,200 + 4,500 + 1,800
    await expect(per.locator(".flow-line.in")).toHaveText(/20,000/);
    await expect(per.locator(".flow-line.out")).toHaveText(/14,500/);
    // All accounts: the cross-side transfer cancels out
    await expect(page.locator(".flow-total")).toContainText(/in Rs\s?145,000 · out Rs\s?30,000/);
    // The monthly figure is labelled as this month's, and each side shows its real balance
    await expect(per.locator(".flow-net")).toContainText("this month");
    await expect(per.locator(".flow-bal")).toContainText(/Balance now\s*Rs\s?62,500/);
    await expect(biz.locator(".flow-bal")).toContainText(/Balance now\s*Rs\s?359,500/);
  }

  // Tapping Personal opens the detailed list
  await page.locator(".money-card.personal").click();
  await expect(page.getByText("Bilal (cousin)")).toBeVisible();

  // WhatsApp opens the chat directly with the number in international format
  await page.goto("./#/contacts");
  await page.getByText("Amara Okafor", { exact: true }).click();
  // Default: regular WhatsApp via the official wa.me link (opens outside the app)
  await expect(page.locator("a.qa.wa")).toHaveAttribute("href", "https://wa.me/923001234510");
  await expect(page.locator("a.qa.wa")).toHaveAttribute("target", "_blank");

  // Loan repayment goes into an account and raises its balance
  await page.goto("./#/money");
  await page.getByRole("button", { name: "Owed", exact: true }).click();
  await page.locator(".money-card.personal").click();
  await page.getByText("Bilal (cousin)").click();
  await page.getByRole("button", { name: "Payment received" }).click();
  const sheet = page.getByRole("dialog").last();
  await sheet.getByLabel("Amount (Rs)").fill("20000");
  await sheet.getByLabel("Into account").selectOption({ label: "Cash · Personal" });
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Payment recorded")).toBeVisible();
  await expect(page.locator(".hero .h-value")).toHaveText(/30,000/);
  await page.goto("./#/");
  await expect(page.locator(".balance-split")).toContainText(/Personal\s*Rs\s?82,500/, { timeout: 4000 });
});

test("contact form: typing a new company adds it to Companies, an existing one is reused", async ({ page }) => {
  await page.goto("./#/contacts");
  const addContact = async (name: string, company: string) => {
    await page.locator(".fab").click(); // on Contacts the + opens New contact directly
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

test("iPhone contacts: bulk .vcf import skips people you already have", async ({ page }) => {
  const vcf = [
    "BEGIN:VCARD", "VERSION:3.0", "N:Iqbal;Hamza;;;", "FN:Hamza Iqbal", "ORG:Iqbal Textiles;", "TITLE:Owner",
    "item1.TEL;type=CELL;type=pref:0301 2223334", "TEL;type=WORK:+92 42 1234567", "EMAIL;type=INTERNET:hamza@iqbal.pk", "END:VCARD",
    "BEGIN:VCARD", "VERSION:2.1", "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=D8=B9=D9=84=DB=8C;;;;", "TEL;CELL:0322-9998887", "END:VCARD",
    "BEGIN:VCARD", "VERSION:4.0", "FN:Ayesha Khan", "TEL;VALUE=uri:tel:+923001112233", "END:VCARD",
  ].join("\r\n");
  const one = ["BEGIN:VCARD", "VERSION:3.0", "FN:Hamza Iqbal", "ORG:Iqbal Textiles", "TEL:0301 2223334", "TEL:+92 42 1234567", "EMAIL:hamza@iqbal.pk", "END:VCARD"].join("\n");
  writeFileSync(join(__dirname, ".tmp/people.vcf"), vcf);
  writeFileSync(join(__dirname, ".tmp/hamza.vcf"), one);

  // Hamza already exists in the CRM (same mobile)
  await page.goto("./#/contacts");
  await page.locator(".fab").click(); // on Contacts the + opens New contact directly
  const form = page.getByRole("dialog").last();
  await expect(form.getByRole("button", { name: "From iPhone contacts" })).toHaveCount(0); // picker button removed
  await form.getByLabel("Name", { exact: true }).fill("Hamza Iqbal");
  await form.getByLabel("Mobile").fill("0301 2223334");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Hamza Iqbal" })).toBeVisible();

  // Bulk: Hamza already exists (same phone) → skipped; the other two are imported
  await page.goto("./#/settings");
  const [fc2] = await Promise.all([page.waitForEvent("filechooser"), page.getByText("Import iPhone contacts", { exact: true }).click()]);
  await fc2.setFiles(join(__dirname, ".tmp/people.vcf"));
  await expect(page.getByText("Import 2 of 3 contacts?")).toBeVisible();
  await page.getByRole("dialog").last().getByRole("button", { name: "Import 2", exact: true }).click();
  await expect(page.getByText("Imported 2 contacts")).toBeVisible();
  const db = (await dumpDb(page)) as Record<string, Record<string, unknown>[]>;
  expect(db.contacts.filter((c) => c.name === "Hamza Iqbal").length).toBe(1);
  expect(db.contacts.find((c) => c.name === "علی")).toMatchObject({ phone: "0322-9998887" });
  expect(db.contacts.find((c) => c.name === "Ayesha Khan")).toMatchObject({ phone: "+923001112233" });
});

async function addAccount(page: Page, name: string, kind: "Bank" | "Wallet" | "Cash", scope: "Business" | "Personal", balance: string) {
  await page.goto("./#/money");
  await page.locator(".screen.current .navbar [aria-label=\"Add money entry\"]").click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Add account", exact: true }).click();
  const s = page.getByRole("dialog").last();
  await s.getByLabel("Name", { exact: true }).fill(name);
  await s.getByRole("button", { name: kind, exact: true }).click();
  await s.getByRole("button", { name: scope, exact: true }).click();
  await s.getByLabel("Balance now (Rs)").fill(balance);
  await s.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(`${name} added`)).toBeVisible();
}

test("won flow: popup creates project, agreed total optional, advance into an account; more payments later", async ({ page }) => {
  await addAccount(page, "Meezan Bank", "Bank", "Business", "100000");
  await addAccount(page, "NayaPay", "Wallet", "Personal", "5000");

  // Lead with no amount
  await page.goto("./#/pipeline");
  await page.getByRole("button", { name: "New lead" }).first().click();
  const lead = page.getByRole("dialog").last();
  await lead.getByLabel("Name", { exact: true }).fill("Faisal Ahmed");
  await lead.getByLabel("Mobile").fill("0333 4445556");
  await lead.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Faisal Ahmed").first().click();
  await expect(page.getByText("No amount yet")).toBeVisible();

  // Won → popup
  await page.getByRole("button", { name: "Won" }).click();
  const won = page.getByRole("dialog").last();
  await expect(won.getByText("is won")).toBeVisible();
  await won.getByLabel("Name", { exact: true }).fill("Faisal store website");
  await won.getByLabel("Description").fill("5-page site with checkout");
  await won.getByLabel("Advance received").fill("15000");
  await won.getByLabel("Into account").selectOption({ label: "Meezan Bank · Business" });
  await won.getByRole("button", { name: "Save", exact: true }).click(); // total left empty: not agreed yet
  await expect(page.getByText(/Project created · advance/)).toBeVisible();
  await expect(page.getByText("Total not agreed yet")).toBeVisible();

  // Later: delivery payment + set the agreed total at the same time
  await page.getByRole("button", { name: /Record (advance|payment|extra payment)/ }).click();
  const pay = page.getByRole("dialog").last();
  await pay.getByRole("button", { name: "Delivery", exact: true }).click();
  await pay.getByLabel("Amount (Rs)").fill("27000");
  await pay.getByLabel("Into account").selectOption({ label: "NayaPay · Personal" });
  await pay.getByLabel("Agreed (Rs)").fill("35000");
  await pay.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/7,000 extra over the agreed total/)).toBeVisible();

  const db = (await dumpDb(page)) as Record<string, Record<string, unknown>[]>;
  const deal = db.deals.find((d) => d.name === "Faisal store website")!;
  expect(deal.value).toBe(35000);
  expect(db.stages.find((s) => s.id === deal.stageId)!.isWon).toBe(true); // stays in Won
  const project = db.projects.find((p) => p.dealId === deal.id)!;
  expect(project).toMatchObject({ name: "Faisal store website", description: "5-page site with checkout", contactId: deal.contactId });
  const meezan = db.accounts.find((a) => a.name === "Meezan Bank")!;
  const nayapay = db.accounts.find((a) => a.name === "NayaPay")!;
  const incomes = db.transactions.filter((t) => t.dealId === deal.id).map((t) => [t.amount, t.accountId, t.note]);
  expect(incomes.sort()).toEqual([[15000, meezan.id, "Advance"], [27000, nayapay.id, "Delivery"]]);

  // Balances updated, shown on Home
  await page.goto("./#/");
  await expect(page.locator(".balance-split")).toContainText(/Business\s*Rs\s?115,000/, { timeout: 4000 });
  await expect(page.locator(".balance-split")).toContainText(/Personal\s*Rs\s?32,000/);

  // New project for the same client
  await page.goto(`./#/deals/${deal.id}`);
  await page.getByRole("button", { name: "Options" }).click();
  await page.getByRole("button", { name: "New deal with Faisal" }).click();
  const nd = page.getByRole("dialog").last();
  await nd.getByLabel("Deal name").fill("Faisal website v2");
  await nd.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Lead added to/)).toBeVisible();
  const db2 = (await dumpDb(page)) as Record<string, Record<string, unknown>[]>;
  expect(db2.contacts.filter((c) => c.name === "Faisal Ahmed").length).toBe(1);
  expect(db2.deals.filter((d) => d.contactId === deal.contactId).length).toBe(2);
});

test("accounts: transfer between accounts moves balances, not income or spending", async ({ page }) => {
  await addAccount(page, "Meezan Bank", "Bank", "Business", "100000");
  await addAccount(page, "Cash", "Cash", "Personal", "2000");
  await page.goto("./#/money");
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await page.getByRole("button", { name: "Transfer", exact: true }).first().click();
  const s = page.getByRole("dialog").last();
  await s.getByLabel("From").selectOption({ label: "Meezan Bank · Bank" });
  await s.getByLabel("To").selectOption({ label: "Cash · Cash" });
  await s.getByLabel("Amount (Rs)").fill("30000");
  await s.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText(/Moved Rs\s?30,000 from Meezan Bank to Cash/)).toBeVisible();
  await page.getByText("Meezan Bank", { exact: true }).click();
  await expect(page.locator(".screen.current .hero .h-value")).toHaveText(/70,000/, { timeout: 4000 });
  await expect(page.getByText("To Cash", { exact: true })).toBeVisible();
  await page.goto("./#/");
  await expect(page.locator(".balance-hero .h-value")).toHaveText(/Rs\s?102,000/, { timeout: 4000 });
  await expect(page.locator(".balance-split")).toContainText(/Personal\s*Rs\s?32,000/);
  // Business → personal transfer: out of business, into personal, nothing in/out overall
  await expect(page.locator(".flow-side.business .flow-line.out")).toHaveText(/30,000/, { timeout: 4000 });
  await expect(page.locator(".flow-side.personal .flow-line.in")).toHaveText(/30,000/);
  await expect(page.locator(".flow-total")).toContainText(/in Rs\s?0 · out Rs\s?0/);
  const db = (await dumpDb(page)) as Record<string, Record<string, unknown>[]>;
  expect(db.transactions.length).toBe(0); // a transfer is not income/expense
  expect(db.transfers.length).toBe(1);
});

test("cash flow: add personal expense and business income, month totals update", async ({ page }) => {
  await page.goto("./#/settings");
  await page.getByText("Erase all data", { exact: true }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Erase everything", exact: true }).click();
  await page.goto("./#/money");
  await page.getByRole("button", { name: "Cash flow" }).click();
  const add = async (kind: "Income" | "Expense", amount: string, category: string) => {
    await page.getByRole("button", { name: kind, exact: true }).click();
    const s = page.getByRole("dialog").last();
    await s.getByLabel("Amount (Rs)").fill(amount);
    await s.getByRole("button", { name: category, exact: true }).click();
    await s.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForTimeout(400);
  };
  await add("Expense", "2500", "Groceries");
  await add("Income", "50000", "Client payment");
  await add("Expense", "1200", "Food");
  await expect(page.getByText("Saved Rs 46,300")).toBeVisible();
  await expect(page.getByText("Where it went")).toBeVisible();
  const db = (await dumpDb(page)) as Record<string, Record<string, unknown>[]>;
  expect(db.transactions.length).toBe(3);
  expect(db.transactions.find((t) => t.category === "Groceries")).toMatchObject({ type: "expense", scope: "personal", amount: 2500 });
  expect(db.transactions.find((t) => t.category === "Client payment")).toMatchObject({ type: "income", scope: "business", amount: 50000 });
  // The month view in Money → Cash flow keeps the totals across navigation
  await page.goto("./#/");
  await page.goto("./#/money");
  await expect(page.getByText("Saved Rs 46,300")).toBeVisible();
});

test("pipeline is Lead → Negotiation → Won; older installs are migrated without losing deals", async ({ page }) => {
  await page.goto("./#/pipeline");
  await expect(page.locator(".screen.current .stage-sec-head")).toHaveText([/Lead/, /Negotiation/, /Won/]);
  // Simulate an old install: old default stages with deals in them, then restart.
  await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res) => {
      const r = indexedDB.open("covison-pocket");
      r.onsuccess = () => res(r.result);
    });
    const tx = db.transaction(["stages", "deals", "meta"], "readwrite");
    const t = new Date().toISOString();
    const stages = await new Promise<{ id: string; pipelineId: string; name: string }[]>((res) => {
      const q = tx.objectStore("stages").getAll();
      q.onsuccess = () => res(q.result);
    });
    const pid = stages[0].pipelineId;
    tx.objectStore("stages").put({ id: "old-q", pipelineId: pid, name: "Qualified", position: 1, isWon: false, isLost: false, createdAt: t, updatedAt: t });
    tx.objectStore("stages").put({ id: "old-p", pipelineId: pid, name: "Proposal", position: 2, isWon: false, isLost: false, createdAt: t, updatedAt: t });
    tx.objectStore("stages").put({ id: "old-l", pipelineId: pid, name: "Lost", position: 9, isWon: false, isLost: true, createdAt: t, updatedAt: t });
    tx.objectStore("deals").put({ id: "dq", pipelineId: pid, stageId: "old-q", name: "Was qualified", value: 0, currency: "PKR", createdAt: t, updatedAt: t });
    tx.objectStore("deals").put({ id: "dp", pipelineId: pid, stageId: "old-p", name: "Was proposal", value: 0, currency: "PKR", createdAt: t, updatedAt: t });
    tx.objectStore("meta").put({ key: "migr.pipeline3", value: false });
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
  });
  await page.reload();
  await expect(page.locator(".screen.current .stage-sec-head")).toHaveText([/Lead\s*1/, /Negotiation\s*1/, /Won\s*0/]);
  const db = (await dumpDb(page)) as Record<string, Record<string, unknown>[]>;
  const name = (id: unknown) => db.stages.find((s) => s.id === id)?.name;
  expect(name(db.deals.find((d) => d.id === "dq")!.stageId)).toBe("Lead");
  expect(name(db.deals.find((d) => d.id === "dp")!.stageId)).toBe("Negotiation");
  expect(db.stages.map((s) => s.name).sort()).toEqual(["Lead", "Negotiation", "Won"]);
});

test("lead form asks only name, mobile, company, position; company is created", async ({ page }) => {
  await page.goto("./#/pipeline");
  await page.getByRole("button", { name: "New lead" }).first().click();
  const lead = page.getByRole("dialog").last();
  await expect(lead.locator(".field label")).toHaveText(["Name", "Mobile", "Company", "Position"]);
  await lead.getByLabel("Name", { exact: true }).fill("Sara Javed");
  await lead.getByLabel("Mobile").fill("0300 7778889");
  await lead.getByLabel("Company", { exact: true }).fill("Javed Foods");
  await lead.getByLabel("Position").fill("Owner");
  await lead.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Lead added to Lead/)).toBeVisible();
  const db = (await dumpDb(page)) as Record<string, Record<string, unknown>[]>;
  const c = db.contacts.find((x) => x.name === "Sara Javed")!;
  expect(c).toMatchObject({ phone: "0300 7778889", jobTitle: "Owner" });
  expect(db.companies.find((x) => x.id === c.companyId)!.name).toBe("Javed Foods");
  expect(db.deals.find((d) => d.contactId === c.id)).toBeTruthy();
});

test("projects: won lead appears as Not started; status, money received and expenses", async ({ page }) => {
  await addAccount(page, "Meezan Bank", "Bank", "Business", "50000");
  await page.goto("./#/pipeline");
  await page.getByRole("button", { name: "New lead" }).first().click();
  const lead = page.getByRole("dialog").last();
  await lead.getByLabel("Name", { exact: true }).fill("Bilal Store");
  await lead.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Bilal Store").first().click();
  await page.getByRole("button", { name: "Won" }).click();
  const won = page.getByRole("dialog").last();
  await won.getByLabel("Name", { exact: true }).fill("Bilal Store app");
  await won.getByLabel("Total agreed (Rs)").fill("80000");
  await won.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Project created")).toBeVisible();

  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Projects" }).click();
  await expect(page.locator('.screen.current section[data-zone="not_started"]')).toContainText("Bilal Store app");
  await page.locator(".screen.current").getByText("Bilal Store app").first().click();
  await page.getByRole("button", { name: "In progress", exact: true }).click();

  // Money received (into Meezan) and an expense on the project
  await page.getByRole("button", { name: "Money received" }).first().click();
  const pay = page.getByRole("dialog").last();
  await pay.getByLabel("Amount (Rs)").fill("30000");
  await pay.getByLabel("Into account").selectOption({ label: "Meezan Bank · Business" });
  await pay.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Expense", exact: true }).click();
  const exp = page.getByRole("dialog").last();
  await exp.getByLabel("Amount (Rs)").fill("6000");
  await exp.getByLabel("Paid from").selectOption({ label: "Meezan Bank · Business" });
  await exp.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(500);

  const cells = page.locator(".screen.current .pm-cell");
  await expect(cells.nth(0)).toContainText("80,000");
  await expect(cells.nth(1)).toContainText("30,000");
  await expect(cells.nth(2)).toContainText("6,000");
  await expect(cells.nth(3)).toContainText("50,000"); // still due
  await expect(page.getByText(/Profit so far\s*Rs\s?24,000/)).toBeVisible();

  const db = (await dumpDb(page)) as Record<string, Record<string, unknown>[]>;
  const project = db.projects.find((p) => p.name === "Bilal Store app")!;
  expect(project.status).toBe("in_progress");
  expect(db.transactions.find((t) => t.type === "expense")).toMatchObject({ amount: 6000, projectId: project.id, scope: "business" });

  // Home: ongoing projects; account balance 50,000 + 30,000 − 6,000
  await page.goto("./#/");
  await expect(page.getByText("Ongoing projects")).toBeVisible();
  await expect(page.locator(".balance-hero .h-value")).toHaveText(/Rs\s?74,000/, { timeout: 4000 });
});

test("a personal loan to a new person creates a contact tagged Personal", async ({ page }) => {
  await addAccount(page, "NayaPay", "Wallet", "Personal", "50000");
  await page.goto("./#/money");
  await page.getByRole("button", { name: "Owed", exact: true }).click();
  await page.getByRole("button", { name: "Loan", exact: true }).click();
  const s = page.getByRole("dialog").last();
  await s.getByLabel("Name", { exact: true }).fill("Usman Cousin");
  await s.getByLabel("Phone").fill("0345 1231231");
  await s.getByLabel("Amount (Rs)").fill("15000");
  await s.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Usman Cousin added to Contacts")).toBeVisible();
  const db = (await dumpDb(page)) as Record<string, Record<string, unknown>[]>;
  const c = db.contacts.find((x) => x.name === "Usman Cousin")!;
  expect(c.phone).toBe("0345 1231231");
  expect(db.ledger.find((e) => e.personName === "Usman Cousin")!.contactId).toBe(c.id);
  const tag = db.tags.find((t) => t.name === "Personal")!;
  expect(db.contactTags.some((l) => l.contactId === c.id && l.tagId === tag.id)).toBe(true);
  // Money lent leaves your pocket: it shows in Cash flow as money out.
  await page.getByRole("button", { name: "Cash flow", exact: true }).click();
  await page.getByRole("button", { name: "Personal", exact: true }).click();
  await expect(page.getByText("Lent to Usman Cousin")).toBeVisible();
  await expect(page.getByText(/incl\. Rs\s?15,000 lent$/)).toBeVisible();
  await expect(page.locator(".screen.current").getByText("Lent", { exact: true })).toBeVisible(); // in "Where it went"
});

test("sheets close with a downward swipe (the + menu)", async ({ page }) => {
  await page.goto("./#/");
  await page.getByRole("button", { name: "Create" }).click();
  const sheet = page.locator(".sheet-layer:not(.closing) .sheet");
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(500);
  await sheet.evaluate(async (el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    let y = r.top + 80;
    const touch = (yy: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: yy });
    const fire = (type: string, yy: number) =>
      el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [touch(yy)], changedTouches: [touch(yy)] }));
    fire("touchstart", y);
    for (let i = 0; i < 12; i++) {
      y += 20;
      fire("touchmove", y);
      await new Promise((r) => setTimeout(r, 8));
    }
    fire("touchend", y);
  });
  await expect(page.locator(".sheet-layer")).toHaveCount(0, { timeout: 2000 });
});

test("amounts keep their decimals (paisa)", async ({ page }) => {
  await addAccount(page, "Cash", "Cash", "Personal", "1000.75");
  await page.goto("./#/money");
  await page.getByRole("button", { name: "Cash flow", exact: true }).click();
  await page.getByRole("button", { name: "Expense", exact: true }).click();
  const s = page.getByRole("dialog").last();
  await s.getByLabel("Amount (Rs)").fill("250.50");
  await s.getByRole("button", { name: "Food", exact: true }).click();
  await s.getByLabel("Paid from").selectOption({ label: "Cash · Personal" });
  await s.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".screen.current").getByText("−Rs 250.50").first()).toBeVisible();
  const db = (await dumpDb(page)) as Record<string, Record<string, unknown>[]>;
  expect(db.transactions[0].amount).toBe(250.5);
  expect(db.accounts[0].openingBalance).toBe(1000.75);
  // 1,000.75 − 250.50 = 750.25
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await expect(page.locator(".screen.current .balance-hero .h-value")).toHaveText(/Rs\s?750\.25/, { timeout: 4000 });
});

/** Long-press a board card with real touch events, then drag it onto a dock zone. */
async function touchDrag(page: Page, cardText: string, zoneId: string) {
  const card = page.locator(".screen.current .kcard", { hasText: cardText }).first();
  await card.scrollIntoViewIfNeeded();
  const box = (await card.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 20;
  await card.evaluate((el, [cx, cy]) => {
    const t = new Touch({ identifier: 7, target: el, clientX: cx, clientY: cy });
    el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [t], changedTouches: [t] }));
  }, [x, y]);
  await page.waitForTimeout(500); // hold → the card lifts and the dock appears
  // Vertical boards: drop onto the stage section itself (its header).
  const zone = page.locator(`.screen.current section[data-zone="${zoneId}"] .stage-sec-head`);
  await expect(zone).toBeVisible();
  const z = (await zone.boundingBox())!;
  await card.evaluate(async (el, [x0, y0, x1, y1]) => {
    const steps = 10;
    let last: Touch | undefined;
    for (let i = 1; i <= steps; i++) {
      const t = new Touch({ identifier: 7, target: el, clientX: x0 + ((x1 - x0) * i) / steps, clientY: y0 + ((y1 - y0) * i) / steps });
      last = t;
      el.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [t], changedTouches: [t] }));
      await new Promise((r) => setTimeout(r, 16));
    }
    el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], changedTouches: [last!] }));
  }, [x, y, z.x + z.width / 2, z.y + z.height / 2]);
}

test("touch drag: lead moves between pipeline stages; project moves between project stages", async ({ page }) => {
  await page.goto("./#/pipeline");
  await page.getByRole("button", { name: "New lead" }).first().click();
  const lead = page.getByRole("dialog").last();
  await lead.getByLabel("Name", { exact: true }).fill("Drag Me Ltd");
  await lead.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Lead added to/)).toBeVisible();
  let db = (await dumpDb(page)) as Record<string, Record<string, unknown>[]>;
  const nego = db.stages.find((s) => s.name === "Negotiation")!;
  await touchDrag(page, "Drag Me Ltd", String(nego.id));
  await expect(page.getByText("Moved to Negotiation")).toBeVisible();
  db = (await dumpDb(page)) as Record<string, Record<string, unknown>[]>;
  expect(db.deals.find((d) => d.name === "Drag Me Ltd")!.stageId).toBe(nego.id);

  // A project card on the Projects board
  await page.goto("./#/projects");
  await page.getByRole("button", { name: "New project" }).first().click();
  const np = page.getByRole("dialog").last();
  await np.getByLabel("Name", { exact: true }).fill("Drag project");
  await np.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Drag project" })).toBeVisible(); // the new project opens
  await page.goto("./#/projects");
  await page.waitForTimeout(500);
  await touchDrag(page, "Drag project", "in_progress");
  await expect(page.getByText("Drag project: In progress")).toBeVisible();
  db = (await dumpDb(page)) as Record<string, Record<string, unknown>[]>;
  expect(db.projects.find((p) => p.name === "Drag project")!.status).toBe("in_progress");
  // No to-dos on the project page anymore
  await page.goto(`./#/projects/${db.projects.find((p) => p.name === "Drag project")!.id}`);
  await expect(page.getByText("To-dos")).toHaveCount(0);
});

test("contact form is short by default; More details reveals the rest", async ({ page }) => {
  await page.goto("./#/contacts");
  await page.locator(".fab").click(); // on Contacts the + opens New contact directly
  const f = page.getByRole("dialog").last();
  await expect(f.locator(".field label")).toHaveText(["Name", "Mobile", "Company", "Position"]);
  await f.getByRole("button", { name: /More details/ }).click();
  await expect(f.getByLabel("Email")).toBeVisible();
});

test("+ button matches the screen; toasts and the backup warning swipe away upward", async ({ page }) => {
  await addSampleData(page);
  // Pipeline: straight to New lead
  await page.goto("./#/pipeline");
  await page.locator(".fab").click();
  await expect(page.getByRole("dialog").last()).toContainText("New lead");
  await page.getByRole("dialog").last().getByRole("button", { name: "Cancel" }).click();
  // Money → Owed: only loan / credit choices
  await page.goto("./#/money");
  await page.getByRole("button", { name: "Owed", exact: true }).click();
  await page.locator(".fab").click();
  const sheet = page.getByRole("dialog").last();
  await expect(sheet.locator(".action")).toHaveText([/Loan given/, /Loan taken/, /Client credit/, /Cancel/]);
  await sheet.getByRole("button", { name: "Cancel" }).click();

  // Backup warning on Home: swipe up hides it (for 3 days)
  await page.goto("./#/");
  const banner = page.locator(".screen.current .banner", { hasText: "Time for a backup" });
  await expect(banner).toBeVisible();
  await banner.evaluate(async (el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + 40;
    let y = r.top + r.height / 2;
    const t = (yy: number) => new Touch({ identifier: 3, target: el, clientX: x, clientY: yy });
    el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [t(y)], changedTouches: [t(y)] }));
    for (let i = 0; i < 8; i++) {
      y -= 12;
      el.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [t(y)], changedTouches: [t(y)] }));
      await new Promise((r2) => setTimeout(r2, 12));
    }
    el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], changedTouches: [t(y)] }));
  });
  await expect(page.getByText("Backup reminder hidden for 3 days")).toBeVisible();
  await expect(banner).toHaveCount(0);

  // A toast swipes away upward
  const toastEl = page.locator(".toast-wrap").first();
  await toastEl.evaluate(async (el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + 60;
    let y = r.top + r.height / 2;
    const t = (yy: number) => new Touch({ identifier: 4, target: el, clientX: x, clientY: yy });
    el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [t(y)], changedTouches: [t(y)] }));
    for (let i = 0; i < 6; i++) {
      y -= 12;
      el.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [t(y)], changedTouches: [t(y)] }));
      await new Promise((r2) => setTimeout(r2, 12));
    }
    el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], changedTouches: [t(y)] }));
  });
  await expect(page.locator(".toast-wrap")).toHaveCount(0, { timeout: 1500 });
});

test("projects: Still due counts completed projects that aren't fully paid", async ({ page }) => {
  await page.goto("./#/projects");
  await page.getByRole("button", { name: "New project" }).first().click();
  const f = page.getByRole("dialog").last();
  await f.getByLabel("Name", { exact: true }).fill("Finished but unpaid");
  await f.getByLabel("Total agreed (Rs)").fill("80000");
  await f.getByRole("button", { name: "Completed", exact: true }).click();
  await f.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finished but unpaid" })).toBeVisible();
  await page.goto("./#/projects");
  await expect(page.locator(".screen.current .metric").first()).toContainText("80,000");
});

test("pipeline card shows the company on top and the person at the bottom", async ({ page }) => {
  await page.goto("./#/pipeline");
  await page.getByRole("button", { name: "New lead" }).first().click();
  const lead = page.getByRole("dialog").last();
  await lead.getByLabel("Name", { exact: true }).fill("Ayan Malik");
  await lead.getByLabel("Company", { exact: true }).fill("Eman Furniture");
  await lead.getByRole("button", { name: "Save", exact: true }).click();
  const card = page.locator(".screen.current .kcard", { hasText: "Eman Furniture" }).first();
  await expect(card.locator(".t-headline")).toHaveText("Eman Furniture");
  await expect(card.locator(".row.gap8.mt8")).toContainText("Ayan Malik");
  await expect(card.locator(".row.gap8.mt8")).not.toContainText("Eman Furniture");
});

test("split bills: 'I paid for them' / 'They paid for me' don't move account balances a second time", async ({ page }) => {
  await page.goto("./#/settings");
  await page.getByText("Erase all data", { exact: true }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Erase everything", exact: true }).click();
  await addAccount(page, "NayaPay", "Wallet", "Personal", "5000");
  // I paid a 2,000 dinner bill myself
  await page.goto("./#/money");
  await page.getByRole("button", { name: "Cash flow", exact: true }).click();
  await page.getByRole("button", { name: "Expense", exact: true }).click();
  let s = page.getByRole("dialog").last();
  await s.getByLabel("Amount (Rs)").fill("2000");
  await s.getByRole("button", { name: "Food", exact: true }).click();
  await s.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(500);
  const addLoan = async (name: string, amount: string, how: string) => {
    await page.getByRole("button", { name: "Owed", exact: true }).click();
    await page.getByRole("button", { name: "Loan", exact: true }).click();
    const d = page.getByRole("dialog").last();
    if (how === "They paid for me") await d.getByRole("button", { name: "I owe them", exact: true }).click();
    await d.getByRole("button", { name: how, exact: true }).click();
    await d.getByLabel("Name", { exact: true }).fill(name);
    await d.getByLabel("Amount (Rs)").fill(amount);
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForTimeout(600);
  };
  // Friend owes half of it: nothing should leave the account again
  await addLoan("Ali Friend", "1000", "I paid for them");
  // Another friend paid a bill and I owe my share: nothing should enter my account
  await addLoan("Sara Friend", "500", "They paid for me");
  const db = (await dumpDb(page)) as Record<string, Record<string, unknown>[]>;
  expect(db.ledger.length).toBe(2);
  expect(db.ledger.every((e) => !e.accountId)).toBe(true);
  await page.goto("./#/money");
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await expect(page.locator(".screen.current")).toContainText(/Rs\s?3,000/); // 5,000 − 2,000 dinner, nothing else
  // Cash flow: only the dinner is money out
  await page.getByRole("button", { name: "Cash flow", exact: true }).click();
  await expect(page.locator(".screen.current")).toContainText(/Money out\s*Rs\s?2,000/);
  await expect(page.getByText(/Lent to|Borrowed from/)).toHaveCount(0);
  // They still show as owed
  await page.getByRole("button", { name: "Owed", exact: true }).click();
  await expect(page.locator(".screen.current")).toContainText(/Personal\s*Rs\s?1,000/);
  await expect(page.locator(".screen.current")).toContainText(/You owe\s*Rs\s?500/);
  // When Ali pays back his 1,000 the money does arrive in the account
  const ali = db.ledger.find((e) => e.personName === "Ali Friend")!;
  await page.goto(`./#/money/${ali.id}`);
  await page.getByRole("button", { name: /Payment|Record/i }).first().click();
  s = page.getByRole("dialog").last();
  await s.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(600);
  await page.goto("./#/money");
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await expect(page.locator(".screen.current")).toContainText(/Rs\s?4,000/);
});
