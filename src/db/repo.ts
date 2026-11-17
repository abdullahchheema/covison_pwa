// The one data layer. Every write goes through here so timestamps, cascades
// and timeline entries stay consistent (what Postgres triggers and FKs did
// in the web CRM).
import {
  db,
  type Activity,
  type ActivityType,
  type Company,
  type Contact,
  type ContactTag,
  type DataTableName,
  type Deal,
  type LeadType,
  type LedgerEntry,
  type Payment,
  type Project,
  type Transaction,
  type ProjectColumn,
  type ProjectTodo,
  type Stage,
  type Tag,
  type Task,
} from "./schema";

export const uid = (): string => crypto.randomUUID();
export const now = (): string => new Date().toISOString();

/** Rows removed by a delete, so the Undo toast can put them back. */
export type Snapshot = Partial<Record<DataTableName, unknown[]>>;

export async function restoreSnapshot(snap: Snapshot): Promise<void> {
  const names = Object.keys(snap) as DataTableName[];
  await db.transaction("rw", names.map((n) => db.table(n)), async () => {
    for (const n of names) {
      const rows = snap[n];
      if (rows?.length) await db.table(n).bulkPut(rows);
    }
  });
  // An undone payment deletion must re-open / re-settle its ledger entry.
  const entryIds = new Set(((snap.payments ?? []) as Payment[]).map((p) => p.entryId));
  for (const id of entryIds) await syncSettled(id);
}

type Input<T> = Omit<T, "id" | "createdAt" | "updatedAt"> & { id?: string };

// ---------- activities ----------
export async function logActivity(
  a: Omit<Activity, "id" | "createdAt" | "occurredAt"> & { occurredAt?: string },
): Promise<string> {
  const id = uid();
  const t = now();
  await db.activities.add({ ...a, id, occurredAt: a.occurredAt ?? t, createdAt: t });
  if (a.contactId) await db.contacts.update(a.contactId, { lastActivityAt: t });
  return id;
}

export async function addNote(
  parent: Pick<Activity, "contactId" | "companyId" | "dealId" | "projectId">,
  body: string,
  type: ActivityType = "note",
): Promise<string> {
  return logActivity({ ...parent, type, body });
}

export async function deleteActivity(id: string): Promise<Snapshot> {
  const row = await db.activities.get(id);
  await db.activities.delete(id);
  return { activities: row ? [row] : [] };
}

// ---------- companies ----------
export async function saveCompany(input: Input<Company>): Promise<string> {
  const t = now();
  if (input.id) {
    await db.companies.update(input.id, { ...input, updatedAt: t });
    return input.id;
  }
  const id = uid();
  await db.companies.add({ ...input, id, createdAt: t, updatedAt: t } as Company);
  return id;
}

export async function findCompanyByName(name: string): Promise<Company | undefined> {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  return db.companies.filter((c) => c.name.trim().toLowerCase() === n).first();
}

export async function deleteCompany(id: string): Promise<Snapshot> {
  return db.transaction("rw", [db.companies, db.contacts, db.deals, db.tasks, db.activities], async () => {
    const company = await db.companies.get(id);
    const contacts = await db.contacts.where("companyId").equals(id).toArray();
    const deals = await db.deals.where("companyId").equals(id).toArray();
    const tasks = await db.tasks.where("companyId").equals(id).toArray();
    const activities = await db.activities.where("companyId").equals(id).toArray();
    await db.contacts.where("companyId").equals(id).modify((c) => void delete c.companyId);
    await db.deals.where("companyId").equals(id).modify((d) => void delete d.companyId);
    await db.tasks.where("companyId").equals(id).modify((x) => void delete x.companyId);
    await db.activities.where("companyId").equals(id).delete();
    await db.companies.delete(id);
    return { companies: company ? [company] : [], contacts, deals, tasks, activities };
  });
}

// ---------- contacts ----------
const TRACKED_CONTACT_FIELDS = ["status", "priority"] as const;

export async function saveContact(input: Input<Contact>, tagIds?: string[]): Promise<string> {
  const t = now();
  let id = input.id;
  if (id) {
    const before = await db.contacts.get(id);
    await db.contacts.update(id, { ...input, updatedAt: t });
    if (before) {
      for (const f of TRACKED_CONTACT_FIELDS) {
        if (before[f] !== input[f] && input[f] !== undefined) {
          await logActivity({
            type: "field_change",
            contactId: id,
            body: `${String(f)} changed`,
            metadata: { field: f, from: before[f] ?? null, to: input[f] ?? null },
          });
        }
      }
    }
  } else {
    id = uid();
    await db.contacts.add({ ...input, customFields: input.customFields ?? {}, id, createdAt: t, updatedAt: t } as Contact);
  }
  if (tagIds) await setContactTags(id, tagIds);
  return id;
}

export async function setContactTags(contactId: string, tagIds: string[]): Promise<void> {
  await db.transaction("rw", db.contactTags, async () => {
    await db.contactTags.where("contactId").equals(contactId).delete();
    await db.contactTags.bulkPut(tagIds.map((tagId) => ({ contactId, tagId })));
  });
}

export async function deleteContact(id: string): Promise<Snapshot> {
  return db.transaction("rw", [db.contacts, db.contactTags, db.deals, db.tasks, db.activities, db.ledger, db.transactions], async () => {
    const transactions = await db.transactions.where("contactId").equals(id).toArray();
    await db.transactions.where("contactId").equals(id).modify((t) => void delete t.contactId);
    const contact = await db.contacts.get(id);
    const contactTags = await db.contactTags.where("contactId").equals(id).toArray();
    const deals = await db.deals.where("contactId").equals(id).toArray();
    const tasks = await db.tasks.where("contactId").equals(id).toArray();
    const activities = await db.activities.where("contactId").equals(id).toArray();
    const ledger = await db.ledger.where("contactId").equals(id).toArray();
    await db.contactTags.where("contactId").equals(id).delete();
    await db.deals.where("contactId").equals(id).modify((d) => void delete d.contactId);
    await db.tasks.where("contactId").equals(id).modify((x) => void delete x.contactId);
    await db.activities.where("contactId").equals(id).delete();
    // Money owed survives the contact: keep the entry, keep the name/phone, drop the link.
    await db.ledger.where("contactId").equals(id).modify((e) => void delete e.contactId);
    await db.contacts.delete(id);
    return { contacts: contact ? [contact] : [], contactTags, deals, tasks, activities, ledger, transactions };
  });
}

// ---------- pipeline / stages / deals ----------
export async function defaultPipelineId(): Promise<string | undefined> {
  const p = (await db.pipelines.where("isDefault").equals(1).first()) ?? (await db.pipelines.toCollection().first());
  return p?.id;
}

export async function saveStage(input: Input<Stage>): Promise<string> {
  const t = now();
  if (input.id) {
    await db.stages.update(input.id, { ...input, updatedAt: t });
    return input.id;
  }
  const id = uid();
  await db.stages.add({ ...input, id, createdAt: t, updatedAt: t } as Stage);
  return id;
}

/** Blocked while the stage still holds deals (ON DELETE RESTRICT in the web schema). */
export async function deleteStage(id: string): Promise<Snapshot> {
  const count = await db.deals.where("stageId").equals(id).count();
  if (count > 0) throw new Error(`Move the ${count} deal${count === 1 ? "" : "s"} out of this stage first.`);
  const stage = await db.stages.get(id);
  await db.stages.delete(id);
  return { stages: stage ? [stage] : [] };
}

export async function reorderStages(ids: string[]): Promise<void> {
  const t = now();
  await db.transaction("rw", db.stages, async () => {
    for (let i = 0; i < ids.length; i++) await db.stages.update(ids[i], { position: i, updatedAt: t });
  });
}

export async function saveDeal(input: Input<Deal>): Promise<string> {
  const t = now();
  if (input.id) {
    const before = await db.deals.get(input.id);
    await db.deals.update(input.id, { ...input, updatedAt: t });
    if (before && before.stageId !== input.stageId) await logStageChange(input.id, before.stageId, input.stageId);
    if (before && before.value !== input.value) {
      await logActivity({
        type: "field_change",
        dealId: input.id,
        body: "value changed",
        metadata: { field: "value", from: before.value, to: input.value },
      });
    }
    return input.id;
  }
  const id = uid();
  await db.deals.add({ ...input, id, createdAt: t, updatedAt: t } as Deal);
  return id;
}

async function logStageChange(dealId: string, fromId: string, toId: string) {
  const [from, to] = await Promise.all([db.stages.get(fromId), db.stages.get(toId)]);
  await logActivity({
    type: "field_change",
    dealId,
    body: `Moved to ${to?.name ?? "stage"}`,
    metadata: { field: "stage", from: from?.name ?? null, to: to?.name ?? null },
  });
}

export async function moveDeal(dealId: string, stageId: string): Promise<void> {
  const deal = await db.deals.get(dealId);
  if (!deal || deal.stageId === stageId) return;
  await db.deals.update(dealId, { stageId, updatedAt: now() });
  await logStageChange(dealId, deal.stageId, stageId);
}

export async function deleteDeal(id: string): Promise<Snapshot> {
  return db.transaction("rw", [db.deals, db.tasks, db.activities, db.ledger, db.transactions], async () => {
    const transactions = await db.transactions.where("dealId").equals(id).toArray();
    // Money received stays in cash flow even if the deal is deleted.
    await db.transactions.where("dealId").equals(id).modify((t) => void delete t.dealId);
    const deal = await db.deals.get(id);
    const tasks = await db.tasks.where("dealId").equals(id).toArray();
    const activities = await db.activities.where("dealId").equals(id).toArray();
    const ledger = await db.ledger.where("dealId").equals(id).toArray();
    await db.tasks.where("dealId").equals(id).modify((x) => void delete x.dealId);
    await db.activities.where("dealId").equals(id).delete();
    await db.ledger.where("dealId").equals(id).modify((e) => void delete e.dealId);
    await db.deals.delete(id);
    return { deals: deal ? [deal] : [], tasks, activities, ledger, transactions };
  });
}

// ---------- tasks ----------
export async function saveTask(input: Input<Task>): Promise<string> {
  const t = now();
  if (input.id) {
    await db.tasks.update(input.id, { ...input, updatedAt: t });
    return input.id;
  }
  const id = uid();
  await db.tasks.add({ ...input, id, createdAt: t, updatedAt: t } as Task);
  return id;
}

export async function toggleTask(id: string): Promise<void> {
  const task = await db.tasks.get(id);
  if (!task) return;
  const done = task.status !== "done";
  await db.tasks.update(id, {
    status: done ? "done" : "open",
    completedAt: done ? now() : undefined,
    updatedAt: now(),
  });
}

export async function deleteTask(id: string): Promise<Snapshot> {
  const task = await db.tasks.get(id);
  await db.tasks.delete(id);
  return { tasks: task ? [task] : [] };
}

// ---------- tags ----------
export async function saveTag(input: Omit<Tag, "id" | "createdAt"> & { id?: string }): Promise<string> {
  if (input.id) {
    await db.tags.update(input.id, input);
    return input.id;
  }
  const id = uid();
  await db.tags.add({ ...input, id, createdAt: now() });
  return id;
}

export async function findOrCreateTag(name: string): Promise<string> {
  const n = name.trim();
  const existing = await db.tags.filter((t) => t.name.toLowerCase() === n.toLowerCase()).first();
  if (existing) return existing.id;
  return saveTag({ name: n, color: "neutral" });
}

export async function deleteTag(id: string): Promise<Snapshot> {
  return db.transaction("rw", [db.tags, db.contactTags], async () => {
    const tag = await db.tags.get(id);
    const contactTags: ContactTag[] = await db.contactTags.where("tagId").equals(id).toArray();
    await db.contactTags.where("tagId").equals(id).delete();
    await db.tags.delete(id);
    return { tags: tag ? [tag] : [], contactTags };
  });
}

// ---------- lead types ----------
export async function saveLeadType(input: Input<LeadType>): Promise<string> {
  const t = now();
  if (input.id) {
    await db.leadTypes.update(input.id, { ...input, updatedAt: t });
    return input.id;
  }
  const id = uid();
  const position = await db.leadTypes.count();
  await db.leadTypes.add({ ...input, position: input.position ?? position, id, createdAt: t, updatedAt: t } as LeadType);
  return id;
}

export async function deleteLeadType(id: string): Promise<Snapshot> {
  return db.transaction("rw", [db.leadTypes, db.contacts], async () => {
    const lt = await db.leadTypes.get(id);
    const contacts = await db.contacts.where("leadTypeId").equals(id).toArray();
    await db.contacts.where("leadTypeId").equals(id).modify((c) => void delete c.leadTypeId);
    await db.leadTypes.delete(id);
    return { leadTypes: lt ? [lt] : [], contacts };
  });
}

// ---------- projects ----------
export async function saveProject(input: Input<Project>): Promise<string> {
  const t = now();
  if (input.id) {
    await db.projects.update(input.id, { ...input, updatedAt: t });
    return input.id;
  }
  const id = uid();
  await db.transaction("rw", [db.projects, db.projectColumns], async () => {
    await db.projects.add({ ...input, id, createdAt: t, updatedAt: t } as Project);
    // Same starter columns a new board gets on the web.
    const cols = ["To do", "In progress", "Done"];
    await db.projectColumns.bulkAdd(
      cols.map((name, position) => ({ id: uid(), projectId: id, name, position, createdAt: t, updatedAt: t })),
    );
  });
  return id;
}

export async function deleteProject(id: string): Promise<Snapshot> {
  return db.transaction(
    "rw",
    [db.projects, db.projectColumns, db.projectTodos, db.tasks, db.activities, db.transactions],
    async () => {
      const transactions = await db.transactions.where("projectId").equals(id).toArray();
      // Money received / spent stays in your accounts; only the link to the project goes.
      await db.transactions.where("projectId").equals(id).modify((t) => void delete t.projectId);
      const project = await db.projects.get(id);
      const projectColumns = await db.projectColumns.where("projectId").equals(id).toArray();
      const projectTodos = await db.projectTodos.where("projectId").equals(id).toArray();
      const tasks = await db.tasks.where("projectId").equals(id).toArray();
      const activities = await db.activities.where("projectId").equals(id).toArray();
      await db.projectTodos.where("projectId").equals(id).delete();
      await db.projectColumns.where("projectId").equals(id).delete();
      await db.tasks.where("projectId").equals(id).delete();
      await db.activities.where("projectId").equals(id).delete();
      await db.projects.delete(id);
      return { projects: project ? [project] : [], projectColumns, projectTodos, tasks, activities, transactions };
    },
  );
}

export async function saveColumn(input: Input<ProjectColumn>): Promise<string> {
  const t = now();
  if (input.id) {
    await db.projectColumns.update(input.id, { ...input, updatedAt: t });
    return input.id;
  }
  const id = uid();
  await db.projectColumns.add({ ...input, id, createdAt: t, updatedAt: t } as ProjectColumn);
  return id;
}

export async function deleteColumn(id: string): Promise<Snapshot> {
  return db.transaction("rw", [db.projectColumns, db.projectTodos], async () => {
    const col = await db.projectColumns.get(id);
    const projectTodos = await db.projectTodos.where("columnId").equals(id).toArray();
    await db.projectTodos.where("columnId").equals(id).delete();
    await db.projectColumns.delete(id);
    return { projectColumns: col ? [col] : [], projectTodos };
  });
}

export async function reorderColumns(ids: string[]): Promise<void> {
  const t = now();
  await db.transaction("rw", db.projectColumns, async () => {
    for (let i = 0; i < ids.length; i++) await db.projectColumns.update(ids[i], { position: i, updatedAt: t });
  });
}

export async function saveTodo(input: Input<ProjectTodo>): Promise<string> {
  const t = now();
  if (input.id) {
    await db.projectTodos.update(input.id, { ...input, updatedAt: t });
    return input.id;
  }
  const id = uid();
  await db.projectTodos.add({ ...input, id, createdAt: t, updatedAt: t } as ProjectTodo);
  await db.projects.update(input.projectId, { updatedAt: t });
  return id;
}

export async function moveTodo(id: string, columnId: string): Promise<void> {
  const last = await db.projectTodos.where("columnId").equals(columnId).sortBy("position");
  const position = last.length ? last[last.length - 1].position + 1 : 0;
  await db.projectTodos.update(id, { columnId, position, updatedAt: now() });
}

export async function deleteTodo(id: string): Promise<Snapshot> {
  const todo = await db.projectTodos.get(id);
  await db.projectTodos.delete(id);
  return { projectTodos: todo ? [todo] : [] };
}

// ---------- money ledger ----------
export const todayYmd = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export interface EntryWithBalance {
  entry: LedgerEntry;
  paid: number;
  balance: number;
  payments: Payment[];
  overdue: boolean;
}

export function withBalance(entry: LedgerEntry, payments: Payment[]): EntryWithBalance {
  const mine = payments.filter((p) => p.entryId === entry.id).sort((a, b) => b.date.localeCompare(a.date));
  const paid = mine.reduce((s, p) => s + p.amount, 0);
  const balance = Math.max(0, Math.round((entry.amount - paid) * 100) / 100);
  return {
    entry,
    paid,
    balance,
    payments: mine,
    overdue: !entry.settledAt && balance > 0 && !!entry.dueDate && entry.dueDate < todayYmd(),
  };
}

/** Totals for the Home cards: what people owe me, and what I owe. Open entries only. */
export async function ledgerTotals(): Promise<{ receivable: number; payable: number; inPeople: number; outPeople: number; overdueIn: number }> {
  const [entries, payments] = await Promise.all([db.ledger.toArray(), db.payments.toArray()]);
  let receivable = 0;
  let payable = 0;
  let overdueIn = 0;
  const inP = new Set<string>();
  const outP = new Set<string>();
  for (const e of entries) {
    if (e.settledAt) continue;
    const b = withBalance(e, payments);
    if (b.balance <= 0) continue;
    const who = e.contactId ?? e.personName.trim().toLowerCase();
    if (e.direction === "in") {
      receivable += b.balance;
      inP.add(who);
      if (b.overdue) overdueIn += b.balance;
    } else {
      payable += b.balance;
      outP.add(who);
    }
  }
  return { receivable, payable, inPeople: inP.size, outPeople: outP.size, overdueIn };
}

export async function saveLedgerEntry(input: Input<LedgerEntry>): Promise<string> {
  const t = now();
  if (input.id) {
    await db.ledger.update(input.id, { ...input, updatedAt: t });
    await syncSettled(input.id);
    return input.id;
  }
  const id = uid();
  await db.ledger.add({ ...input, id, createdAt: t, updatedAt: t } as LedgerEntry);
  return id;
}

/** Settled exactly when fully paid. */
async function syncSettled(entryId: string) {
  const e = await db.ledger.get(entryId);
  if (!e) return;
  const payments = await db.payments.where("entryId").equals(entryId).toArray();
  const { balance } = withBalance(e, payments);
  if (balance <= 0 && !e.settledAt) await db.ledger.update(entryId, { settledAt: now(), updatedAt: now() });
  if (balance > 0 && e.settledAt) await db.ledger.update(entryId, { settledAt: undefined, updatedAt: now() });
}

export async function addPayment(entryId: string, amount: number, date: string, note?: string, method?: string, accountId?: string): Promise<void> {
  await db.transaction("rw", [db.ledger, db.payments, db.transactions], async () => {
    const entry = await db.ledger.get(entryId);
    const paymentId = uid();
    await db.payments.add({ id: paymentId, entryId, amount, date, note, accountId, createdAt: now() });
    // Credit (business) payments are real income/expense, so they also land in
    // the cash-flow book. Personal loans are not income or expenses: no transaction.
    if (entry?.kind === "credit") {
      const t = now();
      await db.transactions.add({
        id: uid(),
        type: entry.direction === "in" ? "income" : "expense",
        scope: "business",
        amount,
        currency: entry.currency,
        date,
        category: entry.direction === "in" ? (entry.dealId ? "Client payment" : "Sales") : "Supplies",
        method,
        note: note ?? entry.note,
        contactId: entry.contactId,
        dealId: entry.dealId,
        ledgerPaymentId: paymentId,
        accountId,
        createdAt: t,
        updatedAt: t,
      });
    }
    await syncSettled(entryId);
  });
}

/** Records the remaining balance as a final payment so the history stays complete. */
export async function settleEntry(entryId: string): Promise<void> {
  const e = await db.ledger.get(entryId);
  if (!e) return;
  const { balance } = withBalance(e, await db.payments.where("entryId").equals(entryId).toArray());
  if (balance > 0) await addPayment(entryId, balance, todayYmd(), "Settled in full");
  else await syncSettled(entryId);
}

export async function deletePayment(id: string): Promise<Snapshot> {
  const p = await db.payments.get(id);
  if (!p) return {};
  const transactions = await db.transactions.where("ledgerPaymentId").equals(id).toArray();
  await db.transaction("rw", [db.ledger, db.payments, db.transactions], async () => {
    await db.transactions.where("ledgerPaymentId").equals(id).delete();
    await db.payments.delete(id);
    await syncSettled(p.entryId);
  });
  return { payments: [p], transactions };
}

export async function deleteLedgerEntry(id: string): Promise<Snapshot> {
  return db.transaction("rw", [db.ledger, db.payments, db.transactions], async () => {
    const e = await db.ledger.get(id);
    const payments = await db.payments.where("entryId").equals(id).toArray();
    const pids = payments.map((p) => p.id);
    const transactions = pids.length ? await db.transactions.where("ledgerPaymentId").anyOf(pids).toArray() : [];
    // The money really changed hands, so its income/expense stays in cash flow;
    // only the link to the deleted entry is dropped.
    if (pids.length) await db.transactions.where("ledgerPaymentId").anyOf(pids).modify((t) => void delete t.ledgerPaymentId);
    await db.payments.where("entryId").equals(id).delete();
    await db.ledger.delete(id);
    return { ledger: e ? [e] : [], payments, transactions };
  });
}

// ---------- cash flow ----------
export const PAYMENT_METHODS = ["Cash", "Bank transfer", "JazzCash", "Easypaisa", "Card", "Cheque"];

export const CATEGORIES: Record<"business" | "personal", Record<"income" | "expense", string[]>> = {
  business: {
    income: ["Client payment", "Sales", "Services", "Commission", "Other income"],
    expense: ["Project costs", "Supplies", "Salaries", "Rent", "Utilities", "Transport", "Marketing", "Software", "Equipment", "Food", "Taxes & fees", "Other"],
  },
  personal: {
    income: ["Salary", "Profit", "Gift", "Refund", "Other income"],
    expense: ["Food", "Groceries", "Fuel", "Bills", "Rent", "Shopping", "Health", "Education", "Family", "Charity", "Entertainment", "Travel", "Other"],
  },
};

type TxInput = Omit<Transaction, "id" | "createdAt" | "updatedAt"> & { id?: string };

export async function saveTransaction(input: TxInput): Promise<string> {
  const t = now();
  if (input.id) {
    await db.transactions.update(input.id, { ...input, updatedAt: t });
    // Keep a linked credit payment in step with an edited transaction.
    const tx = await db.transactions.get(input.id);
    if (tx?.ledgerPaymentId) {
      const pay = await db.payments.get(tx.ledgerPaymentId);
      if (pay) {
        await db.payments.update(pay.id, { amount: input.amount, date: input.date, accountId: input.accountId });
        await syncSettled(pay.entryId);
      }
    }
    return input.id;
  }
  const id = uid();
  await db.transactions.add({ ...input, id, createdAt: t, updatedAt: t } as Transaction);
  return id;
}

export async function deleteTransaction(id: string): Promise<Snapshot> {
  const tx = await db.transactions.get(id);
  if (!tx) return {};
  // Deleting the income of a credit payment also removes that payment.
  if (tx.ledgerPaymentId) {
    const snap = await deletePayment(tx.ledgerPaymentId);
    return snap;
  }
  await db.transactions.delete(id);
  return { transactions: [tx] };
}

/**
 * Record money received on a deal (advance, delivery, extra work...).
 * If the deal has an open credit receivable, the payment goes against it
 * first; anything beyond its balance is recorded as extra income. Either way
 * exactly one income line per payment ends up in cash flow.
 */
export async function recordDealPayment(dealId: string, amount: number, date: string, label: string, method?: string, accountId?: string): Promise<void> {
  const deal = await db.deals.get(dealId);
  if (!deal) return;
  if (amount <= 0) return;
  const entries = await db.ledger.where("dealId").equals(dealId).filter((e) => e.direction === "in" && !e.settledAt).toArray();
  let rest = amount;
  for (const e of entries) {
    if (rest <= 0) break;
    const { balance } = withBalance(e, await db.payments.where("entryId").equals(e.id).toArray());
    const apply = Math.min(balance, rest);
    if (apply > 0) {
      await addPayment(e.id, apply, date, label, method, accountId);
      rest -= apply;
    }
  }
  if (rest > 0) {
    await saveTransaction({
      type: "income",
      scope: "business",
      amount: rest,
      currency: deal.currency,
      date,
      category: "Client payment",
      method,
      note: label,
      contactId: deal.contactId,
      dealId,
      accountId,
    });
  }
}

/** Change the agreed total of a deal (it can change at any stage). Logged on the timeline. */
export async function setDealAgreed(dealId: string, agreed: number): Promise<void> {
  const d = await db.deals.get(dealId);
  if (!d || d.value === agreed) return;
  await db.deals.update(dealId, { value: agreed, updatedAt: now() });
  await logActivity({
    type: "field_change",
    dealId,
    body: "Agreed total changed",
    metadata: { field: "agreed total", from: d.value || null, to: agreed || null },
  });
}

/** Money received on a deal so far, from the cash-flow book. */
export async function dealReceived(dealId: string): Promise<{ received: number; items: Transaction[] }> {
  const items = (await db.transactions.where("dealId").equals(dealId).toArray()).filter((t) => t.type === "income").sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  return { received: items.reduce((s, t) => s + t.amount, 0), items };
}

export function monthRange(year: number, month: number): [string, string] {
  const p = (n: number) => String(n).padStart(2, "0");
  const last = new Date(year, month + 1, 0).getDate();
  return [`${year}-${p(month + 1)}-01`, `${year}-${p(month + 1)}-${p(last)}`];
}

export async function monthTotals(year: number, month: number, scope?: "business" | "personal") {
  const [from, to] = monthRange(year, month);
  const txs = (await db.transactions.where("date").between(from, to, true, true).toArray()).filter((t) => !scope || t.scope === scope);
  const income = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  return { income, expense, net: income - expense, txs };
}

// ---------- meta ----------
export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export async function eraseAll(): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    for (const t of db.tables) if (t.name !== "meta") await t.clear();
  });
  await setMeta("seeded", false);
}
