// Deals kanban for a phone: one full-width page per stage (swipe between
// them), a stage strip with counts and totals, long-press drag onto a stage
// dock, plus a "Move to…" sheet as the accessible fallback.
import { useMemo, useState } from "preact/hooks";
import { db, type Deal, type Stage } from "../db/schema";
import { dealReceived, defaultPipelineId, deleteDeal, moveDeal } from "../db/repo";
import { exportCsv } from "../db/csvExport";
import { useLive } from "../lib/hooks";
import { money, shortDate } from "../lib/format";
import { back, navigate } from "../lib/router";
import { Icon } from "../ui/icons";
import { Avatar, Badge, Empty, Group, Row, Screen, SearchField, useDebounced } from "../ui/kit";
import { actionSheet, toast } from "../ui/overlay";
import { openWhatsApp, waHref, waLinkProps } from "../lib/whatsapp";
import { Draggable } from "../ui/drag";
import { StageSection } from "../ui/board";
import { openDealForm, openLeadForm, openTransactionForm } from "./forms";
import { openDealPaymentForm, openWonForm } from "./moneyForms";
import { TaskSection, Timeline, confirmDelete } from "./shared";

async function loadBoard() {
  const pid = await defaultPipelineId();
  const [stages, deals, contacts, companies, txs] = await Promise.all([
    pid ? db.stages.where("pipelineId").equals(pid).sortBy("position") : Promise.resolve([] as Stage[]),
    db.deals.toArray(),
    db.contacts.toArray(),
    db.companies.toArray(),
    db.transactions.where("dealId").above("").toArray(),
  ]);
  const received = new Map<string, number>();
  for (const t of txs) if (t.dealId && t.type === "income") received.set(t.dealId, (received.get(t.dealId) ?? 0) + t.amount);
  return {
    stages,
    deals: deals.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    contact: new Map(contacts.map((c) => [c.id, c.name])),
    phone: new Map(contacts.filter((c) => c.phone).map((c) => [c.id, c.phone!])),
    company: new Map(companies.map((c) => [c.id, c.name])),
    received,
  };
}

function stageTone(s?: Stage) {
  return s?.isWon ? "success" : s?.isLost ? "neutral" : "brand";
}

/**
 * Move a deal and react to it. The moment a deal reaches a Won stage, ask for
 * the project details (name, description, agreed total, advance + account)
 * and create the client's project. The deal stays in Won.
 */
export async function moveDealTo(dealId: string, stageId: string) {
  await moveDeal(dealId, stageId);
  const [deal, stage] = await Promise.all([db.deals.get(dealId), db.stages.get(stageId)]);
  const needsProject = !!deal && !!stage?.isWon && (await db.projects.where("dealId").equals(deal.id).count()) === 0;
  // The won popup is its own celebration; a toast would sit on top of its buttons.
  if (needsProject) setTimeout(() => openWonForm(deal!), 300);
  else toast(stage?.isWon ? "Deal won, congratulations!" : `Moved to ${stage?.name}`, { icon: stage?.isWon ? "sparkles" : "arrowRight" });
}

export function moveSheet(deal: Deal, stages: Stage[]) {
  actionSheet(
    stages.map((s) => ({
      label: s.id === deal.stageId ? `${s.name} (current)` : s.name,
      run: async () => {
        if (s.id === deal.stageId) return;
        await moveDealTo(deal.id, s.id);
      },
    })),
    `Move “${deal.name}” to…`,
  );
}

export function Pipeline() {
  const board = useLive(loadBoard, []);
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim().toLowerCase());

  const filtered = useMemo(() => {
    if (!board) return [];
    if (!query) return board.deals;
    return board.deals.filter((d) =>
      [d.name, d.contactId && board.contact.get(d.contactId), d.companyId && board.company.get(d.companyId)].some((v) => typeof v === "string" && v.toLowerCase().includes(query)),
    );
  }, [board, query]);

  const byStage = useMemo(() => {
    const m = new Map<string, Deal[]>();
    board?.stages.forEach((s) => m.set(s.id, []));
    filtered.forEach((d) => m.get(d.stageId)?.push(d));
    return m;
  }, [board, filtered]);

  const openTotal = useMemo(() => {
    if (!board) return { n: 0, v: 0 };
    const closed = new Set(board.stages.filter((s) => s.isWon || s.isLost).map((s) => s.id));
    const open = board.deals.filter((d) => !closed.has(d.stageId));
    return { n: open.length, v: open.reduce((a, d) => a + (d.value || 0), 0) };
  }, [board]);

  const zones = (board?.stages ?? []).map((s) => ({ id: s.id, label: s.name, sub: `${byStage.get(s.id)?.length ?? 0}` }));

  return (
    <Screen
      title="Pipeline"
      subtitle={board ? `${openTotal.n} open · ${money(openTotal.v)}` : " "}
      right={
        <>
          <button
            class="nav-btn"
            aria-label="Options"
            onClick={() =>
              actionSheet([
                { label: "Edit stages", icon: "columns", run: () => navigate("/pipeline/stages") },
                { label: "Export deals to CSV", icon: "share", run: () => void exportCsv("deals") },
                { label: "Reports", icon: "chart", run: () => navigate("/reports") },
              ])
            }
          >
            <Icon name="more" size={24} />
          </button>
          <button class="nav-btn" aria-label="New lead" onClick={() => openLeadForm()}>
            <Icon name="plus" size={26} />
          </button>
        </>
      }
    >
      <SearchField value={q} onInput={setQ} placeholder="Search deals" />
      {!board ? (
        <div class="content">
          <div class="skel" style="height:320px;border-radius:22px" />
        </div>
      ) : board.stages.length === 0 ? (
        <Empty icon="pipeline" title="No stages" text="Add stages to start tracking deals." action={<button class="btn primary sm" onClick={() => navigate("/pipeline/stages")}>Edit stages</button>} />
      ) : (
        <>
          <p class="t-footnote c3" style="padding:0 20px">Hold a deal, then drag it up or down to another stage.</p>
          <div class="content">
            {board.stages.map((s) => {
              const ds = byStage.get(s.id) ?? [];
              const total = ds.reduce((a, d) => a + (d.value || 0), 0);
              return (
                <StageSection
                  key={s.id}
                  id={s.id}
                  count={ds.length}
                  limit={s.isWon || s.isLost ? 4 : undefined}
                  head={
                    <Badge tone={stageTone(s)} dot>
                      {s.name}
                    </Badge>
                  }
                  right={total > 0 ? <span class="t-subhead c2 num">{money(total, undefined, true)}</span> : undefined}
                  empty={
                    s.isWon ? (
                      "Won deals land here."
                    ) : (
                      <button class="c3" onClick={() => openLeadForm({ stageId: s.id })}>
                        No leads here. Tap to add one.
                      </button>
                    )
                  }
                >
                  {ds.map((d, i) => (
                    <div key={d.id} class="rise" style={{ "--i": i } as never}>
                          <Draggable dock={false} itemId={d.id} zones={zones} currentZone={d.stageId} onTap={() => navigate(`/deals/${d.id}`)} onDrop={async (z) => {
                            await moveDealTo(d.id, z);
                          }}>
                            <div class="row between" style="align-items:flex-start">
                              <span class="t-headline clamp2" style="flex:1">{d.name}</span>
                              <button
                                class="c3"
                                aria-label="Move deal"
                                style="margin:-6px -6px 0 0;padding:6px"
                                data-nodrag
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveSheet(d, board.stages);
                                }}
                              >
                                <Icon name="more" size={20} />
                              </button>
                            </div>
                            <div class="row between mt8">
                              <div class="col">
                                {d.value ? <div class="t-title3 t-metric">{money(d.value, d.currency)}</div> : <div class="t-subhead c3">{s.isWon ? "Total not agreed" : "No amount yet"}</div>}
                                {(board.received.get(d.id) ?? 0) > 0 && (
                                  <span class="t-footnote c-success" style="font-weight:600">{money(board.received.get(d.id), d.currency)} received</span>
                                )}
                              </div>
                              {d.contactId && waHref(board.phone.get(d.contactId)) && (
                                <span
                                  role="button"
                                  tabIndex={0}
                                  class="wa-chip press"
                                  aria-label={`WhatsApp ${board.contact.get(d.contactId) ?? ""}`}
                                  data-nodrag
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openWhatsApp(board.phone.get(d.contactId!));
                                  }}
                                >
                                  <Icon name="whatsapp" size={16} />
                                  WhatsApp
                                </span>
                              )}
                            </div>
                            <div class="row gap8 mt8 t-footnote c2">
                              {d.contactId && board.contact.get(d.contactId) && (
                                <span class="row gap4 truncate">
                                  <Icon name="user" size={13} />
                                  {board.contact.get(d.contactId)}
                                </span>
                              )}
                              {d.companyId && board.company.get(d.companyId) && (
                                <span class="row gap4 truncate">
                                  <Icon name="building" size={13} />
                                  {board.company.get(d.companyId)}
                                </span>
                              )}
                              {d.expectedCloseDate && (
                                <span class="row gap4" style="margin-left:auto;flex-shrink:0">
                                  <Icon name="calendar" size={13} />
                                  {shortDate(d.expectedCloseDate)}
                                </span>
                              )}
                            </div>
                          </Draggable>
                    </div>
                  ))}
                </StageSection>
              );
            })}
          </div>

        </>
      )}
    </Screen>
  );
}

// ---------------- deal detail ----------------
export function DealDetail({ id }: { id: string }) {
  const data = useLive(async () => {
    const d = await db.deals.get(id);
    if (!d) return null;
    const [stages, contact, company] = await Promise.all([
      db.stages.where("pipelineId").equals(d.pipelineId).sortBy("position"),
      d.contactId ? db.contacts.get(d.contactId) : undefined,
      d.companyId ? db.companies.get(d.companyId) : undefined,
    ]);
    const receivable = await db.ledger.where("dealId").equals(d.id).first();
    const paid = await dealReceived(d.id);
    const project = await db.projects.where("dealId").equals(d.id).first();
    const accounts = new Map((await db.accounts.toArray()).map((a) => [a.id, a.name]));
    return { d, stages, contact, company, receivable, paid, project, accounts };
  }, [id]);

  if (data === undefined) return <Screen title="" backLabel="Pipeline" large={false}><div /></Screen>;
  if (data === null)
    return (
      <Screen title="Deal" backLabel="Back" large={false}>
        <Empty icon="dollar" title="Deal not found" />
      </Screen>
    );
  const { d, stages, contact, company, receivable, paid, project, accounts } = data;
  const agreed = d.value || 0;
  const extra = agreed > 0 ? paid.received - agreed : 0;
  const newDealForClient = () =>
    openLeadForm({ stageId: stages.find((s) => !s.isWon && !s.isLost)?.id, contactId: contact?.id });
  const stage = stages.find((s) => s.id === d.stageId);
  const idx = stages.findIndex((s) => s.id === d.stageId);
  const openStages = stages.filter((s) => !s.isWon && !s.isLost);
  const progress = stage?.isWon ? 1 : stage?.isLost ? 0 : (openStages.findIndex((s) => s.id === d.stageId) + 1) / (openStages.length + 1);
  const won = stages.find((s) => s.isWon);
  const lost = stages.find((s) => s.isLost);

  return (
    <Screen
      title={d.name}
      backLabel="Pipeline"
      backTo="/pipeline"
      large={false}
      right={
        <>
          <button class="nav-btn" onClick={() => openDealForm(d)}>
            Edit
          </button>
          <button
            class="nav-btn"
            aria-label="Options"
            onClick={() =>
              actionSheet([
                { label: "Move to stage…", icon: "move", run: () => moveSheet(d, stages) },
                { label: "Record a payment", icon: "wallet", run: () => openDealPaymentForm(d, paid.received) },
                ...(contact ? [{ label: `New deal with ${contact.name.split(" ")[0]}`, icon: "plus" as const, run: newDealForClient }] : []),
                { label: "Delete deal", icon: "trash", destructive: true, run: () => void confirmDelete("deal", () => deleteDeal(d.id), () => back("/pipeline")) },
              ])
            }
          >
            <Icon name="more" size={24} />
          </button>
        </>
      }
    >
      <div class="content">
        <div class="hero rise" style={{ "--i": 0, paddingBottom: "20px" } as never}>
          <span class="h-label">{stage?.name ?? "Deal"}{stage?.isWon ? " · project" : ""}</span>
          <div class="h-value t-metric selectable">{agreed > 0 ? money(agreed, d.currency) : stage?.isWon ? "Total not agreed yet" : "No amount yet"}</div>
          <div class="h-sub">{d.name}</div>
          <div class="mt16" style="height:6px;border-radius:3px;background:rgb(255 255 255 / .25);overflow:hidden">
            <div style={{ height: "100%", width: `${Math.max(4, progress * 100)}%`, background: "#fff", borderRadius: "3px", transformOrigin: "left", animation: "grow-x 900ms var(--ease-out) both" }} />
          </div>
          <div class="row between mt8 t-footnote" style="opacity:.85">
            <span>
              Stage {idx + 1} of {stages.length}
            </span>
            {stage?.probability !== undefined && <span>{stage.probability}% likely</span>}
          </div>
        </div>

        {contact && waHref(contact.phone) && (
          <a class="btn wa block press mt12" {...waLinkProps(contact.phone)}>
            <Icon name="whatsapp" size={20} />
            WhatsApp {contact.name.split(" ")[0]}
          </a>
        )}

        {stage && !stage.isWon && !stage.isLost && (won || lost) && (
          <div class="row gap8 mt12">
            {won && (
              <button
                class="btn block press"
                style="background:var(--success-soft);color:var(--success)"
                onClick={async () => {
                  await moveDealTo(d.id, won.id);
                }}
              >
                <Icon name="check" size={20} /> Won
              </button>
            )}
            {lost && (
              <button
                class="btn plain block press"
                onClick={async () => {
                  await moveDealTo(d.id, lost.id);
                }}
              >
                <Icon name="x" size={20} /> Lost
              </button>
            )}
          </div>
        )}

        <section class="section">
          <div class="section-head">
            <h2>Money received</h2>
            <button class="link" onClick={() => openDealPaymentForm(d, paid.received)}>
              Record
            </button>
          </div>
          <div class="card rise" style={{ "--i": 2 } as never}>
            <div class="row between">
              <div class="col">
                <span class="t-footnote c3">Received</span>
                <span class="t-title2 t-metric c-success">{money(paid.received, d.currency)}</span>
              </div>
              <button class="col" style="align-items:flex-end;text-align:right" onClick={() => openDealPaymentForm(d, paid.received)}>
                <span class="t-footnote c3">Total agreed</span>
                <span class={`t-title3 t-metric ${agreed > 0 ? "" : "c3"}`}>{agreed > 0 ? money(agreed, d.currency) : "Not yet"}</span>
              </button>
            </div>
            <div class="bar-track mt12" style="height:8px">
              <div class="bar-fill won" style={{ width: `${agreed > 0 ? Math.min(100, Math.max(paid.received > 0 ? 3 : 0, (paid.received / agreed) * 100)) : paid.received > 0 ? 100 : 0}%` }} />
            </div>
            <p class="t-footnote mt8" style="font-weight:600">
              {agreed === 0 ? (
                <span class="c3">{paid.received > 0 ? "Received so far. Set the total when the price is agreed." : "Nothing received yet"}</span>
              ) : extra > 0 ? (
                <span class="c-success">+{money(extra, d.currency)} extra over the agreed total</span>
              ) : extra < 0 ? (
                <span class="c2">{money(-extra, d.currency)} still to collect</span>
              ) : paid.received > 0 ? (
                <span class="c-success">Fully paid</span>
              ) : (
                <span class="c3">Nothing received yet</span>
              )}
            </p>
            {paid.items.length > 0 && (
              <div class="mt12" style="border-top:0.5px solid var(--line)">
                {paid.items.map((t) => (
                  <button key={t.id} class="row between" style="width:100%;padding:10px 0;text-align:left" onClick={() => openTransactionForm(t)}>
                    <span class="col">
                      <span class="t-subhead" style="font-weight:600">{t.note || t.category}</span>
                      <span class="t-footnote c3">{[shortDate(t.date), t.accountId ? accounts.get(t.accountId) : "no account", t.method].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span class="t-subhead num c-success">+{money(t.amount, t.currency)}</span>
                  </button>
                ))}
              </div>
            )}
            <button class="btn tinted block press mt12" onClick={() => openDealPaymentForm(d, paid.received)}>
              <Icon name="plus" size={20} /> {paid.received === 0 ? "Record advance" : agreed > 0 && extra >= 0 ? "Record extra payment" : "Record payment"}
            </button>
          </div>
        </section>

        {contact && stage?.isWon && (
          <button class="btn plain block press mt12" onClick={newDealForClient}>
            <Icon name="plus" size={20} /> New deal / project with {contact.name.split(" ")[0]}
          </button>
        )}

        <Group class="section">
          <Row title={stage?.name ?? "—"} sub="stage" onClick={() => moveSheet(d, stages)} />
          {contact && (
            <Row
              title={contact.name}
              sub={contact.paymentTerms === "credit" ? "contact · pays on credit" : contact.paymentTerms === "immediate" ? "contact · pays immediately" : "contact"}
              lead={<Avatar name={contact.name} />}
              onClick={() => navigate(`/contacts/${contact.id}`)}
            />
          )}
          {project ? (
            <Row title={project.name} sub={project.description ? `project · ${project.description}` : "project board"} lead={<span class="tile violet"><Icon name="briefcase" size={16} /></span>} onClick={() => navigate(`/projects/${project.id}`)} />
          ) : (
            stage?.isWon && <Row title="Set up the project" sub="name, description, agreed total, advance" lead={<span class="tile violet"><Icon name="briefcase" size={16} /></span>} onClick={() => openWonForm(d)} />
          )}
          {receivable && (
            <Row title={receivable.settledAt ? "Credit entry · paid in full" : "Credit entry · track payments"} sub="money" lead={<span class="tile green"><Icon name="wallet" size={16} /></span>} onClick={() => navigate(`/money/${receivable.id}`)} />
          )}
          {company && <Row title={company.name} sub="company" lead={<Avatar name={company.name} square />} onClick={() => navigate(`/companies/${company.id}`)} />}
          {d.expectedCloseDate && <Row title={shortDate(d.expectedCloseDate)} sub="expected close" chevron={false} />}
          <Row title={shortDate(d.createdAt)} sub="created" chevron={false} />
        </Group>

        {d.description && (
          <section class="section">
            <div class="section-head">
              <h2>Description</h2>
            </div>
            <div class="card">
              <p class="t-callout pre selectable">{d.description}</p>
            </div>
          </section>
        )}

        <TaskSection parent={{ dealId: d.id }} />

        <section class="section">
          <div class="section-head">
            <h2>Activity</h2>
          </div>
          <Timeline parent={{ dealId: d.id }} />
        </section>
      </div>
    </Screen>
  );
}
