// Accounts: banks, wallets and cash, with live balances, transfers, and the
// Home cards for "money you have" and "money owed to you".
import { useMemo, useState } from "preact/hooks";
import { db, type Account } from "../db/schema";
import { accountBalances, balanceTotals, deleteTransfer, monthFlows, owedSummary, removeAccount, type AccountWithBalance, type Flow } from "../db/accounts";
import { restoreSnapshot } from "../db/repo";
import { useCountUp, useLive } from "../lib/hooks";
import { money, shortDate } from "../lib/format";
import { back, navigate, switchTab } from "../lib/router";
import { Icon, type IconName } from "../ui/icons";
import { Empty, Group, Row, Screen } from "../ui/kit";
import { actionSheet, confirmSheet, toast, undoToast } from "../ui/overlay";
import { openAccountForm, openTransferForm } from "./moneyForms";
import { openTransactionForm } from "./forms";

const KIND_ICON: Record<Account["kind"], IconName> = { bank: "building", wallet: "wallet", cash: "dollar" };
const KIND_LABEL: Record<Account["kind"], string> = { bank: "Bank", wallet: "Wallet", cash: "Cash" };
const SCOPE_GRAD = {
  business: "linear-gradient(135deg,#4f46e5,#6d4aff)",
  personal: "linear-gradient(135deg,#c2367a,#f472b6)",
};

function goMoney(tab: "accounts" | "flow" | "owed", owedTab?: string) {
  try {
    localStorage.setItem("covison.money.tab", JSON.stringify(tab));
    if (owedTab) localStorage.setItem("covison.owed.tab", JSON.stringify(owedTab));
  } catch {
    /* ignore */
  }
  switchTab("/money");
}

// ---------------- Home cards ----------------
/** Total money across all accounts, split business / personal. */
export function BalanceCard() {
  const t = useLive(balanceTotals, []);
  const total = useCountUp(t?.total ?? 0, 1200);
  if (!t) return <div class="skel" style="height:150px;border-radius:28px" />;
  if (t.count === 0)
    return (
      <button class="card press-soft rise" style={{ "--i": 0, width: "100%", textAlign: "left", display: "block" } as never} onClick={() => openAccountForm()}>
        <div class="row">
          <span class="tile violet">
            <Icon name="wallet" size={18} />
          </span>
          <div class="grow">
            <p class="t-headline">Add your accounts</p>
            <p class="t-subhead c2 mt4">Meezan Bank, NayaPay, cash… Enter what's in each now and see your total here.</p>
          </div>
          <Icon name="plus" size={20} class="c-brand" />
        </div>
      </button>
    );
  return (
    <button class="hero balance-hero press-soft rise" style={{ "--i": 0, width: "100%", textAlign: "left", display: "block", paddingBottom: "18px" } as never} onClick={() => goMoney("accounts")}>
      <div class="row between">
        <span class="h-label">Money you have</span>
        <span class="t-footnote" style="opacity:.85">{t.count} account{t.count === 1 ? "" : "s"}</span>
      </div>
      <div class="h-value t-metric">{money(total)}</div>
      <div class="balance-split mt12">
        <span>
          <i style={{ background: "#c7d2fe" }} />
          Business <strong>{money(t.business)}</strong>
        </span>
        <span>
          <i style={{ background: "#fbcfe8" }} />
          Personal <strong>{money(t.personal)}</strong>
        </span>
      </div>
    </button>
  );
}

/** Money owed to me (business vs personal) and what I owe. */
export function OwedCard() {
  const o = useLive(owedSummary, []);
  const b = useCountUp(o?.businessTotal ?? 0, 1100);
  const p = useCountUp(o?.personalTotal ?? 0, 1100);
  if (!o) return null;
  return (
    <div class="owed-card rise" style={{ "--i": 1 } as never}>
      <div class="row between" style="padding:2px 4px 8px">
        <span class="t-overline">Owed to you</span>
        <span class="t-footnote c-success num" style="font-weight:700">{money(o.businessTotal + o.personalTotal)}</span>
      </div>
      <div class="money-cards">
        <button class="money-card in press" onClick={() => goMoney("owed", "business")}>
          <span class="mc-top">
            <span class="mc-ico">
              <Icon name="building" size={14} stroke={2.4} />
            </span>
            Business
          </span>
          <span class="mc-value t-metric">{money(b)}</span>
          <span class="mc-sub">
            {o.businessPeople} client{o.businessPeople === 1 ? "" : "s"}
            {o.unagreed > 0 ? ` · ${o.unagreed} total not agreed` : ""}
          </span>
        </button>
        <button class="money-card personal press" onClick={() => goMoney("owed", "personal")}>
          <span class="mc-top">
            <span class="mc-ico">
              <Icon name="users" size={14} stroke={2.4} />
            </span>
            Personal
          </span>
          <span class="mc-value t-metric">{money(p)}</span>
          <span class="mc-sub">
            {o.personalPeople} {o.personalPeople === 1 ? "person" : "people"}
          </span>
        </button>
      </div>
      {o.iOweTotal > 0 && (
        <button class="row between press-soft iowe-row" onClick={() => goMoney("owed", "iowe")}>
          <span class="row gap8">
            <span class="mc-ico out">
              <Icon name="arrowUpRight" size={14} stroke={2.6} />
            </span>
            <span class="t-subhead">You owe</span>
          </span>
          <span class="row gap4">
            <span class="t-subhead c-danger num" style="font-weight:700">{money(o.iOweTotal)}</span>
            <Icon name="chevronRight" size={16} class="c3" />
          </span>
        </button>
      )}
    </div>
  );
}

// ---------------- money in / out ----------------
function FlowSide({ label, f, tone }: { label: string; f: Flow; tone: "business" | "personal" }) {
  const inn = useCountUp(f.in, 1000);
  const out = useCountUp(f.out, 1000);
  return (
    <div class={`flow-side ${tone}`}>
      <span class="flow-head">
        <i />
        {label}
      </span>
      <span class="flow-line in">
        <Icon name="arrowDownLeft" size={13} stroke={2.6} />
        <em>In</em>
        <span class="num">{money(inn)}</span>
      </span>
      <span class="flow-line out">
        <Icon name="arrowUpRight" size={13} stroke={2.6} />
        <em>Out</em>
        <span class="num">{money(out)}</span>
      </span>
      <span class={`flow-net num ${f.net >= 0 ? "c-success" : "c-danger"}`}>
        {f.net >= 0 ? "+" : "−"}
        {money(Math.abs(f.net))} net
      </span>
    </div>
  );
}

/** Money in and out of your business and personal accounts for a month. */
export function FlowCard({ switcher, i = 2 }: { switcher?: boolean; i?: number }) {
  const now = new Date();
  const [ym, setYm] = useState<[number, number]>([now.getFullYear(), now.getMonth()]);
  const f = useLive(() => monthFlows(ym[0], ym[1]), [ym[0], ym[1]]);
  const hasAccounts = useLive(async () => (await db.accounts.count()) > 0, []);
  if (!f || hasAccounts === false) return null;
  const isCurrent = ym[0] === now.getFullYear() && ym[1] === now.getMonth();
  const shift = (d: number) =>
    setYm(([y, m]) => {
      const n = new Date(y, m + d, 1);
      return [n.getFullYear(), n.getMonth()];
    });
  const label = new Date(ym[0], ym[1], 1).toLocaleDateString(undefined, switcher ? { month: "long", year: "numeric" } : { month: "long" });
  return (
    <div class="card flow-card rise mt12" style={{ "--i": i } as never}>
      <div class="row between" style="margin-bottom:10px">
        {switcher ? (
          <>
            <button class="icon-btn press" aria-label="Previous month" onClick={() => shift(-1)}>
              <Icon name="chevronLeft" size={16} stroke={2.4} />
            </button>
            <span class="t-headline">{label}</span>
            <button class="icon-btn press" aria-label="Next month" style={isCurrent ? { opacity: 0.35 } : undefined} onClick={() => !isCurrent && shift(1)}>
              <Icon name="chevronRight" size={16} stroke={2.4} />
            </button>
          </>
        ) : (
          <>
            <span class="t-overline">Money in &amp; out · {label}</span>
            <button class="t-footnote c-brand" onClick={() => goMoney("accounts")}>
              Details
            </button>
          </>
        )}
      </div>
      <div class="flow-grid">
        <FlowSide label="Business" f={f.business} tone="business" />
        <FlowSide label="Personal" f={f.personal} tone="personal" />
      </div>
      <div class="flow-total row between">
        <span class="t-footnote c3">
          All accounts · in <strong class="c-success num">{money(f.total.in)}</strong> · out <strong class="c-danger num">{money(f.total.out)}</strong>
        </span>
      </div>
    </div>
  );
}

// ---------------- Money → Accounts ----------------
function AccountRow({ x, i }: { x: AccountWithBalance; i: number }) {
  const a = x.account;
  return (
    <Row
      i={i}
      onClick={() => navigate(`/accounts/${a.id}`)}
      lead={
        <span class="tile" style={{ background: SCOPE_GRAD[a.scope], width: "36px", height: "36px", borderRadius: "10px" }}>
          <Icon name={KIND_ICON[a.kind]} size={18} />
        </span>
      }
      title={a.name}
      sub={`${KIND_LABEL[a.kind]} · ${x.movements.length} movement${x.movements.length === 1 ? "" : "s"}`}
      value={<span class={`num ${x.balance < 0 ? "c-danger" : ""}`} style="color:var(--text);font-weight:600">{money(x.balance)}</span>}
    />
  );
}

export function AccountsView() {
  const t = useLive(balanceTotals, []);
  const groups = useMemo(() => {
    const list = t?.list ?? [];
    return (["business", "personal"] as const).map((s) => ({ scope: s, items: list.filter((x) => x.account.scope === s) }));
  }, [t]);
  if (!t) return <div class="skel" style="height:200px;border-radius:22px" />;
  let i = 0;
  return (
    <>
      <BalanceCard />
      {t.count > 0 && (
        <div class="row gap8 mt12">
          <button class="btn tinted sm grow press" onClick={() => openTransferForm()}>
            <Icon name="refresh" size={16} /> Transfer
          </button>
          <button class="btn plain sm grow press" onClick={() => openAccountForm()}>
            <Icon name="plus" size={16} /> Add account
          </button>
        </div>
      )}
      {t.count > 0 && <FlowCard switcher i={1} />}
      {t.count === 0 ? (
        <Empty
          icon="wallet"
          title="No accounts yet"
          text="Add each place you keep money (a bank, NayaPay, JazzCash, cash) with what's in it now. Mark each as business or personal."
          action={
            <button class="btn primary sm press" onClick={() => openAccountForm()}>
              Add first account
            </button>
          }
        />
      ) : (
        groups.map(
          (g) =>
            g.items.length > 0 && (
              <section class="section" key={g.scope}>
                <div class="section-head">
                  <h2>{g.scope === "business" ? "Business" : "Personal"}</h2>
                  <span class="t-subhead num" style="font-weight:600">
                    {money(g.items.reduce((s, x) => s + x.balance, 0))}
                  </span>
                </div>
                <div class="group">
                  {g.items.map((x) => (
                    <AccountRow key={x.account.id} x={x} i={i++} />
                  ))}
                </div>
              </section>
            ),
        )
      )}
    </>
  );
}

// ---------------- account detail ----------------
export function AccountDetail({ id }: { id: string }) {
  const data = useLive(async () => {
    const all = await accountBalances(true);
    return all.find((x) => x.account.id === id) ?? null;
  }, [id]);
  const bal = useCountUp(data?.balance ?? 0, 900);
  const now = new Date();
  const flows = useLive(() => monthFlows(now.getFullYear(), now.getMonth()), []);
  const mine = flows?.byAccount.get(id);

  if (data === undefined) return <Screen title="" backLabel="Money" large={false}><div /></Screen>;
  if (data === null)
    return (
      <Screen title="Account" backLabel="Back" large={false}>
        <Empty icon="wallet" title="Account not found" />
      </Screen>
    );
  const a = data.account;
  const byDay = new Map<string, typeof data.movements>();
  data.movements.forEach((m) => byDay.set(m.date, [...(byDay.get(m.date) ?? []), m]));
  let i = 0;

  return (
    <Screen
      title={a.name}
      backLabel="Money"
      backTo="/money"
      large={false}
      right={
        <>
          <button class="nav-btn" onClick={() => openAccountForm(a)}>
            Edit
          </button>
          <button
            class="nav-btn"
            aria-label="Options"
            onClick={() =>
              actionSheet([
                {
                  label: a.archived ? "Account is archived" : "Remove account",
                  icon: "trash",
                  destructive: true,
                  run: async () => {
                    if (a.archived) return;
                    const ok = await confirmSheet({
                      title: `Remove ${a.name}?`,
                      message: data.movements.length ? "It has history, so it will be archived (hidden) and its past entries keep their account." : "It has no history and will be deleted.",
                      confirm: "Remove",
                      destructive: true,
                    });
                    if (!ok) return;
                    const r = await removeAccount(a.id);
                    back("/money");
                    undoToast(r.archived ? "Account archived" : "Account deleted", () => restoreSnapshot(r.snap));
                  },
                },
              ])
            }
          >
            <Icon name="more" size={24} />
          </button>
        </>
      }
    >
      <div class="content">
        <div class="hero rise" style={{ "--i": 0, paddingBottom: "20px", background: a.scope === "business" ? undefined : "radial-gradient(120% 140% at 100% 100%, rgb(251 207 232 / .5), transparent 55%), linear-gradient(135deg,#9d174d,#c2367a 55%,#f472b6)" } as never}>
          <div class="row between">
            <span class="h-label">
              {KIND_LABEL[a.kind]} · {a.scope === "business" ? "Business" : "Personal"}
            </span>
            <Icon name={KIND_ICON[a.kind]} size={20} />
          </div>
          <div class="h-value t-metric">{money(bal)}</div>
          <div class="h-sub">
            Started with {money(a.openingBalance)} on {shortDate(a.openingDate)}
          </div>
          {mine && (
            <div class="balance-split mt12">
              <span>
                {now.toLocaleDateString(undefined, { month: "long" })}: in <strong>{money(mine.in)}</strong>
              </span>
              <span>
                out <strong>{money(mine.out)}</strong>
              </span>
            </div>
          )}
        </div>
        <div class="row gap8 mt12">
          <button class="btn sm grow press" style="background:var(--success-soft);color:var(--success)" onClick={() => openTransactionForm(undefined, { type: "income", scope: a.scope, accountId: a.id })}>
            <Icon name="plus" size={16} /> In
          </button>
          <button class="btn sm grow press" style="background:var(--danger-soft);color:var(--danger)" onClick={() => openTransactionForm(undefined, { type: "expense", scope: a.scope, accountId: a.id })}>
            <Icon name="plus" size={16} /> Out
          </button>
          <button class="btn tinted sm grow press" onClick={() => openTransferForm({ fromAccountId: a.id })}>
            <Icon name="refresh" size={16} /> Transfer
          </button>
        </div>

        <section class="section">
          <div class="section-head">
            <h2>History</h2>
            <span class="t-footnote c3">{data.movements.length}</span>
          </div>
          {data.movements.length === 0 ? (
            <p class="t-subhead c3" style="padding:0 4px">No movements yet. Payments, expenses, transfers and loans you book to {a.name} appear here.</p>
          ) : (
            [...byDay.entries()].map(([day, items]) => (
              <Group key={day} label={shortDate(day)} class="mt12">
                {items.map((m) => (
                  <Row
                    key={m.id}
                    i={i++}
                    onClick={
                      m.kind === "transfer"
                        ? async () => {
                            const tid = m.id.replace(/-(in|out)$/, "");
                            if (!(await confirmSheet({ title: "Delete this transfer?", message: "Both accounts are updated.", confirm: "Delete", destructive: true }))) return;
                            const snap = await deleteTransfer(tid);
                            undoToast("Transfer deleted", () => restoreSnapshot(snap));
                          }
                        : m.link
                          ? () => navigate(m.link!)
                          : m.kind === "income" || m.kind === "expense"
                            ? async () => {
                                const t = await db.transactions.get(m.id);
                                if (t) openTransactionForm(t);
                                else toast("Entry not found", { error: true });
                              }
                            : undefined
                    }
                    lead={
                      <span class="tile" style={{ background: m.amount >= 0 ? "linear-gradient(135deg,#149a68,#42d39a)" : "linear-gradient(135deg,#d13a46,#ff737d)" }}>
                        <Icon name={m.kind === "transfer" ? "refresh" : m.amount >= 0 ? "arrowDownLeft" : "arrowUpRight"} size={16} stroke={2.6} />
                      </span>
                    }
                    title={m.label}
                    sub={m.sub}
                    trail={
                      <span class={`num t-headline ${m.amount >= 0 ? "c-success" : ""}`} style="flex-shrink:0">
                        {m.amount >= 0 ? "+" : "−"}
                        {money(Math.abs(m.amount))}
                      </span>
                    }
                    chevron={false}
                  />
                ))}
              </Group>
            ))
          )}
        </section>
      </div>
    </Screen>
  );
}
