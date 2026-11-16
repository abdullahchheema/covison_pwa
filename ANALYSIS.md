# Covison Pocket: analysis of the existing CRM

This note describes how the existing Covison CRM maps onto **Covison Pocket**, a private, single-user, offline-first PWA for iPhone.

## 1. What exists today

The repo holds three codebases:

| Folder | What it is | Status |
|---|---|---|
| `web/` | Next.js 16.3 (App Router), React 19, Tailwind v4, Supabase (Postgres, Auth, Storage, Realtime), recharts, dnd-kit, papaparse | **Live product.** The only thing CI builds. This is the source for the port. |
| `backend/` | Go + MongoDB + SMTP scheduler | Legacy, not ported |
| `frontend/` | Vite + React SPA for the Go API | Legacy, not ported |

How `web/` is built:
- Every page is a server component that calls `requireOrgContext()`.
- Mutations go straight from the browser to Supabase through supabase-js, guarded by RLS.
- Server code is limited to:
  - a cron route that sends follow-up emails,
  - two server actions: send a template email, and send an invite email.

Schema details:
- Defined in `supabase/migrations/*.sql`.
- Every table carries `organization_id`, with composite foreign keys, and soft-deletes through a `deleted_at` column.

## 2. Feature decisions

The user's brief **dropped** email. When asked, the user also confirmed these keep/drop calls:

| Feature found | Decision | Why |
|---|---|---|
| Contacts (list, detail, filters, tags, custom fields) | **Keep** | Core CRM |
| Companies | **Keep** | Core CRM |
| Pipeline / Deals (kanban, detail) | **Keep** | Core CRM |
| Tasks | **Keep** | Core CRM |
| Activities timeline / notes | **Keep** | Core CRM |
| Dashboard | **Keep** | Core CRM |
| Reports (3 charts) | **Keep** | Core CRM |
| Tags | **Keep** | Core CRM |
| Projects (kanban of columns + to-dos) | **Keep** | Confirmed by the user |
| Lead types + custom fields | **Keep** | Confirmed by the user |
| Tickets (support desk) | **Drop** | Confirmed by the user |
| Email: templates, groups, send dialog, follow-up sequences, enrollments, Resend, the daily cron | **Drop** | Dropped in the brief |
| `mark_contact_contacted` (auto-creates a deal when an email is sent) | **Drop** | Only email sending triggers it |
| Auth: login, sign-up, Google OAuth, password reset, verification, onboarding | **Drop** | Single user; the app opens straight on the dashboard |
| Multi-tenancy: organizations, members, roles, invitations, team page, RLS, JWT claims | **Drop** | Single user |
| Owner / assignee fields and "Only mine" filters | **Drop** | Single user, so they mean nothing |
| Notifications (assignment, removed from org) + Realtime | **Drop** | Only triggered by other users. Local push would need a device permission, which the brief rules out. |
| Audit log viewer (`/settings/activity`) | **Drop** | Needs server triggers. Edits to key fields are logged as `field_change` activities on the timeline instead. |
| Saved views (server, per user, shareable) | **Replace** | The last-used filter for each list is remembered on the device |
| Workspace name/slug/logo upload (Supabase Storage) | **Drop** | Single user. The app keeps "Your name" for the greeting. |
| Command palette (Cmd/Ctrl+K) | **Replace** | Becomes a Search screen that covers every entity |
| CSV export (contacts, companies, deals, tasks) | **Keep** | Runs on the device and goes through the share sheet |
| CSV import (contacts, companies) | **Keep** | Same column mapping and validation as the web app |
| Marketing site, privacy, terms, OG image, robots, sitemap, llms.txt | **Drop** | The app is private, so no public web presence |
| Contact `email` field | **Keep** | It is data, not a feature. It shows as a `mailto:` link that opens iOS Mail. |

## 3. Data models kept (IndexedDB via Dexie)

Rules that apply to every table:
- IDs are strings. New ones come from `crypto.randomUUID()`. UUIDs from an import are kept as-is.
- Timestamps are ISO-8601 strings.
- Removed from every table:
  - `organization_id`, `owner_id`, `created_by`, `assigned_to`, `actor_id`, `deleted_at`.
- Deletes are hard deletes, with a 5-second **Undo**.

| Table | Fields | Relationships |
|---|---|---|
| `contacts` | id, name\*, email, phone, jobTitle, status (`new\|qualified\|connected\|attempted\|won`), priority (`low\|medium\|high\|veryHigh`), expectedRevenue (number), expectedClose (date), probability (string 0-1), linkedinUrl, website, country, city, niche, leadTypeId, customFields {key: value}, lastActivityAt, createdAt, updatedAt | → company (`companyId`), → leadType, ↔ tags (through `contactTags`) |
| `companies` | id, name\* (unique, case-insensitive), domain, website, phone, industry, size, address (string), createdAt, updatedAt | ← contacts, deals, tasks, activities |
| `pipelines` | id, name, isDefault | ← stages, deals |
| `stages` | id, pipelineId, name, position, probability, color, isWon, isLost | ← deals. Deleting is blocked while the stage holds deals, the same as ON DELETE RESTRICT. |
| `deals` | id, pipelineId, stageId\*, name\*, value, currency (default USD), expectedCloseDate, description, createdAt, updatedAt | → contact, → company |
| `tasks` | id, title\*, description, priority (`low\|medium\|high`), status (`open\|done`), dueAt, completedAt, createdAt, updatedAt | → **at most one** of contact, company, deal, or project |
| `activities` | id, type (`note\|call\|meeting\|field_change`), body, metadata, occurredAt, createdAt | → **exactly one** of contact, company, deal, or project |
| `tags` | id, name\* (unique), color (`neutral\|brand\|success\|warning\|danger\|info`) | ↔ contacts |
| `contactTags` | [contactId+tagId] | join table |
| `leadTypes` | id, name\*, description, position, fields: `[{key, label, type: text\|number\|date\|select\|checkbox, options?, required?}]` | ← contacts.leadTypeId |
| `projects` | id, name\*, createdAt, updatedAt | ← columns, to-dos, tasks, activities |
| `projectColumns` | id, projectId, name, position | ← to-dos |
| `projectTodos` | id, projectId, columnId, title\*, description, position, createdAt, updatedAt | |
| `meta` | key/value: displayName, theme, lastBackupAt, persistGranted, seeded, listFilters | |

\* means required.

What happens on delete:
- **Contact:** its activities and tag links are deleted. Its deals and tasks are kept, with `contactId` cleared.
- **Company:** the same pattern for its contacts, deals and tasks.
- **Project:** its columns, to-dos, activities and tasks are deleted.

## 4. Screens and flows ported

The bottom tab bar has five tabs:
- **Home**
- **Contacts**
- **Pipeline**
- **Tasks**
- **More**: Companies, Projects, Reports, Tags, Lead types, Search, Settings

A floating **+** button opens quick-create for a contact, deal, task, company, or note.

| Web route | PWA screen |
|---|---|
| `/dashboard` | Home: time-based greeting; open-pipeline hero with a 14-day cumulative sparkline (same baseline maths); mini metrics (contacts, companies, open tasks, overdue); pipeline by stage (2% bar floor, won in green, lost in grey); recent activity (6 items); upcoming tasks (5 items). Also shows a backup reminder. |
| `/contacts`, `/contacts/[id]` | Searchable list with status/priority/tag/lead-type filters and a CSV import/export menu. The detail page has a hero card, quick actions (call, text, mail, open website), details, custom fields, tags, deals, tasks, and a timeline with a note composer. |
| `/companies`, `/companies/[id]` | List and detail, with linked contacts, deals and the timeline |
| `/pipeline`, `/deals/[id]` | One full-width page per stage, which you swipe between. A segmented stage strip shows each stage's count and total. To move a deal, long-press its card and drag it onto a stage chip, or use the "Move to…" sheet. The deal detail page has the timeline. |
| `/tasks`, `/tasks/[id]` | Open and Completed segments with priority filters. Swipe a task to complete or delete it; open it to see details. Overdue tasks are highlighted. |
| `/projects`, `/projects/[id]` | Project list. Each board has swipeable columns. You can add, rename and reorder columns, and drag a to-do to another column. |
| `/reports` | Deals by stage, contacts by status, and deals created over the last 6 months. All charts are animated SVG. |
| `/tags`, `/lead-types` | Create, edit and delete tags and lead types, including the custom-field editor |
| Cmd-K palette | Search across contacts, companies, deals, tasks and projects |
| `/settings` | Your name, theme (System/Light/Dark), storage persistence, backup export and import, import from the existing CRM, CSV export, and erase all data |

## 5. Server dependencies and their replacements

| Dependency | Where (web) | Replacement |
|---|---|---|
| Supabase Postgres + RLS | everywhere | IndexedDB via Dexie, in one `repo.ts` data layer |
| Supabase Auth, OAuth, JWT hook, proxy redirect | `src/proxy.ts`, `auth/*`, `org-context.ts` | Removed. The app opens on Home. |
| Supabase Storage (org logo) | settings | Removed |
| Supabase Realtime (removal notice) | `critical-notification-listener.tsx` | Removed |
| Resend email API | `lib/email/*` | Removed (email is dropped) |
| Vercel cron `0 8 * * *` | `api/cron/follow-ups` | Removed (email is dropped) |
| Postgres triggers: `updated_at`, audit log, notifications | migrations | `updatedAt` is set in the repo layer. Field changes on stage, status and value are logged as activities. |
| RPC `create_organization` (seeds the pipeline) | migrations | `seed.ts` creates the same pipeline on first run: Lead, Qualified, Proposal, Negotiation, Won, Lost |
| Server-side rendering of dashboard and reports | pages | The same maths runs on the device with `liveQuery` |
| Third-party fonts (Geist via Google) | `layout.tsx` | The system font stack (SF Pro on iOS). Nothing is fetched from outside. |

## 6. Import from the existing CRM: field mapping

Settings → **Import from existing CRM** accepts any of these, one file at a time or several together.

### A. The web CRM's own CSV exports (headers detected automatically)

| Export | CSV column | Maps to |
|---|---|---|
| Contacts | Name | `name` |
| | Email | `email` |
| | Phone | `phone` |
| | Job title | `jobTitle` |
| | Status | `status`. The label is lower-cased, e.g. "Qualified" → `qualified`. Unknown values become `new`. |
| | Tags | Split on `;`. A tag is created when it doesn't exist, then linked. |
| | Company | Matched by name, case-insensitive. Created when missing. |
| | Owner | ignored |
| Companies | Name, Domain, Phone, Industry | `name`, `domain`, `phone`, `industry` |
| | Owner | ignored |
| Deals | Name, Value, Currency | `name`, `value`, `currency` |
| | Stage | Matched by name to a stage in the default pipeline. Created when missing (open stage). |
| | Contact, Company | Matched by name. A company is created when missing; a contact link is set only when the contact exists. |
| | Owner | ignored |
| Tasks | Title | `title` |
| | Status | "completed"/"done" → done, otherwise open |
| | Priority | `priority` |
| | Due date | Parsed as a date when possible |
| | Contact | Matched by name |
| | Assigned to | ignored |
| Tickets | — | Not imported (tickets are dropped) |

### B. Raw Supabase table exports

Supabase dashboard → Table editor → Export as CSV, or a JSON array. The file name must start with the table name, e.g. `contacts.csv`, and the file must keep its `id` column. The web CRM's own exports are also named like `contacts-2026-11-01.csv`, so the header row decides which kind a file is: a file with an `id` column is a table export, and a file with the friendly headers is a CRM export. snake_case columns map to camelCase. UUIDs are kept, so relationships survive.

Tables and the columns that map:
- `contacts`: `company_id → companyId`, `job_title`, `expected_revenue`, `expected_close`, `linkedin_url`, `lead_type_id`, `custom_fields` (JSON), `last_activity_at`
- `companies`
- `pipelines`
- `pipeline_stages`: `pipeline_id`, `is_won`, `is_lost`
- `deals`: `stage_id`, `pipeline_id`, `contact_id`, `company_id`, `expected_close_date`
- `tasks`: `due_at`, `completed_at`, plus one parent id
- `activities`: `type = email` becomes `note` with the prefix "[Email] ". `system` becomes `note`.
- `tags`
- `contact_tags`
- `lead_types`: `fields` (JSON)
- `projects`
- `project_columns`
- `project_todos`

Columns that are always dropped:
- `organization_id`, `owner_id`, `created_by`, `assigned_to`, `actor_id`, `invited_by`

Rows with `deleted_at` set are skipped.

Tables that are skipped (dropped features):
- `email_*`, `follow_up_*`, `tickets`, `organization_*`, `profiles`, `notifications`, `saved_views`, `audit_logs`

### How a legacy import merges
A legacy import **merges** into existing data. It does not wipe anything.
- **By id:** if the id already exists, the record is updated.
- **CSV contacts:** a contact with the same email (case-insensitive) is updated, not duplicated.
- **Companies:** matched by name, case-insensitive.

Every value is sanitised and length-capped. A preview with counts is shown before anything is written.

## 7. Notable decisions

- **Name:** "Covison Pocket" (short name "Covison"). The other candidates were "Covi" and "Orbit CRM". It keeps the brand and says what the app is.
- **Stack:** Vite + Preact + TypeScript + Dexie.
  - Builds to static files with relative paths: `base: './'` plus a hash router, so it works under any subpath.
  - No CSS framework, no recharts, no dnd-kit. Charts and drag are hand-written to keep the bundle small and the CSP strict.
- **Service worker:** hand-written. A Vite plugin generates the precache list. The cache name is versioned by a content hash. Updates are opt-in through an "Update available" toast.
- **Design:** the existing "Midnight Luxe / Soft Ivory / Electric Violet" tokens are ported exactly: brand `#6d4aff` in light mode, `#8b72ff` in dark. On top of them:
  - an iOS type scale,
  - glass bars,
  - glossy cards and buttons,
  - spring motion,
  - animated charts,
  - respect for reduced-motion settings.
  Guidance came from the ui-ux-pro-max skill's local style and UX data. Its AI logo generator was not used, because it needs a third-party API key and would send data off the device.
- **Single user:** no owner fields. Deletes are hard deletes with Undo.
- **No device permissions are requested.** Phone, text and mail actions are plain `tel:`, `sms:` and `mailto:` links.

## 8. Additions after the first release (Nov 2026)

These features are new in the PWA. They didn't exist in the web CRM.

### Real Covison logo
- All app icons and the in-app logo now come from `web/public/logo-mark.png`.
- The mark sits on the same ink background (`#120f1a`) that `web/src/app/apple-icon.tsx` uses.

### Smooth launch
- iOS launch images for the iPhone 12/13/14 Pro Max, in light and dark.
- A static HTML splash showing the logo and a progress bar. It paints before any JavaScript runs.
- Startup opens the database and seeds it before the first frame, then fades the splash into the app (at least 450 ms).
- The service worker registers after the first frame, so it doesn't slow startup.
- If the database is slow to open, the splash says so.

### WhatsApp
- Links use the `whatsapp://send?phone=<international number>` deep link, which opens the WhatsApp app straight into the chat.
- Local numbers are converted to international form, e.g. `0300 1234567` → `923001234567`. The country code defaults to 92 and can be changed in Settings.
- WhatsApp shows up in these places:
  - Contact list: a button on each row, plus a swipe action
  - Contact page: a quick-action button
  - Pipeline: a button on every deal card, at every stage
  - Deal page: a WhatsApp button
  - Money entries: a reminder message, already written for you

### Quick lead
- **New lead** (from the + button, or the Pipeline +) creates the contact and the deal in a chosen stage in one step.
- It asks for name, phone, company, payment terms, value and a note.

### Money (new tab; Tasks moved under More)
- New tables: `ledger` and `payments` (Dexie schema version 2, backup `schemaVersion` 2). Backups from version 1 still restore.
- `contacts.paymentTerms` records how a client pays: `immediate` or `credit`.
- When a deal is won for a client who pays on credit, the app offers to add the deal value to "People owe you", due in 30 days.
- Manual entries cover both directions ("They owe me" / "I owe them") and two kinds:
  - **Credit:** a sale or purchase on credit.
  - **Personal loan:** money lent to or borrowed from someone.
- The person can be a contact or just a typed-in name and phone.
- Partial payments, "Settle all", overdue flags and a payment history are included.
- The top of Home shows the open totals for **People owe you** and **You owe**.

### Currency
- PKR is the default everywhere, shown as "Rs 83,100".
- Deals keep their own currency field, so older non-PKR deals display in their original currency.
