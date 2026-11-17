import { useEffect, useRef, useState } from "preact/hooks";
import { db } from "../db/schema";
import { deleteColumn, deleteProject, deleteTodo, moveTodo, reorderColumns, restoreSnapshot } from "../db/repo";
import { useLive } from "../lib/hooks";
import { relativeTime } from "../lib/format";
import { back, navigate } from "../lib/router";
import { Icon } from "../ui/icons";
import { Avatar, Empty, Screen, SkeletonList } from "../ui/kit";
import { actionSheet, toast, undoToast } from "../ui/overlay";
import { Draggable, DropDock } from "../ui/drag";
import { openColumnForm, openProjectForm, openTodoForm } from "./forms";
import { TaskSection, Timeline, confirmDelete } from "./shared";

export function ProjectsList() {
  const data = useLive(async () => {
    const [projects, todos, columns, contacts] = await Promise.all([db.projects.orderBy("updatedAt").reverse().toArray(), db.projectTodos.toArray(), db.projectColumns.toArray(), db.contacts.toArray()]);
    const client = new Map(contacts.map((c) => [c.id, c.name]));
    // "Done" = to-dos in each project's last column.
    const lastCol = new Map<string, string>();
    for (const c of columns.sort((a, b) => a.position - b.position)) lastCol.set(c.projectId, c.id);
    const stats = new Map<string, { total: number; done: number }>();
    for (const t of todos) {
      const s = stats.get(t.projectId) ?? { total: 0, done: 0 };
      s.total++;
      if (lastCol.get(t.projectId) === t.columnId) s.done++;
      stats.set(t.projectId, s);
    }
    return { projects, stats, client };
  }, []);

  return (
    <Screen
      title="Projects"
      backLabel="More"
      backTo="/more"
      right={
        <button class="nav-btn" aria-label="New project" onClick={() => openProjectForm()}>
          <Icon name="plus" size={26} />
        </button>
      }
    >
      <div class="content">
        {!data ? (
          <SkeletonList rows={3} />
        ) : data.projects.length === 0 ? (
          <Empty icon="folder" title="No projects" text="Projects are simple boards of to-dos, for anything that isn't a deal." action={<button class="btn primary sm press" onClick={() => openProjectForm()}>New project</button>} />
        ) : (
          <div class="col gap12">
            {data.projects.map((p, i) => {
              const s = data.stats.get(p.id) ?? { total: 0, done: 0 };
              const pct = s.total ? s.done / s.total : 0;
              return (
                <button key={p.id} class="card press-soft rise" style={{ "--i": i, textAlign: "left" } as never} onClick={() => navigate(`/projects/${p.id}`)}>
                  <div class="row">
                    <Avatar name={p.name} square icon="folder" />
                    <div class="grow">
                      <p class="t-headline truncate">{p.name}</p>
                      <p class="t-footnote c2">
                        {p.contactId && data.client.get(p.contactId) ? `${data.client.get(p.contactId)} · ` : ""}
                        {s.done}/{s.total} done · updated {relativeTime(p.updatedAt)}
                      </p>
                    </div>
                    <Icon name="chevronRight" size={18} class="c3" />
                  </div>
                  <div class="bar-track mt12" style="height:6px">
                    <div class="bar-fill" style={{ width: `${Math.max(pct * 100, s.total ? 3 : 0)}%`, animationDelay: `${150 + i * 60}ms` }} />
                  </div>
                </button>
              );
            })}
          </div>
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
    return { p, columns, todos, client };
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
  const { p, columns, todos, client } = data;
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
            {client && <span>{client.name}</span>}
            {p.dealId && (
              <button class="c-brand" onClick={() => navigate(`/deals/${p.dealId}`)}>
                Money &amp; deal →
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
                { label: "Add column", icon: "columns", run: () => openColumnForm(p.id, undefined, columns.length) },
                { label: "Rename project", icon: "edit", run: () => openProjectForm(p) },
                { label: "Delete project", icon: "trash", destructive: true, run: () => void confirmDelete("project", () => deleteProject(p.id), () => back("/projects"), "All its columns, to-dos, tasks and notes are removed.") },
              ])
            }
          >
            <Icon name="more" size={24} />
          </button>
          <button class="nav-btn" aria-label="New to-do" onClick={() => openTodoForm(p.id, columns, undefined, columns[page]?.id)}>
            <Icon name="plus" size={26} />
          </button>
        </>
      }
    >
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
