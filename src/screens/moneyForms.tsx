// Forms for accounts, transfers, and the "deal won" flow.
import { useState } from "preact/hooks";
import { db, type Account, type Deal, type Project, type ProjectStatus } from "../db/schema";
import { recordProjectIncome, setProjectAgreed } from "../db/projects";
import { lastAccountId, listAccounts, rememberAccount, saveAccount, saveTransfer } from "../db/accounts";
import { logActivity, recordDealPayment, saveContact, saveProject, setDealAgreed, todayYmd } from "../db/repo";
import { useLive } from "../lib/hooks";
import { money } from "../lib/format";
import { MAX_LONG, optText } from "../lib/sanitize";
import { Group, Segmented, SelectField, TextArea, TextField } from "../ui/kit";
import { openSheet, toast } from "../ui/overlay";
import { Icon } from "../ui/icons";

type Binding = { current: (() => Promise<boolean | void>) | null };

function openForm(title: string, body: (bind: Binding) => preact.ComponentChildren, saveLabel = "Save") {
  const bind: Binding = { current: null };
  openSheet(() => body(bind), { title, full: true, done: { label: saveLabel, run: () => (bind.current ? bind.current() : undefined) } });
}
const num = (s: string): number | undefined => {
  if (!s.trim()) return undefined;
  const n = Number(s.replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};
function fail(msg: string): false {
  toast(msg, { error: true });
  return false;
}

const KIND_LABEL: Record<Account["kind"], string> = { bank: "Bank", wallet: "Wallet", cash: "Cash" };

// ---------------- account picker ----------------
/**
 * Account select used on every money form. Remembers the last account used.
 * "+ Add new account…" opens the account form without losing the current form.
 */
export function AccountSelect({
  value,
  onChange,
  label = "Account",
  optional,
}: {
  value: string;
  onChange: (id: string, acc?: Account) => void;
  label?: string;
  optional?: boolean;
}) {
  const accounts = useLive(() => listAccounts(), []);
  return (
    <SelectField
      label={label}
      value={value}
      placeholder={optional ? "Not tracked" : accounts && accounts.length ? "Choose…" : "Add an account first"}
      onChange={(v) => {
        if (v === "__new") {
          openAccountForm(undefined, (id) => onChange(id));
          return;
        }
        onChange(v, accounts?.find((a) => a.id === v));
      }}
      options={[
        ...(accounts ?? []).map((a) => ({ value: a.id, label: `${a.name} · ${a.scope === "business" ? "Business" : "Personal"}` })),
        { value: "__new", label: "+ Add new account…" },
      ]}
    />
  );
}

/** Default account for a new money form: the last one used, if it still exists. */
export function useDefaultAccount(initial?: string): [string, (v: string) => void] {
  const accounts = useLive(() => listAccounts(), []);
  const [v, setV] = useState(initial ?? "");
  const [touched, setTouched] = useState(!!initial);
  const fallback = !touched && accounts ? accounts.find((a) => a.id === lastAccountId())?.id ?? (accounts.length === 1 ? accounts[0].id : "") : "";
  return [
    touched ? v : v || fallback,
    (x: string) => {
      setTouched(true);
      setV(x);
    },
  ];
}

// ---------------- account ----------------
export function openAccountForm(existing?: Account, onSaved?: (id: string) => void) {
  openForm(existing ? "Edit account" : "New account", (bind) => <AccountForm bind={bind} existing={existing} onSaved={onSaved} />);
}

function AccountForm({ bind, existing, onSaved }: { bind: Binding; existing?: Account; onSaved?: (id: string) => void }) {
  const [name, setName] = useState(existing?.name ?? "");
  const [kind, setKind] = useState<Account["kind"]>(existing?.kind ?? "bank");
  const [scope, setScope] = useState<Account["scope"]>(existing?.scope ?? "business");
  const [opening, setOpening] = useState(existing ? String(existing.openingBalance) : "");
  const [date, setDate] = useState(existing?.openingDate ?? todayYmd());
  bind.current = async () => {
    const n = optText(name, 60);
    if (!n) return fail("Give the account a name");
    const ob = num(opening) ?? 0;
    const id = await saveAccount({ id: existing?.id, name: n, kind, scope, openingBalance: ob, openingDate: date || todayYmd(), archived: existing?.archived });
    rememberAccount(id);
    toast(existing ? "Account updated" : `${n} added`, { icon: "wallet" });
    onSaved?.(id);
  };
  return (
    <div class="form">
      <Group>
        <TextField label="Name" value={name} onInput={setName} placeholder="e.g. Meezan Bank, NayaPay, Cash" autoFocus={!existing} maxLength={60} />
      </Group>
      <Segmented<Account["kind"]>
        value={kind}
        onChange={(k) => {
          setKind(k);
          if (k === "cash" && !name) setName("Cash");
        }}
        options={[
          { value: "bank", label: "Bank" },
          { value: "wallet", label: "Wallet" },
          { value: "cash", label: "Cash" },
        ]}
      />
      <Segmented<Account["scope"]>
        value={scope}
        onChange={setScope}
        options={[
          { value: "business", label: "Business" },
          { value: "personal", label: "Personal" },
        ]}
      />
      <Group footer="Enter what's in this account right now. From here on, payments, expenses and transfers you record keep it up to date.">
        <TextField label="Balance now (Rs)" value={opening} onInput={setOpening} inputMode="decimal" placeholder="0" />
        <TextField label="As of" value={date} onInput={setDate} type="date" />
      </Group>
    </div>
  );
}

// ---------------- transfer ----------------
export function openTransferForm(defaults: { fromAccountId?: string; toAccountId?: string } = {}) {
  openForm("Transfer", (bind) => <TransferForm bind={bind} defaults={defaults} />, "Move");
}

function TransferForm({ bind, defaults }: { bind: Binding; defaults: { fromAccountId?: string; toAccountId?: string } }) {
  const accounts = useLive(() => listAccounts(), []);
  const [from, setFrom] = useState(defaults.fromAccountId ?? "");
  const [to, setTo] = useState(defaults.toAccountId ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [note, setNote] = useState("");
  bind.current = async () => {
    const a = num(amount);
    if (!from || !to) return fail("Choose both accounts");
    if (from === to) return fail("Choose two different accounts");
    if (!a || a <= 0) return fail("Enter an amount");
    await saveTransfer({ fromAccountId: from, toAccountId: to, amount: a, date: date || todayYmd(), note: optText(note, 300) });
    const n = (id: string) => accounts?.find((x) => x.id === id)?.name ?? "";
    toast(`Moved ${money(a)} from ${n(from)} to ${n(to)}`, { icon: "arrowRight" });
  };
  const opts = (accounts ?? []).map((x) => ({ value: x.id, label: `${x.name} · ${KIND_LABEL[x.kind]}` }));
  return (
    <div class="form">
      <Group footer="A transfer between your own accounts isn't income or an expense; it only moves the balance.">
        <SelectField label="From" value={from} onChange={setFrom} placeholder="Choose…" options={opts} />
        <SelectField label="To" value={to} onChange={setTo} placeholder="Choose…" options={opts.filter((o) => o.value !== from)} />
        <TextField label="Amount (Rs)" value={amount} onInput={setAmount} inputMode="decimal" placeholder="0" autoFocus />
        <TextField label="Date" value={date} onInput={setDate} type="date" />
        <TextField label="Note" value={note} onInput={setNote} placeholder="Optional" />
      </Group>
    </div>
  );
}

// ---------------- money received on a deal / project ----------------
const PAYMENT_LABELS = ["Advance", "Delivery", "Instalment", "Extra work", "Final payment"];

export function openDealPaymentForm(deal: Deal, received: number) {
  openForm("Money received", (bind) => <DealPaymentForm bind={bind} deal={deal} received={received} />);
}

function DealPaymentForm({ bind, deal, received }: { bind: Binding; deal: Deal; received: number }) {
  const [agreed, setAgreed] = useState(deal.value ? String(deal.value) : "");
  const agreedNum = num(agreed) ?? 0;
  const left = Math.max(0, agreedNum - received);
  const [amount, setAmount] = useState(left ? String(left) : "");
  const [label, setLabel] = useState(received === 0 ? "Advance" : left > 0 ? "Delivery" : "Extra work");
  const [date, setDate] = useState(todayYmd());
  const [accountId, setAccountId] = useDefaultAccount();
  bind.current = async () => {
    const a = num(amount) ?? 0;
    const newAgreed = num(agreed) ?? 0;
    if (a < 0 || newAgreed < 0) return fail("Amounts can't be negative");
    if (a === 0 && newAgreed === (deal.value || 0)) return fail("Enter the money received, or change the agreed total");
    if (a > 0 && !accountId) return fail("Which account did the money go into?");
    if (newAgreed !== (deal.value || 0)) await setDealAgreed(deal.id, newAgreed);
    if (a > 0) {
      rememberAccount(accountId);
      await recordDealPayment(deal.id, a, date || todayYmd(), optText(label, 80) ?? "Payment", undefined, accountId);
    }
    const total = received + a;
    toast(
      a === 0
        ? `Agreed total set to ${money(newAgreed, deal.currency)}`
        : newAgreed > 0
          ? total > newAgreed
            ? `Received ${money(total, deal.currency)} (${money(total - newAgreed, deal.currency)} over the agreed total)`
            : `Received ${money(total, deal.currency)} of ${money(newAgreed, deal.currency)}`
          : `Received ${money(total, deal.currency)} so far`,
      { icon: "wallet" },
    );
  };
  return (
    <div class="form">
      <div class="row wrap gap8" style="padding:0 4px">
        {PAYMENT_LABELS.map((l) => (
          <button key={l} class="chip press" aria-pressed={label === l} onClick={() => setLabel(l)}>
            {l}
          </button>
        ))}
      </div>
      <Group label="Money received">
        <TextField label="Amount (Rs)" value={amount} onInput={setAmount} inputMode="decimal" placeholder="0" autoFocus />
        <AccountSelect value={accountId} onChange={setAccountId} label="Into account" />
        <TextField label="For" value={label} onInput={setLabel} placeholder="Advance, delivery…" />
        <TextField label="Date" value={date} onInput={setDate} type="date" />
      </Group>
      <Group label="Total agreed" footer={`Received so far: ${money(received, deal.currency)}. Leave the total empty if the price isn't fixed yet; you can change it at any stage.`}>
        <TextField label="Agreed (Rs)" value={agreed} onInput={setAgreed} inputMode="decimal" placeholder="Not agreed yet" />
      </Group>
    </div>
  );
}

// ---------------- deal won → project ----------------
/** Shown the moment a deal reaches a Won stage. */
export function openWonForm(deal: Deal) {
  openForm("🎉 Deal won", (bind) => <WonForm bind={bind} deal={deal} />, "Save");
}

function WonForm({ bind, deal }: { bind: Binding; deal: Deal }) {
  const contact = useLive(async () => (deal.contactId ? await db.contacts.get(deal.contactId) : undefined), [deal.contactId]);
  const [name, setName] = useState(deal.name);
  const [desc, setDesc] = useState(deal.description ?? "");
  const [agreed, setAgreed] = useState(deal.value ? String(deal.value) : "");
  const [advance, setAdvance] = useState("");
  const [accountId, setAccountId] = useDefaultAccount();
  bind.current = async () => {
    const projectName = optText(name, 120);
    if (!projectName) return fail("Give the project a name");
    const a = num(advance) ?? 0;
    const total = num(agreed) ?? 0;
    if (a > 0 && !accountId) return fail("Which account did the advance go into?");
    await db.deals.update(deal.id, { name: projectName, description: optText(desc, MAX_LONG), updatedAt: new Date().toISOString() });
    // (the project below starts as "Not started"; change it on the Projects tab)
    if (total !== (deal.value || 0)) await setDealAgreed(deal.id, total);
    const existing = await db.projects.where("dealId").equals(deal.id).first();
    if (!existing) {
      await saveProject({ name: projectName, dealId: deal.id, contactId: deal.contactId, description: optText(desc, MAX_LONG), status: "not_started" });
    } else {
      await db.projects.update(existing.id, { name: projectName, description: optText(desc, MAX_LONG), updatedAt: new Date().toISOString() });
    }
    if (deal.contactId && contact && contact.status !== "won") await saveContact({ ...contact, status: "won" });
    if (a > 0) {
      rememberAccount(accountId);
      await recordDealPayment(deal.id, a, todayYmd(), "Advance", undefined, accountId);
    }
    await logActivity({ type: "note", dealId: deal.id, body: `Project started: ${projectName}${total ? ` · agreed ${money(total, deal.currency)}` : ""}${a ? ` · advance ${money(a, deal.currency)}` : ""}` });
    toast(a > 0 ? `Project created · advance ${money(a, deal.currency)} recorded` : "Project created", { icon: "sparkles" });
  };
  return (
    <div class="form">
      <div class="banner brand">
        <Icon name="sparkles" size={22} class="b-ico" />
        <span>
          {contact ? <strong>{contact.name}</strong> : "This client"} is won. Set up the project; everything except the name is optional and can be changed later.
        </span>
      </div>
      <Group label="Project">
        <TextField label="Name" value={name} onInput={setName} placeholder="Required" autoFocus />
        <TextArea label="Description" value={desc} onInput={setDesc} placeholder="What will you deliver?" />
      </Group>
      <Group label="Money" footer="Leave the total empty if the price will be fixed at the end. Add more payments any time from the deal page.">
        <TextField label="Total agreed (Rs)" value={agreed} onInput={setAgreed} inputMode="decimal" placeholder="Not agreed yet" />
        <TextField label="Advance received" value={advance} onInput={setAdvance} inputMode="decimal" placeholder="0 (none)" />
        {(num(advance) ?? 0) > 0 && <AccountSelect value={accountId} onChange={setAccountId} label="Into account" />}
      </Group>
    </div>
  );
}

// ---------------- projects ----------------
/** New project (or edit one): name, client, description, agreed total, stage. */
export function openProjectEditForm(existing?: Project, onCreated?: (id: string) => void) {
  openForm(existing ? "Edit project" : "New project", (bind) => <ProjectEditForm bind={bind} existing={existing} onCreated={onCreated} />);
}

function ProjectEditForm({ bind, existing, onCreated }: { bind: Binding; existing?: Project; onCreated?: (id: string) => void }) {
  const contacts = useLive(() => db.contacts.orderBy("name").toArray(), []);
  const deal = useLive(async () => (existing?.dealId ? await db.deals.get(existing.dealId) : undefined), [existing?.dealId]);
  const [name, setName] = useState(existing?.name ?? "");
  const [contactId, setContactId] = useState(existing?.contactId ?? "");
  const [desc, setDesc] = useState(existing?.description ?? "");
  const [agreedTouched, setAgreedTouched] = useState(false);
  const [agreedText, setAgreed] = useState("");
  const [status, setStatus] = useState<ProjectStatus>(existing?.status ?? "not_started");
  const currentAgreed = (existing?.dealId ? deal?.value : existing?.agreed) || 0;
  const agreed = agreedTouched ? agreedText : currentAgreed ? String(currentAgreed) : "";
  bind.current = async () => {
    const n = optText(name, 120);
    if (!n) return fail("Give the project a name");
    const total = num(agreed) ?? 0;
    if (existing) {
      await db.projects.update(existing.id, { name: n, contactId: contactId || undefined, description: optText(desc, MAX_LONG), status, updatedAt: new Date().toISOString() });
      if (existing.dealId) await db.deals.update(existing.dealId, { name: n, updatedAt: new Date().toISOString() });
      if (total !== currentAgreed) await setProjectAgreed({ ...existing }, total);
      toast("Project updated");
    } else {
      const id = await saveProject({ name: n, contactId: contactId || undefined, description: optText(desc, MAX_LONG), status, agreed: total });
      toast("Project created", { icon: "folder" });
      onCreated?.(id);
    }
  };
  return (
    <div class="form">
      <Group>
        <TextField label="Name" value={name} onInput={setName} placeholder="Required" autoFocus={!existing} />
        <SelectField label="Client" value={contactId} onChange={setContactId} placeholder="None / personal" options={(contacts ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <TextField label="Total agreed (Rs)" value={agreed} onInput={(v) => { setAgreedTouched(true); setAgreed(v); }} inputMode="decimal" placeholder="Not agreed yet" />
      </Group>
      <div>
        <div class="group-label">Stage</div>
        <Segmented<ProjectStatus>
          value={status}
          onChange={setStatus}
          options={[
            { value: "not_started", label: "Not started" },
            { value: "in_progress", label: "In progress" },
            { value: "completed", label: "Completed" },
          ]}
        />
      </div>
      <Group>
        <TextArea label="Description" value={desc} onInput={setDesc} placeholder="What will you deliver?" />
      </Group>
    </div>
  );
}

/** Money received for a project, at any stage; also lets you set/change the agreed total. */
export async function openProjectMoneyForm(project: Project, received: number) {
  if (project.dealId) {
    const deal = await db.deals.get(project.dealId);
    if (deal) return openDealPaymentForm(deal, received);
  }
  openForm("Money received", (bind) => <ProjectMoneyForm bind={bind} project={project} received={received} />);
}

function ProjectMoneyForm({ bind, project, received }: { bind: Binding; project: Project; received: number }) {
  const [agreed, setAgreed] = useState(project.agreed ? String(project.agreed) : "");
  const left = Math.max(0, (num(agreed) ?? 0) - received);
  const [amount, setAmount] = useState(left ? String(left) : "");
  const [label, setLabel] = useState(received === 0 ? "Advance" : "Payment");
  const [date, setDate] = useState(todayYmd());
  const [accountId, setAccountId] = useDefaultAccount();
  bind.current = async () => {
    const a = num(amount) ?? 0;
    const total = num(agreed) ?? 0;
    if (a <= 0 && total === (project.agreed ?? 0)) return fail("Enter the money received, or change the agreed total");
    if (a > 0 && !accountId) return fail("Which account did the money go into?");
    if (total !== (project.agreed ?? 0)) await setProjectAgreed(project, total);
    if (a > 0) {
      rememberAccount(accountId);
      await recordProjectIncome(project, a, date || todayYmd(), optText(label, 80) ?? "Payment", accountId);
    }
    toast(a > 0 ? `Received ${money(received + a)}${total ? ` of ${money(total)}` : ""}` : "Agreed total updated", { icon: "wallet" });
  };
  return (
    <div class="form">
      <div class="row wrap gap8" style="padding:0 4px">
        {PAYMENT_LABELS.map((l) => (
          <button key={l} class="chip press" aria-pressed={label === l} onClick={() => setLabel(l)}>
            {l}
          </button>
        ))}
      </div>
      <Group label="Money received">
        <TextField label="Amount (Rs)" value={amount} onInput={setAmount} inputMode="decimal" placeholder="0" autoFocus />
        <AccountSelect value={accountId} onChange={setAccountId} label="Into account" />
        <TextField label="For" value={label} onInput={setLabel} />
        <TextField label="Date" value={date} onInput={setDate} type="date" />
      </Group>
      <Group label="Total agreed" footer={`Received so far: ${money(received)}.`}>
        <TextField label="Agreed (Rs)" value={agreed} onInput={setAgreed} inputMode="decimal" placeholder="Not agreed yet" />
      </Group>
    </div>
  );
}
