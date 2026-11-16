import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { match, switchTab, tabOf, useRoute, type Direction } from "./lib/router";
import { Icon, type IconName } from "./ui/icons";
import { Overlays, actionSheet } from "./ui/overlay";
import { Dashboard } from "./screens/Dashboard";
import { ContactsList, ContactDetail } from "./screens/Contacts";
import { CompaniesList, CompanyDetail } from "./screens/Companies";
import { Pipeline, DealDetail } from "./screens/Pipeline";
import { TasksList, TaskDetail } from "./screens/Tasks";
import { ProjectsList, ProjectBoard } from "./screens/Projects";
import { More } from "./screens/More";
import { Reports } from "./screens/Reports";
import { TagsScreen } from "./screens/Tags";
import { LeadTypesScreen } from "./screens/LeadTypes";
import { SearchScreen } from "./screens/Search";
import { SettingsScreen } from "./screens/Settings";
import { LedgerDetail, MoneyScreen } from "./screens/Ledger";
import { StagesScreen } from "./screens/Stages";
import { NotFound } from "./screens/NotFound";
import { openCompanyForm, openContactForm, openDealForm, openLeadForm, openLedgerForm, openNoteForm, openTaskForm, openTransactionForm } from "./screens/forms";

const ROUTES: [string, (p: Record<string, string>) => JSX.Element][] = [
  ["/", () => <Dashboard />],
  ["/contacts", () => <ContactsList />],
  ["/contacts/:id", (p) => <ContactDetail id={p.id} />],
  ["/companies", () => <CompaniesList />],
  ["/companies/:id", (p) => <CompanyDetail id={p.id} />],
  ["/pipeline", () => <Pipeline />],
  ["/pipeline/stages", () => <StagesScreen />],
  ["/deals/:id", (p) => <DealDetail id={p.id} />],
  ["/tasks", () => <TasksList />],
  ["/tasks/:id", (p) => <TaskDetail id={p.id} />],
  ["/projects", () => <ProjectsList />],
  ["/projects/:id", (p) => <ProjectBoard id={p.id} />],
  ["/money", () => <MoneyScreen />],
  ["/money/:id", (p) => <LedgerDetail id={p.id} />],
  ["/more", () => <More />],
  ["/reports", () => <Reports />],
  ["/tags", () => <TagsScreen />],
  ["/lead-types", () => <LeadTypesScreen />],
  ["/search", () => <SearchScreen />],
  ["/settings", () => <SettingsScreen />],
];

function render(path: string): JSX.Element {
  for (const [pattern, el] of ROUTES) {
    const params = match(pattern, path);
    if (params) return el(params);
  }
  return <NotFound />;
}

interface Layer {
  key: number;
  path: string;
  cls: string;
  el: JSX.Element;
}

const ENTER: Record<Direction, string> = { push: "enter-push", pop: "enter-pop", tab: "enter-tab", none: "" };
const LEAVE: Record<Direction, string> = { push: "leave-push", pop: "leave-pop", tab: "leave-tab", none: "" };

/** Keeps the outgoing screen mounted while it animates out. */
function ScreenStack() {
  const route = useRoute();
  const [layers, setLayers] = useState<Layer[]>(() => [{ key: route.key, path: route.path, cls: "", el: render(route.path) }]);
  const timer = useRef<number>();

  useEffect(() => {
    setLayers((prev) => {
      const current = prev[prev.length - 1];
      if (current.path === route.path) return prev;
      const outgoing = { ...current, cls: LEAVE[route.dir] };
      const incoming = { key: route.key, path: route.path, cls: ENTER[route.dir], el: render(route.path) };
      // Pop: the outgoing page slides off on top of the incoming one.
      return route.dir === "pop" ? [incoming, outgoing] : [outgoing, incoming];
    });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setLayers((prev) => {
        const keep = prev.find((l) => l.key === route.key);
        return keep ? [{ ...keep, cls: "" }] : prev;
      });
    }, 440);
  }, [route.key]);

  return (
    <div class="stage">
      {layers.map((l) => (
        <div key={l.key} class={`screen ${l.cls} ${l.key === route.key ? "current" : ""}`} data-path={l.path}>
          {l.el}
        </div>
      ))}
    </div>
  );
}

const TABS: { path: string; label: string; icon: IconName }[] = [
  { path: "/", label: "Home", icon: "home" },
  { path: "/contacts", label: "Contacts", icon: "users" },
  { path: "/pipeline", label: "Pipeline", icon: "pipeline" },
  { path: "/money", label: "Money", icon: "wallet" },
  { path: "/more", label: "More", icon: "grid" },
];

function TabBar() {
  const route = useRoute();
  const active = tabOf(route.path);
  return (
    <nav class="tabbar" aria-label="Main">
      {TABS.map((t) => (
        <button
          key={t.path}
          class="tab"
          aria-current={active === t.path ? "page" : undefined}
          onClick={() => switchTab(t.path)}
        >
          <span class="tab-ico">
            <Icon name={t.icon} size={24} stroke={active === t.path ? 2.3 : 1.9} />
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}

function Fab() {
  const route = useRoute();
  const show = ["/", "/contacts", "/pipeline", "/money", "/tasks"].includes(route.path);
  const open = () =>
    actionSheet(
      [
        { label: "New lead", icon: "sparkles", run: () => openLeadForm() },
        { label: "Add expense", icon: "arrowUpRight", run: () => openTransactionForm(undefined, { type: "expense" }) },
        { label: "Add income", icon: "arrowDownLeft", run: () => openTransactionForm(undefined, { type: "income", scope: "business" }) },
        { label: "Loan or credit (owed)", icon: "handshake", run: () => openLedgerForm() },
        { label: "New contact", icon: "user", run: () => openContactForm() },
        { label: "New deal", icon: "dollar", run: () => openDealForm() },
        { label: "New task", icon: "tasks", run: () => openTaskForm() },
        { label: "New company", icon: "building", run: () => openCompanyForm() },
        { label: "Quick note", icon: "note", run: () => openNoteForm() },
      ],
      "Create",
    );
  return (
    <button class={`fab press ${show ? "" : "hidden"}`} aria-label="Create" onClick={open} tabIndex={show ? 0 : -1}>
      <Icon name="plus" size={28} stroke={2.6} />
    </button>
  );
}

export function App() {
  return (
    <>
      <ScreenStack />
      <Fab />
      <TabBar />
      <Overlays />
    </>
  );
}
