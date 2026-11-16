// Deals kanban for a phone: one full-width page per stage (swipe between
// them), a stage strip with counts and totals, long-press drag onto a stage
// dock, plus a "Move to…" sheet as the accessible fallback.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { db, type Deal, type Stage } from "../db/schema";
import { defaultPipelineId, deleteDeal, moveDeal } from "../db/repo";
import { exportCsv } from "../db/csvExport";
import { useLive } from "../lib/hooks";
import { money, shortDate } from "../lib/format";
import { back, navigate } from "../lib/router";
import { Icon } from "../ui/icons";
import { Avatar, Badge, Empty, Group, Row, Screen, SearchField, useDebounced } from "../ui/kit";
import { actionSheet, toast } from "../ui/overlay";
import { Draggable, DropDock } from "../ui/drag";
import { openDealForm } from "./forms";
import { TaskSection, Timeline, confirmDelete } from "./shared";

async function loadBoard() {
  const pid = await defaultPipelineId();
  const [stages, deals, contacts, companies] = await Promise.all([
    pid ? db.stages.where("pipelineId").equals(pid).sortBy("position") : Promise.resolve([] as Stage[]),
    db.deals.toArray(),
    db.contacts.toArray(),
    db.companies.toArray(),
  ]);
  return {
    stages,
    deals: deals.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    contact: new Map(contacts.map((c) => [c.id, c.name])),
    company: new Map(companies.map((c) => [c.id, c.name])),
  };
}

function stageTone(s?: Stage) {
  return s?.isWon ? "success" : s?.isLost ? "neutral" : "brand";
}

export function moveSheet(deal: Deal, stages: Stage[]) {
  actionSheet(
    stages.map((s) => ({
      label: s.id === deal.stageId ? `${s.name} (current)` : s.name,
      run: async () => {
        if (s.id === deal.stageId) return;
        await moveDeal(deal.id, s.id);
        toast(`Moved to ${s.name}`, { icon: s.isWon ? "sparkles" : "arrowRight" });
      },
    })),
    `Move “${deal.name}” to…`,
  );
}

export function Pipeline() {
  const board = useLive(loadBoard, []);
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim().toLowerCase());
  const [page, setPage] = useState(0);
  const pager = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);

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

  // Keep the stage strip in sync with the swiped page.
  useEffect(() => {
    const el = pager.current;
    if (!el) return;
    const onScroll = () => {
      const w = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? el.clientWidth;
      const p = Math.round(el.scrollLeft / (w + 12));
      setPage((old) => (old === p ? old : p));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [board?.stages.length]);
  useEffect(() => {
    strip.current?.children[page]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [page]);

  const goTo = (i: number) => {
    const el = pager.current;
    const pane = el?.children[i] as HTMLElement | undefined;
    if (el && pane) el.scrollTo({ left: pane.offsetLeft - 16, behavior: "smooth" });
  };

  const zones = (board?.stages ?? []).map((s) => ({ id: s.id, label: s.name, sub: `${byStage.get(s.id)?.length ?? 0}` }));

  return (
    <Screen
      title="Pipeline"
      subtitle={board ? `${openTotal.n} open · ${money(openTotal.v, "USD")}` : " "}
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
          <button class="nav-btn" aria-label="New deal" onClick={() => openDealForm(undefined, board?.stages[page] ? { stageId: board.stages[page].id } : {})}>
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
          <div class="stage-strip" ref={strip}>
            {board.stages.map((s, i) => {
              const ds = byStage.get(s.id) ?? [];
              return (
                <button key={s.id} class="chip press" aria-pressed={page === i} onClick={() => goTo(i)}>
                  {s.name}
                  <span class="count">{ds.length}</span>
                </button>
              );
            })}
          </div>
          <div class="pager" ref={pager}>
            {board.stages.map((s) => {
              const ds = byStage.get(s.id) ?? [];
              const total = ds.reduce((a, d) => a + (d.value || 0), 0);
              return (
                <section class="pane" key={s.id} aria-label={s.name}>
                  <div class="pane-head">
                    <div class="row gap8">
                      <Badge tone={stageTone(s)} dot>
                        {s.name}
                      </Badge>
                      {s.probability !== undefined && <span class="t-footnote c3">{s.probability}%</span>}
                    </div>
                    <span class="t-subhead c2 num">{money(total, "USD", true)}</span>
                  </div>
                  <div class="pane-body">
                    {ds.length === 0 ? (
                      <button class="t-subhead c3 press" style="padding:28px 8px;text-align:center" onClick={() => openDealForm(undefined, { stageId: s.id })}>
                        No deals here. Tap to add one, or long-press a deal in another stage to move it.
                      </button>
                    ) : (
                      ds.map((d, i) => (
                        <div key={d.id} class="rise" style={{ "--i": i } as never}>
                          <Draggable itemId={d.id} zones={zones} currentZone={d.stageId} onTap={() => navigate(`/deals/${d.id}`)} onDrop={async (z) => {
                            await moveDeal(d.id, z);
                            const st = board.stages.find((x) => x.id === z);
                            toast(`Moved to ${st?.name}`, { icon: st?.isWon ? "sparkles" : "arrowRight" });
                          }}>
                            <div class="row between" style="align-items:flex-start">
                              <span class="t-headline clamp2" style="flex:1">{d.name}</span>
                              <button
                                class="c3"
                                aria-label="Move deal"
                                style="margin:-6px -6px 0 0;padding:6px"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveSheet(d, board.stages);
                                }}
                              >
                                <Icon name="more" size={20} />
                              </button>
                            </div>
                            <div class="t-title3 t-metric mt8">{money(d.value, d.currency)}</div>
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
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>
          <div class="dots" aria-hidden="true">
            {board.stages.map((s, i) => (
              <span key={s.id} class={i === page ? "on" : ""} />
            ))}
          </div>
          <p class="t-footnote c3" style="text-align:center;padding:10px 24px 0">Hold a deal to drag it to another stage</p>
        </>
      )}
      <DropDock />
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
    return { d, stages, contact, company };
  }, [id]);

  if (data === undefined) return <Screen title="" backLabel="Pipeline" large={false}><div /></Screen>;
  if (data === null)
    return (
      <Screen title="Deal" backLabel="Back" large={false}>
        <Empty icon="dollar" title="Deal not found" />
      </Screen>
    );
  const { d, stages, contact, company } = data;
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
          <span class="h-label">{stage?.name ?? "Deal"}</span>
          <div class="h-value t-metric selectable">{money(d.value, d.currency)}</div>
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

        {stage && !stage.isWon && !stage.isLost && (won || lost) && (
          <div class="row gap8 mt12">
            {won && (
              <button
                class="btn block press"
                style="background:var(--success-soft);color:var(--success)"
                onClick={async () => {
                  await moveDeal(d.id, won.id);
                  toast("Deal won, congratulations!", { icon: "sparkles" });
                }}
              >
                <Icon name="check" size={20} /> Won
              </button>
            )}
            {lost && (
              <button
                class="btn plain block press"
                onClick={async () => {
                  await moveDeal(d.id, lost.id);
                  toast("Marked as lost");
                }}
              >
                <Icon name="x" size={20} /> Lost
              </button>
            )}
          </div>
        )}

        <Group class="section">
          <Row title={stage?.name ?? "—"} sub="stage" onClick={() => moveSheet(d, stages)} />
          {contact && <Row title={contact.name} sub="contact" lead={<Avatar name={contact.name} />} onClick={() => navigate(`/contacts/${contact.id}`)} />}
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
