// Formatting helpers built on Intl (no locale data to download).

const moneyCache = new Map<string, Intl.NumberFormat>();

/**
 * Currency formatting. Default is Pakistani rupees, shown the local way
 * ("Rs 83,100"). Whole rupees only; other currencies keep up to 2 decimals.
 */
export function money(value: number | undefined, currency = "PKR", compact = false): string {
  const v = value ?? 0;
  const whole = currency === "PKR" || v % 1 === 0;
  const key = `${currency}|${compact}|${whole}`;
  let fmt = moneyCache.get(key);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(currency === "PKR" ? "en-PK" : undefined, {
        style: "currency",
        currency,
        currencyDisplay: currency === "PKR" ? "narrowSymbol" : "symbol",
        notation: compact ? "compact" : "standard",
        maximumFractionDigits: compact ? 1 : whole ? 0 : 2,
      });
    } catch {
      fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
    }
    moneyCache.set(key, fmt);
  }
  return fmt.format(v);
}

export function num(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function shortDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = parseDate(iso);
  if (!d) return iso;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function dateTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "YYYY-MM-DD" is parsed as a local date (not UTC) so it never shifts a day. */
export function parseDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function relativeTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = (d.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day");
  return shortDate(iso);
}

export function dueLabel(iso: string | undefined): { label: string; overdue: boolean; today: boolean } {
  if (!iso) return { label: "", overdue: false, today: false };
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startDue = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startDue - startToday) / 86400000);
  const overdue = d.getTime() < now.getTime();
  let label: string;
  if (days === 0) label = "Today";
  else if (days === 1) label = "Tomorrow";
  else if (days === -1) label = "Yesterday";
  else label = shortDate(iso);
  return { label, overdue, today: days === 0 };
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function initials(name: string): string {
  // Letters only, so "Bilal (cousin)" → "BC", not "B(".
  const parts = name
    .trim()
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "")).toUpperCase();
}

/** Local YYYY-MM-DD for <input type=date>. */
export function toDateInput(iso: string | undefined): string {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Local datetime-local value. */
export function toDateTimeInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromDateTimeInput(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
