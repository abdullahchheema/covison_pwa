// Home. Same metrics and maths as web/src/app/(app)/dashboard/page.tsx:
// open pipeline (excludes won/lost stages), 14-day cumulative sparkline with
// the same baseline, contacts/companies/open-tasks/overdue, pipeline by stage
// (2% bar floor; won green, lost grey), latest 6 activities, next 5 tasks.
import { db } from "../db/schema";
import { defaultPipelineId, getMeta } from "../db/repo";
import { useCountUp, useLive } from "../lib/hooks";
import { greeting, money, relativeTime } from "../lib/format";
import { navigate, switchTab } from "../lib/router";
import { Icon, type IconName } from "../ui/icons";
import { Screen } from "../ui/kit";
import { BarList, Sparkline } from "../ui/charts";
import { TaskRow } from "./shared";
import { BackupReminder } from "./Settings";
import { BalanceCard, FlowCard, OwedCard } from "./Accounts";
import { ProjectRowItem } from "./Projects";
import { loadProjects } from "../db/projects";

async function loadDashboard() {
  const pipelineId = await defaultPipelineId();
  const [stages, deals, contactsCount, companiesCount, tasks, activities, name] = await Promise.all([
    pipelineId ? db.stages.where("pipelineId").equals(pipelineId).sortBy("position") : Promise.resolve([]),
    db.deals.toArray(),
    db.contacts.count(),
    db.companies.count(),
    db.tasks.where("status").equals("open").toArray(),
    db.activities.orderBy("occurredAt").reverse().limit(6).toArray(),
    getMeta<string>("displayName", ""),
  ]);
  const closed = new Set(stages.filter((s) => s.isWon || s.isLost).map((s) => s.id));
  const open = deals.filter((d) => !closed.has(d.stageId));
  const pipelineValue = open.reduce((s, d) => s + (d.value || 0), 0);

  // Dominant currency for display (deals in mixed currencies are summed as-is, like the web app).
  const cur = new Map<string, number>();
  for (const d of open) cur.set(d.currency, (cur.get(d.currency) ?? 0) + 1);
  const currency = [...cur.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "PKR";

  // 14 daily buckets; cumulative on top of the value that existed before the window.
  const DAYS = 14;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = today.getTime() - (DAYS - 1) * 86400000;
  const buckets = new Array(DAYS).fill(0);
  for (const d of open) {
    const t = new Date(d.createdAt).getTime();
    if (t >= start) buckets[Math.min(DAYS - 1, Math.floor((t - start) / 86400000))] += d.value || 0;
  }
  let run = pipelineValue - buckets.reduce((a, b) => a + b, 0);
  const spark = buckets.map((b) => (run += b));

  const now = Date.now();
  const overdue = tasks.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < now).length;
  const upcoming = tasks.filter((t) => t.dueAt).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!)).slice(0, 5);

  const byStage = stages.map((s) => {
    const ds = deals.filter((d) => d.stageId === s.id);
    return { stage: s, count: ds.length, value: ds.reduce((a, d) => a + (d.value || 0), 0) };
  });

  const ids = (k: "contactId" | "companyId" | "dealId" | "projectId") => activities.map((a) => a[k]).filter(Boolean) as string[];
  const [cs, cos, ds, ps] = await Promise.all([
    db.contacts.bulkGet(ids("contactId")),
    db.companies.bulkGet(ids("companyId")),
    db.deals.bulkGet(ids("dealId")),
    db.projects.bulkGet(ids("projectId")),
  ]);
  const names = new Map<string, string>();
  [...cs, ...cos, ...ds, ...ps].forEach((x) => x && names.set(x.id, x.name));

  return {
    name,
    currency,
    pipelineValue,
    openCount: open.length,
    spark,
    contactsCount,
    companiesCount,
    openTasks: tasks.length,
    overdue,
    upcoming,
    byStage,
    activities,
    names,
    empty: contactsCount === 0 && deals.length === 0 && tasks.length === 0,
  };
}

function Metric({ icon, grad, value, label, hint, onClick, i }: { icon: IconName; grad: string; value: number; label: string; hint?: string; onClick: () => void; i: number }) {
  const v = useCountUp(value, 900);
  return (
    <button class="metric press rise" style={{ "--i": i + 2 } as never} onClick={onClick}>
      <span class="m-ico" style={{ background: grad }}>
        <Icon name={icon} size={17} stroke={2.2} />
      </span>
      <span class="m-value t-metric">{Math.round(v)}</span>
      <span class="m-label">{label}</span>
      {hint && <span class="m-hint">{hint}</span>}
    </button>
  );
}

const ACT_ICON: Record<string, IconName> = { note: "note", call: "phone", meeting: "meeting", field_change: "refresh" };

export function Dashboard() {
  const d = useLive(loadDashboard, []);
  const value = useCountUp(d?.pipelineValue ?? 0, 1300);
  const hello = greeting();

  return (
    <Screen
      title={d?.name ? `${hello}, ${d.name.split(" ")[0]}` : hello}
      subtitle={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
      right={
        <button class="nav-btn" aria-label="Search" onClick={() => navigate("/search")}>
          <Icon name="search" size={22} />
        </button>
      }
    >
      <div class="content">
        <BackupReminder compact />
        {!d ? (
          <div class="col gap12">
            <div class="skel" style="height:190px;border-radius:28px" />
            <div class="metrics">
              <div class="skel" style="height:118px;border-radius:18px" />
              <div class="skel" style="height:118px;border-radius:18px" />
              <div class="skel" style="height:118px;border-radius:18px" />
            </div>
          </div>
        ) : (
          <>
            <BalanceCard />
            <OwedCard />
            <FlowCard />
            <OngoingProjects />

            <button class="hero press-soft rise mt12" style={{ "--i": 3, width: "100%", textAlign: "left", display: "block" } as never} onClick={() => switchTab("/pipeline")}>
              <div class="row between">
                <span class="h-label">Open pipeline</span>
                <Icon name="trend" size={20} />
              </div>
              <div class="h-value t-metric">{money(value, d.currency)}</div>
              <div class="h-sub">
                {d.openCount} open deal{d.openCount === 1 ? "" : "s"} · last 14 days
              </div>
              <Sparkline data={d.spark} />
            </button>

            <div class="metrics mt12">
              <Metric i={0} icon="users" grad="linear-gradient(135deg,#6d4aff,#a78bfa)" value={d.contactsCount} label="Contacts" onClick={() => navigate("/contacts")} />
              <Metric i={1} icon="building" grad="linear-gradient(135deg,#2878d9,#69a8ff)" value={d.companiesCount} label="Companies" onClick={() => navigate("/companies")} />
              <Metric
                i={2}
                icon="tasks"
                grad="linear-gradient(135deg,#149a68,#42d39a)"
                value={d.openTasks}
                label="Open tasks"
                hint={d.overdue ? `${d.overdue} overdue` : undefined}
                onClick={() => navigate("/tasks")}
              />
            </div>

            {d.empty && (
              <div class="card mt16 rise" style={{ "--i": 5 } as never}>
                <div class="row">
                  <span class="tile violet">
                    <Icon name="sparkles" size={18} />
                  </span>
                  <div class="grow">
                    <p class="t-headline">Welcome to Covison Pocket</p>
                    <p class="t-subhead c2 mt4">Everything stays on this iPhone. Add your first contact with the + button, or bring your data over in Settings.</p>
                  </div>
                </div>
                <button class="btn tinted block mt12 press" onClick={() => navigate("/settings")}>
                  Import or try sample data
                </button>
              </div>
            )}

            {d.byStage.length > 0 && (
              <section class="section">
                <div class="section-head">
                  <h2>Pipeline by stage</h2>
                  <button class="link" onClick={() => navigate("/reports")}>
                    Reports
                  </button>
                </div>
                <div class="card rise" style={{ "--i": 6 } as never}>
                  <BarList
                    items={d.byStage.map(({ stage, count, value }) => ({
                      label: stage.name,
                      value,
                      display: money(value, d.currency, true),
                      sub: `${count}`,
                      kind: stage.isWon ? "won" : stage.isLost ? "lost" : undefined,
                    }))}
                  />
                </div>
              </section>
            )}

            <section class="section">
              <div class="section-head">
                <h2>Up next</h2>
                <button class="link" onClick={() => navigate("/tasks")}>
                  All tasks
                </button>
              </div>
              {d.upcoming.length ? (
                <div class="group">
                  {d.upcoming.map((t, i) => (
                    <TaskRow key={t.id} task={t} i={i + 7} />
                  ))}
                </div>
              ) : (
                <p class="t-subhead c3" style="padding:0 4px">Nothing scheduled. Enjoy the calm.</p>
              )}
            </section>

            <section class="section">
              <div class="section-head">
                <h2>Recent activity</h2>
              </div>
              {d.activities.length ? (
                <div class="card">
                  <div class="timeline">
                    {d.activities.map((a, i) => {
                      const pid = a.contactId ?? a.companyId ?? a.dealId ?? a.projectId;
                      const to = a.contactId ? `/contacts/${a.contactId}` : a.companyId ? `/companies/${a.companyId}` : a.dealId ? `/deals/${a.dealId}` : `/projects/${a.projectId}`;
                      return (
                        <button key={a.id} class="tl-item rise" style={{ "--i": i + 10, display: "block", width: "100%", textAlign: "left" } as never} onClick={() => navigate(to)}>
                          <span class={`tl-dot ${a.type}`}>
                            <Icon name={ACT_ICON[a.type]} size={11} stroke={2.6} />
                          </span>
                          <div class="row between">
                            <span class="t-subhead truncate" style="font-weight:600">
                              {(pid && d.names.get(pid)) || "Deleted record"}
                            </span>
                            <span class="t-footnote c3" style="flex-shrink:0">
                              {relativeTime(a.occurredAt)}
                            </span>
                          </div>
                          <p class="t-subhead c2 clamp2 mt4">{a.body || `${a.type} logged`}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p class="t-subhead c3" style="padding:0 4px">Notes and calls you log will appear here.</p>
              )}
            </section>
          </>
        )}
      </div>
    </Screen>
  );
}

function OngoingProjects() {
  const rows = useLive(async () => (await loadProjects()).filter((r) => r.status !== "completed"), []);
  if (!rows || rows.length === 0) return null;
  const order = { in_progress: 0, not_started: 1, completed: 2 } as const;
  const list = [...rows].sort((a, b) => order[a.status] - order[b.status]).slice(0, 5);
  return (
    <section class="section">
      <div class="section-head">
        <h2>Ongoing projects</h2>
        <button class="link" onClick={() => switchTab("/projects")}>
          All {rows.length > 5 ? `(${rows.length})` : ""}
        </button>
      </div>
      <div class="group">
        {list.map((r, i) => (
          <ProjectRowItem key={r.project.id} r={r} i={i + 3} />
        ))}
      </div>
    </section>
  );
}
