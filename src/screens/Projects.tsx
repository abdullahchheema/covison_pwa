import { useEffect, useRef, useState } from "preact/hooks";
import { db } from "../db/schema";
import { deleteColumn, deleteProject, deleteTodo, moveTodo, reorderColumns, restoreSnapshot } from "../db/repo";
import { useLive, useStoredState } from "../lib/hooks";
import { back, navigate } from "../lib/router";
import { Icon } from "../ui/icons";
import { Badge, Empty, Row, Screen, Segmented, SkeletonList, SwipeRow } from "../ui/kit";
import type { ProjectStatus } from "../db/schema";
import { STATUS_LABEL, loadProject, loadProjects, setProjectStatus, type ProjectMoney, type ProjectRow } from "../db/projects";
import { openProjectEditForm, openProjectMoneyForm } from "./moneyForms";
import { money, shortDate } from "../lib/format";
import { openTransactionForm } from "./forms";
import type { IconName } from "../ui/icons";
import { actionSheet, toast, undoToast } from "../ui/overlay";
import { Draggable, DropDock } from "../ui/drag";
import { openColumnForm, openTodoForm } from "./forms";
import { TaskSection, Timeline, confirmDelete } from "./shared";

const STAGE_TONE: Record<ProjectStatus, "neutral" | "brand" | "success"> = { not_started: "neutral", in_progress: "brand", completed: "success" };
const STAGE_ICON: Record<ProjectStatus, IconName> = { not_started: "circle", in_progress: "refresh", completed: "checkCircle" };

function ProjectMoneyLine({ m }: { m: ProjectMoney }) {
  return (
    <span class="pm-line">
      <span class="c-success">↓ {money(m.received)}</span>
      {m.spent > 0 && <span class="c-danger">↑ {money(m.spent)}</span>}
      <span class="c3">{m.agreed > 0 ? (m.due > 0 ? `${money(m.due)} due` : "paid") : "total not set"}</span>
    </span>
  );
}

export function ProjectRowItem({ r, i }: { r: ProjectRow; i: number }) {
  const next: ProjectStatus | undefined = r.status === "not_started" ? "in_progress" : r.status === "in_progress" ? "completed" : undefined;
  const pct = r.money.agreed > 0 ? Math.min(1, r.money.received / r.money.agreed) : 0;
  return (
    <SwipeRow
      i={i}
      actions={[
        ...(next ? [{ label: next === "in_progress" ? "Start" : "Complete", icon: (next === "in_progress" ? "refresh" : "check") as IconName, tone: "success" as const, run: () => void setProjectStatus(r.project.id, next).then(() => toast(`${r.project.name}: ${STATUS_LABEL[next]}`)) }] : []),
        ...(r.status === "completed" ? [{ label: "Reopen", icon: "refresh" as IconName, tone: "brand" as const, run: () => void setProjectStatus(r.project.id, "in_progress") }] : []),
      ]}
    >
      <Row
        onClick={() => navigate(`/projects/${r.project.id}`)}
        lead={
          <span class={`tile pstage ${r.status}`}>
            <Icon name={STAGE_ICON[r.status]} size={16} stroke={2.4} />
          </span>
        }
        title={r.project.name}
        sub={
          <span class="col" style="gap:3px">
            <span class="truncate">{r.client ?? "No client"}</span>
            <ProjectMoneyLine m={r.money} />
          </span>
        }
        trail={
          r.money.agreed > 0 ? (
            <span class="col" style="align-items:flex-end;gap:4px;flex-shrink:0">
              <span class="t-subhead num" style="font-weight:600">{money(r.money.agreed, "PKR", r.money.agreed >= 1_000_000)}</span>
              <span class="mini-track">
                <span style={{ width: `${pct * 100}%` }} />
              </span>
            </span>
          ) : undefined
        }
      />
    </SwipeRow>
  );
}

export function ProjectsList() {
  const rows = useLive(loadProjects, []);
  const [showDone, setShowDone] = useStoredState<boolean>("projects.showDone", false);
  const by = (st: ProjectStatus) => (rows ?? []).filter((r) => r.status === st);
  const active = (rows ?? []).filter((r) => r.status !== "completed");
  const totals = active.reduce((t, r) => ({ due: t.due + r.money.due, received: t.received + r.money.received, spent: t.spent + r.money.spent }), { due: 0, received: 0, spent: 0 });
  let i = 0;
  const section = (st: ProjectStatus, list: ProjectRow[]) =>
    list.length > 0 && (
      <section class="section" key={st}>
        <div class="section-head">
          <h2 class="row gap8">
            <Badge tone={STAGE_TONE[st]} dot>
              {STATUS_LABEL[st]}
            </Badge>
            <span class="t-subhead c3 num">{list.length}</span>
          </h2>
        </div>
        <div class="group">
          {list.map((r) => (
            <ProjectRowItem key={r.project.id} r={r} i={i++} />
          ))}
        </div>
      </section>
    );

  return (
    <Screen
      title="Projects"
      subtitle={rows ? `${active.length} ongoing` : " "}
      right={
        <button class="nav-btn" aria-label="New project" onClick={() => openProjectEditForm(undefined, (id) => setTimeout(() => navigate(`/projects/${id}`), 320))}>
          <Icon name="plus" size={26} />
        </button>
      }
    >
      <div class="content">
        {!rows ? (
          <SkeletonList rows={4} />
        ) : rows.length === 0 ? (
          <Empty
            icon="folder"
            title="No projects yet"
            text="When a lead is won, its project appears here automatically. You can also add one yourself."
            action={<button class="btn primary sm press" onClick={() => openProjectEditForm()}>New project</button>}
          />
        ) : (
          <>
            <div class="money-cards" style="grid-template-columns:repeat(3,1fr)">
              <div class="metric">
                <span class="m-label">Still due</span>
                <span class="m-value t-metric" style="font-size:18px">{money(totals.due, "PKR", totals.due >= 1_000_000)}</span>
              </div>
              <div class="metric">
                <span class="m-label">Received</span>
                <span class="m-value t-metric c-success" style="font-size:18px">{money(totals.received, "PKR", totals.received >= 1_000_000)}</span>
              </div>
              <div class="metric">
                <span class="m-label">Spent</span>
                <span class="m-value t-metric c-danger" style="font-size:18px">{money(totals.spent, "PKR", totals.spent >= 1_000_000)}</span>
              </div>
            </div>
            {section("not_started", by("not_started"))}
            {section("in_progress", by("in_progress"))}
            {by("completed").length > 0 && (
              <section class="section">
                <button class="section-head" style="width:100%" onClick={() => setShowDone(!showDone)}>
                  <h2 class="row gap8">
                    <Badge tone="success" dot>
                      Completed
                    </Badge>
                    <span class="t-subhead c3 num">{by("completed").length}</span>
                  </h2>
                  <span class="link">{showDone ? "Hide" : "Show"}</span>
                </button>
                {showDone && (
                  <div class="group">
                    {by("completed").map((r) => (
                      <ProjectRowItem key={r.project.id} r={r} i={i++} />
                    ))}
                  </div>
                )}
              </section>
            )}
            <p class="t-footnote c3" style="text-align:center;padding:14px 8px 0">Swipe a project left to start or complete it.</p>
          </>
        )}
      </div>
    </Screen>
  );
}

export function ProjectBoard({ id }: { id: string }) {
  const data = useLive(async () => {
    const p = await db.projects.get(id);
    if (!p) return null;
    const [columns, todos] = await Promise.all([db.projectColumns.where("projectId").equals(id).sortBy("position"), db.projectTodos.where("projectId").equals(id).sortBy("position")]);
    const client = p.contactId ? await db.contacts.get(p.contactId) : undefined;
    const row = await loadProject(id);
    const accounts = new Map((await db.accounts.toArray()).map((a) => [a.id, a.name]));
    return { p, columns, todos, client, row: row!, accounts };
  }, [id]);
  const pager = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  useEffect(() => {
    const el = pager.current;
    if (!el) return;
    const onScroll = () => {
      const w = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? el.clientWidth;
      setPage(Math.round(el.scrollLeft / (w + 12)));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [data?.columns.length]);

  if (data === undefined) return <Screen title="" backLabel="Projects" large={false}><div /></Screen>;
  if (data === null)
    return (
      <Screen title="Project" backLabel="Back" large={false}>
        <Empty icon="folder" title="Project not found" />
      </Screen>
    );
  const { p, columns, todos, client, row, accounts } = data;
  const m = row.money;
  const status = row.status;
  const zones = columns.map((c) => ({ id: c.id, label: c.name, sub: String(todos.filter((t) => t.columnId === c.id).length) }));
  const move = async (i: number, dir: -1 | 1) => {
    const ids = columns.map((c) => c.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await reorderColumns(ids);
  };

  return (
    <Screen
      title={p.name}
      subtitle={
        (client || p.dealId) && (
          <span class="row gap8 wrap">
            {client && (
              <button class="c-brand" onClick={() => navigate(`/contacts/${client.id}`)}>
                {client.name}
              </button>
            )}
            {p.dealId && (
              <button class="c2" onClick={() => navigate(`/deals/${p.dealId}`)}>
                · deal →
              </button>
            )}
          </span>
        )
      }
      backLabel="Projects"
      backTo="/projects"
      right={
        <>
          <button
            class="nav-btn"
            aria-label="Options"
            onClick={() =>
              actionSheet([
                { label: "Edit project", icon: "edit", run: () => openProjectEditForm(p) },
                { label: "Add to-do column", icon: "columns", run: () => openColumnForm(p.id, undefined, columns.length) },
                { label: "Delete project", icon: "trash", destructive: true, run: () => void confirmDelete("project", () => deleteProject(p.id), () => back("/projects"), "All its columns, to-dos, tasks and notes are removed.") },
              ])
            }
          >
            <Icon name="more" size={24} />
          </button>
          <button
            class="nav-btn"
            aria-label="Add to project"
            onClick={() =>
              actionSheet([
                { label: "Money received", icon: "arrowDownLeft", run: () => void openProjectMoneyForm(p, m.received) },
                { label: "Expense on this project", icon: "arrowUpRight", run: () => openTransactionForm(undefined, { type: "expense", scope: "business", projectId: p.id, contactId: p.contactId, category: "Project costs" }) },
                { label: "To-do", icon: "tasks", run: () => openTodoForm(p.id, columns, undefined, columns[page]?.id) },
              ])
            }
          >
            <Icon name="plus" size={26} />
          </button>
        </>
      }
    >
      <div class="content">
        <Segmented<ProjectStatus>
          value={status}
          onChange={(v) => void setProjectStatus(p.id, v).then(() => toast(STATUS_LABEL[v], { icon: v === "completed" ? "checkCircle" : "refresh" }))}
          options={[
            { value: "not_started", label: "Not started" },
            { value: "in_progress", label: "In progress" },
            { value: "completed", label: "Completed" },
          ]}
        />

        <div class="card rise mt12" style={{ "--i": 0 } as never}>
          <div class="pm-grid">
            <button class="pm-cell" onClick={() => void openProjectMoneyForm(p, m.received)}>
              <span class="t-footnote c3">Agreed</span>
              <span class={`t-headline t-metric ${m.agreed ? "" : "c3"}`}>{m.agreed ? money(m.agreed) : "Not set"}</span>
            </button>
            <div class="pm-cell">
              <span class="t-footnote c3">Received</span>
              <span class="t-headline t-metric c-success">{money(m.received)}</span>
            </div>
            <div class="pm-cell">
              <span class="t-footnote c3">Spent</span>
              <span class="t-headline t-metric c-danger">{money(m.spent)}</span>
            </div>
            <div class="pm-cell">
              <span class="t-footnote c3">{m.agreed ? "Still due" : "Profit"}</span>
              <span class={`t-headline t-metric ${m.agreed ? (m.due > 0 ? "" : "c-success") : m.profit >= 0 ? "c-success" : "c-danger"}`}>{m.agreed ? (m.due > 0 ? money(m.due) : "Paid") : money(m.profit)}</span>
            </div>
          </div>
          {m.agreed > 0 && (
            <div class="bar-track mt12" style="height:8px">
              <div class="bar-fill won" style={{ width: `${Math.min(100, (m.received / m.agreed) * 100)}%` }} />
            </div>
          )}
          {m.agreed > 0 && (
            <p class="t-footnote mt8 c2">
              Profit so far <strong class={m.profit >= 0 ? "c-success" : "c-danger"}>{money(m.profit)}</strong>
              {m.received > m.agreed ? ` · ${money(m.received - m.agreed)} extra over agreed` : ""}
            </p>
          )}
          <div class="row gap8 mt12">
            <button class="btn sm grow press" style="background:var(--success-soft);color:var(--success)" onClick={() => void openProjectMoneyForm(p, m.received)}>
              <Icon name="plus" size={16} /> Money received
            </button>
            <button class="btn sm grow press" style="background:var(--danger-soft);color:var(--danger)" onClick={() => openTransactionForm(undefined, { type: "expense", scope: "business", projectId: p.id, contactId: p.contactId, category: "Project costs" })}>
              <Icon name="plus" size={16} /> Expense
            </button>
          </div>
        </div>

        {p.description && <p class="t-subhead c2 pre selectable" style="padding:12px 4px 0">{p.description}</p>}

        <section class="section">
          <div class="section-head">
            <h2>Money in &amp; out</h2>
            <span class="t-footnote c3">{m.items.length}</span>
          </div>
          {m.items.length === 0 ? (
            <p class="t-subhead c3" style="padding:0 4px">No money recorded on this project yet.</p>
          ) : (
            <div class="group">
              {m.items.map((t, ti) => (
                <Row
                  key={t.id}
                  i={ti}
                  onClick={() => openTransactionForm(t)}
                  lead={
                    <span class="tile" style={{ background: t.type === "income" ? "linear-gradient(135deg,#149a68,#42d39a)" : "linear-gradient(135deg,#d13a46,#ff737d)" }}>
                      <Icon name={t.type === "income" ? "arrowDownLeft" : "arrowUpRight"} size={16} stroke={2.6} />
                    </span>
                  }
                  title={t.note || t.category}
                  sub={[shortDate(t.date), t.type === "expense" && t.note ? t.category : undefined, t.accountId ? accounts.get(t.accountId) : "no account"].filter(Boolean).join(" · ")}
                  trail={
                    <span class={`num t-headline ${t.type === "income" ? "c-success" : "c-danger"}`} style="flex-shrink:0">
                      {t.type === "income" ? "+" : "−"}
                      {money(t.amount)}
                    </span>
                  }
                  chevron={false}
                />
              ))}
            </div>
          )}
        </section>

        <div class="section-head section">
          <h2>To-dos</h2>
          <button class="link" onClick={() => openTodoForm(p.id, columns, undefined, columns[page]?.id)}>
            Add
          </button>
        </div>
      </div>
      {columns.length === 0 ? (
        <Empty icon="columns" title="No columns" action={<button class="btn primary sm press" onClick={() => openColumnForm(p.id, undefined, 0)}>Add column</button>} />
      ) : (
        <>
          <div class="pager" ref={pager}>
            {columns.map((c, ci) => {
              const items = todos.filter((t) => t.columnId === c.id);
              return (
                <section class="pane" key={c.id}>
                  <div class="pane-head">
                    <span class="t-headline">
                      {c.name} <span class="c3 num">{items.length}</span>
                    </span>
                    <button
                      class="c3"
                      aria-label={`Column ${c.name} options`}
                      onClick={() =>
                        actionSheet(
                          [
                            { label: "Add to-do here", icon: "plus", run: () => openTodoForm(p.id, columns, undefined, c.id) },
                            { label: "Rename", icon: "edit", run: () => openColumnForm(p.id, c) },
                            ...(ci > 0 ? [{ label: "Move left", icon: "arrowLeft" as const, run: () => void move(ci, -1) }] : []),
                            ...(ci < columns.length - 1 ? [{ label: "Move right", icon: "arrowRight" as const, run: () => void move(ci, 1) }] : []),
                            { label: "Delete column", icon: "trash", destructive: true, run: () => void confirmDelete("column", () => deleteColumn(c.id), undefined, items.length ? `Its ${items.length} to-dos are deleted too.` : undefined) },
                          ],
                          c.name,
                        )
                      }
                    >
                      <Icon name="more" size={22} />
                    </button>
                  </div>
                  <div class="pane-body">
                    {items.length === 0 ? (
                      <button class="t-subhead c3 press" style="padding:24px 8px;text-align:center" onClick={() => openTodoForm(p.id, columns, undefined, c.id)}>
                        Empty. Tap to add a to-do.
                      </button>
                    ) : (
                      items.map((t, i) => (
                        <div key={t.id} class="rise" style={{ "--i": i } as never}>
                          <Draggable
                            itemId={t.id}
                            zones={zones}
                            currentZone={c.id}
                            onTap={() =>
                              actionSheet(
                                [
                                  { label: "Edit", icon: "edit", run: () => openTodoForm(p.id, columns, t) },
                                  ...columns.filter((x) => x.id !== c.id).map((x) => ({ label: `Move to ${x.name}`, icon: "arrowRight" as const, run: () => void moveTodo(t.id, x.id) })),
                                  {
                                    label: "Delete",
                                    icon: "trash",
                                    destructive: true,
                                    run: async () => {
                                      const snap = await deleteTodo(t.id);
                                      undoToast("To-do deleted", () => restoreSnapshot(snap));
                                    },
                                  },
                                ],
                                t.title,
                              )
                            }
                            onDrop={async (z) => {
                              await moveTodo(t.id, z);
                              toast(`Moved to ${columns.find((x) => x.id === z)?.name}`, { icon: "arrowRight" });
                            }}
                          >
                            <p class="t-callout" style="font-weight:500">{t.title}</p>
                            {t.description && <p class="t-footnote c2 clamp2 mt4">{t.description}</p>}
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
            {columns.map((c, i) => (
              <span key={c.id} class={i === page ? "on" : ""} />
            ))}
          </div>
        </>
      )}

      <div class="content">
        <TaskSection parent={{ projectId: p.id }} />
        <section class="section">
          <div class="section-head">
            <h2>Notes</h2>
          </div>
          <Timeline parent={{ projectId: p.id }} />
        </section>
      </div>
      <DropDock />
    </Screen>
  );
}
