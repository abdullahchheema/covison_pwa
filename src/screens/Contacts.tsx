import { useMemo, useState } from "preact/hooks";
import { db, type Contact } from "../db/schema";
import { deleteContact } from "../db/repo";
import { exportCsv } from "../db/csvExport";
import { useLive, useStoredState } from "../lib/hooks";
import { CONTACT_PRIORITIES, CONTACT_STATUSES, PRIORITY_LABELS, PRIORITY_TONE, STATUS_LABELS, STATUS_TONE } from "../lib/options";
import { money, relativeTime, shortDate } from "../lib/format";
import { hostOf, mailHref, safeUrl, smsHref, telHref } from "../lib/sanitize";
import { back, navigate } from "../lib/router";
import { Icon } from "../ui/icons";
import { Avatar, Badge, Empty, Group, Row, Screen, SearchField, SkeletonList, SwipeRow, useDebounced } from "../ui/kit";
import { actionSheet, openSheet } from "../ui/overlay";
import { importVcfContacts, openContactForm, openDealForm } from "./forms";
import { Timeline, TaskSection, confirmDelete } from "./shared";
import { openCsvImport } from "./CsvImport";
import { ContactMoney } from "./Ledger";
import { openWhatsApp, waHref, waLinkProps } from "../lib/whatsapp";

interface Filters {
  status: string;
  priority: string;
  tagId: string;
  leadTypeId: string;
}
const NO_FILTERS: Filters = { status: "", priority: "", tagId: "", leadTypeId: "" };

export function ContactsList() {
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim().toLowerCase());
  const [filters, setFilters] = useStoredState<Filters>("filters.contacts", NO_FILTERS);

  const data = useLive(async () => {
    const [contacts, companies, tags, links, leadTypes] = await Promise.all([
      db.contacts.orderBy("name").toArray(),
      db.companies.toArray(),
      db.tags.toArray(),
      db.contactTags.toArray(),
      db.leadTypes.orderBy("position").toArray(),
    ]);
    return { contacts, companies: new Map(companies.map((c) => [c.id, c.name])), tags, links, leadTypes };
  }, []);

  const list = useMemo(() => {
    if (!data) return undefined;
    const tagged = filters.tagId ? new Set(data.links.filter((l) => l.tagId === filters.tagId).map((l) => l.contactId)) : null;
    return data.contacts.filter((c) => {
      if (filters.status && c.status !== filters.status) return false;
      if (filters.priority && c.priority !== filters.priority) return false;
      if (filters.leadTypeId && c.leadTypeId !== filters.leadTypeId) return false;
      if (tagged && !tagged.has(c.id)) return false;
      if (!query) return true;
      const company = c.companyId ? data.companies.get(c.companyId) ?? "" : "";
      return [c.name, c.email, c.phone, c.jobTitle, company, c.city, c.niche].some((v) => v?.toLowerCase().includes(query));
    });
  }, [data, filters, query]);

  // Alphabetical sections, like the iOS Contacts app.
  const sections = useMemo(() => {
    if (!list) return [];
    const out: { letter: string; items: Contact[] }[] = [];
    for (const c of list) {
      const ch = c.name.trim()[0]?.toUpperCase() ?? "#";
      const letter = /[A-Z]/.test(ch) ? ch : "#";
      const last = out[out.length - 1];
      if (last?.letter === letter) last.items.push(c);
      else out.push({ letter, items: [c] });
    }
    return out;
  }, [list]);

  const extraFilters = [filters.priority, filters.tagId, filters.leadTypeId].filter(Boolean).length;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    data?.contacts.forEach((c) => m.set(c.status, (m.get(c.status) ?? 0) + 1));
    return m;
  }, [data]);

  const openFilters = () =>
    openSheet(
      (close) => (
        <FilterSheet
          initial={filters}
          tags={data?.tags ?? []}
          leadTypes={data?.leadTypes ?? []}
          onApply={(f) => {
            setFilters(f);
            close();
          }}
        />
      ),
      { title: "Filter contacts" },
    );

  let idx = 0;
  return (
    <Screen
      title="Contacts"
      subtitle={data ? `${data.contacts.length} people` : " "}
      backLabel="More"
      backTo="/more"
      right={
        <>
          <button class="nav-btn" aria-label="Filters" onClick={openFilters}>
            <Icon name="layers" size={22} />
            {extraFilters > 0 && <span class="badge brand" style="height:18px;padding:0 6px;margin-left:2px">{extraFilters}</span>}
          </button>
          <button
            class="nav-btn"
            aria-label="Options"
            onClick={() =>
              actionSheet([
                { label: "Import iPhone contacts (.vcf)", icon: "users", run: () => void importVcfContacts() },
                { label: "Import from CSV", icon: "upload", run: () => void openCsvImport("contacts") },
                { label: "Export to CSV", icon: "share", run: () => void exportCsv("contacts") },
                { label: "Companies", icon: "building", run: () => navigate("/companies") },
                { label: "Tags", icon: "tag", run: () => navigate("/tags") },
              ])
            }
          >
            <Icon name="more" size={24} />
          </button>
        </>
      }
    >
      <SearchField value={q} onInput={setQ} placeholder="Search name, email, company" />
      <div class="content">
        <div class="chips">
          <button class="chip press" aria-pressed={!filters.status} onClick={() => setFilters({ ...filters, status: "" })}>
            All <span class="count">{data?.contacts.length ?? ""}</span>
          </button>
          {CONTACT_STATUSES.map((s) => (
            <button key={s} class="chip press" aria-pressed={filters.status === s} onClick={() => setFilters({ ...filters, status: filters.status === s ? "" : s })}>
              {STATUS_LABELS[s]} <span class="count">{counts.get(s) ?? 0}</span>
            </button>
          ))}
        </div>
        {!list ? (
          <SkeletonList />
        ) : list.length === 0 ? (
          data!.contacts.length === 0 ? (
            <Empty
              icon="users"
              title="No contacts yet"
              text="Add people you work with, or import a CSV from your old CRM."
              action={
                <div class="row gap8">
                  <button class="btn primary sm press" onClick={() => openContactForm()}>
                    Add contact
                  </button>
                  <button class="btn tinted sm press" onClick={() => void openCsvImport("contacts")}>
                    Import CSV
                  </button>
                </div>
              }
            />
          ) : (
            <Empty
              icon="search"
              title="No matches"
              text="Try a different search or clear the filters."
              action={
                <button
                  class="btn tinted sm press"
                  onClick={() => {
                    setQ("");
                    setFilters(NO_FILTERS);
                  }}
                >
                  Clear filters
                </button>
              }
            />
          )
        ) : (
          sections.map((sec) => (
            <div key={sec.letter} class="mt12">
              <div class="group-label">{sec.letter}</div>
              <div class="group">
                {sec.items.map((c) => (
                  <ContactRow key={c.id} c={c} company={c.companyId ? data!.companies.get(c.companyId) : undefined} i={idx++} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </Screen>
  );
}

function ContactRow({ c, company, i }: { c: Contact; company?: string; i: number }) {
  return (
    <SwipeRow
      i={i}
      actions={[
        ...(waHref(c.phone) ? [{ label: "WhatsApp", icon: "whatsapp" as const, tone: "success" as const, run: () => void openWhatsApp(c.phone) }] : []),
        ...(telHref(c.phone) ? [{ label: "Call", icon: "phone" as const, tone: "brand" as const, run: () => (location.href = telHref(c.phone)!) }] : []),
        {
          label: "Delete",
          icon: "trash",
          tone: "danger",
          run: () => void confirmDelete("contact", () => deleteContact(c.id), undefined, `${c.name}, their notes and tag links will be removed. Deals and tasks stay.`),
        },
      ]}
    >
      <Row
        onClick={() => navigate(`/contacts/${c.id}`)}
        lead={<Avatar name={c.name} />}
        title={c.name}
        sub={[c.jobTitle, company].filter(Boolean).join(" · ") || c.email || " "}
        trail={
          <span class="row gap8" style="flex-shrink:0">
            <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABELS[c.status]}</Badge>
            {waHref(c.phone) && (
              <span
                role="button"
                tabIndex={0}
                class="wa-chip press"
                aria-label={`WhatsApp ${c.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  openWhatsApp(c.phone);
                }}
                style="padding:0 8px;height:30px;width:30px;justify-content:center"
              >
                <Icon name="whatsapp" size={17} />
              </span>
            )}
          </span>
        }
        chevron={false}
      />
    </SwipeRow>
  );
}

function FilterSheet({
  initial,
  tags,
  leadTypes,
  onApply,
}: {
  initial: Filters;
  tags: { id: string; name: string }[];
  leadTypes: { id: string; name: string }[];
  onApply: (f: Filters) => void;
}) {
  const [f, setF] = useState(initial);
  const chipRow = (key: keyof Filters, opts: { value: string; label: string }[]) => (
    <div class="row wrap gap8" style="padding:0 4px">
      {opts.map((o) => (
        <button key={o.value} class="chip press" aria-pressed={f[key] === o.value} onClick={() => setF({ ...f, [key]: f[key] === o.value ? "" : o.value })}>
          {o.label}
        </button>
      ))}
    </div>
  );
  return (
    <div class="form">
      <div>
        <div class="group-label">Priority</div>
        {chipRow("priority", CONTACT_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] })))}
      </div>
      {tags.length > 0 && (
        <div>
          <div class="group-label">Tag</div>
          {chipRow("tagId", tags.map((t) => ({ value: t.id, label: t.name })))}
        </div>
      )}
      {leadTypes.length > 0 && (
        <div>
          <div class="group-label">Lead type</div>
          {chipRow("leadTypeId", leadTypes.map((t) => ({ value: t.id, label: t.name })))}
        </div>
      )}
      <div class="row gap8">
        <button class="btn plain grow press" onClick={() => onApply({ ...NO_FILTERS, status: f.status })}>
          Reset
        </button>
        <button class="btn primary grow press" onClick={() => onApply(f)}>
          Show results
        </button>
      </div>
    </div>
  );
}

// ---------------- detail ----------------
export function ContactDetail({ id }: { id: string }) {
  const data = useLive(async () => {
    const c = await db.contacts.get(id);
    if (!c) return null;
    const [company, links, leadType, deals, stages] = await Promise.all([
      c.companyId ? db.companies.get(c.companyId) : undefined,
      db.contactTags.where("contactId").equals(id).toArray(),
      c.leadTypeId ? db.leadTypes.get(c.leadTypeId) : undefined,
      db.deals.where("contactId").equals(id).toArray(),
      db.stages.toArray(),
    ]);
    const tags = (await db.tags.bulkGet(links.map((l) => l.tagId))).filter(Boolean);
    return { c, company, tags, leadType, deals, stages: new Map(stages.map((s) => [s.id, s])) };
  }, [id]);

  if (data === undefined) return <Screen title="" backLabel="Contacts" large={false}><div /></Screen>;
  if (data === null)
    return (
      <Screen title="Contact" backLabel="Back" large={false}>
        <Empty icon="user" title="Contact not found" text="It may have been deleted." />
      </Screen>
    );
  const { c, company, tags, leadType, deals, stages } = data;
  const web = safeUrl(c.website);
  const linkedin = safeUrl(c.linkedinUrl);

  return (
    <Screen
      title={c.name}
      backLabel="Contacts"
      backTo="/contacts"
      large={false}
      right={
        <>
          <button class="nav-btn" onClick={() => openContactForm(c)}>
            Edit
          </button>
          <button
            class="nav-btn"
            aria-label="Options"
            onClick={() =>
              actionSheet([
                { label: "New deal", icon: "dollar", run: () => openDealForm(undefined, { contactId: c.id, companyId: c.companyId, name: `${c.name} deal` }) },
                {
                  label: "Delete contact",
                  icon: "trash",
                  destructive: true,
                  run: () => void confirmDelete("contact", () => deleteContact(c.id), () => back("/contacts"), "Their notes and tag links will be removed. Deals and tasks stay."),
                },
              ])
            }
          >
            <Icon name="more" size={24} />
          </button>
        </>
      }
    >
      <div class="d-hero fade-in">
        <div class="pop-in">
          <Avatar name={c.name} size="lg" />
        </div>
        <h1 class="selectable">{c.name}</h1>
        {(c.jobTitle || company) && (
          <p class="d-sub">
            {c.jobTitle}
            {c.jobTitle && company ? " at " : ""}
            {company && (
              <button class="c-brand" onClick={() => navigate(`/companies/${company.id}`)}>
                {company.name}
              </button>
            )}
          </p>
        )}
        <div class="row gap8 wrap center mt4">
          <Badge tone={STATUS_TONE[c.status]} dot>
            {STATUS_LABELS[c.status]}
          </Badge>
          {c.priority && <Badge tone={PRIORITY_TONE[c.priority]}>{PRIORITY_LABELS[c.priority]} priority</Badge>}
          {leadType && <Badge tone="info">{leadType.name}</Badge>}
          {c.paymentTerms === "credit" ? <Badge tone="warning">Pays on credit</Badge> : c.paymentTerms === "immediate" ? <Badge tone="success">Pays immediately</Badge> : null}
        </div>
      </div>

      <div class="content">
        <div class="qa-row">
          <a class="qa press" href={telHref(c.phone)} aria-disabled={!telHref(c.phone)}>
            <Icon name="phone" size={22} />
            call
          </a>
          <a class="qa wa press" {...waLinkProps(c.phone)} aria-disabled={!waHref(c.phone)}>
            <Icon name="whatsapp" size={22} />
            WhatsApp
          </a>
          <a class="qa press" href={smsHref(c.phone)} aria-disabled={!smsHref(c.phone)}>
            <Icon name="message" size={22} />
            text
          </a>
          <a class="qa press" href={mailHref(c.email)} aria-disabled={!mailHref(c.email)}>
            <Icon name="mail" size={22} />
            mail
          </a>
        </div>

        <Group class="section">
          {c.email && <Row title={<span class="selectable">{c.email}</span>} sub="email" chevron={false} />}
          {c.phone && <Row title={<span class="selectable">{c.phone}</span>} sub="phone" chevron={false} />}
          {web && <Row title={hostOf(c.website)} sub="website" href={web} />}
          {linkedin && <Row title={hostOf(c.linkedinUrl)} sub="LinkedIn" href={linkedin} />}
          {(c.city || c.country) && <Row title={[c.city, c.country].filter(Boolean).join(", ")} sub="location" chevron={false} />}
          {c.niche && <Row title={c.niche} sub="niche" chevron={false} />}
          {c.expectedRevenue !== undefined && <Row title={money(c.expectedRevenue)} sub="expected revenue" chevron={false} />}
          {c.expectedClose && <Row title={shortDate(c.expectedClose)} sub="expected close" chevron={false} />}
          {c.probability && <Row title={c.probability} sub="probability" chevron={false} />}
          <Row title={relativeTime(c.lastActivityAt ?? c.updatedAt)} sub="last activity" chevron={false} />
        </Group>

        {leadType && leadType.fields.length > 0 && (
          <Group class="section" label={leadType.name}>
            {leadType.fields.map((f) => {
              const v = c.customFields[f.key];
              const shown = f.type === "checkbox" ? (v === true ? "Yes" : "No") : f.type === "date" && typeof v === "string" ? shortDate(v) : v === undefined || v === "" ? "—" : String(v);
              return <Row key={f.key} title={shown} sub={f.label} chevron={false} />;
            })}
          </Group>
        )}

        <section class="section">
          <div class="section-head">
            <h2>Tags</h2>
            <button class="link" onClick={() => openContactForm(c)}>
              Edit
            </button>
          </div>
          {tags.length ? (
            <div class="row wrap gap8" style="padding:0 4px">
              {tags.map((t) => (
                <Badge key={t!.id} tone={t!.color}>
                  {t!.name}
                </Badge>
              ))}
            </div>
          ) : (
            <p class="t-subhead c3" style="padding:0 4px">No tags.</p>
          )}
        </section>

        <section class="section">
          <div class="section-head">
            <h2>Deals</h2>
            <button class="link" onClick={() => openDealForm(undefined, { contactId: c.id, companyId: c.companyId, name: `${c.name} deal` })}>
              Add
            </button>
          </div>
          {deals.length ? (
            <div class="group">
              {deals.map((d, i) => {
                const s = stages.get(d.stageId);
                return (
                  <Row
                    key={d.id}
                    i={i}
                    onClick={() => navigate(`/deals/${d.id}`)}
                    lead={<Avatar name={d.name} square icon="dollar" />}
                    title={d.name}
                    sub={s?.name}
                    value={money(d.value, d.currency)}
                  />
                );
              })}
            </div>
          ) : (
            <p class="t-subhead c3" style="padding:0 4px">No deals.</p>
          )}
        </section>

        <ContactMoney contactId={c.id} name={c.name} phone={c.phone} />

        <TaskSection parent={{ contactId: c.id }} />

        <section class="section">
          <div class="section-head">
            <h2>Activity</h2>
          </div>
          <Timeline parent={{ contactId: c.id }} />
        </section>
      </div>
    </Screen>
  );
}
