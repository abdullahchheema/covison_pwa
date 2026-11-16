// Pieces shared by several screens: activity timeline, task rows, delete helpers.
import { useState } from "preact/hooks";
import { db, type Activity, type Task } from "../db/schema";
import { addNote, deleteActivity, deleteTask, restoreSnapshot, toggleTask, type Snapshot } from "../db/repo";
import { useLive } from "../lib/hooks";
import { ACTIVITY_LABELS, PRIORITY_LABELS, TASK_PRIORITY_TONE } from "../lib/options";
import { dateTime, dueLabel, relativeTime } from "../lib/format";
import { MAX_LONG, optText } from "../lib/sanitize";
import { navigate } from "../lib/router";
import { Icon, type IconName } from "../ui/icons";
import { Badge, Row, SwipeRow } from "../ui/kit";
import { actionSheet, confirmSheet, toast, undoToast } from "../ui/overlay";
import { openNoteForm, openTaskForm } from "./forms";

type Parent = Pick<Activity, "contactId" | "companyId" | "dealId" | "projectId">;

const ACT_ICON: Record<Activity["type"], IconName> = {
  note: "note",
  call: "phone",
  meeting: "meeting",
  field_change: "refresh",
};

function describeChange(a: Activity): string {
  const m = a.metadata as { field?: string; from?: unknown; to?: unknown } | undefined;
  if (!m?.field) return a.body ?? "Updated";
  if (m.field === "stage") return `Moved ${m.from ? `from ${m.from} ` : ""}to ${m.to}`;
  const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "none" : String(v));
  return `${m.field[0].toUpperCase()}${m.field.slice(1)}: ${fmt(m.from)} → ${fmt(m.to)}`;
}

/** Timeline of activities for one parent, with an inline note composer. */
export function Timeline({ parent }: { parent: Parent }) {
  const key = (Object.keys(parent) as (keyof Parent)[]).find((k) => parent[k])!;
  const id = parent[key]!;
  const items = useLive(() => db.activities.where(key).equals(id).reverse().sortBy("occurredAt"), [key, id]);
  const [draft, setDraft] = useState("");

  const submit = async () => {
    const body = optText(draft, MAX_LONG);
    if (!body) return;
    await addNote(parent, body);
    setDraft("");
    toast("Note added", { icon: "note" });
  };

  return (
    <div>
      <div class="card tonal" style="padding:10px 10px 10px 14px">
        <div class="row gap8">
          <textarea
            class="grow"
            rows={1}
            value={draft}
            placeholder="Add a note…"
            maxLength={MAX_LONG}
            style="border:0;background:none;font:inherit;font-size:17px;color:var(--text);resize:none;outline:none;padding:8px 0;min-height:40px"
            onInput={(e) => {
              const el = e.target as HTMLTextAreaElement;
              setDraft(el.value);
              el.style.height = "auto";
              el.style.height = `${Math.min(160, el.scrollHeight)}px`;
            }}
          />
          {draft.trim() ? (
            <button class="icon-btn brand press pop-in" aria-label="Add note" onClick={submit}>
              <Icon name="arrowUpRight" size={18} stroke={2.4} />
            </button>
          ) : (
            <button
              class="icon-btn press"
              aria-label="Log call or meeting"
              onClick={() =>
                actionSheet([
                  { label: "Log a call", icon: "phone", run: () => openNoteForm(parent, "call") },
                  { label: "Log a meeting", icon: "meeting", run: () => openNoteForm(parent, "meeting") },
                ])
              }
            >
              <Icon name="plus" size={18} stroke={2.4} />
            </button>
          )}
        </div>
      </div>
      {items === undefined ? null : items.length === 0 ? (
        <p class="t-subhead c3" style="padding:16px 4px">No activity yet. Notes, calls and changes show up here.</p>
      ) : (
        <div class="timeline mt16">
          {items.map((a, i) => (
            <div
              key={a.id}
              class="tl-item rise"
              style={{ "--i": i } as never}
              onContextMenu={(e) => e.preventDefault()}
            >
              <span class={`tl-dot ${a.type}`}>
                <Icon name={ACT_ICON[a.type]} size={11} stroke={2.6} />
              </span>
              <div class="row between">
                <span class="t-footnote c3">
                  {ACTIVITY_LABELS[a.type]} · <span title={dateTime(a.occurredAt)}>{relativeTime(a.occurredAt)}</span>
                </span>
                {a.type !== "field_change" && (
                  <button
                    class="c3"
                    aria-label="Delete entry"
                    onClick={async () => {
                      if (!(await confirmSheet({ title: "Delete this entry?", confirm: "Delete", destructive: true }))) return;
                      const snap = await deleteActivity(a.id);
                      undoToast("Entry deleted", () => restoreSnapshot(snap));
                    }}
                  >
                    <Icon name="more" size={18} />
                  </button>
                )}
              </div>
              <p class={`t-callout mt4 pre selectable ${a.type === "field_change" ? "c2" : ""}`}>
                {a.type === "field_change" ? describeChange(a) : a.body}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One task row with a completion checkbox and swipe-to-delete. */
export function TaskRow({ task, i, sub }: { task: Task; i?: number; sub?: string }) {
  const done = task.status === "done";
  const due = dueLabel(task.dueAt);
  return (
    <SwipeRow
      i={i}
      actions={[
        { label: done ? "Reopen" : "Done", icon: "check", tone: "success", run: () => void toggleTask(task.id) },
        {
          label: "Delete",
          icon: "trash",
          tone: "danger",
          run: async () => {
            const snap = await deleteTask(task.id);
            undoToast("Task deleted", () => restoreSnapshot(snap));
          },
        },
      ]}
    >
      <Row
        onClick={() => navigate(`/tasks/${task.id}`)}
        chevron={false}
        lead={
          <button
            class="press"
            aria-label={done ? "Mark as open" : "Mark as done"}
            onClick={(e) => {
              e.stopPropagation();
              void toggleTask(task.id);
              if (!done) toast("Nice, task done", { icon: "checkCircle" });
            }}
            style={{ color: done ? "var(--success)" : "var(--text-3)", display: "grid", placeItems: "center", width: "28px", height: "28px" }}
          >
            <span key={String(done)} style={done ? { animation: "check-pop 420ms var(--ease-spring)" } : undefined}>
              <Icon name={done ? "checkCircle" : "circle"} size={26} stroke={done ? 2.2 : 1.8} />
            </span>
          </button>
        }
        title={<span style={done ? { textDecoration: "line-through", color: "var(--text-3)" } : undefined}>{task.title}</span>}
        sub={
          (due.label || sub) && (
            <span class="row gap4" style="gap:6px">
              {due.label && (
                <span class={!done && due.overdue ? "c-danger" : due.today ? "c-brand" : ""}>
                  {!done && due.overdue ? "Overdue · " : ""}
                  {due.label}
                </span>
              )}
              {sub && <span class="truncate">{due.label ? "· " : ""}{sub}</span>}
            </span>
          )
        }
        trail={task.priority && !done ? <Badge tone={TASK_PRIORITY_TONE[task.priority]}>{PRIORITY_LABELS[task.priority]}</Badge> : undefined}
      />
    </SwipeRow>
  );
}

export function TaskSection({ parent, label = "Tasks" }: { parent: Partial<Pick<Task, "contactId" | "companyId" | "dealId" | "projectId">>; label?: string }) {
  const key = (Object.keys(parent) as (keyof typeof parent)[]).find((k) => parent[k])!;
  const id = parent[key]!;
  const tasks = useLive(async () => {
    const all = await db.tasks.where(key).equals(id).toArray();
    return all.sort((a, b) => (a.status === b.status ? (a.dueAt ?? "~").localeCompare(b.dueAt ?? "~") : a.status === "open" ? -1 : 1));
  }, [key, id]);
  return (
    <section class="section">
      <div class="section-head">
        <h2>{label}</h2>
        <button class="link" onClick={() => openTaskForm(undefined, parent)}>
          Add
        </button>
      </div>
      {tasks && tasks.length > 0 ? (
        <div class="group">
          {tasks.map((t, i) => (
            <TaskRow key={t.id} task={t} i={i} />
          ))}
        </div>
      ) : (
        <p class="t-subhead c3" style="padding:0 4px">No tasks.</p>
      )}
    </section>
  );
}

/** Confirm, delete, and offer Undo. */
export async function confirmDelete(what: string, run: () => Promise<Snapshot>, after?: () => void, message?: string) {
  const ok = await confirmSheet({ title: `Delete ${what}?`, message, confirm: "Delete", destructive: true });
  if (!ok) return;
  try {
    const snap = await run();
    after?.();
    undoToast(`${what[0].toUpperCase()}${what.slice(1)} deleted`, () => restoreSnapshot(snap));
  } catch (e) {
    toast((e as Error).message || "Could not delete", { error: true });
  }
}
