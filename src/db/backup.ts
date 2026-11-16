// Full backup / restore as one JSON file.
import { DATA_TABLES, SCHEMA_VERSION, db, type DataTableName } from "./schema";
import { now, setMeta } from "./repo";

export const BACKUP_APP_ID = "covison-pocket";

export interface BackupFile {
  app: typeof BACKUP_APP_ID;
  schemaVersion: number;
  exportedAt: string;
  counts: Record<DataTableName, number>;
  data: Record<DataTableName, unknown[]>;
}

export async function buildBackup(): Promise<BackupFile> {
  return db.transaction("r", DATA_TABLES.map((t) => db.table(t)), async () => {
    const data = {} as Record<DataTableName, unknown[]>;
    const counts = {} as Record<DataTableName, number>;
    for (const t of DATA_TABLES) {
      data[t] = await db.table(t).toArray();
      counts[t] = data[t].length;
    }
    return { app: BACKUP_APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: now(), counts, data };
  });
}

export function backupFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `covison-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

/** Hand the file to the iOS share sheet when possible, else download it. */
export async function shareOrDownload(blob: Blob, filename: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
      return "shared";
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return "cancelled";
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}

export async function exportBackup(): Promise<{ result: string; counts: Record<string, number> }> {
  const backup = await buildBackup();
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const result = await shareOrDownload(blob, backupFileName());
  if (result !== "cancelled") await setMeta("lastBackupAt", backup.exportedAt);
  return { result, counts: backup.counts };
}

// ---------------- validation ----------------

type Kind = "string" | "number" | "boolean" | "object" | "array";
type FieldSpec = [name: string, kind: Kind, required: boolean];

const S = (n: string, req = false): FieldSpec => [n, "string", req];
const N = (n: string, req = false): FieldSpec => [n, "number", req];
const B = (n: string, req = false): FieldSpec => [n, "boolean", req];

const SPEC: Record<DataTableName, FieldSpec[]> = {
  pipelines: [S("id", true), S("name", true), N("isDefault", true)],
  stages: [S("id", true), S("pipelineId", true), S("name", true), N("position", true), B("isWon", true), B("isLost", true)],
  companies: [S("id", true), S("name", true), S("domain"), S("website"), S("phone"), S("industry"), N("size"), S("address")],
  leadTypes: [S("id", true), S("name", true), N("position", true), ["fields", "array", true]],
  contacts: [
    S("id", true),
    S("name", true),
    S("status", true),
    S("email"),
    S("phone"),
    S("companyId"),
    S("leadTypeId"),
    N("expectedRevenue"),
    ["customFields", "object", true],
  ],
  tags: [S("id", true), S("name", true), S("color", true)],
  contactTags: [S("contactId", true), S("tagId", true)],
  projects: [S("id", true), S("name", true)],
  projectColumns: [S("id", true), S("projectId", true), S("name", true), N("position", true)],
  projectTodos: [S("id", true), S("projectId", true), S("columnId", true), S("title", true), N("position", true)],
  deals: [S("id", true), S("pipelineId", true), S("stageId", true), S("name", true), N("value", true), S("currency", true)],
  tasks: [S("id", true), S("title", true), S("status", true), S("dueAt"), S("contactId"), S("dealId")],
  activities: [S("id", true), S("type", true), S("occurredAt", true), S("body")],
  ledger: [
    S("id", true),
    S("direction", true),
    S("kind", true),
    S("personName", true),
    N("amount", true),
    S("currency", true),
    S("date", true),
    S("contactId"),
    S("dealId"),
    S("settledAt"),
  ],
  payments: [S("id", true), S("entryId", true), N("amount", true), S("date", true)],
};

function kindOf(v: unknown): Kind | "null" | "other" {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  return t === "string" || t === "number" || t === "boolean" || t === "object" ? t : "other";
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  backup?: BackupFile;
}

/** Strict structural validation of a backup file. Nothing is written. */
export function validateBackup(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (kindOf(raw) !== "object") return { ok: false, errors: ["The file is not a backup (not a JSON object)."] };
  const b = raw as Partial<BackupFile>;
  if (b.app !== BACKUP_APP_ID) errors.push("This is not a Covison Pocket backup file.");
  if (typeof b.schemaVersion !== "number" || b.schemaVersion > SCHEMA_VERSION)
    errors.push(`Unsupported backup version (${String(b.schemaVersion)}). Update the app first.`);
  if (kindOf(b.data) !== "object") errors.push("The backup has no data section.");
  if (errors.length) return { ok: false, errors };

  const data = b.data as Record<string, unknown>;
  const ids = {} as Record<DataTableName, Set<string>>;
  for (const table of DATA_TABLES) {
    const rows = data[table] ?? [];
    if (!Array.isArray(rows)) {
      errors.push(`"${table}" should be a list.`);
      continue;
    }
    ids[table] = new Set();
    rows.forEach((row, i) => {
      if (kindOf(row) !== "object") {
        errors.push(`${table}[${i}] is not an object.`);
        return;
      }
      const r = row as Record<string, unknown>;
      for (const [name, kind, required] of SPEC[table]) {
        const v = r[name];
        if (v === undefined) {
          if (required) errors.push(`${table}[${i}] is missing "${name}".`);
          continue;
        }
        if (kindOf(v) !== kind) errors.push(`${table}[${i}].${name} should be a ${kind}.`);
      }
      if (typeof r.id === "string") {
        if (ids[table].has(r.id)) errors.push(`${table} has a duplicate id ${r.id}.`);
        ids[table].add(r.id);
      }
    });
    if (errors.length > 50) break;
  }

  // Referential checks for required links.
  if (!errors.length) {
    const ref = (table: DataTableName, field: string, target: DataTableName, required: boolean) => {
      ((data[table] ?? []) as Record<string, unknown>[]).forEach((r, i) => {
        const v = r[field];
        if (v === undefined || v === null) {
          if (required) errors.push(`${table}[${i}] has no ${field}.`);
        } else if (!ids[target].has(v as string)) errors.push(`${table}[${i}].${field} points to a missing ${target} row.`);
      });
    };
    ref("stages", "pipelineId", "pipelines", true);
    ref("deals", "stageId", "stages", true);
    ref("deals", "contactId", "contacts", false);
    ref("deals", "companyId", "companies", false);
    ref("contacts", "companyId", "companies", false);
    ref("contactTags", "contactId", "contacts", true);
    ref("contactTags", "tagId", "tags", true);
    ref("projectColumns", "projectId", "projects", true);
    ref("projectTodos", "columnId", "projectColumns", true);
    ref("tasks", "contactId", "contacts", false);
    ref("tasks", "dealId", "deals", false);
    ref("activities", "contactId", "contacts", false);
    ref("activities", "dealId", "deals", false);
    ref("ledger", "contactId", "contacts", false);
    ref("ledger", "dealId", "deals", false);
    ref("payments", "entryId", "ledger", true);
    (data.ledger as Record<string, unknown>[] | undefined)?.forEach((r, i) => {
      if (r.direction !== "in" && r.direction !== "out") errors.push(`ledger[${i}].direction must be "in" or "out".`);
      if (r.kind !== "credit" && r.kind !== "loan") errors.push(`ledger[${i}].kind must be "credit" or "loan".`);
    });
  }

  if (errors.length) return { ok: false, errors: errors.slice(0, 50) };
  return { ok: true, errors: [], backup: b as BackupFile };
}

export function countsOf(backup: BackupFile): Record<DataTableName, number> {
  const out = {} as Record<DataTableName, number>;
  for (const t of DATA_TABLES) out[t] = (backup.data[t] ?? []).length;
  return out;
}

/** Replace everything with the backup, atomically. */
export async function restoreBackup(backup: BackupFile): Promise<void> {
  await db.transaction("rw", DATA_TABLES.map((t) => db.table(t)), async () => {
    for (const t of DATA_TABLES) await db.table(t).clear();
    for (const t of DATA_TABLES) {
      const rows = backup.data[t] ?? [];
      if (rows.length) await db.table(t).bulkAdd(rows);
    }
  });
  await setMeta("seeded", true);
}
