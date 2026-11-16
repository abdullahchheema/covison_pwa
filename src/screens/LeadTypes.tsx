import { db } from "../db/schema";
import { deleteLeadType } from "../db/repo";
import { useLive } from "../lib/hooks";
import { LEAD_FIELD_LABELS } from "../lib/options";
import { Icon } from "../ui/icons";
import { Empty, Group, Row, Screen, SwipeRow } from "../ui/kit";
import { openLeadTypeForm } from "./forms";
import { confirmDelete } from "./shared";

export function LeadTypesScreen() {
  const data = useLive(async () => {
    const [types, contacts] = await Promise.all([db.leadTypes.orderBy("position").toArray(), db.contacts.toArray()]);
    const counts = new Map<string, number>();
    contacts.forEach((c) => c.leadTypeId && counts.set(c.leadTypeId, (counts.get(c.leadTypeId) ?? 0) + 1));
    return { types, counts };
  }, []);
  return (
    <Screen
      title="Lead types"
      backLabel="More"
      backTo="/more"
      right={
        <button class="nav-btn" aria-label="New lead type" onClick={() => openLeadTypeForm()}>
          <Icon name="plus" size={26} />
        </button>
      }
    >
      <div class="content">
        {data && data.types.length === 0 ? (
          <Empty
            icon="layers"
            title="No lead types"
            text="Group contacts by kind (e.g. Agency, Founder) and give each kind its own extra fields."
            action={<button class="btn primary sm press" onClick={() => openLeadTypeForm()}>New lead type</button>}
          />
        ) : (
          <Group footer="Deleting a lead type keeps its contacts; only the type and its custom field labels go.">
            {data?.types.map((t, i) => (
              <SwipeRow key={t.id} i={i} actions={[{ label: "Delete", icon: "trash", tone: "danger", run: () => void confirmDelete("lead type", () => deleteLeadType(t.id)) }]}>
                <Row
                  onClick={() => openLeadTypeForm(t)}
                  lead={<span class="tile indigo"><Icon name="layers" size={16} /></span>}
                  title={t.name}
                  sub={t.fields.length ? t.fields.map((f) => `${f.label} (${LEAD_FIELD_LABELS[f.type]})`).join(", ") : "No custom fields"}
                  value={`${data.counts.get(t.id) ?? 0}`}
                />
              </SwipeRow>
            ))}
          </Group>
        )}
      </div>
    </Screen>
  );
}
