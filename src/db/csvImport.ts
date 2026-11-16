// CSV import with column mapping for contacts and companies, ported from
// web/src/components/contacts/contacts-import-dialog.tsx (same targets,
// header guessing, validation rules and 1000-row cap). Adds de-duplication
// by email / company name, which the web importer lacked.
import { db, type Contact } from "./schema";
import { findCompanyByName, now, uid } from "./repo";
import { isEmail, optText } from "../lib/sanitize";
import { CONTACT_PRIORITIES, CONTACT_STATUSES } from "../lib/options";

export const MAX_ROWS = 1000;

export type Entity = "contacts" | "companies";

export const TARGETS: Record<Entity, { key: string; label: string; required?: boolean; guesses: string[] }[]> = {
  contacts: [
    { key: "name", label: "Name", required: true, guesses: ["name", "full name", "fullname", "contact", "contact name"] },
    { key: "email", label: "Email", guesses: ["email", "e-mail", "email address", "mail"] },
    { key: "phone", label: "Phone", guesses: ["phone", "phone number", "mobile", "tel", "telephone", "cell"] },
    { key: "jobTitle", label: "Job title", guesses: ["job title", "job_title", "title", "position", "role"] },
    { key: "company", label: "Company", guesses: ["company", "company name", "organization", "organisation", "account"] },
    { key: "status", label: "Status", guesses: ["status", "stage", "lead status"] },
    { key: "priority", label: "Priority", guesses: ["priority"] },
  ],
  companies: [
    { key: "name", label: "Name", required: true, guesses: ["name", "company", "company name", "organization"] },
    { key: "domain", label: "Domain", guesses: ["domain"] },
    { key: "website", label: "Website", guesses: ["website", "url", "site", "web"] },
    { key: "phone", label: "Phone", guesses: ["phone", "phone number", "tel"] },
    { key: "industry", label: "Industry", guesses: ["industry", "sector", "vertical"] },
  ],
};

export function guessMapping(entity: Entity, headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const used = new Set<string>();
  for (const t of TARGETS[entity]) {
    const hit = headers.find((h) => !used.has(h) && t.guesses.includes(h.trim().toLowerCase()));
    if (hit) {
      map[t.key] = hit;
      used.add(hit);
    }
  }
  return map;
}

export interface PreparedRow {
  values: Record<string, string>;
  error?: string;
}

export function prepareRows(entity: Entity, rows: Record<string, string>[], mapping: Record<string, string>): PreparedRow[] {
  return rows.slice(0, MAX_ROWS).map((row) => {
    const values: Record<string, string> = {};
    for (const t of TARGETS[entity]) {
      const header = mapping[t.key];
      const v = header ? optText(row[header]) : undefined;
      if (v) values[t.key] = v;
    }
    let error: string | undefined;
    if (!values.name) error = "Missing name";
    else if (entity === "contacts") {
      if (values.email && !isEmail(values.email)) error = "Invalid email";
      if (values.status) {
        const s = values.status.toLowerCase();
        if (!(CONTACT_STATUSES as string[]).includes(s)) error = `Unknown status "${values.status}"`;
        else values.status = s;
      }
      if (values.priority) {
        const p = CONTACT_PRIORITIES.find((x) => x.toLowerCase() === values.priority.toLowerCase().replace(/\s+/g, ""));
        if (!p) error = `Unknown priority "${values.priority}"`;
        else values.priority = p;
      }
    }
    return { values, error };
  });
}

export async function importPrepared(entity: Entity, rows: PreparedRow[]): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const t = now();
  await db.transaction("rw", [db.contacts, db.companies], async () => {
    for (const { values, error } of rows) {
      if (error) {
        skipped++;
        continue;
      }
      if (entity === "companies") {
        const hit = await findCompanyByName(values.name);
        const patch = { domain: values.domain, website: values.website, phone: values.phone, industry: values.industry };
        if (hit) {
          await db.companies.update(hit.id, { ...clean(patch), updatedAt: t });
          updated++;
        } else {
          await db.companies.add({ id: uid(), name: values.name, ...clean(patch), createdAt: t, updatedAt: t });
          created++;
        }
        continue;
      }
      let companyId: string | undefined;
      if (values.company) {
        const hit = await findCompanyByName(values.company);
        if (hit) companyId = hit.id;
        else {
          companyId = uid();
          await db.companies.add({ id: companyId, name: values.company, createdAt: t, updatedAt: t });
        }
      }
      const patch = clean({
        email: values.email,
        phone: values.phone,
        jobTitle: values.jobTitle,
        status: values.status as Contact["status"] | undefined,
        priority: values.priority as Contact["priority"] | undefined,
        companyId,
      });
      const existing = values.email
        ? await db.contacts.filter((c) => (c.email ?? "").toLowerCase() === values.email.toLowerCase()).first()
        : undefined;
      if (existing) {
        await db.contacts.update(existing.id, { ...patch, name: values.name, updatedAt: t });
        updated++;
      } else {
        await db.contacts.add({ id: uid(), name: values.name, status: "new", customFields: {}, ...patch, createdAt: t, updatedAt: t } as Contact);
        created++;
      }
    }
  });
  return { created, updated, skipped };
}

function clean<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>;
}
