// Create / edit forms, each presented in a bottom sheet with Cancel / Save
// in the header (iOS pattern).
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { DEFAULT_CURRENCY, db, type Activity, type LedgerEntry, type Transaction, type ActivityType, type Company, type Contact, type Deal, type LeadField, type LeadType, type Stage, type Tag, type TagColor, type Task } from "../db/schema";
import {
  addNote,
  addPayment,
  CATEGORIES,
  saveTransaction,
  saveLedgerEntry,
  todayYmd,
  defaultPipelineId,
  logActivity,
  saveColumn,
  saveCompany,
  saveContact,
  saveDeal,
  saveLeadType,
  saveProject,
  saveStage,
  saveTag,
  saveTask,
  saveTodo,
} from "../db/repo";
import { useLive } from "../lib/hooks";
import {
  CONTACT_PRIORITIES,
  CONTACT_STATUSES,
  CURRENCIES,
  LEAD_FIELD_LABELS,
  LEAD_FIELD_TYPES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TAG_COLORS,
  TASK_PRIORITIES,
} from "../lib/options";
import { MAX_LONG, cleanText, isEmail, optText } from "../lib/sanitize";
import { fromDateTimeInput, money, toDateTimeInput } from "../lib/format";
import { Group, Row, Segmented, SelectField, SwitchField, TextArea, TextField } from "../ui/kit";
import { confirmSheet, openSheet, toast } from "../ui/overlay";
import { parseVCards, phoneKey } from "../lib/phoneContacts";
import { pickFile } from "./CsvImport";
import { linkLedgerPeople } from "../db/migrations";
import { AccountSelect, useDefaultAccount } from "./moneyForms";
import { rememberAccount } from "../db/accounts";
import { Icon } from "../ui/icons";
import { navigate } from "../lib/router";

type Binding = { current: (() => Promise<boolean | void>) | null };

function openForm(title: string, body: (bind: Binding, close: () => void) => ComponentChildren, saveLabel = "Save") {
  const bind: Binding = { current: null };
  openSheet((close) => body(bind, close), {
    title,
    full: true,
    done: { label: saveLabel, run: () => (bind.current ? bind.current() : undefined) },
  });
}

const cap = (s: string, n = 300) => cleanText(s, n);
const numOrUndef = (s: string): number | undefined => {
  if (!s.trim()) return undefined;
  const n = Number(s.replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};
function fail(msg: string): false {
  toast(msg, { error: true });
  return false;
}

// =================== Company picker (type a name, pick or create) ===================
/** Find a company by name (case-insensitive) or create it. Empty name → no company. */
export async function resolveCompany(name: string): Promise<string | undefined> {
  const n = optText(name);
  if (!n) return undefined;
  const hit = await db.companies.filter((c) => c.name.trim().toLowerCase() === n.toLowerCase()).first();
  if (hit) return hit.id;
  const id = await saveCompany({ name: n });
  toast(`“${n}” added to Companies`, { icon: "building" });
  return id;
}

/** Free-text company field with suggestions from existing companies. */
function CompanyField({ value, onInput }: { value: string; onInput: (v: string) => void }) {
  const names = useLive(async () => (await db.companies.orderBy("name").toArray()).map((c) => c.name), []);
  const listId = useState(() => `co-${Math.random().toString(36).slice(2)}`)[0];
  const n = value.trim().toLowerCase();
  const isNew = !!n && names !== undefined && !names.some((x) => x.trim().toLowerCase() === n);
  return (
    <>
      <TextField label="Company" value={value} onInput={onInput} list={listId} placeholder="Type or pick" />
      <datalist id={listId}>
        {(names ?? []).map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      {isNew && (
        <div class="field" style="min-height:36px">
          <span class="t-footnote c-brand row gap4" style="gap:6px;padding:0 0 8px">
            <Icon name="plus" size={14} stroke={2.6} />
            New company, will be added to Companies
          </span>
        </div>
      )}
    </>
  );
}

// =================== Contact ===================
export function openContactForm(existing?: Contact, defaults: Partial<Contact> = {}) {
  openForm(existing ? "Edit contact" : "New contact", (bind) => <ContactForm bind={bind} existing={existing} defaults={defaults} />);
}

function ContactForm({ bind, existing, defaults }: { bind: Binding; existing?: Contact; defaults: Partial<Contact> }) {
  const c = { ...defaults, ...existing };
  const [f, setF] = useState({
    name: c.name ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    jobTitle: c.jobTitle ?? "",
    companyName: "",
    status: c.status ?? "new",
    paymentTerms: c.paymentTerms ?? "immediate",
    priority: c.priority ?? "",
    leadTypeId: c.leadTypeId ?? "",
    expectedRevenue: c.expectedRevenue?.toString() ?? "",
    expectedClose: c.expectedClose ?? "",
    probability: c.probability ?? "",
    linkedinUrl: c.linkedinUrl ?? "",
    website: c.website ?? "",
    city: c.city ?? "",
    country: c.country ?? "",
    niche: c.niche ?? "",
  });
  const [custom, setCustom] = useState<Record<string, string | number | boolean>>(c.customFields ?? {});
  const [tagIds, setTagIds] = useState<string[] | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  // Prefill the company name when editing (or when opened from a company page).
  const [companyTouched, setCompanyTouched] = useState(false);
  const initialCompany = useLive(async () => (c.companyId ? (await db.companies.get(c.companyId))?.name ?? "" : ""), [c.companyId]);
  const companyName = companyTouched ? f.companyName : initialCompany ?? "";
  const leadTypes = useLive(() => db.leadTypes.orderBy("position").toArray(), []);
  const tags = useLive(() => db.tags.orderBy("name").toArray(), []);
  const currentTags = useLive(
    async () => (existing ? (await db.contactTags.where("contactId").equals(existing.id).toArray()).map((l) => l.tagId) : []),
    [existing?.id],
  );
  const selectedTags = tagIds ?? currentTags ?? [];
  const leadType = leadTypes?.find((l) => l.id === f.leadTypeId);

  bind.current = async () => {
    const name = optText(f.name);
    if (!name) return fail("Name is required");
    if (f.email.trim() && !isEmail(f.email.trim())) return fail("That email doesn't look right");
    if (leadType) {
      const missing = leadType.fields.find((fd) => fd.required && (custom[fd.key] === undefined || custom[fd.key] === ""));
      if (missing) return fail(`${missing.label} is required for ${leadType.name}`);
    }
    const customFields: Contact["customFields"] = {};
    if (leadType) for (const fd of leadType.fields) if (custom[fd.key] !== undefined && custom[fd.key] !== "") customFields[fd.key] = custom[fd.key];
    const id = await saveContact(
      {
        id: existing?.id,
        name,
        email: optText(f.email),
        phone: optText(f.phone),
        jobTitle: optText(f.jobTitle),
        companyId: companyTouched || initialCompany !== undefined ? await resolveCompany(companyName) : c.companyId,
        status: f.status as Contact["status"],
        priority: (f.priority || undefined) as Contact["priority"],
        paymentTerms: f.paymentTerms as Contact["paymentTerms"],
        leadTypeId: f.leadTypeId || undefined,
        expectedRevenue: numOrUndef(f.expectedRevenue),
        expectedClose: f.expectedClose || undefined,
        probability: optText(f.probability, 20),
        linkedinUrl: optText(f.linkedinUrl),
        website: optText(f.website),
        city: optText(f.city),
        country: optText(f.country),
        niche: optText(f.niche),
        customFields,
        lastActivityAt: existing?.lastActivityAt,
      },
      selectedTags,
    );
    toast(existing ? "Contact updated" : "Contact added");
    if (!existing) setTimeout(() => navigate(`/contacts/${id}`), 320);
  };

  return (
    <div class="form">
      <Group>
        <TextField label="Name" value={f.name} onInput={set("name")} placeholder="Required" autoFocus={!existing} />
        <TextField label="Email" value={f.email} onInput={set("email")} type="email" inputMode="email" />
        <TextField label="Phone" value={f.phone} onInput={set("phone")} type="tel" inputMode="tel" />
        <TextField label="Job title" value={f.jobTitle} onInput={set("jobTitle")} />
        <CompanyField
          value={companyName}
          onInput={(v) => {
            setCompanyTouched(true);
            set("companyName")(v);
          }}
        />
      </Group>
      <Group label="Lead">
        <SelectField label="Status" value={f.status} placeholder={false} onChange={set("status")} options={CONTACT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} />
        <SelectField label="Priority" value={f.priority} onChange={set("priority")} options={CONTACT_PRIORITIES.map((s) => ({ value: s, label: PRIORITY_LABELS[s] }))} />
        <SelectField label="Pays" value={f.paymentTerms} placeholder={false} onChange={set("paymentTerms")} options={[{ value: "immediate", label: "Immediately" }, { value: "credit", label: "On credit" }]} />
        <SelectField label="Lead type" value={f.leadTypeId} onChange={set("leadTypeId")} options={(leadTypes ?? []).map((x) => ({ value: x.id, label: x.name }))} />
        <TextField label="Revenue" value={f.expectedRevenue} onInput={set("expectedRevenue")} inputMode="decimal" placeholder="0" />
        <TextField label="Close date" value={f.expectedClose} onInput={set("expectedClose")} type="date" />
        <TextField label="Probability" value={f.probability} onInput={set("probability")} inputMode="decimal" placeholder="0.7" />
      </Group>
      {leadType && leadType.fields.length > 0 && (
        <Group label={`${leadType.name} fields`}>
          {leadType.fields.map((fd) => (
            <CustomFieldInput key={fd.key} field={fd} value={custom[fd.key]} onChange={(v) => setCustom((p) => ({ ...p, [fd.key]: v }))} />
          ))}
        </Group>
      )}
      {tags && tags.length > 0 && (
        <div>
          <div class="group-label">Tags</div>
          <div class="row wrap gap8" style="padding:0 4px">
            {tags.map((t) => {
              const on = selectedTags.includes(t.id);
              return (
                <button
                  key={t.id}
                  class="chip press"
                  aria-pressed={on}
                  onClick={() => setTagIds(on ? selectedTags.filter((x) => x !== t.id) : [...selectedTags, t.id])}
                >
                  {on && <Icon name="check" size={14} stroke={3} />}
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <Group label="More">
        <TextField label="LinkedIn" value={f.linkedinUrl} onInput={set("linkedinUrl")} type="url" inputMode="url" />
        <TextField label="Website" value={f.website} onInput={set("website")} type="url" inputMode="url" />
        <TextField label="City" value={f.city} onInput={set("city")} />
        <TextField label="Country" value={f.country} onInput={set("country")} />
        <TextField label="Niche" value={f.niche} onInput={set("niche")} />
      </Group>
    </div>
  );
}

function CustomFieldInput({ field, value, onChange }: { field: LeadField; value: unknown; onChange: (v: string | number | boolean) => void }) {
  const label = field.required ? `${field.label} *` : field.label;
  switch (field.type) {
    case "checkbox":
      return <SwitchField label={field.label} checked={value === true} onChange={onChange} />;
    case "select":
      return <SelectField label={label} value={String(value ?? "")} onChange={(v) => onChange(v)} options={(field.options ?? []).map((o) => ({ value: o, label: o }))} />;
    case "number":
      return <TextField label={label} value={value === undefined ? "" : String(value)} inputMode="decimal" onInput={(v) => onChange(numOrUndef(v) ?? "")} />;
    case "date":
      return <TextField label={label} type="date" value={String(value ?? "")} onInput={onChange} />;
    default:
      return <TextField label={label} value={String(value ?? "")} onInput={(v) => onChange(cap(v, 2000))} />;
  }
}

// =================== Company ===================
export function openCompanyForm(existing?: Company) {
  openForm(existing ? "Edit company" : "New company", (bind) => <CompanyForm bind={bind} existing={existing} />);
}

function CompanyForm({ bind, existing }: { bind: Binding; existing?: Company }) {
  const [f, setF] = useState({
    name: existing?.name ?? "",
    domain: existing?.domain ?? "",
    website: existing?.website ?? "",
    phone: existing?.phone ?? "",
    industry: existing?.industry ?? "",
    size: existing?.size?.toString() ?? "",
    address: existing?.address ?? "",
  });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  bind.current = async () => {
    const name = optText(f.name);
    if (!name) return fail("Name is required");
    const dupe = await db.companies.filter((c) => c.name.trim().toLowerCase() === name.toLowerCase() && c.id !== existing?.id).first();
    if (dupe) return fail("A company with that name already exists");
    const id = await saveCompany({
      id: existing?.id,
      name,
      domain: optText(f.domain),
      website: optText(f.website),
      phone: optText(f.phone),
      industry: optText(f.industry),
      size: numOrUndef(f.size),
      address: optText(f.address, 500),
    });
    toast(existing ? "Company updated" : "Company added");
    if (!existing) setTimeout(() => navigate(`/companies/${id}`), 320);
  };
  return (
    <div class="form">
      <Group>
        <TextField label="Name" value={f.name} onInput={set("name")} placeholder="Required" autoFocus={!existing} />
        <TextField label="Industry" value={f.industry} onInput={set("industry")} />
        <TextField label="Domain" value={f.domain} onInput={set("domain")} inputMode="url" />
        <TextField label="Website" value={f.website} onInput={set("website")} type="url" inputMode="url" />
        <TextField label="Phone" value={f.phone} onInput={set("phone")} type="tel" inputMode="tel" />
        <TextField label="Employees" value={f.size} onInput={set("size")} inputMode="numeric" />
      </Group>
      <Group>
        <TextArea label="Address" value={f.address} onInput={set("address")} maxLength={500} />
      </Group>
    </div>
  );
}

// =================== Deal ===================
export function openDealForm(existing?: Deal, defaults: Partial<Deal> = {}) {
  openForm(existing ? "Edit deal" : "New deal", (bind) => <DealForm bind={bind} existing={existing} defaults={defaults} />);
}

function DealForm({ bind, existing, defaults }: { bind: Binding; existing?: Deal; defaults: Partial<Deal> }) {
  const d = { ...defaults, ...existing };
  const [f, setF] = useState({
    name: d.name ?? "",
    value: d.value?.toString() ?? "",
    currency: d.currency ?? "PKR",
    stageId: d.stageId ?? "",
    contactId: d.contactId ?? "",
    companyName: "",
    expectedCloseDate: d.expectedCloseDate ?? "",
    description: d.description ?? "",
  });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const stages = useLive(async () => {
    const pid = await defaultPipelineId();
    return pid ? db.stages.where("pipelineId").equals(pid).sortBy("position") : ([] as Stage[]);
  }, []);
  const contacts = useLive(() => db.contacts.orderBy("name").toArray(), []);
  const [companyTouched, setCompanyTouched] = useState(false);
  const initialCompany = useLive(async () => (d.companyId ? (await db.companies.get(d.companyId))?.name ?? "" : ""), [d.companyId]);
  const companyName = companyTouched ? f.companyName : initialCompany ?? "";
  const stageId = f.stageId || stages?.[0]?.id || "";

  bind.current = async () => {
    const name = optText(f.name);
    if (!name) return fail("Name is required");
    if (!stageId) return fail("Pick a stage");
    const stage = stages!.find((s) => s.id === stageId)!;
    let companyId = companyTouched || initialCompany !== undefined ? await resolveCompany(companyName) : d.companyId;
    if (!companyId && f.contactId) companyId = (await db.contacts.get(f.contactId))?.companyId;
    const id = await saveDeal({
      id: existing?.id,
      pipelineId: stage.pipelineId,
      stageId,
      name,
      value: numOrUndef(f.value) ?? 0,
      currency: f.currency,
      contactId: f.contactId || undefined,
      companyId,
      expectedCloseDate: f.expectedCloseDate || undefined,
      description: optText(f.description, MAX_LONG),
    });
    toast(existing ? "Deal updated" : "Deal added");
    if (!existing && !defaults.stageId) setTimeout(() => navigate(`/deals/${id}`), 320);
  };
  return (
    <div class="form">
      <Group>
        <TextField label="Name" value={f.name} onInput={set("name")} placeholder="Required" autoFocus={!existing} />
        <TextField label="Value" value={f.value} onInput={set("value")} inputMode="decimal" placeholder="0" />
        <SelectField label="Currency" value={f.currency} placeholder={false} onChange={set("currency")} options={[...new Set([f.currency, ...CURRENCIES])].map((c) => ({ value: c, label: c }))} />
        <SelectField label="Stage" value={stageId} placeholder={false} onChange={set("stageId")} options={(stages ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <TextField label="Close date" value={f.expectedCloseDate} onInput={set("expectedCloseDate")} type="date" />
      </Group>
      <Group label="Related">
        <SelectField label="Contact" value={f.contactId} onChange={set("contactId")} options={(contacts ?? []).map((x) => ({ value: x.id, label: x.name }))} />
        <CompanyField
          value={companyName}
          onInput={(v) => {
            setCompanyTouched(true);
            set("companyName")(v);
          }}
        />
      </Group>
      <Group>
        <TextArea label="Description" value={f.description} onInput={set("description")} />
      </Group>
    </div>
  );
}

// =================== Task ===================
type Parent = "none" | "contact" | "deal" | "company" | "project";

export function openTaskForm(existing?: Task, defaults: Partial<Task> = {}) {
  openForm(existing ? "Edit task" : "New task", (bind) => <TaskForm bind={bind} existing={existing} defaults={defaults} />);
}

function TaskForm({ bind, existing, defaults }: { bind: Binding; existing?: Task; defaults: Partial<Task> }) {
  const t = { ...defaults, ...existing };
  const initialParent: Parent = t.contactId ? "contact" : t.dealId ? "deal" : t.companyId ? "company" : t.projectId ? "project" : "none";
  const [title, setTitle] = useState(t.title ?? "");
  const [due, setDue] = useState(toDateTimeInput(t.dueAt));
  const [priority, setPriority] = useState<string>(t.priority ?? "");
  const [description, setDescription] = useState(t.description ?? "");
  const [parent, setParent] = useState<Parent>(initialParent);
  const [parentId, setParentId] = useState(t.contactId ?? t.dealId ?? t.companyId ?? t.projectId ?? "");
  const options = useLive(async () => {
    switch (parent) {
      case "contact":
        return (await db.contacts.orderBy("name").toArray()).map((x) => ({ value: x.id, label: x.name }));
      case "deal":
        return (await db.deals.toArray()).sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ value: x.id, label: x.name }));
      case "company":
        return (await db.companies.orderBy("name").toArray()).map((x) => ({ value: x.id, label: x.name }));
      case "project":
        return (await db.projects.toArray()).map((x) => ({ value: x.id, label: x.name }));
      default:
        return [];
    }
  }, [parent]);

  bind.current = async () => {
    const tt = optText(title);
    if (!tt) return fail("Title is required");
    const link: Partial<Task> = { contactId: undefined, dealId: undefined, companyId: undefined, projectId: undefined };
    if (parent !== "none" && parentId) (link as Record<string, string>)[`${parent}Id`] = parentId;
    await saveTask({
      id: existing?.id,
      title: tt,
      description: optText(description, MAX_LONG),
      priority: (priority || undefined) as Task["priority"],
      dueAt: fromDateTimeInput(due),
      status: existing?.status ?? "open",
      completedAt: existing?.completedAt,
      ...link,
    });
    toast(existing ? "Task updated" : "Task added");
  };

  return (
    <div class="form">
      <Group>
        <TextField label="Title" value={title} onInput={setTitle} placeholder="What needs doing?" autoFocus={!existing} />
        <TextField label="Due" value={due} onInput={setDue} type="datetime-local" />
        <SelectField label="Priority" value={priority} onChange={(v) => setPriority(v)} options={TASK_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} />
      </Group>
      <div>
        <div class="group-label">Related to</div>
        <Segmented<Parent>
          value={parent}
          onChange={(v) => {
            setParent(v);
            setParentId("");
          }}
          options={[
            { value: "none", label: "None" },
            { value: "contact", label: "Contact" },
            { value: "deal", label: "Deal" },
            { value: "company", label: "Company" },
            { value: "project", label: "Project" },
          ]}
        />
        {parent !== "none" && (
          <div class="group mt8">
            <SelectField label={parent[0].toUpperCase() + parent.slice(1)} value={parentId} onChange={setParentId} placeholder="Choose…" options={options ?? []} />
          </div>
        )}
      </div>
      <Group>
        <TextArea label="Notes" value={description} onInput={setDescription} />
      </Group>
    </div>
  );
}

// =================== Note / call / meeting ===================
export function openNoteForm(parent?: Pick<Activity, "contactId" | "companyId" | "dealId" | "projectId">, type: ActivityType = "note") {
  openForm("Log activity", (bind) => <NoteForm bind={bind} parent={parent} initialType={type} />, "Add");
}

function NoteForm({ bind, parent, initialType }: { bind: Binding; parent?: Pick<Activity, "contactId" | "companyId" | "dealId" | "projectId">; initialType: ActivityType }) {
  const [type, setType] = useState<ActivityType>(initialType);
  const [body, setBody] = useState("");
  const [contactId, setContactId] = useState("");
  const [when, setWhen] = useState(toDateTimeInput(new Date().toISOString()));
  const contacts = useLive(() => (parent ? Promise.resolve([] as Contact[]) : db.contacts.orderBy("name").toArray()), []);
  bind.current = async () => {
    const text = optText(body, MAX_LONG);
    if (!text) return fail("Write something first");
    const target = parent ?? (contactId ? { contactId } : undefined);
    if (!target) return fail("Choose a contact");
    const occurredAt = fromDateTimeInput(when);
    if (occurredAt) await logActivity({ ...target, type, body: text, occurredAt });
    else await addNote(target, text, type);
    toast("Logged");
  };
  return (
    <div class="form">
      <Segmented<ActivityType>
        value={type}
        onChange={setType}
        options={[
          { value: "note", label: "Note" },
          { value: "call", label: "Call" },
          { value: "meeting", label: "Meeting" },
        ]}
      />
      {!parent && (
        <div class="group">
          <SelectField label="Contact" value={contactId} onChange={setContactId} placeholder="Choose…" options={(contacts ?? []).map((x) => ({ value: x.id, label: x.name }))} />
        </div>
      )}
      <Group>
        <TextArea label={type === "note" ? "Note" : type === "call" ? "Call summary" : "Meeting notes"} value={body} onInput={setBody} placeholder="Type here…" />
        <TextField label="When" value={when} onInput={setWhen} type="datetime-local" />
      </Group>
    </div>
  );
}

// =================== Project / column / to-do ===================
export function openProjectForm(existing?: { id: string; name: string }) {
  openForm(existing ? "Rename project" : "New project", (bind) => <NameForm bind={bind} label="Name" initial={existing?.name} onSave={async (name) => {
    const id = await saveProject({ id: existing?.id, name });
    toast(existing ? "Project renamed" : "Project created");
    if (!existing) setTimeout(() => navigate(`/projects/${id}`), 320);
  }} />);
}

export function openColumnForm(projectId: string, existing?: { id: string; name: string; position: number }, position = 0) {
  openForm(existing ? "Rename column" : "New column", (bind) => <NameForm bind={bind} label="Name" initial={existing?.name} onSave={async (name) => {
    await saveColumn({ id: existing?.id, projectId, name, position: existing?.position ?? position });
  }} />);
}

function NameForm({ bind, label, initial, onSave }: { bind: Binding; label: string; initial?: string; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initial ?? "");
  bind.current = async () => {
    const n = optText(name);
    if (!n) return fail(`${label} is required`);
    await onSave(n);
  };
  return (
    <div class="form">
      <Group>
        <TextField label={label} value={name} onInput={setName} placeholder="Required" autoFocus />
      </Group>
    </div>
  );
}

export function openTodoForm(projectId: string, columns: { id: string; name: string }[], existing?: { id: string; title: string; description?: string; columnId: string; position: number }, columnId?: string) {
  openForm(existing ? "Edit to-do" : "New to-do", (bind) => <TodoForm bind={bind} projectId={projectId} columns={columns} existing={existing} columnId={columnId} />);
}

function TodoForm({ bind, projectId, columns, existing, columnId }: { bind: Binding; projectId: string; columns: { id: string; name: string }[]; existing?: { id: string; title: string; description?: string; columnId: string; position: number }; columnId?: string }) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [col, setCol] = useState(existing?.columnId ?? columnId ?? columns[0]?.id ?? "");
  bind.current = async () => {
    const tt = optText(title);
    if (!tt) return fail("Title is required");
    if (!col) return fail("Add a column first");
    let position = existing?.position ?? 0;
    if (!existing || existing.columnId !== col) {
      const items = await db.projectTodos.where("columnId").equals(col).toArray();
      position = items.reduce((m, x) => Math.max(m, x.position + 1), 0);
    }
    await saveTodo({ id: existing?.id, projectId, columnId: col, title: tt, description: optText(description, MAX_LONG), position });
  };
  return (
    <div class="form">
      <Group>
        <TextField label="Title" value={title} onInput={setTitle} placeholder="Required" autoFocus={!existing} />
        <SelectField label="Column" value={col} placeholder={false} onChange={setCol} options={columns.map((c) => ({ value: c.id, label: c.name }))} />
      </Group>
      <Group>
        <TextArea label="Description" value={description} onInput={setDescription} />
      </Group>
    </div>
  );
}

// =================== Tag ===================
export function openTagForm(existing?: Tag) {
  openForm(existing ? "Edit tag" : "New tag", (bind) => <TagForm bind={bind} existing={existing} />);
}

function TagForm({ bind, existing }: { bind: Binding; existing?: Tag }) {
  const [name, setName] = useState(existing?.name ?? "");
  const [color, setColor] = useState<TagColor>(existing?.color ?? "brand");
  bind.current = async () => {
    const n = optText(name, 60);
    if (!n) return fail("Name is required");
    const dupe = await db.tags.filter((t) => t.name.toLowerCase() === n.toLowerCase() && t.id !== existing?.id).first();
    if (dupe) return fail("That tag already exists");
    await saveTag({ id: existing?.id, name: n, color });
    toast(existing ? "Tag updated" : "Tag created");
  };
  return (
    <div class="form">
      <Group>
        <TextField label="Name" value={name} onInput={setName} placeholder="Required" autoFocus maxLength={60} />
      </Group>
      <div>
        <div class="group-label">Colour</div>
        <div class="row wrap gap8" style="padding:0 4px">
          {TAG_COLORS.map((c) => (
            <button key={c} class="chip press" aria-pressed={color === c} onClick={() => setColor(c)}>
              <span class={`badge ${c}`} style="height:18px;padding:0 6px">
                <span class="dot" />
              </span>
              {c[0].toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// =================== Stage ===================
export function openStageForm(pipelineId: string, existing?: Stage, position = 0) {
  openForm(existing ? "Edit stage" : "New stage", (bind) => <StageForm bind={bind} pipelineId={pipelineId} existing={existing} position={position} />);
}

function StageForm({ bind, pipelineId, existing, position }: { bind: Binding; pipelineId: string; existing?: Stage; position: number }) {
  const [name, setName] = useState(existing?.name ?? "");
  const [prob, setProb] = useState(existing?.probability?.toString() ?? "");
  const [kind, setKind] = useState<"open" | "won" | "lost">(existing?.isWon ? "won" : existing?.isLost ? "lost" : "open");
  bind.current = async () => {
    const n = optText(name, 60);
    if (!n) return fail("Name is required");
    await saveStage({
      id: existing?.id,
      pipelineId,
      name: n,
      position: existing?.position ?? position,
      probability: numOrUndef(prob),
      isWon: kind === "won",
      isLost: kind === "lost",
    });
  };
  return (
    <div class="form">
      <Group>
        <TextField label="Name" value={name} onInput={setName} placeholder="Required" autoFocus maxLength={60} />
        <TextField label="Win chance %" value={prob} onInput={setProb} inputMode="numeric" />
      </Group>
      <div>
        <div class="group-label">Stage type</div>
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: "open", label: "Open" },
            { value: "won", label: "Won" },
            { value: "lost", label: "Lost" },
          ]}
        />
      </div>
    </div>
  );
}

// =================== Lead type ===================
export function openLeadTypeForm(existing?: LeadType) {
  openForm(existing ? "Edit lead type" : "New lead type", (bind) => <LeadTypeForm bind={bind} existing={existing} />);
}

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || "field";
}

function LeadTypeForm({ bind, existing }: { bind: Binding; existing?: LeadType }) {
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [fields, setFields] = useState<(LeadField & { optionsText?: string })[]>(
    (existing?.fields ?? []).map((f) => ({ ...f, optionsText: f.options?.join(", ") })),
  );
  const patch = (i: number, p: Partial<LeadField & { optionsText?: string }>) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...p } : f)));

  bind.current = async () => {
    const n = optText(name, 80);
    if (!n) return fail("Name is required");
    const used = new Set<string>();
    const clean: LeadField[] = [];
    for (const f of fields) {
      const label = optText(f.label, 120);
      if (!label) continue;
      let key = f.key || slug(label);
      while (used.has(key)) key = `${key}_2`;
      used.add(key);
      const options = f.type === "select" ? (f.optionsText ?? "").split(",").map((o) => cleanText(o, 120).trim()).filter(Boolean) : undefined;
      if (f.type === "select" && !options?.length) return fail(`"${label}" needs at least one choice`);
      clean.push({ key, label, type: f.type, ...(options ? { options } : {}), ...(f.required ? { required: true } : {}) });
    }
    await saveLeadType({ id: existing?.id, name: n, description: optText(description, 2000), position: existing?.position ?? 0, fields: clean });
    toast(existing ? "Lead type updated" : "Lead type created");
  };

  return (
    <div class="form">
      <Group>
        <TextField label="Name" value={name} onInput={setName} placeholder="Required" autoFocus={!existing} />
        <TextField label="Description" value={description} onInput={setDescription} />
      </Group>
      {fields.map((f, i) => (
        <div key={i} class="rise" style={{ "--i": 0 } as never}>
          <div class="row between" style="padding:0 16px 6px">
            <span class="t-overline">Field {i + 1}</span>
            <button class="c-danger t-footnote" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
          <Group>
            <TextField label="Label" value={f.label} onInput={(v) => patch(i, { label: v })} placeholder="e.g. Budget" />
            <SelectField label="Type" value={f.type} placeholder={false} onChange={(v) => patch(i, { type: (v || "text") as LeadField["type"] })} options={LEAD_FIELD_TYPES.map((t) => ({ value: t, label: LEAD_FIELD_LABELS[t] }))} />
            {f.type === "select" && <TextField label="Choices" value={f.optionsText ?? ""} onInput={(v) => patch(i, { optionsText: v })} placeholder="A, B, C" />}
            <SwitchField label="Required" checked={!!f.required} onChange={(v) => patch(i, { required: v })} />
          </Group>
        </div>
      ))}
      <button class="btn tinted block press" onClick={() => setFields((fs) => [...fs, { key: "", label: "", type: "text" }])}>
        <Icon name="plus" size={20} /> Add field
      </button>
    </div>
  );
}

// =================== Quick lead (contact + deal in one go) ===================
/**
 * The day-to-day flow: capture a lead with a phone number and drop it straight
 * into a pipeline stage. Creates (or reuses) the contact and creates the deal.
 */
export function openLeadForm(defaults: { stageId?: string; contactId?: string } = {}) {
  openForm(defaults.contactId ? "New deal" : "New lead", (bind) => <LeadForm bind={bind} defaults={defaults} />);
}

function LeadForm({ bind, defaults }: { bind: Binding; defaults: { stageId?: string; contactId?: string } }) {
  // Two shapes: a brand-new lead (just the essentials), or a new deal for an
  // existing client (opened from "New deal with …").
  const existingId = defaults.contactId;
  const [f, setF] = useState({ name: "", phone: "", company: "", position: "", dealName: "" });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const stages = useLive(async () => {
    const pid = await defaultPipelineId();
    return pid ? db.stages.where("pipelineId").equals(pid).sortBy("position") : ([] as Stage[]);
  }, []);
  const client = useLive(async () => (existingId ? await db.contacts.get(existingId) : undefined), [existingId]);
  const stageId = defaults.stageId || stages?.find((s) => !s.isWon && !s.isLost)?.id || stages?.[0]?.id || "";

  bind.current = async () => {
    if (!stageId) return fail("Add a pipeline stage first");
    const stage = stages!.find((s) => s.id === stageId)!;
    let contactId = existingId;
    let contactName = client?.name ?? "";
    let companyId = client?.companyId;
    if (!existingId) {
      const name = optText(f.name);
      if (!name) return fail("Name is required");
      companyId = await resolveCompany(f.company);
      contactId = await saveContact({
        name,
        phone: optText(f.phone),
        jobTitle: optText(f.position),
        status: "new",
        companyId,
        customFields: {},
      });
      contactName = name;
    }
    await saveDeal({
      pipelineId: stage.pipelineId,
      stageId,
      name: optText(f.dealName) ?? contactName,
      value: 0,
      currency: DEFAULT_CURRENCY,
      contactId,
      companyId,
    });
    toast(`Lead added to ${stage.name}`, { icon: "sparkles" });
  };

  if (existingId)
    return (
      <div class="form">
        <Group footer="The deal starts in the pipeline; set the money when it's won.">
          <Row title={client?.name ?? "…"} sub="client" chevron={false} />
          <TextField label="Deal name" value={f.dealName} onInput={set("dealName")} placeholder="e.g. Website v2" autoFocus />
        </Group>
      </div>
    );

  return (
    <div class="form">
      <Group footer="A new company is added to Companies automatically. Money is asked for when the lead is won.">
        <TextField label="Name" value={f.name} onInput={set("name")} placeholder="Required" autoFocus />
        <TextField label="Mobile" value={f.phone} onInput={set("phone")} type="tel" inputMode="tel" placeholder="0300 1234567" />
        <CompanyField value={f.company} onInput={set("company")} />
        <TextField label="Position" value={f.position} onInput={set("position")} placeholder="e.g. Owner, Manager" />
      </Group>
    </div>
  );
}

// =================== Money: ledger entry ===================
export function openLedgerForm(existing?: LedgerEntry, defaults: Partial<LedgerEntry> = {}) {
  openForm(existing ? "Edit entry" : "New money entry", (bind) => <LedgerForm bind={bind} existing={existing} defaults={defaults} />);
}

function LedgerForm({ bind, existing, defaults }: { bind: Binding; existing?: LedgerEntry; defaults: Partial<LedgerEntry> }) {
  const e = { ...defaults, ...existing };
  const [f, setF] = useState({
    direction: e.direction ?? "in",
    kind: e.kind ?? "loan",
    contactId: e.contactId ?? "",
    personName: e.contactId ? "" : e.personName ?? "",
    phone: e.contactId ? "" : e.phone ?? "",
    amount: e.amount ? String(e.amount) : "",
    date: e.date ?? todayYmd(),
    dueDate: e.dueDate ?? "",
    note: e.note ?? "",
  });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const contacts = useLive(() => db.contacts.orderBy("name").toArray(), []);
  const [accountId, setAccountId] = useDefaultAccount(e.accountId);

  bind.current = async () => {
    const amount = numOrUndef(f.amount);
    if (!amount || amount <= 0) return fail("Enter an amount");
    let personName = optText(f.personName);
    let phone = optText(f.phone);
    if (f.contactId) {
      const c = await db.contacts.get(f.contactId);
      personName = c?.name;
      phone = c?.phone;
    }
    if (!personName) return fail("Choose a contact or type a name");
    await saveLedgerEntry({
      id: existing?.id,
      direction: f.direction as LedgerEntry["direction"],
      kind: f.kind as LedgerEntry["kind"],
      personName,
      phone,
      contactId: f.contactId || undefined,
      dealId: e.dealId,
      amount,
      currency: e.currency ?? DEFAULT_CURRENCY,
      date: f.date || todayYmd(),
      dueDate: f.dueDate || undefined,
      note: optText(f.note, MAX_LONG),
      accountId: f.kind === "loan" && accountId ? accountId : undefined,
      settledAt: existing?.settledAt,
    });
    if (f.kind === "loan") rememberAccount(accountId);
    // Everyone you lend to / borrow from becomes a contact (tagged Personal for loans).
    if (!f.contactId) {
      const made = await linkLedgerPeople();
      if (made) toast(`${personName} added to Contacts`, { icon: "user" });
    }
    toast(existing ? "Entry updated" : f.direction === "in" ? "Added to money owed to you" : "Added to money you owe", { icon: "wallet" });
  };

  return (
    <div class="form">
      <Segmented
        value={f.direction}
        onChange={set("direction")}
        options={[
          { value: "in", label: "They owe me" },
          { value: "out", label: "I owe them" },
        ]}
      />
      <Segmented
        value={f.kind}
        onChange={set("kind")}
        options={[
          { value: "loan", label: "Personal loan" },
          { value: "credit", label: "Credit (business)" },
        ]}
      />
      <Group label="Who" footer="Pick a contact, or type a new name and number; they're added to Contacts automatically.">
        <SelectField label="Contact" value={f.contactId} onChange={set("contactId")} placeholder="Not a contact" options={(contacts ?? []).map((x) => ({ value: x.id, label: x.name }))} />
        {!f.contactId && <TextField label="Name" value={f.personName} onInput={set("personName")} placeholder="Required" />}
        {!f.contactId && <TextField label="Phone" value={f.phone} onInput={set("phone")} type="tel" inputMode="tel" placeholder="For WhatsApp reminders" />}
      </Group>
      <Group label="Amount">
        <TextField label="Amount (Rs)" value={f.amount} onInput={set("amount")} inputMode="decimal" placeholder="0" autoFocus={!existing && !defaults.amount} />
        <TextField label="Date" value={f.date} onInput={set("date")} type="date" />
        <TextField label="Due by" value={f.dueDate} onInput={set("dueDate")} type="date" />
        {f.kind === "loan" && <AccountSelect value={accountId} onChange={setAccountId} label={f.direction === "in" ? "Lent from" : "Received into"} optional />}
      </Group>
      <Group>
        <TextArea label="Note" value={f.note} onInput={set("note")} placeholder="What was it for?" />
      </Group>
    </div>
  );
}

// =================== Money: payment ===================
export function openPaymentForm(entry: LedgerEntry, remaining: number) {
  openForm(entry.direction === "in" ? "Payment received" : "Payment made", (bind) => <PaymentForm bind={bind} entry={entry} remaining={remaining} />, "Save");
}

function PaymentForm({ bind, entry, remaining }: { bind: Binding; entry: LedgerEntry; remaining: number }) {
  const [amount, setAmount] = useState(String(remaining));
  const [date, setDate] = useState(todayYmd());
  const [note, setNote] = useState("");
  const [accountId, setAccountId] = useDefaultAccount();
  bind.current = async () => {
    const a = numOrUndef(amount);
    if (!a || a <= 0) return fail("Enter an amount");
    if (a > remaining + 0.001) return fail(`That's more than the ${money(remaining)} left`);
    rememberAccount(accountId);
    await addPayment(entry.id, a, date || todayYmd(), optText(note, 500), undefined, accountId || undefined);
    toast(a >= remaining ? "Fully settled 🎉" : "Payment recorded", { icon: "checkCircle" });
  };
  return (
    <div class="form">
      <Group footer={`Remaining: ${money(remaining)}. Partial payments are fine.`}>
        <TextField label="Amount (Rs)" value={amount} onInput={setAmount} inputMode="decimal" autoFocus />
        <TextField label="Date" value={date} onInput={setDate} type="date" />
        <AccountSelect value={accountId} onChange={setAccountId} label={entry.direction === "in" ? "Into account" : "From account"} optional />
        <TextField label="Note" value={note} onInput={setNote} placeholder="Optional" />
      </Group>
    </div>
  );
}

// =================== From iPhone contacts ===================
/** Bulk import of a multi-contact .vcf (Settings / Contacts menu). De-duplicates by phone, then email. */
export async function importVcfContacts() {
  const [file] = await pickFile(".vcf,text/vcard,text/x-vcard");
  if (!file) return;
  const people = parseVCards(await file.text());
  if (!people.length) return toast("No contacts found in that file", { error: true });
  const existing = await db.contacts.toArray();
  const byPhone = new Set(existing.map((c) => phoneKey(c.phone)).filter(Boolean));
  const byEmail = new Set(existing.map((c) => (c.email ?? "").toLowerCase()).filter(Boolean));
  const fresh = people.filter((p) => !(p.phones.some((ph) => byPhone.has(phoneKey(ph))) || p.emails.some((e) => byEmail.has(e.toLowerCase()))));
  const ok = await confirmSheet({
    title: `Import ${fresh.length} of ${people.length} contacts?`,
    message: fresh.length < people.length ? `${people.length - fresh.length} already exist (same phone or email) and will be skipped.` : "Name, phone, email and company are imported.",
    confirm: `Import ${fresh.length}`,
  });
  if (!ok || !fresh.length) return;
  for (const p of fresh) {
    await saveContact({
      name: optText(p.name) ?? "Unnamed",
      phone: optText(p.phones[0]),
      email: optText(p.emails[0]),
      jobTitle: optText(p.title),
      companyId: p.org ? await resolveCompanyQuiet(p.org) : undefined,
      status: "new",
      customFields: {},
    });
  }
  toast(`Imported ${fresh.length} contacts`, { icon: "users" });
}

async function resolveCompanyQuiet(name: string): Promise<string | undefined> {
  const n = optText(name);
  if (!n) return undefined;
  const hit = await db.companies.filter((c) => c.name.trim().toLowerCase() === n.toLowerCase()).first();
  return hit?.id ?? saveCompany({ name: n });
}

// =================== Income / expense ===================
export function openTransactionForm(existing?: Transaction, defaults: Partial<Transaction> = {}) {
  openForm(existing ? "Edit entry" : defaults.type === "income" ? "Add income" : "Add expense", (bind) => <TransactionForm bind={bind} existing={existing} defaults={defaults} />);
}

function TransactionForm({ bind, existing, defaults }: { bind: Binding; existing?: Transaction; defaults: Partial<Transaction> }) {
  const t = { ...defaults, ...existing };
  const [type, setType] = useState<Transaction["type"]>(t.type ?? "expense");
  const [scope, setScope] = useState<Transaction["scope"]>(t.scope ?? "personal");
  const [amount, setAmount] = useState(t.amount ? String(t.amount) : "");
  const [category, setCategory] = useState(t.category ?? "");
  const [date, setDate] = useState(t.date ?? todayYmd());
  const [accountId, setAccountId] = useDefaultAccount(t.accountId);
  const [scopeTouched, setScopeTouched] = useState(!!existing || !!defaults.scope);
  const [note, setNote] = useState(t.note ?? "");
  const [contactId, setContactId] = useState(t.contactId ?? "");
  const contacts = useLive(() => db.contacts.orderBy("name").toArray(), []);
  const used = useLive(async () => [...new Set((await db.transactions.toArray()).map((x) => x.category))], []);
  const suggestions = [...new Set([...CATEGORIES[scope][type], ...(used ?? [])])];
  const shown = CATEGORIES[scope][type];
  const listId = useState(() => `cat-${Math.random().toString(36).slice(2)}`)[0];

  bind.current = async () => {
    const a = numOrUndef(amount);
    if (!a || a <= 0) return fail("Enter an amount");
    const cat = optText(category, 60) ?? "Other";
    rememberAccount(accountId);
    await saveTransaction({
      id: existing?.id,
      type,
      scope,
      amount: a,
      currency: t.currency ?? DEFAULT_CURRENCY,
      date: date || todayYmd(),
      category: cat,
      method: t.method,
      accountId: accountId || undefined,
      note: optText(note, 2000),
      contactId: contactId || undefined,
      dealId: t.dealId,
      projectId: t.projectId,
      ledgerPaymentId: t.ledgerPaymentId,
    });
    toast(existing ? "Updated" : type === "income" ? "Income added" : "Expense added", { icon: "wallet" });
  };

  return (
    <div class="form">
      <Segmented<Transaction["type"]>
        value={type}
        onChange={(v) => {
          setType(v);
          if (!existing) setCategory("");
        }}
        options={[
          { value: "expense", label: "Expense" },
          { value: "income", label: "Income" },
        ]}
      />
      <Segmented<Transaction["scope"]>
        value={scope}
        onChange={(v) => {
          setScope(v);
          setScopeTouched(true);
          if (!existing) setCategory("");
        }}
        options={[
          { value: "personal", label: "Personal" },
          { value: "business", label: "Business" },
        ]}
      />
      <Group>
        <TextField label="Amount (Rs)" value={amount} onInput={setAmount} inputMode="decimal" placeholder="0" autoFocus={!existing} />
        <TextField label="Date" value={date} onInput={setDate} type="date" />
      </Group>
      <div>
        <div class="group-label">Category</div>
        <div class="row wrap gap8" style="padding:0 4px 10px">
          {shown.map((c) => (
            <button key={c} class="chip press" aria-pressed={category === c} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
        <div class="group">
          <TextField label="Or type" value={category} onInput={setCategory} list={listId} placeholder="Your own category" />
          <datalist id={listId}>
            {suggestions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      </div>
      <Group>
        <AccountSelect
          value={accountId}
          onChange={(id, acc) => {
            setAccountId(id);
            if (acc && !scopeTouched) setScope(acc.scope);
          }}
          label={type === "income" ? "Into account" : "Paid from"}
          optional
        />
        <SelectField label="Person" value={contactId} onChange={setContactId} placeholder="None" options={(contacts ?? []).map((x) => ({ value: x.id, label: x.name }))} />
        <TextField label="Note" value={note} onInput={setNote} placeholder="Optional" />
      </Group>
    </div>
  );
}
