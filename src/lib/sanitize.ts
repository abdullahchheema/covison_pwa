// Text safety helpers.
//
// Rendering: Preact escapes every text child and attribute value, and the
// codebase never injects raw HTML (enforced by scripts/check-safety.mjs), so
// stored text cannot become markup. What remains dangerous is *URLs* placed
// into href (javascript:, data:), which safeUrl() blocks, and junk control
// characters / huge strings arriving through imports, which cleanText() strips.

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g;

export const MAX_SHORT = 300;
export const MAX_LONG = 20000;

/** Remove control / bidi-override characters and cap the length. Keeps \n and \t. */
export function cleanText(value: unknown, max = MAX_SHORT): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  return s.replace(CONTROL, "").slice(0, max);
}

/** cleanText + trim, returning undefined for empty strings. */
export function optText(value: unknown, max = MAX_SHORT): string | undefined {
  const s = cleanText(value, max).trim();
  return s ? s : undefined;
}

/**
 * Returns an http(s) URL safe to use as an href, or undefined. Bare domains
 * ("acme.com") are upgraded to https. Anything else (javascript:, data:,
 * vbscript:, file:) is rejected.
 */
export function safeUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}

/** tel: href with only dialable characters. */
export function telHref(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/[^\d+*#,;]/g, "");
  return digits ? `tel:${digits}` : undefined;
}

export function smsHref(phone: string | undefined): string | undefined {
  const t = telHref(phone);
  return t ? t.replace(/^tel:/, "sms:") : undefined;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // same check as the web CSV importer

export function isEmail(s: string | undefined): boolean {
  return !!s && EMAIL_RE.test(s);
}

export function mailHref(email: string | undefined): string | undefined {
  return isEmail(email) ? `mailto:${encodeURIComponent(email!).replace(/%40/g, "@")}` : undefined;
}

/** Display host for a URL ("https://www.acme.com/x" → "acme.com"). */
export function hostOf(url: string | undefined): string {
  const safe = safeUrl(url);
  if (!safe) return url ?? "";
  try {
    return new URL(safe).host.replace(/^www\./, "");
  } catch {
    return url ?? "";
  }
}
