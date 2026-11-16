// Same three reports as web/src/app/(app)/reports/page.tsx, plus a win-rate
// summary: deals by stage, contacts by status, deals created per month for
// the last 6 calendar months (empty months kept).
import { db } from "../db/schema";
import { defaultPipelineId } from "../db/repo";
import { useCountUp, useLive } from "../lib/hooks";
import { CONTACT_STATUSES, STATUS_LABELS } from "../lib/options";
import { money } from "../lib/format";
import { Screen } from "../ui/kit";
import { ColumnChart, Donut } from "../ui/charts";

async function loadReports() {
  const pid = await defaultPipelineId();
  const [stages, deals, contacts] = await Promise.all([
    pid ? db.stages.where("pipelineId").equals(pid).sortBy("position") : Promise.resolve([]),
    db.deals.toArray(),
    db.contacts.toArray(),
  ]);
  const byStage = stages.map((s) => ({ label: s.name, value: deals.filter((d) => d.stageId === s.id).length }));
  const STATUS_COLORS: Record<string, string> = { new: "#2878d9", qualified: "#6d4aff", connected: "#a78bfa", attempted: "#c88518", won: "#149a68" };
  const byStatus = CONTACT_STATUSES.map((s) => ({ label: STATUS_LABELS[s], value: contacts.filter((c) => c.status === s).length, color: STATUS_COLORS[s] }));

  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    return { y: d.getFullYear(), m: d.getMonth(), label: d.toLocaleDateString(undefined, { month: "short" }), value: 0 };
  });
  for (const d of deals) {
    const c = new Date(d.createdAt);
    const b = months.find((x) => x.y === c.getFullYear() && x.m === c.getMonth());
    if (b) b.value++;
  }

  const won = new Set(stages.filter((s) => s.isWon).map((s) => s.id));
  const lost = new Set(stages.filter((s) => s.isLost).map((s) => s.id));
  const wonDeals = deals.filter((d) => won.has(d.stageId));
  const lostCount = deals.filter((d) => lost.has(d.stageId)).length;
  const closed = wonDeals.length + lostCount;
  return {
    byStage,
    byStatus,
    months,
    winRate: closed ? Math.round((wonDeals.length / closed) * 100) : 0,
    wonValue: wonDeals.reduce((a, d) => a + (d.value || 0), 0),
    avgDeal: deals.length ? deals.reduce((a, d) => a + (d.value || 0), 0) / deals.length : 0,
    total: deals.length,
  };
}

function Stat({ label, value, format, i }: { label: string; value: number; format: (n: number) => string; i: number }) {
  const v = useCountUp(value, 1000);
  return (
    <div class="metric rise" style={{ "--i": i } as never}>
      <span class="m-value t-metric" style="font-size:22px">{format(v)}</span>
      <span class="m-label">{label}</span>
    </div>
  );
}

export function Reports() {
  const r = useLive(loadReports, []);
  return (
    <Screen title="Reports" backLabel="More" backTo="/more">
      <div class="content">
        {!r ? (
          <div class="skel" style="height:240px;border-radius:22px" />
        ) : (
          <>
            <div class="metrics">
              <Stat i={0} label="Win rate" value={r.winRate} format={(n) => `${Math.round(n)}%`} />
              <Stat i={1} label="Won value" value={r.wonValue} format={(n) => money(n, "USD", true)} />
              <Stat i={2} label="Avg. deal" value={r.avgDeal} format={(n) => money(n, "USD", true)} />
            </div>

            <section class="section">
              <div class="section-head">
                <h2>Deals by stage</h2>
                <span class="t-footnote c3">{r.total} total</span>
              </div>
              <div class="card rise" style={{ "--i": 3 } as never}>
                <ColumnChart items={r.byStage} />
              </div>
            </section>

            <section class="section">
              <div class="section-head">
                <h2>Contacts by status</h2>
              </div>
              <div class="card rise" style={{ "--i": 4 } as never}>
                <Donut items={r.byStatus} />
              </div>
            </section>

            <section class="section">
              <div class="section-head">
                <h2>Deals created</h2>
                <span class="t-footnote c3">last 6 months</span>
              </div>
              <div class="card rise" style={{ "--i": 5 } as never}>
                <ColumnChart items={r.months.map((m) => ({ label: m.label, value: m.value }))} />
              </div>
            </section>
          </>
        )}
      </div>
    </Screen>
  );
}
