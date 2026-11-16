import Dexie, { type Table } from "dexie";

export type ContactStatus = "new" | "qualified" | "connected" | "attempted" | "won";
export type ContactPriority = "low" | "medium" | "high" | "veryHigh";
export type TaskPriority = "low" | "medium" | "high";
export type ActivityType = "note" | "call" | "meeting" | "field_change";
export type TagColor = "neutral" | "brand" | "success" | "warning" | "danger" | "info";
export type LeadFieldType = "text" | "number" | "date" | "select" | "checkbox";
export type PaymentTerms = "immediate" | "credit";

export interface Contact {
  /** How this client pays: up front, or on credit (creates a receivable when a deal is won). */
  paymentTerms?: PaymentTerms;
  id: string;
  name: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  status: ContactStatus;
  priority?: ContactPriority;
  companyId?: string;
  expectedRevenue?: number;
  expectedClose?: string; // YYYY-MM-DD
  probability?: string;
  linkedinUrl?: string;
  website?: string;
  country?: string;
  city?: string;
  niche?: string;
  leadTypeId?: string;
  customFields: Record<string, string | number | boolean>;
  lastActivityAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Company {
  id: string;
  name: string;
  domain?: string;
  website?: string;
  phone?: string;
  industry?: string;
  size?: number;
  address?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Pipeline {
  id: string;
  name: string;
  isDefault: 0 | 1; // number so it can be indexed
  createdAt: string;
  updatedAt: string;
}

export interface Stage {
  id: string;
  pipelineId: string;
  name: string;
  position: number;
  probability?: number;
  color?: string;
  isWon: boolean;
  isLost: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Deal {
  id: string;
  pipelineId: string;
  stageId: string;
  name: string;
  value: number;
  currency: string;
  contactId?: string;
  companyId?: string;
  expectedCloseDate?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  status: "open" | "done";
  dueAt?: string; // ISO
  completedAt?: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  type: ActivityType;
  body?: string;
  metadata?: Record<string, unknown>;
  contactId?: string;
  companyId?: string;
  dealId?: string;
  projectId?: string;
  occurredAt: string;
  createdAt: string;
}

export interface Tag {
  id: string;
  name: string;
  color: TagColor;
  createdAt: string;
}

export interface ContactTag {
  contactId: string;
  tagId: string;
}

export interface LeadField {
  key: string;
  label: string;
  type: LeadFieldType;
  options?: string[];
  required?: boolean;
}

export interface LeadType {
  id: string;
  name: string;
  description?: string;
  position: number;
  fields: LeadField[];
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectColumn {
  id: string;
  projectId: string;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTodo {
  id: string;
  projectId: string;
  columnId: string;
  title: string;
  description?: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Money owed in either direction.
 * - direction "in": they owe me (receivable), "out": I owe them (payable)
 * - kind "credit": a sale/purchase on credit, "loan": a personal loan
 * The person is either a linked contact or a free-text name (+ phone),
 * so personal loans with friends don't need a CRM contact.
 */
export interface LedgerEntry {
  id: string;
  direction: "in" | "out";
  kind: "credit" | "loan";
  personName: string;
  phone?: string;
  contactId?: string;
  dealId?: string;
  amount: number;
  currency: string;
  date: string; // YYYY-MM-DD
  dueDate?: string; // YYYY-MM-DD
  note?: string;
  settledAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** A (partial) repayment against a ledger entry. */
export interface Payment {
  id: string;
  entryId: string;
  amount: number;
  date: string; // YYYY-MM-DD
  note?: string;
  createdAt: string;
}

export interface Meta {
  key: string;
  value: unknown;
}

export class CovisonDB extends Dexie {
  contacts!: Table<Contact, string>;
  companies!: Table<Company, string>;
  pipelines!: Table<Pipeline, string>;
  stages!: Table<Stage, string>;
  deals!: Table<Deal, string>;
  tasks!: Table<Task, string>;
  activities!: Table<Activity, string>;
  tags!: Table<Tag, string>;
  contactTags!: Table<ContactTag, [string, string]>;
  leadTypes!: Table<LeadType, string>;
  projects!: Table<Project, string>;
  projectColumns!: Table<ProjectColumn, string>;
  projectTodos!: Table<ProjectTodo, string>;
  ledger!: Table<LedgerEntry, string>;
  payments!: Table<Payment, string>;
  meta!: Table<Meta, string>;

  constructor(name = "covison-pocket") {
    super(name);
    this.version(1).stores({
      contacts: "id, name, status, companyId, leadTypeId, updatedAt, createdAt",
      companies: "id, name, updatedAt",
      pipelines: "id, isDefault",
      stages: "id, pipelineId, position",
      deals: "id, stageId, pipelineId, contactId, companyId, updatedAt, createdAt",
      tasks: "id, status, dueAt, contactId, companyId, dealId, projectId",
      activities: "id, occurredAt, contactId, companyId, dealId, projectId",
      tags: "id, name",
      contactTags: "[contactId+tagId], contactId, tagId",
      leadTypes: "id, position",
      projects: "id, updatedAt",
      projectColumns: "id, projectId, position",
      projectTodos: "id, projectId, columnId, position",
      meta: "key",
    });
    // v2: money ledger (credit clients + personal loans). Additive, no data migration needed.
    this.version(2).stores({
      ledger: "id, direction, contactId, dealId, settledAt, date",
      payments: "id, entryId, date",
    });
  }
}

export const db = new CovisonDB();

/** Every data table, in restore order (parents before children). `meta` excluded. */
export const DATA_TABLES = [
  "pipelines",
  "stages",
  "companies",
  "leadTypes",
  "contacts",
  "tags",
  "contactTags",
  "projects",
  "projectColumns",
  "projectTodos",
  "deals",
  "tasks",
  "activities",
  "ledger",
  "payments",
] as const;
export type DataTableName = (typeof DATA_TABLES)[number];

export const SCHEMA_VERSION = 2;

export const DEFAULT_CURRENCY = "PKR";
