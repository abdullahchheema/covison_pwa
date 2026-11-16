import { useEffect, useState } from "preact/hooks";
import { DATA_TABLES, db } from "../db/schema";
import { eraseAll, getMeta, setMeta } from "../db/repo";
import { countsOf, exportBackup, restoreBackup, validateBackup, type BackupFile } from "../db/backup";
import { analyzeLegacyFiles, applyLegacyPlan, type LegacyPlan } from "../db/legacy";
import { exportCsv, type CsvEntity } from "../db/csvExport";
import { loadSampleData, ensureSeeded } from "../db/seed";
import { useLive } from "../lib/hooks";
import { getThemePref, setThemePref, type ThemePref } from "../lib/theme";
import { requestPersistence, isStandalone } from "../lib/pwa";
import { relativeTime, shortDate } from "../lib/format";
import { optText } from "../lib/sanitize";
import { navigate } from "../lib/router";
import { Icon } from "../ui/icons";
import { Group, Row, Screen, Segmented, TextField } from "../ui/kit";
import { actionSheet, confirmSheet, openSheet, toast } from "../ui/overlay";
import { pickFile } from "./CsvImport";
import { getCountryCode, setCountryCode } from "../lib/whatsapp";

const DAY = 86400000;

const TABLE_LABELS: Record<string, string> = {
  contacts: "contacts",
  companies: "companies",
  deals: "deals",
  tasks: "tasks",
  activities: "notes & activities",
  projects: "projects",
  projectTodos: "to-dos",
  tags: "tags",
  leadTypes: "lead types",
  stages: "stages",
  ledger: "money entries",
  payments: "payments",
};

function useBackupStatus() {
  return useLive(async () => {
    const [last, contacts, deals, tasks] = await Promise.all([getMeta<string | null>("lastBackupAt", null), db.contacts.count(), db.deals.count(), db.tasks.count()]);
    const hasData = contacts + deals + tasks > 0;
    const stale = hasData && (!last || Date.now() - new Date(last).getTime() > 7 * DAY);
    return { last, stale, hasData };
  }, []);
}

/** Gentle reminder when the last backup is older than 7 days. */
export function BackupReminder({ compact }: { compact?: boolean }) {
  const s = useBackupStatus();
  if (!s?.stale) return null;
  return (
    <button class="banner press-soft fade-in" style={{ width: "100%", textAlign: "left", marginBottom: compact ? "14px" : 0 }} onClick={() => navigate("/settings")}>
      <Icon name="shield" size={22} class="b-ico" />
      <span class="grow">
        <strong>Time for a backup</strong>
        <span class="t-footnote c2" style="display:block">
          {s.last ? `Last backup ${relativeTime(s.last)}.` : "You haven't backed up yet."} Your data lives only on this iPhone.
        </span>
      </span>
      <Icon name="chevronRight" size={18} class="c3" />
    </button>
  );
}

async function doExport() {
  try {
    const { result, counts } = await exportBackup();
    if (result === "cancelled") return;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    toast(`Backup ready · ${total} records`, { icon: "shield" });
  } catch (e) {
    toast(`Export failed: ${(e as Error).message}`, { error: true });
  }
}

async function doRestore() {
  const [file] = await pickFile("application/json,.json");
  if (!file) return;
  if (file.size > 100_000_000) return toast("That file is too large", { error: true });
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return toast("That file isn't valid JSON", { error: true });
  }
  const v = validateBackup(parsed);
  if (!v.ok || !v.backup) {
    openSheet(
      () => (
        <div class="form">
          <div class="banner">
            <Icon name="alert" size={22} class="b-ico" />
            <span>This backup can't be restored. Nothing was changed.</span>
          </div>
          <Group label="Problems found">
            {v.errors.slice(0, 12).map((e) => (
              <Row key={e} title={<span class="t-subhead">{e}</span>} chevron={false} />
            ))}
          </Group>
        </div>
      ),
      { title: "Invalid backup" },
    );
    return;
  }
  const backup = v.backup;
  const incoming = countsOf(backup);
  const current: Record<string, number> = {};
  for (const t of DATA_TABLES) current[t] = await db.table(t).count();
  openSheet((close) => <RestoreConfirm backup={backup} incoming={incoming} current={current} fileName={file.name} close={close} />, { title: "Restore backup" });
}

function RestoreConfirm({ backup, incoming, current, fileName, close }: { backup: BackupFile; incoming: Record<string, number>; current: Record<string, number>; fileName: string; close: () => void }) {
  const [busy, setBusy] = useState(false);
  const shown = Object.keys(TABLE_LABELS);
  return (
    <div class="form">
      <div class="banner brand">
        <Icon name="file" size={22} class="b-ico" />
        <span class="grow">
          <strong class="truncate" style="display:block">{fileName}</strong>
          <span class="t-footnote c2">Backed up {shortDate(backup.exportedAt)} · valid</span>
        </span>
      </div>
      <Group label="What will change" footer="Restoring replaces everything currently on this iPhone with the backup. It can't be undone, so export a backup first if you're unsure.">
        {shown.map((t) => (
          <Row key={t} title={TABLE_LABELS[t]} value={<span class="num">{current[t]} → <strong style="color:var(--text)">{incoming[t as keyof typeof incoming]}</strong></span>} chevron={false} />
        ))}
      </Group>
      <button
        class="btn danger block press"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await restoreBackup(backup);
            close();
            toast("Backup restored", { icon: "checkCircle" });
          } catch (e) {
            toast(`Restore failed, nothing changed: ${(e as Error).message}`, { error: true });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Restoring…" : "Replace all data"}
      </button>
    </div>
  );
}

async function doLegacyImport() {
  const files = await pickFile(".csv,.json,text/csv,application/json", true);
  if (!files.length) return;
  const plan = await analyzeLegacyFiles(files);
  openSheet((close) => <LegacyConfirm plan={plan} close={close} />, { title: "Import from Covison CRM", full: true });
}

function LegacyConfirm({ plan, close }: { plan: LegacyPlan; close: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div class="form">
      <p class="t-subhead c2" style="padding:0 4px">
        Records are <strong>merged</strong> into what's already here. Contacts with the same email and companies with the same name are updated, not duplicated. Email, ticket and team data is skipped.
      </p>
      {plan.files.length > 0 && (
        <Group label="Ready to import">
          {plan.summary.map((s) => (
            <Row key={s.label} title={<span class="t-subhead">{s.label}</span>} value={`${s.count} rows`} chevron={false} />
          ))}
        </Group>
      )}
      {plan.skipped.length > 0 && (
        <Group label="Skipped">
          {plan.skipped.map((s) => (
            <Row key={s} title={<span class="t-subhead c2">{s}</span>} chevron={false} />
          ))}
        </Group>
      )}
      <button
        class="btn primary block press"
        disabled={busy || plan.files.length === 0}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await applyLegacyPlan(plan);
            close();
            toast(`Imported: ${r.created} new, ${r.updated} updated${r.skippedRows ? `, ${r.skippedRows} skipped` : ""}`, { ms: 5000 });
          } catch (e) {
            toast(`Import failed: ${(e as Error).message}`, { error: true });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Importing…" : "Import"}
      </button>
      <Group label="What can I import?">
        <Row title={<span class="t-subhead">CSV exports from the web CRM: Contacts, Companies, Deals, Tasks</span>} chevron={false} />
        <Row title={<span class="t-subhead">Supabase table exports (CSV or JSON) named after the table, e.g. contacts.csv, pipeline_stages.csv, activities.json</span>} chevron={false} />
      </Group>
    </div>
  );
}

function CountryCodeSheet({ close }: { close: () => void }) {
  const [v, setV] = useState(getCountryCode());
  return (
    <div class="form">
      <Group footer="Used to turn local numbers like 0300 1234567 into WhatsApp format (92 300 1234567). Numbers saved with + already keep their own code.">
        <TextField label="Code" value={v} onInput={setV} inputMode="numeric" maxLength={4} />
      </Group>
      <button
        class="btn primary block press"
        onClick={() => {
          setCountryCode(v);
          close();
          toast("Saved");
        }}
      >
        Save
      </button>
    </div>
  );
}

function NameSheet({ initial, close }: { initial: string; close: () => void }) {
  const [v, setV] = useState(initial);
  return (
    <div class="form">
      <Group footer="Used for the greeting on Home. Stored only on this iPhone.">
        <TextField label="Name" value={v} onInput={setV} autoFocus maxLength={80} />
      </Group>
      <button
        class="btn primary block press"
        onClick={async () => {
          await setMeta("displayName", optText(v, 80) ?? "");
          close();
        }}
      >
        Save
      </button>
    </div>
  );
}

export function SettingsScreen() {
  const status = useBackupStatus();
  const name = useLive(() => getMeta<string>("displayName", ""), []);
  const persisted = useLive(() => getMeta<boolean | null>("persistGranted", null), []);
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  const [usage, setUsage] = useState<string>("");
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => {
      if (e.usage !== undefined) setUsage(`${(e.usage / 1024 / 1024).toFixed(1)} MB used`);
    });
    const sw = navigator.serviceWorker;
    if (sw?.controller) {
      const onMsg = (e: MessageEvent) => e.data?.type === "VERSION" && setVersion(String(e.data.version));
      sw.addEventListener("message", onMsg);
      sw.controller.postMessage("GET_VERSION");
      return () => sw.removeEventListener("message", onMsg);
    }
  }, []);

  return (
    <Screen title="Settings" backLabel="More" backTo="/more">
      <div class="content col gap16" style="gap:26px">
        <Group>
          <Row
            onClick={() => openSheet((close) => <NameSheet initial={name ?? ""} close={close} />, { title: "Your name" })}
            lead={<span class="tile violet"><Icon name="user" size={16} /></span>}
            title="Your name"
            value={name || "Not set"}
          />
        </Group>

        <Group label="Money & WhatsApp">
          <Row lead={<span class="tile green"><Icon name="wallet" size={16} /></span>} title="Currency" value="PKR (Rs)" chevron={false} />
          <Row
            onClick={() => openSheet((close) => <CountryCodeSheet close={close} />, { title: "WhatsApp country code" })}
            lead={<span class="tile green"><Icon name="whatsapp" size={16} /></span>}
            title="WhatsApp country code"
            value={`+${getCountryCode()}`}
          />
        </Group>

        <div>
          <div class="group-label">Appearance</div>
          <Segmented<ThemePref>
            value={theme}
            onChange={(t) => {
              setTheme(t);
              setThemePref(t);
            }}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </div>

        <div class="col" style="gap:10px">
          <BackupReminder />
          <Group
            label="Backup"
            footer={
              <>
                {status?.last ? `Last backed up ${shortDate(status.last)} (${relativeTime(status.last)}).` : "Never backed up."} Save the file to Files or iCloud Drive. Restoring replaces all data.
              </>
            }
          >
            <Row onClick={doExport} lead={<span class="tile green"><Icon name="share" size={16} /></span>} title="Export backup" sub="All data as one JSON file" />
            <Row onClick={doRestore} lead={<span class="tile blue"><Icon name="download" size={16} /></span>} title="Restore from backup" sub="Validates, then asks before replacing" />
          </Group>
        </div>

        <Group label="Bring data over" footer="Field mapping is documented in ANALYSIS.md, section 6.">
          <Row onClick={doLegacyImport} lead={<span class="tile indigo"><Icon name="upload" size={16} /></span>} title="Import from existing CRM" sub="Web CRM CSV exports or Supabase tables" />
          <Row
            onClick={() =>
              actionSheet(
                (["contacts", "companies", "deals", "tasks"] as CsvEntity[]).map((e) => ({ label: `${e[0].toUpperCase()}${e.slice(1)}`, icon: "file" as const, run: () => void exportCsv(e) })),
                "Export as CSV",
              )
            }
            lead={<span class="tile orange"><Icon name="file" size={16} /></span>}
            title="Export CSV"
            sub="For spreadsheets"
          />
          <Row
            onClick={async () => {
              if (!(await confirmSheet({ title: "Add sample data?", message: "Adds a few demo contacts, deals, tasks and a project so you can try things out. You can delete them later.", confirm: "Add sample data" }))) return;
              await loadSampleData();
              toast("Sample data added", { icon: "sparkles" });
            }}
            lead={<span class="tile pink"><Icon name="sparkles" size={16} /></span>}
            title="Add sample data"
          />
        </Group>

        <Group label="Privacy & storage" footer="Covison Pocket has no server, no account, no analytics and asks for no permissions. Data never leaves this device unless you export it.">
          <Row
            onClick={async () => {
              const ok = await requestPersistence();
              toast(ok ? "Storage is persistent" : "iOS decides this automatically for Home Screen apps", { icon: ok ? "shield" : "info" });
            }}
            lead={<span class="tile green"><Icon name="database" size={16} /></span>}
            title="Persistent storage"
            value={persisted === true ? "On" : persisted === false ? "Not granted" : "Unknown"}
          />
          <Row lead={<span class="tile gray"><Icon name="info" size={16} /></span>} title="Storage" value={usage || "—"} chevron={false} />
          <Row lead={<span class="tile gray"><Icon name="wifiOff" size={16} /></span>} title="Works offline" value={isStandalone() ? "Installed" : "In browser"} chevron={false} />
        </Group>

        <Group footer={version ? `App version ${version}` : undefined}>
          <Row
            danger
            onClick={async () => {
              if (!(await confirmSheet({ title: "Erase all data?", message: "Every contact, deal, task and note on this iPhone will be deleted. Export a backup first. This can't be undone.", confirm: "Erase everything", destructive: true }))) return;
              await eraseAll();
              await ensureSeeded();
              toast("All data erased");
            }}
            lead={<span class="tile red"><Icon name="trash" size={16} /></span>}
            title="Erase all data"
            chevron={false}
          />
        </Group>
      </div>
    </Screen>
  );
}
