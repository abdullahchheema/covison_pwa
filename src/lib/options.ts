// Option lists and labels, ported from web/src/components/contacts/contacts-table.tsx
// and the task / lead-type forms so the vocabulary matches the web CRM.
import type { ActivityType, ContactPriority, ContactStatus, LeadFieldType, TagColor, TaskPriority } from "../db/schema";

export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

export const CONTACT_STATUSES: ContactStatus[] = ["new", "qualified", "connected", "attempted", "won"];
export const STATUS_LABELS: Record<ContactStatus, string> = {
  new: "New",
  qualified: "Qualified",
  connected: "Connected",
  attempted: "Attempted",
  won: "Won",
};
export const STATUS_TONE: Record<ContactStatus, Tone> = {
  new: "info",
  qualified: "brand",
  connected: "brand",
  attempted: "warning",
  won: "success",
};

export const CONTACT_PRIORITIES: ContactPriority[] = ["low", "medium", "high", "veryHigh"];
export const PRIORITY_LABELS: Record<ContactPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  veryHigh: "Very high",
};
export const PRIORITY_TONE: Record<ContactPriority, Tone> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  veryHigh: "danger",
};

export const TASK_PRIORITIES: TaskPriority[] = ["low", "medium", "high"];
export const TASK_PRIORITY_TONE: Record<TaskPriority, Tone> = { low: "neutral", medium: "info", high: "warning" };

export const TAG_COLORS: TagColor[] = ["neutral", "brand", "success", "warning", "danger", "info"];

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  note: "Note",
  call: "Call",
  meeting: "Meeting",
  field_change: "Update",
};

export const LEAD_FIELD_TYPES: LeadFieldType[] = ["text", "number", "date", "select", "checkbox"];
export const LEAD_FIELD_LABELS: Record<LeadFieldType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  select: "Choice",
  checkbox: "Yes / No",
};

export const CURRENCIES = ["PKR", "USD", "AED", "SAR", "GBP", "EUR", "CAD", "AUD"];
