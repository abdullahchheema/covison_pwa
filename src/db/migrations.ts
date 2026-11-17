// One-time data fixes that run at start-up (and after restoring a backup).
// Each one is safe to run again: it only acts when there is something to fix.
import { db, type Contact } from "./schema";
import { defaultPipelineId, findOrCreateTag, getMeta, now, setMeta, uid } from "./repo";
import { phoneKey } from "../lib/phoneContacts";

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Pipeline is Lead → Negotiation → Won. Older installs were seeded with
 * Lead, Qualified, Proposal, Negotiation, Won, Lost. Deals keep their place:
 * Qualified → Lead, Proposal → Negotiation; Lost is removed only if empty.
 * Stages with any other (custom) name are left alone.
 */
export async function simplifyPipeline(): Promise<boolean> {
  if (await getMeta("migr.pipeline3", false)) return false;
  const pid = await defaultPipelineId();
  if (!pid) return false;
  let changed = false;
  await db.transaction("rw", [db.stages, db.deals, db.meta], async () => {
    const stages = await db.stages.where("pipelineId").equals(pid).sortBy("position");
    const find = (n: string) => stages.find((s) => norm(s.name) === n);
    const t = now();
    let lead = find("lead");
    let nego = find("negotiation");
    const qualified = find("qualified");
    const proposal = find("proposal");
    const lost = find("lost");
    if (!qualified && !proposal && !(lost && lost.isLost)) {
      await setMeta("migr.pipeline3", true);
      return;
    }
    if (!lead) {
      lead = { id: uid(), pipelineId: pid, name: "Lead", position: 0, probability: 20, isWon: false, isLost: false, createdAt: t, updatedAt: t };
      await db.stages.add(lead);
    }
    if (!nego) {
      nego = { id: uid(), pipelineId: pid, name: "Negotiation", position: 1, probability: 60, isWon: false, isLost: false, createdAt: t, updatedAt: t };
      await db.stages.add(nego);
    }
    const move = async (fromId: string, toId: string) => {
      await db.deals.where("stageId").equals(fromId).modify({ stageId: toId, updatedAt: t });
      await db.stages.delete(fromId);
      changed = true;
    };
    if (qualified) await move(qualified.id, lead.id);
    if (proposal) await move(proposal.id, nego.id);
    if (lost && lost.isLost && (await db.deals.where("stageId").equals(lost.id).count()) === 0) {
      await db.stages.delete(lost.id);
      changed = true;
    }
    // Re-number: Lead, Negotiation, (custom open stages), Won, (Lost if kept).
    const rest = (await db.stages.where("pipelineId").equals(pid).sortBy("position")).filter((s) => s.id !== lead!.id && s.id !== nego!.id);
    const order = [lead, nego, ...rest.filter((s) => !s.isWon && !s.isLost), ...rest.filter((s) => s.isWon), ...rest.filter((s) => s.isLost)];
    for (let i = 0; i < order.length; i++) await db.stages.update(order[i]!.id, { position: i, updatedAt: t });
    await setMeta("migr.pipeline3", true);
  });
  return changed;
}

/**
 * Every person you lend to or borrow from is a contact. Links loan / credit
 * entries that only have a typed name to an existing contact (same phone, or
 * same name), or creates one tagged "Personal" for personal loans.
 */
export async function linkLedgerPeople(): Promise<number> {
  const entries = (await db.ledger.toArray()).filter((e) => !e.contactId && e.personName.trim());
  if (!entries.length) return 0;
  const contacts = await db.contacts.toArray();
  let created = 0;
  for (const e of entries) {
    const key = phoneKey(e.phone);
    let c: Contact | undefined =
      (key ? contacts.find((x) => phoneKey(x.phone) === key) : undefined) ?? contacts.find((x) => norm(x.name) === norm(e.personName));
    if (!c) {
      const t = now();
      c = { id: uid(), name: e.personName.trim(), phone: e.phone, status: "new", customFields: {}, createdAt: t, updatedAt: t };
      await db.contacts.add(c);
      contacts.push(c);
      if (e.kind === "loan") await db.contactTags.put({ contactId: c.id, tagId: await findOrCreateTag("Personal") });
      created++;
    }
    await db.ledger.update(e.id, { contactId: c.id, phone: e.phone ?? c.phone });
  }
  return created;
}

export async function runMigrations(): Promise<void> {
  try {
    await simplifyPipeline();
    await linkLedgerPeople();
  } catch (e) {
    console.error("Migration failed", e);
  }
}

/** After a restore, older data may need the same fixes again. */
export async function resetMigrationFlags(): Promise<void> {
  await setMeta("migr.pipeline3", false);
}
