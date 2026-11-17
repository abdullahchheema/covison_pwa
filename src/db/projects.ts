// Projects: status (not started / in progress / completed) and the money on
// each one — agreed total, money received, money spent, profit, still due.
// A project created from a won deal shares the deal's money (deal.value is the
// agreed total, deal payments are its income). A project you create directly
// keeps its own agreed total and income lines (transaction.projectId).
import { db, type Deal, type Project, type ProjectStatus, type Transaction } from "./schema";
import { logActivity, now, recordDealPayment, saveTransaction, setDealAgreed } from "./repo";
import { DEFAULT_CURRENCY } from "./schema";

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
};
export const STATUS_ORDER: ProjectStatus[] = ["not_started", "in_progress", "completed"];

export interface ProjectMoney {
  agreed: number; // 0 = not agreed yet
  received: number;
  spent: number;
  profit: number; // received − spent
  due: number; // agreed − received (never negative)
  items: Transaction[]; // received + spent, newest first
}

export function moneyFor(p: Project, deal: Deal | undefined, txs: Transaction[]): ProjectMoney {
  const mine = txs.filter((t) => t.projectId === p.id || (!!p.dealId && t.dealId === p.dealId));
  const received = mine.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const spent = mine.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const agreed = (p.dealId ? deal?.value : p.agreed) || 0;
  return {
    agreed,
    received,
    spent,
    profit: Math.round((received - spent) * 100) / 100,
    due: Math.max(0, Math.round((agreed - received) * 100) / 100),
    items: mine.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
  };
}

export interface ProjectRow {
  project: Project;
  status: ProjectStatus;
  client?: string;
  deal?: Deal;
  money: ProjectMoney;
}

export async function loadProjects(): Promise<ProjectRow[]> {
  const [projects, deals, contacts, txs] = await Promise.all([db.projects.toArray(), db.deals.toArray(), db.contacts.toArray(), db.transactions.toArray()]);
  const dealById = new Map(deals.map((d) => [d.id, d]));
  const name = new Map(contacts.map((c) => [c.id, c.name]));
  return projects
    .map((project) => {
      const deal = project.dealId ? dealById.get(project.dealId) : undefined;
      return {
        project,
        status: project.status ?? "in_progress",
        client: project.contactId ? name.get(project.contactId) : undefined,
        deal,
        money: moneyFor(project, deal, txs),
      };
    })
    .sort((a, b) => b.project.updatedAt.localeCompare(a.project.updatedAt));
}

export async function loadProject(id: string): Promise<ProjectRow | null> {
  const project = await db.projects.get(id);
  if (!project) return null;
  const [deal, txs, client] = await Promise.all([
    project.dealId ? db.deals.get(project.dealId) : Promise.resolve(undefined),
    db.transactions.toArray(),
    project.contactId ? db.contacts.get(project.contactId) : Promise.resolve(undefined),
  ]);
  return { project, status: project.status ?? "in_progress", client: client?.name, deal, money: moneyFor(project, deal, txs) };
}

export async function setProjectStatus(id: string, status: ProjectStatus): Promise<void> {
  const p = await db.projects.get(id);
  if (!p || p.status === status) return;
  await db.projects.update(id, { status, updatedAt: now() });
  await logActivity({ type: "field_change", projectId: id, body: `Status: ${STATUS_LABEL[status]}`, metadata: { field: "status", from: p.status ? STATUS_LABEL[p.status] : null, to: STATUS_LABEL[status] } });
}

export async function setProjectAgreed(p: Project, agreed: number): Promise<void> {
  if (p.dealId) await setDealAgreed(p.dealId, agreed);
  else await db.projects.update(p.id, { agreed, updatedAt: now() });
}

/** Money received for a project (goes through the deal when there is one). */
export async function recordProjectIncome(p: Project, amount: number, date: string, label: string, accountId?: string): Promise<void> {
  if (p.dealId) await recordDealPayment(p.dealId, amount, date, label, undefined, accountId);
  else
    await saveTransaction({
      type: "income",
      scope: "business",
      amount,
      currency: DEFAULT_CURRENCY,
      date,
      category: "Client payment",
      note: label,
      contactId: p.contactId,
      projectId: p.id,
      accountId,
    });
  await db.projects.update(p.id, { updatedAt: now() });
}
