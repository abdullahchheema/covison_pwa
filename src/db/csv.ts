// Minimal RFC 4180 CSV reader/writer (no dependency).

/** Parse CSV text into rows of cells. Handles quotes, escaped quotes, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Rows → array of objects keyed by the header row. */
export function csvToObjects(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const [header = [], ...body] = parseCsv(text);
  const headers = header.map((h) => h.trim());
  const rows = body.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  return { headers, rows };
}

/**
 * Quote a value for CSV (same rule as the web app's toCsvValue) and neutralise
 * spreadsheet formula injection: cells starting with = + - @ tab or CR get a
 * leading apostrophe so Excel/Numbers treat them as text.
 */
export function toCsvValue(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  // BOM so Excel opens UTF-8 correctly (the web export lacked this).
  return "﻿" + [headers, ...rows].map((r) => r.map(toCsvValue).join(",")).join("\r\n");
}
