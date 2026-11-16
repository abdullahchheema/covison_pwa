// Per-list CSV exports. Same columns as the web CRM's exports (so the files
// can go back into the web app or be re-imported here), but over ALL rows,
// with a BOM and formula-injection protection.
import { db } from "./schema";
import { toCsv } from "./csv";
import { shareOrDownload } from "./backup";
import { STATUS_LABELS } from "../lib/options";

export type CsvEntity = "contacts" | "companies" | "deals" | "tasks";

async function nameMaps() {
  const [companies, contacts, stages, tags, links] = await Promise.all([
    db.companies.toArray(),
    db.contacts.toArray(),
    db.stages.toArray(),
    db.tags.toArray(),
    db.contactTags.toArray(),
  ]);
  const company = new Map(companies.map((c) => [c.id, c.name]));
  const contact = new Map(contacts.map((c) => [c.id, c.name]));
  const stage = new Map(stages.map((s) => [s.id, s.name]));
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const tagsOf = new Map<string, string[]>();
  for (const l of links) {
    const n = tagName.get(l.tagId);
    if (n) tagsOf.set(l.contactId, [...(tagsOf.get(l.contactId) ?? []), n]);
  }
  return { company, contact, stage, tagsOf, contacts, companies };
}

export async function buildCsv(entity: CsvEntity): Promise<string> {
  const m = await nameMaps();
  switch (entity) {
    case "contacts":
      return toCsv(
        ["Name", "Email", "Phone", "Job title", "Status", "Priority", "Tags", "Company", "Expected revenue", "Expected close", "City", "Country"],
        m.contacts.map((c) => [
          c.name,
          c.email,
          c.phone,
          c.jobTitle,
          STATUS_LABELS[c.status] ?? c.status,
          c.priority,
          (m.tagsOf.get(c.id) ?? []).join("; "),
          c.companyId ? m.company.get(c.companyId) : "",
          c.expectedRevenue,
          c.expectedClose,
          c.city,
          c.country,
        ]),
      );
    case "companies":
      return toCsv(
        ["Name", "Domain", "Website", "Phone", "Industry"],
        m.companies.map((c) => [c.name, c.domain, c.website, c.phone, c.industry]),
      );
    case "deals": {
      const deals = await db.deals.toArray();
      return toCsv(
        ["Name", "Stage", "Value", "Currency", "Contact", "Company", "Expected close"],
        deals.map((d) => [
          d.name,
          m.stage.get(d.stageId),
          d.value,
          d.currency,
          d.contactId ? m.contact.get(d.contactId) : "",
          d.companyId ? m.company.get(d.companyId) : "",
          d.expectedCloseDate,
        ]),
      );
    }
    case "tasks": {
      const tasks = await db.tasks.toArray();
      return toCsv(
        ["Title", "Status", "Priority", "Due date", "Contact"],
        tasks.map((t) => [
          t.title,
          t.status === "done" ? "Completed" : "Open",
          t.priority,
          t.dueAt ? t.dueAt.slice(0, 10) : "",
          t.contactId ? m.contact.get(t.contactId) : "",
        ]),
      );
    }
  }
}

export async function exportCsv(entity: CsvEntity) {
  const csv = await buildCsv(entity);
  const d = new Date().toISOString().slice(0, 10);
  return shareOrDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${entity}-${d}.csv`);
}
