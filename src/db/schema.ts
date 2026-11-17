import Dexie, { type Table } from "dexie";

export type ContactStatus = "new" | "qualified" | "connected" | "attempted" | "won";
export type ContactPriority = "low" | "medium" | "high" | "veryHigh";
export type TaskPriority = "low" | "medium" | "high";
export type ActivityType = "note" | "call" | "meeting" | "field_change";
export type TagColor = "neutral" | "brand" | "success" | "warning" | "danger" | "info";
export type LeadFieldType = "text" | "number" | "date" | "select" | "checkbox";
export type PaymentTerms = "immediate" | "credit";
export type ProjectStatus = "not_started" | "in_progress" | "completed";

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
  /** Set when the project was created from a won deal. */
  dealId?: string;
  contactId?: string;
  description?: string;
  /** Where the work stands. */
  status?: ProjectStatus;
  /** Agreed total for projects not created from a deal (deal projects use deal.value). */
  agreed?: number;
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
  /** Loans only: the account the money left (lent) or arrived in (borrowed). */
  accountId?: string;
  settledAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** A (partial) repayment against a ledger entry. */
export interface Payment {
  id: string;
  entryId: string;
  /** Account the repayment went into / came out of. */
  accountId?: string;
  amount: number;
  date: string; // YYYY-MM-DD
  note?: string;
  createdAt: string;
}

/**
 * A money movement for the cash-flow book: income or expense, business or
 * personal. Deal payments (advance, delivery, extras) are income
 * transactions linked to the deal. Payments on credit entries create a
 * linked transaction too (`ledgerPaymentId`), so cash flow stays complete
 * without double entry. Personal loans are NOT income/expense and only live
 * in the ledger.
 */
export interface Transaction {
  id: string;
  type: "income" | "expense";
  scope: "business" | "personal";
  amount: number;
  currency: string;
  date: string; // YYYY-MM-DD
  category: string;
  method?: string; // Cash, Bank, JazzCash, Easypaisa, Card
  note?: string;
  contactId?: string;
  dealId?: string;
  ledgerPaymentId?: string;
  /** Which account the money went into / came out of. */
  accountId?: string;
  /** Money received for, or spent on, a project. */
  projectId?: string;
  createdAt: string;
  updatedAt: string;
}

/** A place money sits: a bank, a wallet (NayaPay, JazzCash, Easypaisa) or cash. */
export interface Account {
  id: string;
  name: string;
  kind: "bank" | "wallet" | "cash";
  scope: "business" | "personal";
  /** Balance when the account was added to the app. */
  openingBalance: number;
  openingDate: string; // YYYY-MM-DD
  position: number;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Money moved between two of your own accounts. Not income, not expense. */
export interface Transfer {
  id: string;
  fromAccountId: string;
  toAccountId: string;
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
  transactions!: Table<Transaction, string>;
  accounts!: Table<Account, string>;
  transfers!: Table<Transfer, string>;
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
    // v3: cash-flow book (income / expenses, business / personal, deal payments).
    this.version(3).stores({
      transactions: "id, date, type, scope, category, dealId, contactId, ledgerPaymentId",
    });
    // v4: accounts (banks, wallets, cash) and transfers; money rows remember their account.
    this.version(4).stores({
      transactions: "id, date, type, scope, category, dealId, contactId, ledgerPaymentId, accountId",
      ledger: "id, direction, contactId, dealId, settledAt, date, accountId",
      payments: "id, entryId, date, accountId",
      projects: "id, updatedAt, dealId, contactId",
      accounts: "id, position, scope",
      transfers: "id, date, fromAccountId, toAccountId",
    });
    // v5: project status + project money (income/expense linked to a project).
    this.version(5)
      .stores({
        transactions: "id, date, type, scope, category, dealId, contactId, ledgerPaymentId, accountId, projectId",
        projects: "id, updatedAt, dealId, contactId, status",
      })
      .upgrade(async (tx) => {
        // Projects that already exist are most likely being worked on.
        await tx.table("projects").toCollection().modify((p: { status?: string }) => {
          if (!p.status) p.status = "in_progress";
        });
      });
  }
}

export const db = new CovisonDB();

/** Every data table, in restore order (parents before children). `meta` excluded. */
export const DATA_TABLES = [
  "accounts",
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
  "transactions",
  "transfers",
] as const;
export type DataTableName = (typeof DATA_TABLES)[number];

export const SCHEMA_VERSION = 5;

export const DEFAULT_CURRENCY = "PKR";
