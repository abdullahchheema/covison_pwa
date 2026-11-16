// Global search across every entity (replaces the web CRM's Cmd-K palette).
import { useEffect, useRef, useState } from "preact/hooks";
import { db } from "../db/schema";
import { useLive } from "../lib/hooks";
import { money } from "../lib/format";
import { navigate } from "../lib/router";
import { Icon, type IconName } from "../ui/icons";
import { Avatar, Empty, Group, Row, Screen, useDebounced } from "../ui/kit";

interface Hit {
  id: string;
  kind: string;
  title: string;
  sub?: string;
  to: string;
  icon?: IconName;
  square?: boolean;
}

export function SearchScreen() {
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim().toLowerCase(), 100);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 450);
    return () => clearTimeout(t);
  }, []);

  const results = useLive(async () => {
    if (!query) return null;
    const has = (...v: (string | undefined)[]) => v.some((x) => x?.toLowerCase().includes(query));
    const [contacts, companies, deals, tasks, projects] = await Promise.all([
      db.contacts.filter((c) => has(c.name, c.email, c.phone, c.jobTitle, c.city)).limit(20).toArray(),
      db.companies.filter((c) => has(c.name, c.domain, c.industry)).limit(10).toArray(),
      db.deals.filter((d) => has(d.name, d.description)).limit(10).toArray(),
      db.tasks.filter((t) => has(t.title, t.description)).limit(10).toArray(),
      db.projects.filter((p) => has(p.name)).limit(10).toArray(),
    ]);
    const groups: { label: string; hits: Hit[] }[] = [
      { label: "Contacts", hits: contacts.map((c) => ({ id: c.id, kind: "contact", title: c.name, sub: c.email ?? c.jobTitle, to: `/contacts/${c.id}` })) },
      { label: "Companies", hits: companies.map((c) => ({ id: c.id, kind: "company", title: c.name, sub: c.industry, to: `/companies/${c.id}`, square: true })) },
      { label: "Deals", hits: deals.map((d) => ({ id: d.id, kind: "deal", title: d.name, sub: money(d.value, d.currency), to: `/deals/${d.id}`, icon: "dollar", square: true })) },
      { label: "Tasks", hits: tasks.map((t) => ({ id: t.id, kind: "task", title: t.title, sub: t.status === "done" ? "Completed" : "Open", to: `/tasks/${t.id}`, icon: "tasks", square: true })) },
      { label: "Projects", hits: projects.map((p) => ({ id: p.id, kind: "project", title: p.name, to: `/projects/${p.id}`, icon: "folder", square: true })) },
    ];
    return groups.filter((g) => g.hits.length);
  }, [query]);

  let i = 0;
  return (
    <Screen title="Search" backLabel="Back">
      <label class="search">
        <Icon name="search" size={18} />
        <input
          ref={input}
          type="search"
          value={q}
          placeholder="Contacts, companies, deals, tasks…"
          enterKeyHint="search"
          autoComplete="off"
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
      </label>
      <div class="content">
        {!query ? (
          <Empty icon="search" title="Search everything" text="Everything is searched right here on your iPhone. Nothing leaves the device." />
        ) : results && results.length === 0 ? (
          <Empty icon="search" title="No results" text={`Nothing matches “${q.trim()}”.`} />
        ) : (
          results?.map((g) => (
            <Group key={g.label} label={g.label} class="mt12">
              {g.hits.map((h) => (
                <Row key={h.id} i={i++} onClick={() => navigate(h.to)} lead={<Avatar name={h.title} icon={h.icon} square={h.square} />} title={h.title} sub={h.sub} />
              ))}
            </Group>
          ))
        )}
      </div>
    </Screen>
  );
}
