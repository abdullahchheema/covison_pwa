// Cash flow: every rupee in and out, business and personal, month by month.
import { useMemo, useState } from "preact/hooks";
import { db, type Transaction } from "../db/schema";
import { deleteTransaction, monthTotals, restoreSnapshot } from "../db/repo";
import { monthLoanMoves, type LoanMove } from "../db/accounts";
import { useCountUp, useLive, useStoredState } from "../lib/hooks";
import { money } from "../lib/format";
import { navigate } from "../lib/router";
import { Icon } from "../ui/icons";
import { Empty, Row, SwipeRow } from "../ui/kit";
import { BarList } from "../ui/charts";
import { confirmSheet, undoToast } from "../ui/overlay";
import { openTransactionForm } from "./forms";

type Scope = "" | "business" | "personal";

function monthLabel(y: number, m: number) {
  return new Date(y, m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function dayLabel(ymd: string) {
  const today = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const t = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
  const y = new Date(today.getTime() - 86400000);
  const yd = `${y.getFullYear()}-${p(y.getMonth() + 1)}-${p(y.getDate())}`;
  if (ymd === t) return "Today";
  if (ymd === yd) return "Yesterday";
  const [yy, mm, dd] = ymd.split("-").map(Number);
  return new Date(yy, mm - 1, dd).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** Compact "this month" card for Home. */
export function MonthGlance() {
  const now = new Date();
  const t = useLive(() => monthTotals(now.getFullYear(), now.getMonth()), []);
  const inc = useCountUp(t?.income ?? 0, 1000);
  const exp = useCountUp(t?.expense ?? 0, 1000);
  if (!t) return null;
  const net = t.income - t.expense;
  return (
    <button class="card press-soft rise mt12" style={{ "--i": 4, width: "100%", textAlign: "left", display: "block" } as never} onClick={() => {
      try {
        localStorage.setItem("covison.money.tab", JSON.stringify("flow"));
      } catch {
        /* ignore */
      }
      navigate("/money");
    }}>
      <div class="row between">
        <span class="t-overline">{now.toLocaleDateString(undefined, { month: "long" })} so far</span>
        <span class={`t-footnote num ${net >= 0 ? "c-success" : "c-danger"}`} style="font-weight:700">
          {net >= 0 ? "+" : "−"}
          {money(Math.abs(net))} net
        </span>
      </div>
      <div class="row gap16 mt8">
        <div class="col grow">
          <span class="t-footnote c3 row gap4">
            <Icon name="arrowDownLeft" size={13} stroke={2.6} /> Earned
          </span>
          <span class="t-title3 t-metric c-success">{money(inc)}</span>
        </div>
        <div class="col grow">
          <span class="t-footnote c3 row gap4">
            <Icon name="arrowUpRight" size={13} stroke={2.6} /> Spent
          </span>
          <span class="t-title3 t-metric c-danger">{money(exp)}</span>
        </div>
      </div>
    </button>
  );
}

function LoanRow({ m, i }: { m: LoanMove; i: number }) {
  const inc = m.dir === "in";
  return (
    <div class="rise" style={{ "--i": Math.min(i, 12) } as never}>
      <Row
        onClick={() => navigate(m.link)}
        lead={
          <span class="tile" style={{ background: "linear-gradient(135deg,#5b3fd6,#9b7bff)" }}>
            <Icon name="handshake" size={16} stroke={2.2} />
          </span>
        }
        title={m.label}
        sub={m.sub}
        trail={
          <span class={`num t-headline ${inc ? "c-success" : ""}`} style="flex-shrink:0">
            {inc ? "+" : "−"}
            {money(m.amount)}
          </span>
        }
        chevron={false}
      />
    </div>
  );
}

type Entry = { kind: "tx"; t: Transaction } | { kind: "loan"; m: LoanMove };
const eDate = (e: Entry) => (e.kind === "tx" ? e.t.date : e.m.date);
const eCreated = (e: Entry) => (e.kind === "tx" ? e.t.createdAt : e.m.createdAt);
const eSigned = (e: Entry) => (e.kind === "tx" ? (e.t.type === "income" ? e.t.amount : -e.t.amount) : e.m.dir === "in" ? e.m.amount : -e.m.amount);

function TxRow({ t, i, contactName }: { t: Transaction; i: number; contactName?: string }) {
  const inc = t.type === "income";
  return (
    <SwipeRow
      i={i}
      actions={[
        {
          label: "Delete",
          icon: "trash",
          tone: "danger",
          run: async () => {
            if (t.ledgerPaymentId && !(await confirmSheet({ title: "Delete this payment?", message: "It is linked to a credit entry; that payment will be removed too.", confirm: "Delete", destructive: true }))) return;
            const snap = await deleteTransaction(t.id);
            undoToast(inc ? "Income deleted" : "Expense deleted", () => restoreSnapshot(snap));
          },
        },
      ]}
    >
      <Row
        onClick={() => openTransactionForm(t)}
        lead={
          <span class="tile" style={{ background: inc ? "linear-gradient(135deg,#149a68,#42d39a)" : t.scope === "business" ? "linear-gradient(135deg,#d13a46,#ff737d)" : "linear-gradient(135deg,#c88518,#f1bb5c)" }}>
            <Icon name={inc ? "arrowDownLeft" : "arrowUpRight"} size={16} stroke={2.6} />
          </span>
        }
        title={t.category}
        sub={[t.note, contactName, t.scope === "business" ? "Business" : "Personal", t.method].filter(Boolean).join(" · ")}
        trail={
          <span class={`num t-headline ${inc ? "c-success" : ""}`} style="flex-shrink:0">
            {inc ? "+" : "−"}
            {money(t.amount, t.currency)}
          </span>
        }
        chevron={false}
      />
    </SwipeRow>
  );
}

export function CashFlowView() {
  const now = new Date();
  const [ym, setYm] = useState<[number, number]>([now.getFullYear(), now.getMonth()]);
  const [scope, setScope] = useStoredState<Scope>("cashflow.scope", "");
  const data = useLive(async () => {
    const [t, loans, contacts] = await Promise.all([monthTotals(ym[0], ym[1], scope || undefined), monthLoanMoves(ym[0], ym[1], scope || undefined), db.contacts.toArray()]);
    const loanIn = loans.filter((m) => m.dir === "in").reduce((s, m) => s + m.amount, 0);
    const loanOut = loans.filter((m) => m.dir === "out").reduce((s, m) => s + m.amount, 0);
    // Money in / out of your pocket: earnings and spending plus loans you gave,
    // took or got back, so the month's net matches what your accounts did.
    return { ...t, loans, loanIn, loanOut, in: t.income + loanIn, out: t.expense + loanOut, names: new Map(contacts.map((c) => [c.id, c.name])) };
  }, [ym[0], ym[1], scope]);
  const inc = useCountUp(data?.in ?? 0, 900);
  const exp = useCountUp(data?.out ?? 0, 900);

  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    data?.txs.filter((t) => t.type === "expense").forEach((t) => m.set(t.category, (m.get(t.category) ?? 0) + t.amount));
    data?.loans.filter((l) => l.dir === "out").forEach((l) => m.set(l.category, (m.get(l.category) ?? 0) + l.amount));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [data]);

  const days = useMemo(() => {
    const m = new Map<string, Entry[]>();
    const all: Entry[] = [...(data?.txs ?? []).map((t) => ({ kind: "tx" as const, t })), ...(data?.loans ?? []).map((l) => ({ kind: "loan" as const, m: l }))];
    all
      .sort((a, b) => eDate(b).localeCompare(eDate(a)) || eCreated(b).localeCompare(eCreated(a)))
      .forEach((e) => m.set(eDate(e), [...(m.get(eDate(e)) ?? []), e]));
    return [...m.entries()];
  }, [data]);

  const isCurrent = ym[0] === now.getFullYear() && ym[1] === now.getMonth();
  const shift = (d: number) => setYm(([y, m]) => {
    const n = new Date(y, m + d, 1);
    return [n.getFullYear(), n.getMonth()];
  });
  const net = (data?.in ?? 0) - (data?.out ?? 0);
  let idx = 0;

  return (
    <>
      <div class="row between" style="padding:2px 0 10px">
        <button class="icon-btn press" aria-label="Previous month" onClick={() => shift(-1)}>
          <Icon name="chevronLeft" size={18} stroke={2.4} />
        </button>
        <span class="t-headline">{monthLabel(ym[0], ym[1])}</span>
        <button class="icon-btn press" aria-label="Next month" disabled={isCurrent} style={isCurrent ? { opacity: 0.35 } : undefined} onClick={() => !isCurrent && shift(1)}>
          <Icon name="chevronRight" size={18} stroke={2.4} />
        </button>
      </div>

      <div class="chips">
        {([["", "All"], ["business", "Business"], ["personal", "Personal"]] as [Scope, string][]).map(([v, l]) => (
          <button key={l} class="chip press" aria-pressed={scope === v} onClick={() => setScope(v)}>
            {l}
          </button>
        ))}
      </div>

      <div class="card rise" style={{ "--i": 0 } as never}>
        <div class="row">
          <div class="col grow">
            <span class="t-footnote c3">Money in</span>
            <span class="t-title2 t-metric c-success">{money(inc)}</span>
          </div>
          <div class="col grow">
            <span class="t-footnote c3">Money out</span>
            <span class="t-title2 t-metric c-danger">{money(exp)}</span>
          </div>
        </div>
        {data && (data.loanIn > 0 || data.loanOut > 0) && (
          <div class="row t-caption c3 mt4">
            <span class="grow">{data.loanIn > 0 ? `incl. ${money(data.loanIn)} from loans` : ""}</span>
            <span class="grow">{data.loanOut > 0 ? `incl. ${data.loans.some((l) => l.dir === "out" && l.category !== "Lent") ? `${money(data.loanOut)} lent / paid back` : `${money(data.loanOut)} lent`}` : ""}</span>
          </div>
        )}
        <div class="bar-track mt12" style="height:8px;display:flex;background:var(--danger-soft)">
          <div class="bar-fill won" style={{ width: `${(data?.in ?? 0) + (data?.out ?? 0) > 0 ? ((data?.in ?? 0) / ((data?.in ?? 0) + (data?.out ?? 0))) * 100 : 0}%`, borderRadius: "5px 0 0 5px" }} />
        </div>
        <p class={`t-subhead mt8 num ${net >= 0 ? "c-success" : "c-danger"}`} style="font-weight:700">
          {net >= 0 ? "Saved " : "Overspent "}
          {money(Math.abs(net))}
          {isCurrent ? " this month" : " that month"}
        </p>
        <div class="row gap8 mt12">
          <button class="btn sm press grow" style="background:var(--success-soft);color:var(--success)" onClick={() => openTransactionForm(undefined, { type: "income", scope: scope || "business" })}>
            <Icon name="plus" size={16} /> Income
          </button>
          <button class="btn sm press grow" style="background:var(--danger-soft);color:var(--danger)" onClick={() => openTransactionForm(undefined, { type: "expense", scope: scope || "personal" })}>
            <Icon name="plus" size={16} /> Expense
          </button>
        </div>
      </div>

      {byCategory.length > 0 && (
        <section class="section">
          <div class="section-head">
            <h2>Where it went</h2>
          </div>
          <div class="card rise" style={{ "--i": 1 } as never}>
            <BarList items={byCategory.map(([label, value]) => ({ label, value, display: money(value, "PKR", value >= 100000) }))} />
          </div>
        </section>
      )}

      <section class="section">
        <div class="section-head">
          <h2>Entries</h2>
          <span class="t-footnote c3">{(data?.txs.length ?? 0) + (data?.loans.length ?? 0)}</span>
        </div>
        {data && days.length === 0 ? (
          <Empty icon="wallet" title="Nothing this month" text="Add what you earn and spend, personal and business. Deal payments show up here automatically." />
        ) : (
          days.map(([day, items]) => {
            const dayNet = items.reduce((s, e) => s + eSigned(e), 0);
            return (
              <div key={day} class="mt12">
                <div class="row between" style="padding:0 16px 6px">
                  <span class="t-footnote c3" style="text-transform:uppercase;letter-spacing:.04em">{dayLabel(day)}</span>
                  <span class={`t-footnote num ${dayNet >= 0 ? "c-success" : "c3"}`}>
                    {dayNet >= 0 ? "+" : "−"}
                    {money(Math.abs(dayNet))}
                  </span>
                </div>
                <div class="group">
                  {items.map((e) =>
                    e.kind === "tx" ? (
                      <TxRow key={e.t.id} t={e.t} i={idx++} contactName={e.t.contactId ? data!.names.get(e.t.contactId) : undefined} />
                    ) : (
                      <LoanRow key={e.m.id} m={e.m} i={idx++} />
                    ),
                  )}
                </div>
              </div>
            );
          })
        )}
      </section>
      <p class="t-footnote c3" style="text-align:center;padding:16px 8px 0">Money you lend, borrow or get back shows here too. Tap a loan to see who still owes what.</p>
    </>
  );
}
