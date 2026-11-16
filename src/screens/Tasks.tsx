import { useMemo, useState } from "preact/hooks";
import { db, type Task } from "../db/schema";
import { deleteTask, toggleTask } from "../db/repo";
import { exportCsv } from "../db/csvExport";
import { useLive, useStoredState } from "../lib/hooks";
import { PRIORITY_LABELS, TASK_PRIORITIES, TASK_PRIORITY_TONE } from "../lib/options";
import { dateTime, dueLabel, shortDate } from "../lib/format";
import { back, navigate } from "../lib/router";
import { Icon } from "../ui/icons";
import { Badge, Empty, Group, Row, Screen, SearchField, Segmented, SkeletonList, useDebounced } from "../ui/kit";
import { actionSheet, toast } from "../ui/overlay";
import { openTaskForm } from "./forms";
import { TaskRow, Timeline, confirmDelete } from "./shared";

type View = "open" | "done";

async function loadTasks() {
  const [tasks, contacts, deals, companies, projects] = await Promise.all([
    db.tasks.toArray(),
    db.contacts.toArray(),
    db.deals.toArray(),
    db.companies.toArray(),
    db.projects.toArray(),
  ]);
  const names = new Map<string, string>();
  [...contacts, ...deals, ...companies, ...projects].forEach((x) => names.set(x.id, x.name));
  return { tasks, names };
}

export function parentName(t: Task, names: Map<string, string>): string | undefined {
  const id = t.contactId ?? t.dealId ?? t.companyId ?? t.projectId;
  return id ? names.get(id) : undefined;
}

export function TasksList() {
  const data = useLive(loadTasks, []);
  const [view, setView] = useStoredState<View>("tasks.view", "open");
  const [prio, setPrio] = useStoredState<string>("tasks.priority", "");
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim().toLowerCase());

  const groups = useMemo(() => {
    if (!data) return undefined;
    const list = data.tasks.filter(
      (t) =>
        (view === "done" ? t.status === "done" : t.status !== "done") &&
        (!prio || t.priority === prio) &&
        (!query || t.title.toLowerCase().includes(query) || (parentName(t, data.names) ?? "").toLowerCase().includes(query)),
    );
    if (view === "done") return [{ label: "Completed", items: list.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")) }];
    const now = new Date();
    const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    const endWeek = endToday + 6 * 86400000;
    const buckets: Record<string, Task[]> = { Overdue: [], Today: [], "Next 7 days": [], Later: [], "No date": [] };
    for (const t of list) {
      if (!t.dueAt) buckets["No date"].push(t);
      else {
        const d = new Date(t.dueAt).getTime();
        if (d < now.getTime()) buckets.Overdue.push(t);
        else if (d < endToday) buckets.Today.push(t);
        else if (d < endWeek) buckets["Next 7 days"].push(t);
        else buckets.Later.push(t);
      }
    }
    return Object.entries(buckets)
      .filter(([, items]) => items.length)
      .map(([label, items]) => ({ label, items: items.sort((a, b) => (a.dueAt ?? "~").localeCompare(b.dueAt ?? "~")) }));
  }, [data, view, prio, query]);

  const openCount = data?.tasks.filter((t) => t.status !== "done").length ?? 0;
  let idx = 0;

  return (
    <Screen
      title="Tasks"
      subtitle={data ? `${openCount} open` : " "}
      right={
        <>
          <button class="nav-btn" aria-label="Options" onClick={() => actionSheet([{ label: "Export to CSV", icon: "share", run: () => void exportCsv("tasks") }])}>
            <Icon name="more" size={24} />
          </button>
          <button class="nav-btn" aria-label="New task" onClick={() => openTaskForm()}>
            <Icon name="plus" size={26} />
          </button>
        </>
      }
    >
      <SearchField value={q} onInput={setQ} placeholder="Search tasks" />
      <div class="content">
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: "open", label: "Open" },
            { value: "done", label: "Completed" },
          ]}
        />
        <div class="chips mt12">
          <button class="chip press" aria-pressed={!prio} onClick={() => setPrio("")}>
            Any priority
          </button>
          {TASK_PRIORITIES.map((p) => (
            <button key={p} class="chip press" aria-pressed={prio === p} onClick={() => setPrio(prio === p ? "" : p)}>
              {PRIORITY_LABELS[p]}
            </button>
          ))}
        </div>
        {!groups ? (
          <SkeletonList rows={5} />
        ) : groups.length === 0 ? (
          <Empty
            icon={view === "open" ? "checkCircle" : "tasks"}
            title={view === "open" ? "All clear" : "Nothing completed yet"}
            text={view === "open" ? "No open tasks. Add one with the + button." : "Tasks you complete show up here."}
          />
        ) : (
          groups.map((g) => (
            <div key={g.label} class="mt12">
              <div class={`group-label ${g.label === "Overdue" ? "c-danger" : ""}`}>
                {g.label} · {g.items.length}
              </div>
              <div class="group">
                {g.items.map((t) => (
                  <TaskRow key={t.id} task={t} i={idx++} sub={parentName(t, data!.names)} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </Screen>
  );
}

export function TaskDetail({ id }: { id: string }) {
  const data = useLive(async () => {
    const t = await db.tasks.get(id);
    if (!t) return null;
    const names = (await loadTasks()).names;
    return { t, parent: parentName(t, names) };
  }, [id]);

  if (data === undefined) return <Screen title="" backLabel="Tasks" large={false}><div /></Screen>;
  if (data === null)
    return (
      <Screen title="Task" backLabel="Back" large={false}>
        <Empty icon="tasks" title="Task not found" />
      </Screen>
    );
  const { t, parent } = data;
  const done = t.status === "done";
  const due = dueLabel(t.dueAt);
  const parentPath = t.contactId ? `/contacts/${t.contactId}` : t.dealId ? `/deals/${t.dealId}` : t.companyId ? `/companies/${t.companyId}` : t.projectId ? `/projects/${t.projectId}` : undefined;

  return (
    <Screen
      title="Task"
      backLabel="Tasks"
      backTo="/tasks"
      large={false}
      right={
        <button class="nav-btn" onClick={() => openTaskForm(t)}>
          Edit
        </button>
      }
    >
      <div class="content">
        <div class="card rise mt8" style={{ "--i": 0 } as never}>
          <div class="row" style="align-items:flex-start">
            <button
              class="press"
              aria-label={done ? "Mark as open" : "Mark as done"}
              style={{ color: done ? "var(--success)" : "var(--text-3)", marginTop: "2px" }}
              onClick={() => {
                void toggleTask(t.id);
                if (!done) toast("Nice, task done", { icon: "checkCircle" });
              }}
            >
              <Icon name={done ? "checkCircle" : "circle"} size={30} />
            </button>
            <div class="grow">
              <h1 class="t-title2 selectable" style={done ? { textDecoration: "line-through", color: "var(--text-3)" } : undefined}>
                {t.title}
              </h1>
              <div class="row gap8 wrap mt8">
                {t.priority && <Badge tone={TASK_PRIORITY_TONE[t.priority]}>{PRIORITY_LABELS[t.priority]}</Badge>}
                {done ? <Badge tone="success">Completed</Badge> : due.overdue ? <Badge tone="danger">Overdue</Badge> : null}
              </div>
            </div>
          </div>
          {t.description && <p class="t-callout c2 pre selectable mt12">{t.description}</p>}
        </div>

        <Group class="section">
          <Row title={t.dueAt ? dateTime(t.dueAt) : "No due date"} sub="due" chevron={false} lead={<span class="tile orange"><Icon name="calendar" size={16} /></span>} />
          {parent && parentPath && <Row title={parent} sub="related to" onClick={() => navigate(parentPath)} lead={<span class="tile violet"><Icon name="link" size={16} /></span>} />}
          {t.completedAt && <Row title={shortDate(t.completedAt)} sub="completed" chevron={false} lead={<span class="tile green"><Icon name="check" size={16} /></span>} />}
          <Row title={shortDate(t.createdAt)} sub="created" chevron={false} lead={<span class="tile gray"><Icon name="clock" size={16} /></span>} />
        </Group>

        <div class="col gap8 section">
          <button class={`btn block press ${done ? "plain" : "primary"}`} onClick={() => void toggleTask(t.id)}>
            <Icon name={done ? "refresh" : "check"} size={20} />
            {done ? "Reopen task" : "Mark as done"}
          </button>
          <button class="btn danger block press" onClick={() => void confirmDelete("task", () => deleteTask(t.id), () => back("/tasks"))}>
            Delete task
          </button>
        </div>

        {t.dealId && (
          <section class="section">
            <div class="section-head">
              <h2>Deal activity</h2>
            </div>
            <Timeline parent={{ dealId: t.dealId }} />
          </section>
        )}
      </div>
    </Screen>
  );
}
