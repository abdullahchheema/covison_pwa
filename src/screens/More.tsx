import { db } from "../db/schema";
import { useLive } from "../lib/hooks";
import { navigate } from "../lib/router";
import { Icon, type IconName } from "../ui/icons";
import { Group, Row, Screen } from "../ui/kit";
import { BackupReminder } from "./Settings";

const ITEMS: { to: string; label: string; icon: IconName; tile: string; count?: "companies" | "projects" | "tags" | "leadTypes" | "tasks" | "contacts" }[] = [
  { to: "/contacts", label: "Contacts", icon: "users", tile: "violet", count: "contacts" },
  { to: "/tasks", label: "Tasks", icon: "tasks", tile: "green", count: "tasks" },
  { to: "/companies", label: "Companies", icon: "building", tile: "blue", count: "companies" },
  { to: "/reports", label: "Reports", icon: "chart", tile: "violet" },
  { to: "/search", label: "Search", icon: "search", tile: "gray" },
];
const ORGANISE: typeof ITEMS = [
  { to: "/tags", label: "Tags", icon: "tag", tile: "pink", count: "tags" },
  { to: "/lead-types", label: "Lead types", icon: "layers", tile: "indigo", count: "leadTypes" },
  { to: "/pipeline/stages", label: "Pipeline stages", icon: "columns", tile: "gold" },
];

export function More() {
  const counts = useLive(async () => ({
    tasks: await db.tasks.where("status").equals("open").count(),
    contacts: await db.contacts.count(),
    companies: await db.companies.count(),
    projects: await db.projects.count(),
    tags: await db.tags.count(),
    leadTypes: await db.leadTypes.count(),
  }), []);
  let i = 0;
  const row = (it: (typeof ITEMS)[number]) => (
    <Row
      key={it.to}
      i={i++}
      onClick={() => navigate(it.to)}
      lead={
        <span class={`tile ${it.tile}`}>
          <Icon name={it.icon} size={17} />
        </span>
      }
      title={it.label}
      value={it.count && counts ? counts[it.count] : undefined}
    />
  );
  return (
    <Screen title="More">
      <div class="content col gap16">
        <BackupReminder compact />
        <Group>{ITEMS.map(row)}</Group>
        <Group label="Organise">{ORGANISE.map(row)}</Group>
        <Group>
          {row({ to: "/settings", label: "Settings", icon: "settings", tile: "gray" })}
        </Group>
        <div class="col center gap8" style="padding:24px 0 8px">
          <img src="./logo-mark.png" alt="" width="48" height="48" style="filter:drop-shadow(0 8px 18px rgb(109 74 255 / .35))" />
          <p class="t-footnote c3">Covison Pocket · private &amp; offline</p>
        </div>
      </div>
    </Screen>
  );
}
