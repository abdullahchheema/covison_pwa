// Accounts (banks, wallets, cash), transfers, balances, and the "who owes
// what" summary used by Home.
//
// Balance of an account =
//   opening balance (what you had when you added it)
//   + income − expenses booked to it
//   + transfers in − transfers out
//   − money lent from it (personal loans)   + money borrowed into it
//   + loan repayments received into it       − loan repayments paid from it
// Credit (business) payments are counted through the income/expense line
// they create, so nothing is counted twice. Movements dated before the
// account was added are treated as already included in the opening balance.
import { db, type Account, type Deal, type LedgerEntry, type Transfer } from "./schema";
import { now, todayYmd, uid, withBalance, type Snapshot } from "./repo";
import { money } from "../lib/format";

export interface Movement {
  id: string;
  date: string;
  createdAt: string;
  label: string;
  sub?: string;
  amount: number; // signed: + into the account, − out of it
  kind: "income" | "expense" | "transfer" | "loan" | "repayment";
  link?: string;
}

const LAST_KEY = "covison.lastAccount";
export function lastAccountId(): string {
  try {
    return localStorage.getItem(LAST_KEY) ?? "";
  } catch {
    return "";
  }
}
export function rememberAccount(id: string | undefined) {
  if (!id) return;
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    /* ignore */
  }
}

export async function listAccounts(includeArchived = false): Promise<Account[]> {
  const all = await db.accounts.orderBy("position").toArray();
  return includeArchived ? all : all.filter((a) => !a.archived);
}

export async function saveAccount(input: Omit<Account, "id" | "createdAt" | "updatedAt" | "position"> & { id?: string; position?: number }): Promise<string> {
  const t = now();
  if (input.id) {
    await db.accounts.update(input.id, { ...input, updatedAt: t });
    return input.id;
  }
  const id = uid();
  const position = input.position ?? (await db.accounts.count());
  await db.accounts.add({ ...input, id, position, createdAt: t, updatedAt: t } as Account);
  return id;
}

async function usageCount(id: string): Promise<number> {
  const [a, b, c, d, e, f] = await Promise.all([
    db.transactions.where("accountId").equals(id).count(),
    db.transfers.where("fromAccountId").equals(id).count(),
    db.transfers.where("toAccountId").equals(id).count(),
    db.ledger.where("accountId").equals(id).count(),
    db.payments.where("accountId").equals(id).count(),
    Promise.resolve(0),
  ]);
  return a + b + c + d + e + f;
}

/** Deletes an unused account; an account with history is archived instead so balances stay right. */
export async function removeAccount(id: string): Promise<{ archived: boolean; snap: Snapshot }> {
  const acc = await db.accounts.get(id);
  if (!acc) return { archived: false, snap: {} };
  if ((await usageCount(id)) > 0) {
    await db.accounts.update(id, { archived: true, updatedAt: now() });
    return { archived: true, snap: { accounts: [acc] } };
  }
  await db.accounts.delete(id);
  return { archived: false, snap: { accounts: [acc] } };
}

export async function saveTransfer(input: Omit<Transfer, "id" | "createdAt"> & { id?: string }): Promise<string> {
  if (input.fromAccountId === input.toAccountId) throw new Error("Choose two different accounts");
  if (input.id) {
    await db.transfers.update(input.id, input);
    return input.id;
  }
  const id = uid();
  await db.transfers.add({ ...input, id, createdAt: now() });
  return id;
}

export async function deleteTransfer(id: string): Promise<Snapshot> {
  const t = await db.transfers.get(id);
  await db.transfers.delete(id);
  return { transfers: t ? [t] : [] };
}

function counts(acc: Account, date: string, createdAt: string): boolean {
  return date > acc.openingDate || (date === acc.openingDate && createdAt >= acc.createdAt);
}

/** Every movement of money into / out of each account. */
export async function allMovements(): Promise<Map<string, Movement[]>> {
  const [accounts, txs, transfers, ledger, payments, contacts, deals] = await Promise.all([
    db.accounts.toArray(),
    db.transactions.toArray(),
    db.transfers.toArray(),
    db.ledger.toArray(),
    db.payments.toArray(),
    db.contacts.toArray(),
    db.deals.toArray(),
  ]);
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  const contactName = new Map(contacts.map((c) => [c.id, c.name]));
  const dealName = new Map(deals.map((d) => [d.id, d.name]));
  const entryById = new Map(ledger.map((e) => [e.id, e]));
  const out = new Map<string, Movement[]>(accounts.map((a) => [a.id, []]));
  const push = (accId: string | undefined, m: Movement) => {
    if (accId && out.has(accId)) out.get(accId)!.push(m);
  };

  for (const t of txs) {
    const who = t.dealId ? dealName.get(t.dealId) : t.contactId ? contactName.get(t.contactId) : undefined;
    push(t.accountId, {
      id: t.id,
      date: t.date,
      createdAt: t.createdAt,
      label: t.note && t.dealId ? `${t.note} · ${who ?? ""}`.replace(/ · $/, "") : t.category,
      sub: [t.dealId ? "Project payment" : t.category, who && !t.dealId ? who : undefined, t.note && !t.dealId ? t.note : undefined].filter(Boolean).join(" · "),
      amount: t.type === "income" ? t.amount : -t.amount,
      kind: t.type,
      link: t.dealId ? `/deals/${t.dealId}` : undefined,
    });
  }
  for (const tr of transfers) {
    push(tr.fromAccountId, { id: `${tr.id}-out`, date: tr.date, createdAt: tr.createdAt, label: `To ${accName.get(tr.toAccountId) ?? "account"}`, sub: tr.note ?? "Transfer", amount: -tr.amount, kind: "transfer" });
    push(tr.toAccountId, { id: `${tr.id}-in`, date: tr.date, createdAt: tr.createdAt, label: `From ${accName.get(tr.fromAccountId) ?? "account"}`, sub: tr.note ?? "Transfer", amount: tr.amount, kind: "transfer" });
  }
  for (const e of ledger) {
    if (e.kind !== "loan") continue;
    push(e.accountId, {
      id: e.id,
      date: e.date,
      createdAt: e.createdAt,
      label: e.direction === "in" ? `Lent to ${e.personName}` : `Borrowed from ${e.personName}`,
      sub: e.note ?? "Personal loan",
      amount: e.direction === "in" ? -e.amount : e.amount,
      kind: "loan",
      link: `/money/${e.id}`,
    });
  }
  for (const p of payments) {
    const e = entryById.get(p.entryId);
    if (!e || e.kind !== "loan") continue; // credit payments are counted via their transaction
    push(p.accountId, {
      id: p.id,
      date: p.date,
      createdAt: p.createdAt,
      label: e.direction === "in" ? `${e.personName} repaid` : `Repaid ${e.personName}`,
      sub: p.note ?? "Loan repayment",
      amount: e.direction === "in" ? p.amount : -p.amount,
      kind: "repayment",
      link: `/money/${e.id}`,
    });
  }
  for (const list of out.values()) list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  return out;
}

export interface AccountWithBalance {
  account: Account;
  balance: number;
  movements: Movement[];
}

export async function accountBalances(includeArchived = false): Promise<AccountWithBalance[]> {
  const [accounts, moves] = await Promise.all([listAccounts(true), allMovements()]);
  return accounts
    .filter((a) => includeArchived || !a.archived)
    .map((account) => {
      const movements = (moves.get(account.id) ?? []).filter((m) => counts(account, m.date, m.createdAt));
      const balance = Math.round((account.openingBalance + movements.reduce((s, m) => s + m.amount, 0)) * 100) / 100;
      return { account, balance, movements };
    });
}

export async function balanceTotals() {
  const list = await accountBalances();
  const sum = (s?: "business" | "personal") => list.filter((x) => !s || x.account.scope === s).reduce((t, x) => t + x.balance, 0);
  return { total: sum(), business: sum("business"), personal: sum("personal"), count: list.length, list };
}

// ---------------- money in / out per side ----------------

export interface Flow {
  in: number;
  out: number;
  net: number;
}

export interface MonthFlows {
  business: Flow;
  personal: Flow;
  total: Flow;
  byAccount: Map<string, Flow>;
}

/**
 * Money that came into and went out of your accounts in a month, per side
 * (business / personal). Transfers between two accounts on the same side are
 * internal and not counted; a business → personal transfer is "out" of
 * business and "in" to personal.
 */
export async function monthFlows(year: number, month: number): Promise<MonthFlows> {
  const p = (n: number) => String(n).padStart(2, "0");
  const from = `${year}-${p(month + 1)}-01`;
  const to = `${year}-${p(month + 1)}-${p(new Date(year, month + 1, 0).getDate())}`;
  const [list, transfers] = await Promise.all([accountBalances(true), db.transfers.toArray()]);
  const scopeOf = new Map(list.map((x) => [x.account.id, x.account.scope]));
  const internal = new Set(transfers.filter((t) => scopeOf.get(t.fromAccountId) === scopeOf.get(t.toAccountId)).map((t) => t.id));
  const zero = (): Flow => ({ in: 0, out: 0, net: 0 });
  const res: MonthFlows = { business: zero(), personal: zero(), total: zero(), byAccount: new Map() };
  for (const { account, movements } of list) {
    const acc = zero();
    for (const m of movements) {
      if (m.date < from || m.date > to) continue;
      // Per-account view counts every transfer; per-side totals skip same-side ones.
      if (m.amount >= 0) acc.in += m.amount;
      else acc.out += -m.amount;
      if (m.kind === "transfer" && internal.has(m.id.replace(/-(in|out)$/, ""))) continue;
      const side = res[account.scope];
      if (m.amount >= 0) side.in += m.amount;
      else side.out += -m.amount;
    }
    acc.net = acc.in - acc.out;
    res.byAccount.set(account.id, acc);
  }
  for (const k of ["business", "personal"] as const) res[k].net = res[k].in - res[k].out;
  // Whole-picture totals: transfers between sides cancel out here.
  const crossIds = new Set(transfers.filter((t) => !internal.has(t.id) && t.date >= from && t.date <= to).map((t) => t.id));
  const cross = transfers.filter((t) => crossIds.has(t.id)).reduce((s, t) => s + t.amount, 0);
  res.total = {
    in: res.business.in + res.personal.in - cross,
    out: res.business.out + res.personal.out - cross,
    net: 0,
  };
  res.total.net = res.total.in - res.total.out;
  return res;
}

// ---------------- projects (won deals) and what people owe ----------------

export interface DealMoney {
  deal: Deal;
  agreed: number; // 0 = not agreed yet
  received: number;
  due: number; // agreed − received, never negative
}

/** Money on every won deal (the client's project). */
export async function wonDealMoney(): Promise<DealMoney[]> {
  const [stages, deals, txs, ledger] = await Promise.all([db.stages.toArray(), db.deals.toArray(), db.transactions.toArray(), db.ledger.toArray()]);
  const won = new Set(stages.filter((s) => s.isWon).map((s) => s.id));
  const withLedger = new Set(ledger.filter((e) => e.dealId).map((e) => e.dealId!));
  const received = new Map<string, number>();
  for (const t of txs) if (t.dealId && t.type === "income") received.set(t.dealId, (received.get(t.dealId) ?? 0) + t.amount);
  return deals
    .filter((d) => won.has(d.stageId) && !withLedger.has(d.id))
    .map((deal) => {
      const r = received.get(deal.id) ?? 0;
      return { deal, agreed: deal.value || 0, received: r, due: Math.max(0, Math.round(((deal.value || 0) - r) * 100) / 100) };
    });
}

export interface OwedLine {
  id: string;
  title: string;
  sub: string;
  amount: number;
  link: string;
  overdue?: boolean;
}

/** What people owe you (business vs personal) and what you owe. */
export async function owedSummary() {
  const [entries, payments, projects, contacts] = await Promise.all([db.ledger.toArray(), db.payments.toArray(), wonDealMoney(), db.contacts.toArray()]);
  const name = new Map(contacts.map((c) => [c.id, c.name]));
  const business: OwedLine[] = [];
  const personal: OwedLine[] = [];
  const iOwe: OwedLine[] = [];
  for (const e of entries as LedgerEntry[]) {
    if (e.settledAt) continue;
    const b = withBalance(e, payments);
    if (b.balance <= 0) continue;
    const line: OwedLine = {
      id: e.id,
      title: e.personName,
      sub: [e.kind === "loan" ? "Personal loan" : "Credit", e.dueDate ? `due ${e.dueDate}` : undefined, e.note].filter(Boolean).join(" · "),
      amount: b.balance,
      link: `/money/${e.id}`,
      overdue: b.overdue,
    };
    if (e.direction === "out") iOwe.push(line);
    else if (e.kind === "loan") personal.push(line);
    else business.push(line);
  }
  // Projects created directly (not from a deal) with an agreed total still to collect.
  const [manual, allTx] = await Promise.all([db.projects.filter((p) => !p.dealId && (p.agreed ?? 0) > 0).toArray(), db.transactions.toArray()]);
  for (const mp of manual) {
    const got = allTx.filter((t) => t.projectId === mp.id && t.type === "income").reduce((s, t) => s + t.amount, 0);
    const due = Math.round(((mp.agreed ?? 0) - got) * 100) / 100;
    if (due <= 0) continue;
    business.push({
      id: mp.id,
      title: mp.contactId ? name.get(mp.contactId) ?? mp.name : mp.name,
      sub: `Project “${mp.name}” · received ${money(got)} of ${money(mp.agreed ?? 0)}`,
      amount: due,
      link: `/projects/${mp.id}`,
    });
  }
  for (const p of projects) {
    if (p.due <= 0) continue;
    business.push({
      id: p.deal.id,
      title: p.deal.contactId ? name.get(p.deal.contactId) ?? p.deal.name : p.deal.name,
      sub: `Project “${p.deal.name}” · received ${money(p.received)} of ${money(p.agreed)}`,
      amount: p.due,
      link: `/deals/${p.deal.id}`,
    });
  }
  const total = (l: OwedLine[]) => l.reduce((s, x) => s + x.amount, 0);
  const sort = (l: OwedLine[]) => l.sort((a, b) => b.amount - a.amount);
  return {
    business: sort(business),
    personal: sort(personal),
    iOwe: sort(iOwe),
    businessTotal: total(business),
    // Count people, not lines: one client with two projects is one client.
    businessPeople: new Set(business.map((l) => l.title.trim().toLowerCase())).size,
    personalPeople: new Set(personal.map((l) => l.title.trim().toLowerCase())).size,
    personalTotal: total(personal),
    iOweTotal: total(iOwe),
    unagreed: projects.filter((p) => p.agreed === 0).length,
  };
}

export { todayYmd };
