// "Import from existing CRM". Accepts:
//  A) the web CRM's own CSV exports (Contacts, Companies, Deals, Tasks),
//     detected from their header row; and
//  B) raw Supabase table exports (CSV or JSON), detected from the file name
//     (contacts.csv, pipeline_stages.json, ...).
// Everything MERGES into the existing data. The field mapping is documented
// in ANALYSIS.md section 6.
import { csvToObjects } from "./csv";
import {
  DEFAULT_CURRENCY,
  db,
  type Activity,
  type Company,
  type Contact,
  type ContactPriority,
  type ContactStatus,
  type Deal,
  type LeadField,
  type Task,
} from "./schema";
import { defaultPipelineId, findCompanyByName, findOrCreateTag, now, uid } from "./repo";
import { MAX_LONG, cleanText, optText } from "../lib/sanitize";
import { CONTACT_PRIORITIES, CONTACT_STATUSES, LEAD_FIELD_TYPES } from "../lib/options";
import { ensureSeeded } from "./seed";

export type LegacyKind =
  | "web-contacts-csv"
  | "web-companies-csv"
  | "web-deals-csv"
  | "web-tasks-csv"
  | "web-tickets-csv"
  | `table:${string}`
  | "unknown";

export interface LegacyFile {
  name: string;
  kind: LegacyKind;
  rows: Record<string, unknown>[];
}

export interface LegacyPlan {
  files: LegacyFile[];
  summary: { label: string; count: number }[];
  skipped: string[];
}

const SUPPORTED_TABLES = [
  "pipelines",
  "pipeline_stages",
  "companies",
  "lead_types",
  "contacts",
  "tags",
  "contact_tags",
  "projects",
  "project_columns",
  "project_todos",
  "deals",
  "tasks",
  "activities",
];
const DROPPED_TABLES = [
  "tickets",
  "email_groups",
  "email_group_contacts",
  "email_templates",
  "follow_up_sequences",
  "follow_up_sequence_steps",
  "follow_up_enrollments",
  "organizations",
  "organization_members",
  "organization_invitations",
  "profiles",
  "notifications",
  "saved_views",
  "audit_logs",
];

const norm = (h: string) => h.trim().toLowerCase();

function detectCsvKind(headers: string[]): LegacyKind {
  const h = new Set(headers.map(norm));
  if (h.has("job title") && h.has("name") && h.has("email")) return "web-contacts-csv";
  if (h.has("stage") && h.has("value") && h.has("name")) return "web-deals-csv";
  if (h.has("title") && h.has("due date")) return "web-tasks-csv";
  if (h.has("title") && h.has("category")) return "web-tickets-csv";
  if (h.has("name") && h.has("domain") && h.has("industry")) return "web-companies-csv";
  return "unknown";
}

function tableFromFileName(name: string): string | undefined {
  const base = name.toLowerCase().replace(/\.(csv|json)$/, "");
  // Longest match first so "contact_tags" wins over "contacts".
  const all = [...SUPPORTED_TABLES, ...DROPPED_TABLES].sort((a, b) => b.length - a.length);
  return all.find((t) => base === t || base.startsWith(`${t}_`) || base.startsWith(`${t}-`) || base.startsWith(`${t} `) || base.startsWith(`${t}(`));
}

/** Parse the picked files and work out what each one is. Nothing is written. */
export async function analyzeLegacyFiles(files: File[]): Promise<LegacyPlan> {
  const out: LegacyFile[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const text = await f.text();
    let rows: Record<string, unknown>[] = [];
    let kind: LegacyKind = "unknown";
    const table = tableFromFileName(f.name);
    if (/\.json$/i.test(f.name)) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && parsed.app === "covison-pocket") {
          skipped.push(`${f.name}: this is a Covison Pocket backup. Use "Restore from backup" instead.`);
          continue;
        }
        rows = Array.isArray(parsed) ? parsed : [];
      } catch {
        skipped.push(`${f.name}: not valid JSON.`);
        continue;
      }
      kind = table ? `table:${table}` : "unknown";
    } else {
      const parsed = csvToObjects(text);
      rows = parsed.rows;
      // The web CRM names its own exports "contacts-YYYY-MM-DD.csv", so the
      // header row decides: a raw Supabase table export always has an "id"
      // column, the web CRM's friendly exports never do.
      const hasId = parsed.headers.some((h) => h.trim().toLowerCase() === "id");
      const webKind = detectCsvKind(parsed.headers);
      kind = table && hasId ? `table:${table}` : webKind !== "unknown" ? webKind : table ? `table:${table}` : "unknown";
    }
    if (kind === "web-tickets-csv" || (kind.startsWith("table:") && DROPPED_TABLES.includes(kind.slice(6)))) {
      skipped.push(`${f.name}: ${kind === "web-tickets-csv" ? "tickets" : kind.slice(6)} is a dropped feature, skipped.`);
      continue;
    }
    if (kind === "unknown") {
      skipped.push(`${f.name}: not recognised. Name Supabase exports after their table (e.g. contacts.csv).`);
      continue;
    }
    if (rows.length > 20000) rows = rows.slice(0, 20000);
    out.push({ name: f.name, kind, rows });
  }
  const label = (k: LegacyKind) =>
    k.startsWith("table:") ? `${k.slice(6)} (Supabase table)` : k.replace("web-", "").replace("-csv", " (CRM CSV export)");
  return { files: out, summary: out.map((f) => ({ label: `${f.name} → ${label(f.kind)}`, count: f.rows.length })), skipped };
}

// ---------------- helpers ----------------

const str = (v: unknown, max?: number) => optText(v, max);
function numOr(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}
function bool(v: unknown): boolean {
  return v === true || v === "true" || v === "t" || v === "1" || v === 1;
}
function isoOr(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
function dateOnly(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function json<T>(v: unknown, fallback: T): T {
  if (v && typeof v === "object") return v as T;
  if (typeof v === "string" && v.trim()) {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}
function statusOf(v: unknown): ContactStatus {
  const s = String(v ?? "").trim().toLowerCase();
  return (CONTACT_STATUSES as string[]).includes(s) ? (s as ContactStatus) : "new";
}
function priorityOf(v: unknown): ContactPriority | undefined {
  const s = String(v ?? "").trim();
  const hit = CONTACT_PRIORITIES.find((p) => p.toLowerCase() === s.toLowerCase().replace(/\s+/g, ""));
  return hit;
}
function get(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const hit = Object.keys(row).find((h) => norm(h) === k);
    if (hit !== undefined && row[hit] !== "" && row[hit] !== null) return row[hit];
  }
  return undefined;
}

/** Parse lead-type fields defensively (port of web/src/lib/lead-types.ts parser). */
export function parseLeadFields(value: unknown): LeadField[] {
  const arr = json<unknown[]>(value, []);
  if (!Array.isArray(arr)) return [];
  return arr.flatMap((entry): LeadField[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const r = entry as Record<string, unknown>;
    const key = typeof r.key === "string" ? cleanText(r.key, 80) : "";
    const label = typeof r.label === "string" ? cleanText(r.label, 120) : "";
    if (!key || !label) return [];
    const type = (LEAD_FIELD_TYPES as string[]).includes(r.type as string) ? (r.type as LeadField["type"]) : "text";
    const options = Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === "string").map((o) => cleanText(o, 120)) : undefined;
    return [{ key, label, type, ...(type === "select" && options ? { options } : {}), ...(r.required === true ? { required: true } : {}) }];
  });
}

function cleanCustomFields(v: unknown): Record<string, string | number | boolean> {
  const obj = json<Record<string, unknown>>(v, {});
  const out: Record<string, string | number | boolean> = {};
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const [k, val] of Object.entries(obj)) {
    if (typeof val === "number" || typeof val === "boolean") out[cleanText(k, 80)] = val;
    else if (val !== null && val !== undefined) out[cleanText(k, 80)] = cleanText(val, 2000);
  }
  return out;
}

// ---------------- apply ----------------

export interface LegacyResult {
  created: number;
  updated: number;
  skippedRows: number;
  notes: string[];
}

/** Apply the analysed files, merging. Supabase tables go first, in dependency order. */
export async function applyLegacyPlan(plan: LegacyPlan): Promise<LegacyResult> {
  await ensureSeeded();
  const res: LegacyResult = { created: 0, updated: 0, skippedRows: 0, notes: [] };
  const t = now();
  const order = [...SUPPORTED_TABLES];
  const tableFiles = plan.files
    .filter((f) => f.kind.startsWith("table:"))
    .sort((a, b) => order.indexOf(a.kind.slice(6)) - order.indexOf(b.kind.slice(6)));
  const csvFiles = plan.files.filter((f) => !f.kind.startsWith("table:"));
  const csvOrder: LegacyKind[] = ["web-companies-csv", "web-contacts-csv", "web-deals-csv", "web-tasks-csv"];
  csvFiles.sort((a, b) => csvOrder.indexOf(a.kind) - csvOrder.indexOf(b.kind));

  const put = async (table: string, row: { id: string } & Record<string, unknown>) => {
    const tbl = db.table(table);
    const exists = await tbl.get(row.id);
    if (exists) {
      await tbl.put({ ...exists, ...row });
      res.updated++;
    } else {
      await tbl.add(row);
      res.created++;
    }
  };

  // ---------- B) raw Supabase tables ----------
  for (const f of tableFiles) {
    const table = f.kind.slice(6);
    for (const r of f.rows) {
      if (get(r, "deleted_at")) {
        res.skippedRows++;
        continue;
      }
      const id = str(get(r, "id"), 64);
      const created = isoOr(get(r, "created_at")) ?? t;
      const updated = isoOr(get(r, "updated_at")) ?? created;
      try {
        switch (table) {
          case "pipelines": {
            if (!id) throw 0;
            await put("pipelines", { id, name: str(get(r, "name")) ?? "Pipeline", isDefault: bool(get(r, "is_default")) ? 1 : 0, createdAt: created, updatedAt: updated } as never);
            if (bool(get(r, "is_default"))) await db.pipelines.where("isDefault").equals(1).filter((p) => p.id !== id).modify({ isDefault: 0 });
            break;
          }
          case "pipeline_stages": {
            const pipelineId = str(get(r, "pipeline_id"), 64);
            if (!id || !pipelineId) throw 0;
            await put("stages", {
              id,
              pipelineId,
              name: str(get(r, "name")) ?? "Stage",
              position: numOr(get(r, "position")) ?? 0,
              probability: numOr(get(r, "probability")),
              color: str(get(r, "color"), 40),
              isWon: bool(get(r, "is_won")),
              isLost: bool(get(r, "is_lost")),
              createdAt: created,
              updatedAt: updated,
            } as never);
            break;
          }
          case "companies": {
            const name = str(get(r, "name"));
            if (!id || !name) throw 0;
            const address = get(r, "address");
            await put("companies", {
              id,
              name,
              domain: str(get(r, "domain")),
              website: str(get(r, "website")),
              phone: str(get(r, "phone")),
              industry: str(get(r, "industry")),
              size: numOr(get(r, "size")),
              address: address && typeof address === "object" ? Object.values(address).filter(Boolean).join(", ") : str(address),
              createdAt: created,
              updatedAt: updated,
            } satisfies Company);
            break;
          }
          case "lead_types": {
            const name = str(get(r, "name"));
            if (!id || !name) throw 0;
            await put("leadTypes", { id, name, description: str(get(r, "description"), 2000), position: numOr(get(r, "position")) ?? 0, fields: parseLeadFields(get(r, "fields")), createdAt: created, updatedAt: updated } as never);
            break;
          }
          case "contacts": {
            const name = str(get(r, "name"));
            if (!id || !name) throw 0;
            await put("contacts", {
              id,
              name,
              email: str(get(r, "email")),
              phone: str(get(r, "phone")),
              jobTitle: str(get(r, "job_title")),
              status: statusOf(get(r, "status")),
              priority: priorityOf(get(r, "priority")),
              companyId: str(get(r, "company_id"), 64),
              expectedRevenue: numOr(get(r, "expected_revenue")),
              expectedClose: dateOnly(get(r, "expected_close")),
              probability: str(get(r, "probability"), 20),
              linkedinUrl: str(get(r, "linkedin_url")),
              website: str(get(r, "website")),
              country: str(get(r, "country")),
              city: str(get(r, "city")),
              niche: str(get(r, "niche")),
              leadTypeId: str(get(r, "lead_type_id"), 64),
              customFields: cleanCustomFields(get(r, "custom_fields")),
              lastActivityAt: isoOr(get(r, "last_activity_at")),
              createdAt: created,
              updatedAt: updated,
            } satisfies Contact);
            break;
          }
          case "tags": {
            const name = str(get(r, "name"));
            if (!id || !name) throw 0;
            const color = str(get(r, "color"), 20) ?? "neutral";
            await put("tags", { id, name, color: ["neutral", "brand", "success", "warning", "danger", "info"].includes(color) ? color : "neutral", createdAt: created } as never);
            break;
          }
          case "contact_tags": {
            const contactId = str(get(r, "contact_id"), 64);
            const tagId = str(get(r, "tag_id"), 64);
            if (!contactId || !tagId) throw 0;
            await db.contactTags.put({ contactId, tagId });
            res.created++;
            break;
          }
          case "projects": {
            const name = str(get(r, "name"));
            if (!id || !name) throw 0;
            await put("projects", { id, name, createdAt: created, updatedAt: updated } as never);
            break;
          }
          case "project_columns": {
            const projectId = str(get(r, "project_id"), 64);
            if (!id || !projectId) throw 0;
            await put("projectColumns", { id, projectId, name: str(get(r, "name")) ?? "Column", position: numOr(get(r, "position")) ?? 0, createdAt: created, updatedAt: updated } as never);
            break;
          }
          case "project_todos": {
            const projectId = str(get(r, "project_id"), 64);
            const columnId = str(get(r, "column_id"), 64);
            const title = str(get(r, "title"));
            if (!id || !projectId || !columnId || !title) throw 0;
            await put("projectTodos", { id, projectId, columnId, title, description: str(get(r, "description"), MAX_LONG), position: numOr(get(r, "position")) ?? 0, createdAt: created, updatedAt: updated } as never);
            break;
          }
          case "deals": {
            const name = str(get(r, "name"));
            const stageId = str(get(r, "stage_id"), 64);
            if (!id || !name || !stageId) throw 0;
            await put("deals", {
              id,
              name,
              stageId,
              pipelineId: str(get(r, "pipeline_id"), 64) ?? (await defaultPipelineId())!,
              value: numOr(get(r, "value")) ?? 0,
              currency: str(get(r, "currency"), 8) ?? DEFAULT_CURRENCY,
              contactId: str(get(r, "contact_id"), 64),
              companyId: str(get(r, "company_id"), 64),
              expectedCloseDate: dateOnly(get(r, "expected_close_date")),
              description: str(get(r, "description"), MAX_LONG),
              createdAt: created,
              updatedAt: updated,
            } satisfies Deal);
            break;
          }
          case "tasks": {
            const title = str(get(r, "title"));
            if (!id || !title) throw 0;
            const completedAt = isoOr(get(r, "completed_at"));
            const status = String(get(r, "status") ?? "").toLowerCase();
            const pr = String(get(r, "priority") ?? "").toLowerCase();
            await put("tasks", {
              id,
              title,
              description: str(get(r, "description"), MAX_LONG),
              priority: pr === "low" || pr === "medium" || pr === "high" ? pr : undefined,
              status: completedAt || status === "completed" || status === "done" ? "done" : "open",
              dueAt: isoOr(get(r, "due_at")),
              completedAt,
              contactId: str(get(r, "contact_id"), 64),
              companyId: str(get(r, "company_id"), 64),
              dealId: str(get(r, "deal_id"), 64),
              projectId: str(get(r, "project_id"), 64),
              createdAt: created,
              updatedAt: updated,
            } satisfies Task);
            break;
          }
          case "activities": {
            if (!id) throw 0;
            const raw = String(get(r, "type") ?? "note");
            if (get(r, "ticket_id") && !get(r, "contact_id") && !get(r, "company_id") && !get(r, "deal_id") && !get(r, "project_id")) {
              res.skippedRows++; // belonged to a ticket (dropped)
              break;
            }
            const type = raw === "call" || raw === "meeting" || raw === "field_change" ? raw : "note";
            let body = str(get(r, "body"), MAX_LONG);
            if (raw === "email") body = `[Email] ${body ?? ""}`.trim();
            const meta = json<Record<string, unknown>>(get(r, "metadata"), {});
            await put("activities", {
              id,
              type,
              body,
              metadata: meta && typeof meta === "object" && !Array.isArray(meta) && Object.keys(meta).length ? JSON.parse(JSON.stringify(meta)) : undefined,
              contactId: str(get(r, "contact_id"), 64),
              companyId: str(get(r, "company_id"), 64),
              dealId: str(get(r, "deal_id"), 64),
              projectId: str(get(r, "project_id"), 64),
              occurredAt: isoOr(get(r, "occurred_at")) ?? created,
              createdAt: created,
            } satisfies Activity);
            break;
          }
        }
      } catch {
        res.skippedRows++;
      }
    }
  }

  // ---------- A) web CRM CSV exports ----------
  const companyIdFor = async (name: string | undefined): Promise<string | undefined> => {
    if (!name) return undefined;
    const hit = await findCompanyByName(name);
    if (hit) return hit.id;
    const id = uid();
    await db.companies.add({ id, name, createdAt: t, updatedAt: t });
    res.created++;
    return id;
  };
  const contactIdFor = async (name: string | undefined) => {
    if (!name) return undefined;
    const n = name.toLowerCase();
    return (await db.contacts.filter((c) => c.name.toLowerCase() === n).first())?.id;
  };

  for (const f of csvFiles) {
    for (const r of f.rows) {
      try {
        if (f.kind === "web-companies-csv") {
          const name = str(get(r, "name"));
          if (!name) throw 0;
          const hit = await findCompanyByName(name);
          const patch = { domain: str(get(r, "domain")), phone: str(get(r, "phone")), industry: str(get(r, "industry")) };
          if (hit) {
            await db.companies.update(hit.id, { ...dropEmpty(patch), updatedAt: t });
            res.updated++;
          } else {
            await db.companies.add({ id: uid(), name, ...dropEmpty(patch), createdAt: t, updatedAt: t });
            res.created++;
          }
        } else if (f.kind === "web-contacts-csv") {
          const name = str(get(r, "name"));
          if (!name) throw 0;
          const email = str(get(r, "email"));
          const patch = dropEmpty({
            email,
            phone: str(get(r, "phone")),
            jobTitle: str(get(r, "job title", "job_title")),
            status: statusOf(get(r, "status")),
            priority: priorityOf(get(r, "priority")),
            companyId: await companyIdFor(str(get(r, "company"))),
          });
          const existing = email
            ? await db.contacts.filter((c) => (c.email ?? "").toLowerCase() === email.toLowerCase()).first()
            : undefined;
          let contactId: string;
          if (existing) {
            contactId = existing.id;
            await db.contacts.update(contactId, { ...patch, name, updatedAt: t });
            res.updated++;
          } else {
            contactId = uid();
            await db.contacts.add({ id: contactId, name, status: "new", customFields: {}, ...patch, createdAt: t, updatedAt: t } as Contact);
            res.created++;
          }
          const tags = String(get(r, "tags") ?? "")
            .split(";")
            .map((s) => cleanText(s, 60).trim())
            .filter(Boolean);
          for (const tag of tags) await db.contactTags.put({ contactId, tagId: await findOrCreateTag(tag) });
        } else if (f.kind === "web-deals-csv") {
          const name = str(get(r, "name"));
          if (!name) throw 0;
          const pipelineId = (await defaultPipelineId())!;
          const stageName = str(get(r, "stage")) ?? "Lead";
          let stage = await db.stages.where("pipelineId").equals(pipelineId).filter((s) => s.name.toLowerCase() === stageName.toLowerCase()).first();
          if (!stage) {
            const position = await db.stages.where("pipelineId").equals(pipelineId).count();
            stage = { id: uid(), pipelineId, name: stageName, position, isWon: false, isLost: false, createdAt: t, updatedAt: t };
            await db.stages.add(stage);
            res.notes.push(`Created stage "${stageName}".`);
          }
          await db.deals.add({
            id: uid(),
            pipelineId,
            stageId: stage.id,
            name,
            value: numOr(get(r, "value")) ?? 0,
            currency: str(get(r, "currency"), 8) ?? DEFAULT_CURRENCY,
            contactId: await contactIdFor(str(get(r, "contact"))),
            companyId: await companyIdFor(str(get(r, "company"))),
            createdAt: t,
            updatedAt: t,
          });
          res.created++;
        } else if (f.kind === "web-tasks-csv") {
          const title = str(get(r, "title"));
          if (!title) throw 0;
          const status = String(get(r, "status") ?? "").toLowerCase();
          const done = status === "completed" || status === "done";
          const pr = String(get(r, "priority") ?? "").toLowerCase();
          await db.tasks.add({
            id: uid(),
            title,
            status: done ? "done" : "open",
            completedAt: done ? t : undefined,
            priority: pr === "low" || pr === "medium" || pr === "high" ? pr : undefined,
            dueAt: isoOr(get(r, "due date")),
            contactId: await contactIdFor(str(get(r, "contact"))),
            createdAt: t,
            updatedAt: t,
          });
          res.created++;
        }
      } catch {
        res.skippedRows++;
      }
    }
  }
  return res;
}

function dropEmpty<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>;
}
