import { db, type Stage } from "./schema";
import { getMeta, now, setMeta, uid } from "./repo";

/**
 * First run: create the default pipeline with the same stages the web CRM's
 * create_organization() RPC seeds. Idempotent.
 */
export async function ensureSeeded(): Promise<void> {
  const seeded = await getMeta("seeded", false);
  if (seeded && (await db.pipelines.count()) > 0) return;
  await db.transaction("rw", [db.pipelines, db.stages, db.meta], async () => {
    if ((await db.pipelines.count()) > 0) {
      await setMeta("seeded", true);
      return;
    }
    const t = now();
    const pipelineId = uid();
    await db.pipelines.add({ id: pipelineId, name: "Sales Pipeline", isDefault: 1, createdAt: t, updatedAt: t });
    const names: [string, number, boolean, boolean][] = [
      ["Lead", 10, false, false],
      ["Qualified", 25, false, false],
      ["Proposal", 50, false, false],
      ["Negotiation", 75, false, false],
      ["Won", 100, true, false],
      ["Lost", 0, false, true],
    ];
    const stages: Stage[] = names.map(([name, probability, isWon, isLost], position) => ({
      id: uid(),
      pipelineId,
      name,
      position,
      probability,
      isWon,
      isLost,
      createdAt: t,
      updatedAt: t,
    }));
    await db.stages.bulkAdd(stages);
    await setMeta("seeded", true);
  });
}

/** Demo data so the app can be explored before importing real data. */
export async function loadSampleData(): Promise<void> {
  await ensureSeeded();
  const stages = await db.stages.orderBy("position").toArray();
  const pipelineId = stages[0]?.pipelineId;
  if (!pipelineId) return;
  const day = 86400000;
  const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString();

  const companies = [
    ["Northwind Labs", "northwind.io", "Software"],
    ["Bluepeak Studio", "bluepeak.design", "Design"],
    ["Atlas Freight", "atlasfreight.com", "Logistics"],
    ["Lumen Health", "lumenhealth.co", "Healthcare"],
    ["Cedar & Co", "cedarco.com", "Retail"],
  ].map(([name, domain, industry], i) => ({
    id: uid(),
    name,
    domain,
    website: `https://${domain}`,
    industry,
    createdAt: iso(-60 + i),
    updatedAt: iso(-10 + i),
  }));
  await db.companies.bulkAdd(companies);

  const people: [string, string, number, "new" | "qualified" | "connected" | "attempted" | "won"][] = [
    ["Amara Okafor", "Head of Growth", 0, "qualified"],
    ["Liam Chen", "CTO", 0, "connected"],
    ["Sofia Rossi", "Creative Director", 1, "new"],
    ["Noah Patel", "Ops Manager", 2, "attempted"],
    ["Hana Suzuki", "Founder", 3, "won"],
    ["Omar Haddad", "Procurement Lead", 4, "qualified"],
    ["Ella Novak", "Marketing Lead", 1, "new"],
    ["Mateo García", "COO", 2, "connected"],
  ];
  const contacts = people.map(([name, jobTitle, ci, status], i) => ({
    id: uid(),
    name,
    jobTitle,
    status,
    priority: (["low", "medium", "high", "veryHigh"] as const)[i % 4],
    email: `${name.split(" ")[0].toLowerCase()}@${companies[ci].domain}`,
    phone: `+1 555 01${String(10 + i)}`,
    companyId: companies[ci].id,
    customFields: {},
    createdAt: iso(-40 + i * 3),
    updatedAt: iso(-5 + i),
  }));
  await db.contacts.bulkAdd(contacts);

  const tagIds = [uid(), uid(), uid()];
  await db.tags.bulkAdd([
    { id: tagIds[0], name: "VIP", color: "brand", createdAt: iso(-30) },
    { id: tagIds[1], name: "Referral", color: "success", createdAt: iso(-30) },
    { id: tagIds[2], name: "Follow up", color: "warning", createdAt: iso(-30) },
  ]);
  await db.contactTags.bulkAdd([
    { contactId: contacts[0].id, tagId: tagIds[0] },
    { contactId: contacts[4].id, tagId: tagIds[0] },
    { contactId: contacts[1].id, tagId: tagIds[1] },
    { contactId: contacts[3].id, tagId: tagIds[2] },
  ]);

  const dealDefs: [string, number, number, number, number][] = [
    ["Northwind annual licence", 24000, 2, 0, -12],
    ["Bluepeak rebrand", 8500, 1, 2, -9],
    ["Atlas fleet tracking", 41000, 3, 3, -7],
    ["Lumen pilot", 12000, 4, 4, -20],
    ["Cedar POS rollout", 6400, 0, 5, -3],
    ["Northwind add-on seats", 3200, 1, 1, -1],
    ["Bluepeak retainer", 4800, 5, 6, -25],
  ];
  await db.deals.bulkAdd(
    dealDefs.map(([name, value, si, ci, created]) => ({
      id: uid(),
      pipelineId,
      stageId: stages[Math.min(si, stages.length - 1)].id,
      name,
      value,
      currency: "USD",
      contactId: contacts[ci].id,
      companyId: contacts[ci].companyId,
      createdAt: iso(created),
      updatedAt: iso(created),
    })),
  );

  await db.tasks.bulkAdd(
    [
      ["Send proposal to Northwind", -1, "high", 0],
      ["Call Liam about integration", 0, "medium", 1],
      ["Prepare Atlas demo", 2, "high", 3],
      ["Check in with Sofia", 5, "low", 2],
      ["Renewal paperwork for Hana", 9, "medium", 4],
    ].map(([title, due, priority, ci]) => ({
      id: uid(),
      title: title as string,
      priority: priority as "low" | "medium" | "high",
      status: "open" as const,
      dueAt: iso(due as number),
      contactId: contacts[ci as number].id,
      createdAt: iso(-3),
      updatedAt: iso(-3),
    })),
  );

  await db.activities.bulkAdd(
    [
      [0, "call", "Intro call, interested in annual plan", -6],
      [1, "note", "Wants SSO before signing", -4],
      [4, "meeting", "Kick-off meeting went well", -2],
      [3, "note", "Left voicemail", -1],
    ].map(([ci, type, body, d]) => ({
      id: uid(),
      type: type as "note" | "call" | "meeting",
      body: body as string,
      contactId: contacts[ci as number].id,
      occurredAt: iso(d as number),
      createdAt: iso(d as number),
    })),
  );

  const t = now();
  const projectId = uid();
  await db.projects.add({ id: projectId, name: "Q3 launch", createdAt: t, updatedAt: t });
  const colIds = [uid(), uid(), uid()];
  await db.projectColumns.bulkAdd(
    ["To do", "In progress", "Done"].map((name, position) => ({
      id: colIds[position],
      projectId,
      name,
      position,
      createdAt: t,
      updatedAt: t,
    })),
  );
  await db.projectTodos.bulkAdd(
    [
      ["Draft landing page copy", 0],
      ["Pick launch date", 0],
      ["Design pricing table", 1],
      ["Set up analytics dashboard", 2],
    ].map(([title, c], position) => ({
      id: uid(),
      projectId,
      columnId: colIds[c as number],
      title: title as string,
      position,
      createdAt: t,
      updatedAt: t,
    })),
  );
}
