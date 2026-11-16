// WhatsApp deep links. `whatsapp://send?phone=` opens the WhatsApp app
// directly with that chat (no browser hop). Numbers are normalised to the
// international format WhatsApp expects: digits only, with country code.
// Local Pakistani numbers like 0300 1234567 become 923001234567.

const CC_KEY = "covison.countryCode";

export function getCountryCode(): string {
  try {
    return localStorage.getItem(CC_KEY) || "92";
  } catch {
    return "92";
  }
}

export function setCountryCode(cc: string) {
  const clean = cc.replace(/\D/g, "").slice(0, 4);
  try {
    localStorage.setItem(CC_KEY, clean || "92");
  } catch {
    /* ignore */
  }
}

/** "+92 300-1234567", "0300 1234567", "00923001234567" → "923001234567". */
export function waNumber(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  const trimmed = phone.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return undefined;
  if (trimmed.startsWith("+")) {
    /* already international */
  } else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = getCountryCode() + digits.slice(1);
  else if (digits.length <= 10) digits = getCountryCode() + digits; // local number without trunk 0
  return digits.length >= 8 && digits.length <= 15 ? digits : undefined;
}

/** Deep link that opens WhatsApp straight into the chat, optionally with a draft message. */
export function waHref(phone: string | undefined, text?: string): string | undefined {
  const n = waNumber(phone);
  if (!n) return undefined;
  return `whatsapp://send?phone=${n}${text ? `&text=${encodeURIComponent(text)}` : ""}`;
}

export function openWhatsApp(phone: string | undefined, text?: string): boolean {
  const href = waHref(phone, text);
  if (!href) return false;
  location.href = href;
  return true;
}
