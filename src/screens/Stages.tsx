import { db } from "../db/schema";
import { defaultPipelineId, deleteStage, reorderStages } from "../db/repo";
import { useLive } from "../lib/hooks";
import { Icon } from "../ui/icons";
import { Badge, Group, Row, Screen } from "../ui/kit";
import { actionSheet } from "../ui/overlay";
import { openStageForm } from "./forms";
import { confirmDelete } from "./shared";

export function StagesScreen() {
  const data = useLive(async () => {
    const pid = await defaultPipelineId();
    if (!pid) return null;
    const [stages, deals] = await Promise.all([db.stages.where("pipelineId").equals(pid).sortBy("position"), db.deals.where("pipelineId").equals(pid).toArray()]);
    const counts = new Map<string, number>();
    deals.forEach((d) => counts.set(d.stageId, (counts.get(d.stageId) ?? 0) + 1));
    return { pid, stages, counts };
  }, []);

  const move = async (i: number, dir: -1 | 1) => {
    if (!data) return;
    const ids = data.stages.map((s) => s.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await reorderStages(ids);
  };

  return (
    <Screen
      title="Stages"
      backLabel="Pipeline"
      backTo="/pipeline"
      right={
        data && (
          <button class="nav-btn" aria-label="New stage" onClick={() => openStageForm(data.pid, undefined, data.stages.length)}>
            <Icon name="plus" size={26} />
          </button>
        )
      }
    >
      <div class="content">
        {data && (
          <Group footer="Won and lost stages are left out of the open pipeline total. A stage that still holds deals can't be deleted.">
            {data.stages.map((s, i) => (
              <Row
                key={s.id}
                i={i}
                title={s.name}
                sub={`${data.counts.get(s.id) ?? 0} deals${s.probability !== undefined ? ` · ${s.probability}%` : ""}`}
                trail={s.isWon ? <Badge tone="success">Won</Badge> : s.isLost ? <Badge>Lost</Badge> : undefined}
                onClick={() =>
                  actionSheet(
                    [
                      { label: "Edit", icon: "edit", run: () => openStageForm(data.pid, s) },
                      ...(i > 0 ? [{ label: "Move up", icon: "chevronLeft" as const, run: () => void move(i, -1) }] : []),
                      ...(i < data.stages.length - 1 ? [{ label: "Move down", icon: "chevronRight" as const, run: () => void move(i, 1) }] : []),
                      { label: "Delete", icon: "trash", destructive: true, run: () => void confirmDelete("stage", () => deleteStage(s.id)) },
                    ],
                    s.name,
                  )
                }
              />
            ))}
          </Group>
        )}
      </div>
    </Screen>
  );
}
