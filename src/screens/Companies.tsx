import { useMemo, useState } from "preact/hooks";
import { db } from "../db/schema";
import { deleteCompany } from "../db/repo";
import { exportCsv } from "../db/csvExport";
import { useLive } from "../lib/hooks";
import { STATUS_LABELS, STATUS_TONE } from "../lib/options";
import { money } from "../lib/format";
import { hostOf, safeUrl, telHref } from "../lib/sanitize";
import { back, navigate } from "../lib/router";
import { Icon } from "../ui/icons";
import { Avatar, Badge, Empty, Group, Row, Screen, SearchField, SkeletonList, SwipeRow, useDebounced } from "../ui/kit";
import { actionSheet } from "../ui/overlay";
import { openCompanyForm, openContactForm, openDealForm } from "./forms";
import { TaskSection, Timeline, confirmDelete } from "./shared";
import { openCsvImport } from "./CsvImport";

export function CompaniesList() {
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim().toLowerCase());
  const data = useLive(async () => {
    const [companies, contacts, deals] = await Promise.all([db.companies.orderBy("name").toArray(), db.contacts.toArray(), db.deals.toArray()]);
    const people = new Map<string, number>();
    contacts.forEach((c) => c.companyId && people.set(c.companyId, (people.get(c.companyId) ?? 0) + 1));
    const value = new Map<string, number>();
    deals.forEach((d) => d.companyId && value.set(d.companyId, (value.get(d.companyId) ?? 0) + (d.value || 0)));
    return { companies, people, value };
  }, []);
  const list = useMemo(
    () => data?.companies.filter((c) => !query || [c.name, c.industry, c.domain].some((v) => v?.toLowerCase().includes(query))),
    [data, query],
  );

  return (
    <Screen
      title="Companies"
      subtitle={data ? `${data.companies.length} organisations` : " "}
      backLabel="More"
      backTo="/more"
      right={
        <>
          <button
            class="nav-btn"
            aria-label="Options"
            onClick={() =>
              actionSheet([
                { label: "Import from CSV", icon: "upload", run: () => void openCsvImport("companies") },
                { label: "Export to CSV", icon: "share", run: () => void exportCsv("companies") },
              ])
            }
          >
            <Icon name="more" size={24} />
          </button>
          <button class="nav-btn" aria-label="New company" onClick={() => openCompanyForm()}>
            <Icon name="plus" size={26} />
          </button>
        </>
      }
    >
      <SearchField value={q} onInput={setQ} placeholder="Search companies" />
      <div class="content">
        {!list ? (
          <SkeletonList />
        ) : list.length === 0 ? (
          <Empty
            icon="building"
            title={data!.companies.length ? "No matches" : "No companies yet"}
            text={data!.companies.length ? "Try another search." : "Companies group your contacts and deals."}
            action={!data!.companies.length && <button class="btn primary sm press" onClick={() => openCompanyForm()}>Add company</button>}
          />
        ) : (
          <div class="group">
            {list.map((c, i) => (
              <SwipeRow
                key={c.id}
                i={i}
                actions={[
                  {
                    label: "Delete",
                    icon: "trash",
                    tone: "danger",
                    run: () => void confirmDelete("company", () => deleteCompany(c.id), undefined, "Contacts, deals and tasks are kept and unlinked."),
                  },
                ]}
              >
                <Row
                  onClick={() => navigate(`/companies/${c.id}`)}
                  lead={<Avatar name={c.name} square />}
                  title={c.name}
                  sub={[c.industry, `${data!.people.get(c.id) ?? 0} people`].filter(Boolean).join(" · ")}
                  value={data!.value.get(c.id) ? money(data!.value.get(c.id), "USD", true) : undefined}
                />
              </SwipeRow>
            ))}
          </div>
        )}
      </div>
    </Screen>
  );
}

export function CompanyDetail({ id }: { id: string }) {
  const data = useLive(async () => {
    const c = await db.companies.get(id);
    if (!c) return null;
    const [contacts, deals, stages] = await Promise.all([
      db.contacts.where("companyId").equals(id).sortBy("name"),
      db.deals.where("companyId").equals(id).toArray(),
      db.stages.toArray(),
    ]);
    return { c, contacts, deals, stages: new Map(stages.map((s) => [s.id, s])) };
  }, [id]);

  if (data === undefined) return <Screen title="" backLabel="Companies" large={false}><div /></Screen>;
  if (data === null)
    return (
      <Screen title="Company" backLabel="Back" large={false}>
        <Empty icon="building" title="Company not found" />
      </Screen>
    );
  const { c, contacts, deals, stages } = data;
  const web = safeUrl(c.website ?? c.domain);

  return (
    <Screen
      title={c.name}
      backLabel="Companies"
      backTo="/companies"
      large={false}
      right={
        <>
          <button class="nav-btn" onClick={() => openCompanyForm(c)}>
            Edit
          </button>
          <button
            class="nav-btn"
            aria-label="Options"
            onClick={() =>
              actionSheet([
                {
                  label: "Delete company",
                  icon: "trash",
                  destructive: true,
                  run: () => void confirmDelete("company", () => deleteCompany(c.id), () => back("/companies"), "Contacts, deals and tasks are kept and unlinked."),
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
          <Avatar name={c.name} size="lg" square />
        </div>
        <h1 class="selectable">{c.name}</h1>
        {c.industry && <p class="d-sub">{c.industry}</p>}
      </div>
      <div class="content">
        <div class="qa-row" style="grid-template-columns:repeat(3,1fr)">
          <a class="qa press" href={telHref(c.phone)} aria-disabled={!telHref(c.phone)}>
            <Icon name="phone" size={22} />
            call
          </a>
          <a class="qa press" href={web} target="_blank" rel="noopener noreferrer" aria-disabled={!web}>
            <Icon name="globe" size={22} />
            website
          </a>
          <button class="qa press" onClick={() => openContactForm(undefined, { companyId: c.id })}>
            <Icon name="user" size={22} />
            add person
          </button>
        </div>

        <Group class="section">
          {web && <Row title={hostOf(web)} sub="website" href={web} />}
          {c.phone && <Row title={<span class="selectable">{c.phone}</span>} sub="phone" chevron={false} />}
          {c.size !== undefined && <Row title={String(c.size)} sub="employees" chevron={false} />}
          {c.address && <Row title={<span class="selectable pre">{c.address}</span>} sub="address" chevron={false} />}
          {!web && !c.phone && c.size === undefined && !c.address && <Row title={<span class="c3">No details yet</span>} onClick={() => openCompanyForm(c)} />}
        </Group>

        <section class="section">
          <div class="section-head">
            <h2>People</h2>
            <button class="link" onClick={() => openContactForm(undefined, { companyId: c.id })}>
              Add
            </button>
          </div>
          {contacts.length ? (
            <div class="group">
              {contacts.map((p, i) => (
                <Row
                  key={p.id}
                  i={i}
                  onClick={() => navigate(`/contacts/${p.id}`)}
                  lead={<Avatar name={p.name} />}
                  title={p.name}
                  sub={p.jobTitle}
                  trail={<Badge tone={STATUS_TONE[p.status]}>{STATUS_LABELS[p.status]}</Badge>}
                />
              ))}
            </div>
          ) : (
            <p class="t-subhead c3" style="padding:0 4px">No people yet.</p>
          )}
        </section>

        <section class="section">
          <div class="section-head">
            <h2>Deals</h2>
            <button class="link" onClick={() => openDealForm(undefined, { companyId: c.id, name: `${c.name} deal` })}>
              Add
            </button>
          </div>
          {deals.length ? (
            <div class="group">
              {deals.map((d, i) => (
                <Row key={d.id} i={i} onClick={() => navigate(`/deals/${d.id}`)} lead={<Avatar name={d.name} square icon="dollar" />} title={d.name} sub={stages.get(d.stageId)?.name} value={money(d.value, d.currency)} />
              ))}
            </div>
          ) : (
            <p class="t-subhead c3" style="padding:0 4px">No deals.</p>
          )}
        </section>

        <TaskSection parent={{ companyId: c.id }} />

        <section class="section">
          <div class="section-head">
            <h2>Activity</h2>
          </div>
          <Timeline parent={{ companyId: c.id }} />
        </section>
      </div>
    </Screen>
  );
}
