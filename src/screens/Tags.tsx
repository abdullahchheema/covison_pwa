import { db } from "../db/schema";
import { deleteTag } from "../db/repo";
import { useLive } from "../lib/hooks";
import { Icon } from "../ui/icons";
import { Badge, Empty, Group, Row, Screen, SwipeRow } from "../ui/kit";
import { openTagForm } from "./forms";
import { confirmDelete } from "./shared";

export function TagsScreen() {
  const data = useLive(async () => {
    const [tags, links] = await Promise.all([db.tags.orderBy("name").toArray(), db.contactTags.toArray()]);
    const counts = new Map<string, number>();
    links.forEach((l) => counts.set(l.tagId, (counts.get(l.tagId) ?? 0) + 1));
    return { tags, counts };
  }, []);
  return (
    <Screen
      title="Tags"
      backLabel="More"
      backTo="/more"
      right={
        <button class="nav-btn" aria-label="New tag" onClick={() => openTagForm()}>
          <Icon name="plus" size={26} />
        </button>
      }
    >
      <div class="content">
        {data && data.tags.length === 0 ? (
          <Empty icon="tag" title="No tags" text="Tags help you slice contacts any way you like." action={<button class="btn primary sm press" onClick={() => openTagForm()}>New tag</button>} />
        ) : (
          <Group footer="Swipe a tag to delete it. Contacts keep everything else.">
            {data?.tags.map((t, i) => (
              <SwipeRow key={t.id} i={i} actions={[{ label: "Delete", icon: "trash", tone: "danger", run: () => void confirmDelete("tag", () => deleteTag(t.id)) }]}>
                <Row
                  onClick={() => openTagForm(t)}
                  title={<Badge tone={t.color}>{t.name}</Badge>}
                  value={`${data.counts.get(t.id) ?? 0} contacts`}
                />
              </SwipeRow>
            ))}
          </Group>
        )}
      </div>
    </Screen>
  );
}
