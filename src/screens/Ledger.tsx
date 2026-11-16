// Money: who owes me, whom I owe. Covers credit clients (receivables from won
// deals), credit purchases, and personal loans in both directions.
import { useMemo, useState } from "preact/hooks";
import { db, type LedgerEntry } from "../db/schema";
import { deleteLedgerEntry, deletePayment, restoreSnapshot, settleEntry, withBalance, type EntryWithBalance } from "../db/repo";
import { useCountUp, useLive, useStoredState } from "../lib/hooks";
import { money, shortDate } from "../lib/format";
import { back, navigate, switchTab } from "../lib/router";
import { waHref } from "../lib/whatsapp";
import { telHref } from "../lib/sanitize";
import { Icon } from "../ui/icons";
import { Avatar, Badge, Empty, Group, Row, Screen, Segmented, SkeletonList, SwipeRow } from "../ui/kit";
import { actionSheet, confirmSheet, toast, undoToast } from "../ui/overlay";
import { openLedgerForm, openPaymentForm, openTransactionForm } from "./forms";
import { confirmDelete } from "./shared";
import { CashFlowView } from "./CashFlow";

type View = "in" | "out" | "settled";

async function loadLedger() {
  const [entries, payments] = await Promise.all([db.ledger.orderBy("date").reverse().toArray(), db.payments.toArray()]);
  return entries.map((e) => withBalance(e, payments));
}

/** Friendly WhatsApp reminder, in the user's voice. */
export function reminderText(e: LedgerEntry, balance: number): string {
  const amt = money(balance, e.currency);
  if (e.direction === "in") {
    const due = e.dueDate ? ` (due ${shortDate(e.dueDate)})` : "";
    return `Assalam o Alaikum ${e.personName.split(" ")[0]}, a gentle reminder about the pending amount of ${amt}${due}. Please let me know when it's convenient. Thank you!`;
  }
  return `Assalam o Alaikum ${e.personName.split(" ")[0]}, about the ${amt} I owe you: `;
}

export function MoneySummary({ compact }: { compact?: boolean }) {
  const t = useLive(async () => {
    const all = await loadLedger();
    const open = all.filter((x) => !x.entry.settledAt && x.balance > 0);
    const sum = (d: "in" | "out") => open.filter((x) => x.entry.direction === d).reduce((s, x) => s + x.balance, 0);
    const people = (d: "in" | "out") => new Set(open.filter((x) => x.entry.direction === d).map((x) => x.entry.contactId ?? x.entry.personName.toLowerCase())).size;
    const overdue = open.filter((x) => x.entry.direction === "in" && x.overdue).reduce((s, x) => s + x.balance, 0);
    return { rec: sum("in"), pay: sum("out"), inP: people("in"), outP: people("out"), overdue };
  }, []);
  const rec = useCountUp(t?.rec ?? 0, 1100);
  const pay = useCountUp(t?.pay ?? 0, 1100);
  if (!t) return <div class="skel" style="height:116px;border-radius:22px" />;
  const go = (v: View) => {
    try {
      localStorage.setItem("covison.ledger.view", JSON.stringify(v));
      localStorage.setItem("covison.money.tab", JSON.stringify("owed"));
    } catch {
      /* ignore */
    }
    switchTab("/money");
  };
  return (
    <div class="money-cards">
      <button class="money-card in press rise" style={{ "--i": 1 } as never} onClick={() => go("in")}>
        <span class="mc-top">
          <span class="mc-ico">
            <Icon name="arrowDownLeft" size={16} stroke={2.6} />
          </span>
          People owe you
        </span>
        <span class="mc-value t-metric">{money(rec, "PKR", rec >= 10_000_000)}</span>
        <span class="mc-sub">
          {t.inP} {t.inP === 1 ? "person" : "people"}
          {t.overdue > 0 && !compact && <strong> · {money(t.overdue, "PKR", true)} overdue</strong>}
        </span>
      </button>
      <button class="money-card out press rise" style={{ "--i": 2 } as never} onClick={() => go("out")}>
        <span class="mc-top">
          <span class="mc-ico">
            <Icon name="arrowUpRight" size={16} stroke={2.6} />
          </span>
          You owe
        </span>
        <span class="mc-value t-metric">{money(pay, "PKR", pay >= 10_000_000)}</span>
        <span class="mc-sub">
          {t.outP} {t.outP === 1 ? "person" : "people"}
        </span>
      </button>
    </div>
  );
}

function EntryRow({ x, i }: { x: EntryWithBalance; i: number }) {
  const e = x.entry;
  const pct = e.amount > 0 ? Math.min(1, x.paid / e.amount) : 0;
  const wa = waHref(e.phone, reminderText(e, x.balance));
  return (
    <SwipeRow
      i={i}
      actions={[
        ...(wa && !e.settledAt ? [{ label: "WhatsApp", icon: "whatsapp" as const, tone: "success" as const, run: () => (location.href = wa) }] : []),
        {
          label: "Delete",
          icon: "trash",
          tone: "danger",
          run: () => void confirmDelete("entry", () => deleteLedgerEntry(e.id), undefined, "Its payment history is removed too."),
        },
      ]}
    >
      <Row
        onClick={() => navigate(`/money/${e.id}`)}
        lead={<Avatar name={e.personName} />}
        title={e.personName}
        sub={
          <span class="row gap4" style="gap:6px">
            <span>{e.kind === "loan" ? "Loan" : "Credit"}</span>
            {e.settledAt ? (
              <span>· settled {shortDate(e.settledAt)}</span>
            ) : x.overdue ? (
              <span class="c-danger">· overdue since {shortDate(e.dueDate)}</span>
            ) : e.dueDate ? (
              <span>· due {shortDate(e.dueDate)}</span>
            ) : (
              <span>· {shortDate(e.date)}</span>
            )}
          </span>
        }
        trail={
          <span class="col" style="align-items:flex-end;gap:4px;flex-shrink:0">
            <span class={`num t-headline ${e.settledAt ? "c3" : e.direction === "in" ? "c-success" : "c-danger"}`}>{money(e.settledAt ? e.amount : x.balance, e.currency)}</span>
            {!e.settledAt && x.paid > 0 && (
              <span class="mini-track" aria-label={`${Math.round(pct * 100)}% paid`}>
                <span style={{ width: `${pct * 100}%` }} />
              </span>
            )}
          </span>
        }
        chevron={false}
      />
    </SwipeRow>
  );
}

export function MoneyScreen() {
  const [tab, setTab] = useStoredState<"flow" | "owed">("money.tab", "flow");
  return (
    <Screen
      title="Money"
      subtitle={tab === "flow" ? "Earnings and expenses" : "Credit clients and personal loans"}
      right={
        <button
          class="nav-btn"
          aria-label="Add money entry"
          onClick={() =>
            actionSheet([
              { label: "Add expense", icon: "arrowUpRight", run: () => openTransactionForm(undefined, { type: "expense" }) },
              { label: "Add income", icon: "arrowDownLeft", run: () => openTransactionForm(undefined, { type: "income", scope: "business" }) },
              { label: "Loan or credit (owed)", icon: "handshake", run: () => openLedgerForm() },
            ])
          }
        >
          <Icon name="plus" size={26} />
        </button>
      }
    >
      <div class="content">
        <Segmented<"flow" | "owed">
          value={tab}
          onChange={setTab}
          options={[
            { value: "flow", label: "Cash flow" },
            { value: "owed", label: "Owed" },
          ]}
        />
        <div class="mt16" key={tab}>
          {tab === "flow" ? <CashFlowView /> : <OwedView />}
        </div>
      </div>
    </Screen>
  );
}

function OwedView() {
  const all = useLive(loadLedger, []);
  const [view, setView] = useStoredState<View>("ledger.view", "in");
  const [kind, setKind] = useStoredState<"" | "loan" | "credit">("ledger.kind", "");

  const list = useMemo(() => {
    if (!all) return undefined;
    return all.filter((x) => {
      const settled = !!x.entry.settledAt;
      if (view === "settled" ? !settled : settled || x.entry.direction !== view) return false;
      return !kind || x.entry.kind === kind;
    });
  }, [all, view, kind]);
  const total = (list ?? []).reduce((s, x) => s + (x.entry.settledAt ? 0 : x.balance), 0);

  return (
    <>
        <MoneySummary />
        <div class="mt16">
          <Segmented<View>
            value={view}
            onChange={setView}
            options={[
              { value: "in", label: "Owed to me" },
              { value: "out", label: "I owe" },
              { value: "settled", label: "Settled" },
            ]}
          />
        </div>
        <div class="chips mt12">
          <button class="chip press" aria-pressed={!kind} onClick={() => setKind("")}>
            All
          </button>
          <button class="chip press" aria-pressed={kind === "credit"} onClick={() => setKind(kind === "credit" ? "" : "credit")}>
            Credit
          </button>
          <button class="chip press" aria-pressed={kind === "loan"} onClick={() => setKind(kind === "loan" ? "" : "loan")}>
            Personal loans
          </button>
        </div>
        {!list ? (
          <SkeletonList rows={4} />
        ) : list.length === 0 ? (
          <Empty
            icon="wallet"
            title={view === "settled" ? "Nothing settled yet" : view === "in" ? "Nobody owes you" : "You don't owe anyone"}
            text={
              view === "settled"
                ? "Fully paid entries move here."
                : "Add a personal loan or a credit sale. Deals won with credit clients can add themselves here."
            }
            action={
              view !== "settled" && (
                <button class="btn primary sm press" onClick={() => openLedgerForm(undefined, { direction: view })}>
                  Add entry
                </button>
              )
            }
          />
        ) : (
          <>
            {view !== "settled" && (
              <div class="row between" style="padding:4px 4px 8px">
                <span class="t-overline">{list.length} open</span>
                <span class={`t-subhead num ${view === "in" ? "c-success" : "c-danger"}`} style="font-weight:600">
                  {money(total)}
                </span>
              </div>
            )}
            <div class="group">
              {list.map((x, i) => (
                <EntryRow key={x.entry.id} x={x} i={i} />
              ))}
            </div>
          </>
        )}
    </>
  );
}

export function LedgerDetail({ id }: { id: string }) {
  const data = useLive(async () => {
    const e = await db.ledger.get(id);
    if (!e) return null;
    const payments = await db.payments.where("entryId").equals(id).toArray();
    const deal = e.dealId ? await db.deals.get(e.dealId) : undefined;
    return { x: withBalance(e, payments), deal };
  }, [id]);
  const [busy, setBusy] = useState(false);

  if (data === undefined) return <Screen title="" backLabel="Money" large={false}><div /></Screen>;
  if (data === null)
    return (
      <Screen title="Entry" backLabel="Back" large={false}>
        <Empty icon="wallet" title="Entry not found" />
      </Screen>
    );
  const { x, deal } = data;
  const e = x.entry;
  const pct = e.amount > 0 ? Math.min(1, x.paid / e.amount) : 0;
  const wa = waHref(e.phone, reminderText(e, x.balance));
  const tel = telHref(e.phone);
  const inbound = e.direction === "in";

  return (
    <Screen
      title={e.personName}
      backLabel="Money"
      backTo="/money"
      large={false}
      right={
        <>
          <button class="nav-btn" onClick={() => openLedgerForm(e)}>
            Edit
          </button>
          <button
            class="nav-btn"
            aria-label="Options"
            onClick={() =>
              actionSheet([
                { label: "Delete entry", icon: "trash", destructive: true, run: () => void confirmDelete("entry", () => deleteLedgerEntry(e.id), () => back("/money"), "Its payment history is removed too.") },
              ])
            }
          >
            <Icon name="more" size={24} />
          </button>
        </>
      }
    >
      <div class="content">
        <div class={`hero ${inbound ? "hero-in" : "hero-out"} rise`} style={{ "--i": 0, paddingBottom: "20px" } as never}>
          <div class="row between">
            <span class="h-label">{e.settledAt ? "Settled" : inbound ? `${e.personName.split(" ")[0]} owes you` : `You owe ${e.personName.split(" ")[0]}`}</span>
            <Badge tone="neutral">{e.kind === "loan" ? "Personal loan" : "Credit"}</Badge>
          </div>
          <div class="h-value t-metric selectable">{money(e.settledAt ? e.amount : x.balance, e.currency)}</div>
          <div class="h-sub">
            {e.settledAt ? `Paid in full · ${shortDate(e.settledAt)}` : `of ${money(e.amount, e.currency)} · ${money(x.paid, e.currency)} paid`}
          </div>
          <div class="mt16" style="height:6px;border-radius:3px;background:rgb(255 255 255 / .25);overflow:hidden">
            <div style={{ height: "100%", width: `${Math.max(3, pct * 100)}%`, background: "#fff", borderRadius: "3px", transformOrigin: "left", animation: "grow-x 900ms var(--ease-out) both" }} />
          </div>
        </div>

        {!e.settledAt && (
          <div class="row gap8 mt12">
            <button class="btn primary block press" style="flex:1.4" onClick={() => openPaymentForm(e, x.balance)}>
              <Icon name="plus" size={20} />
              {inbound ? "Payment received" : "Payment made"}
            </button>
            {wa && (
              <a class="btn wa press" href={wa} aria-label="WhatsApp">
                <Icon name="whatsapp" size={20} />
                {inbound ? "Remind" : "Chat"}
              </a>
            )}
          </div>
        )}

        <Group class="section">
          {e.contactId ? (
            <Row title={e.personName} sub="contact" lead={<Avatar name={e.personName} />} onClick={() => navigate(`/contacts/${e.contactId}`)} />
          ) : (
            <Row title={e.personName} sub="person" lead={<Avatar name={e.personName} />} chevron={false} />
          )}
          {e.phone && <Row title={<span class="selectable">{e.phone}</span>} sub="phone" href={tel} chevron={false} />}
          {deal && <Row title={deal.name} sub="from deal" onClick={() => navigate(`/deals/${deal.id}`)} />}
          <Row title={shortDate(e.date)} sub={inbound ? "lent / sold on" : "borrowed / bought on"} chevron={false} />
          {e.dueDate && <Row title={<span class={x.overdue ? "c-danger" : ""}>{shortDate(e.dueDate)}{x.overdue ? " · overdue" : ""}</span>} sub="due by" chevron={false} />}
          {e.note && <Row title={<span class="pre selectable">{e.note}</span>} sub="note" chevron={false} />}
        </Group>

        <section class="section">
          <div class="section-head">
            <h2>Payments</h2>
            {!e.settledAt && (
              <button
                class="link"
                disabled={busy}
                onClick={async () => {
                  if (!(await confirmSheet({ title: `Mark as fully paid?`, message: `Records ${money(x.balance, e.currency)} as paid today.`, confirm: "Mark as settled" }))) return;
                  setBusy(true);
                  await settleEntry(e.id);
                  setBusy(false);
                  toast("Settled 🎉", { icon: "checkCircle" });
                }}
              >
                Settle all
              </button>
            )}
          </div>
          {x.payments.length ? (
            <div class="group">
              {x.payments.map((p, i) => (
                <SwipeRow
                  key={p.id}
                  i={i}
                  actions={[
                    {
                      label: "Delete",
                      icon: "trash",
                      tone: "danger",
                      run: async () => {
                        const snap = await deletePayment(p.id);
                        undoToast("Payment deleted", () => restoreSnapshot(snap));
                      },
                    },
                  ]}
                >
                  <Row
                    lead={
                      <span class="tile green">
                        <Icon name="check" size={16} />
                      </span>
                    }
                    title={money(p.amount, e.currency)}
                    sub={[shortDate(p.date), p.note].filter(Boolean).join(" · ")}
                    chevron={false}
                  />
                </SwipeRow>
              ))}
            </div>
          ) : (
            <p class="t-subhead c3" style="padding:0 4px">No payments yet. Partial payments are fine; record each one as it comes.</p>
          )}
        </section>
      </div>
    </Screen>
  );
}

/** Money section on a contact's page. */
export function ContactMoney({ contactId, name, phone }: { contactId: string; name: string; phone?: string }) {
  const rows = useLive(async () => {
    const [entries, payments] = await Promise.all([db.ledger.where("contactId").equals(contactId).toArray(), db.payments.toArray()]);
    return entries.map((e) => withBalance(e, payments)).sort((a, b) => Number(!!a.entry.settledAt) - Number(!!b.entry.settledAt) || b.entry.date.localeCompare(a.entry.date));
  }, [contactId]);
  const owes = (rows ?? []).filter((x) => !x.entry.settledAt && x.entry.direction === "in").reduce((s, x) => s + x.balance, 0);
  const owe = (rows ?? []).filter((x) => !x.entry.settledAt && x.entry.direction === "out").reduce((s, x) => s + x.balance, 0);
  return (
    <section class="section">
      <div class="section-head">
        <h2>Money</h2>
        <button class="link" onClick={() => openLedgerForm(undefined, { contactId, personName: name, phone, direction: "in", kind: "credit" })}>
          Add
        </button>
      </div>
      {(owes > 0 || owe > 0) && (
        <div class="row gap8" style="padding:0 4px 10px">
          {owes > 0 && <Badge tone="success">Owes you {money(owes)}</Badge>}
          {owe > 0 && <Badge tone="danger">You owe {money(owe)}</Badge>}
        </div>
      )}
      {rows && rows.length ? (
        <div class="group">
          {rows.map((x, i) => (
            <EntryRow key={x.entry.id} x={x} i={i} />
          ))}
        </div>
      ) : (
        <p class="t-subhead c3" style="padding:0 4px">No credit or loans with {name.split(" ")[0]}.</p>
      )}
    </section>
  );
}
