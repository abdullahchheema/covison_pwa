// Projects: a board with three stages (Not started / In progress / Completed),
// laid out like the deal pipeline — swipe between stages, long-press a card
// and drag it onto another stage. Each project page shows its money.
import { useMemo } from "preact/hooks";
import { db, type ProjectStatus } from "../db/schema";
import { deleteProject } from "../db/repo";
import { STATUS_LABEL, STATUS_ORDER, loadProject, loadProjects, setProjectStatus, type ProjectMoney, type ProjectRow } from "../db/projects";
import { useLive } from "../lib/hooks";
import { money, shortDate } from "../lib/format";
import { back, navigate } from "../lib/router";
import { Icon, type IconName } from "../ui/icons";
import { Avatar, Badge, Empty, Row, Screen, Segmented, SwipeRow } from "../ui/kit";
import { actionSheet, toast } from "../ui/overlay";
import { Draggable } from "../ui/drag";
import { StageSection } from "../ui/board";
import { openProjectEditForm, openProjectMoneyForm } from "./moneyForms";
import { openTransactionForm } from "./forms";
import { Timeline, confirmDelete } from "./shared";

const STAGE_TONE: Record<ProjectStatus, "neutral" | "brand" | "success"> = { not_started: "neutral", in_progress: "brand", completed: "success" };

function ProjectMoneyLine({ m }: { m: ProjectMoney }) {
  return (
    <span class="pm-line">
      <span class="c-success">↓ {money(m.received)}</span>
      {m.spent > 0 && <span class="c-danger">↑ {money(m.spent)}</span>}
      <span class="c3">{m.agreed > 0 ? (m.due > 0 ? `${money(m.due)} due` : "paid") : "total not set"}</span>
    </span>
  );
}

/** Compact project row (used on Home under "Ongoing projects"). */
export function ProjectRowItem({ r, i }: { r: ProjectRow; i: number }) {
  const next: ProjectStatus | undefined = r.status === "not_started" ? "in_progress" : r.status === "in_progress" ? "completed" : undefined;
  return (
    <SwipeRow
      i={i}
      actions={
        next
          ? [{ label: next === "in_progress" ? "Start" : "Complete", icon: (next === "in_progress" ? "refresh" : "check") as IconName, tone: "success" as const, run: () => void setProjectStatus(r.project.id, next).then(() => toast(`${r.project.name}: ${STATUS_LABEL[next]}`)) }]
          : [{ label: "Reopen", icon: "refresh" as IconName, tone: "brand" as const, run: () => void setProjectStatus(r.project.id, "in_progress") }]
      }
    >
      <Row
        onClick={() => navigate(`/projects/${r.project.id}`)}
        lead={<Avatar name={r.client ?? r.project.name} />}
        title={r.project.name}
        sub={
          <span class="col" style="gap:3px">
            <span class="row gap8 truncate">
              <Badge tone={STAGE_TONE[r.status]} dot>
                {STATUS_LABEL[r.status]}
              </Badge>
              <span class="truncate">{r.client ?? "No client"}</span>
            </span>
            <ProjectMoneyLine m={r.money} />
          </span>
        }
      />
    </SwipeRow>
  );
}

/** The card shown on the board (same information as the row, in card form). */
function ProjectCard({ r }: { r: ProjectRow }) {
  const m = r.money;
  const pct = m.agreed > 0 ? Math.min(1, m.received / m.agreed) : 0;
  return (
    <>
      <div class="row gap12" style="align-items:flex-start">
        <Avatar name={r.client ?? r.project.name} />
        <div class="grow">
          <p class="t-headline clamp2">{r.project.name}</p>
          <p class="t-footnote c2 truncate">{r.client ?? "No client"}</p>
        </div>
        {m.agreed > 0 && <span class="t-subhead num" style="font-weight:700;flex-shrink:0">{money(m.agreed)}</span>}
      </div>
      {m.agreed > 0 && (
        <div class="bar-track mt12" style="height:6px">
          <div class="bar-fill won" style={{ width: `${Math.max(m.received > 0 ? 3 : 0, pct * 100)}%` }} />
        </div>
      )}
      <div class="mt8">
        <ProjectMoneyLine m={m} />
      </div>
    </>
  );
}

export function ProjectsList() {
  const rows = useLive(loadProjects, []);
  const by = useMemo(() => {
    const m = new Map<ProjectStatus, ProjectRow[]>(STATUS_ORDER.map((s) => [s, []]));
    (rows ?? []).forEach((r) => m.get(r.status)?.push(r));
    return m;
  }, [rows]);
  const active = (rows ?? []).filter((r) => r.status !== "completed");
  const totals = active.reduce((t, r) => ({ due: t.due + r.money.due, received: t.received + r.money.received, spent: t.spent + r.money.spent }), { due: 0, received: 0, spent: 0 });
  const zones = STATUS_ORDER.map((s) => ({ id: s, label: STATUS_LABEL[s] }));

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
      {!rows ? (
        <div class="content">
          <div class="skel" style="height:320px;border-radius:22px" />
        </div>
      ) : rows.length === 0 ? (
        <Empty
          icon="briefcase"
          title="No projects yet"
          text="When a lead is won, its project appears here automatically. You can also add one yourself."
          action={<button class="btn primary sm press" onClick={() => openProjectEditForm()}>New project</button>}
        />
      ) : (
        <div class="content">
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
          <p class="t-footnote c3" style="padding:12px 4px 0">Hold a project, then drag it up or down to another stage.</p>
          {STATUS_ORDER.map((s) => {
            const list = by.get(s) ?? [];
            const due = list.reduce((t, r) => t + r.money.due, 0);
            return (
              <StageSection
                key={s}
                id={s}
                count={list.length}
                limit={s === "completed" ? 4 : undefined}
                head={
                  <Badge tone={STAGE_TONE[s]} dot>
                    {STATUS_LABEL[s]}
                  </Badge>
                }
                right={due > 0 ? <span class="t-subhead c2 num">{money(due, "PKR", true)} due</span> : undefined}
                empty={s === "not_started" ? "Won leads land here." : "Nothing here yet."}
              >
                {list.map((r, i) => (
                  <div key={r.project.id} class="rise" style={{ "--i": i } as never}>
                    <Draggable
                      dock={false}
                      itemId={r.project.id}
                      zones={zones}
                      currentZone={s}
                      onTap={() => navigate(`/projects/${r.project.id}`)}
                      onDrop={async (z) => {
                        await setProjectStatus(r.project.id, z as ProjectStatus);
                        toast(`${r.project.name}: ${STATUS_LABEL[z as ProjectStatus]}`, { icon: z === "completed" ? "checkCircle" : "arrowRight" });
                      }}
                    >
                      <ProjectCard r={r} />
                    </Draggable>
                  </div>
                ))}
              </StageSection>
            );
          })}
        </div>
      )}
    </Screen>
  );
}

// ---------------- project page ----------------
export function ProjectBoard({ id }: { id: string }) {
  const data = useLive(async () => {
    const row = await loadProject(id);
    if (!row) return null;
    const accounts = new Map((await db.accounts.toArray()).map((a) => [a.id, a.name]));
    return { row, accounts };
  }, [id]);

  if (data === undefined) return <Screen title="" backLabel="Projects" large={false}><div /></Screen>;
  if (data === null)
    return (
      <Screen title="Project" backLabel="Back" large={false}>
        <Empty icon="briefcase" title="Project not found" />
      </Screen>
    );
  const { row, accounts } = data;
  const p = row.project;
  const m = row.money;
  const status = row.status;
  const addExpense = () => openTransactionForm(undefined, { type: "expense", scope: "business", projectId: p.id, contactId: p.contactId, category: "Project costs" });

  return (
    <Screen
      title={p.name}
      subtitle={
        (row.client || p.dealId) && (
          <span class="row gap8 wrap">
            {row.client && p.contactId && (
              <button class="c-brand" onClick={() => navigate(`/contacts/${p.contactId}`)}>
                {row.client}
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
                { label: "Delete project", icon: "trash", destructive: true, run: () => void confirmDelete("project", () => deleteProject(p.id), () => back("/projects"), "Its notes are removed. Money received and spent stays in your accounts.") },
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
                { label: "Expense on this project", icon: "arrowUpRight", run: addExpense },
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
          options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
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
            <button class="btn sm grow press" style="background:var(--danger-soft);color:var(--danger)" onClick={addExpense}>
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

        <section class="section">
          <div class="section-head">
            <h2>Notes</h2>
          </div>
          <Timeline parent={{ projectId: p.id }} />
        </section>
      </div>
    </Screen>
  );
}
