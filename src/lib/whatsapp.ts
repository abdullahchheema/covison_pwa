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

export type WaApp = "whatsapp" | "business";
const APP_KEY = "covison.waApp";

/**
 * Which app chats open in. iOS lets both WhatsApp and WhatsApp Business claim
 * the `whatsapp://` scheme, and when both are installed it often picks
 * Business. The official `https://wa.me/` link is a universal link that iOS
 * hands to regular WhatsApp first (with an "open in Business" option), so it
 * is the default. "business" keeps the `whatsapp://` scheme.
 */
export function getWaApp(): WaApp {
  try {
    return localStorage.getItem(APP_KEY) === "business" ? "business" : "whatsapp";
  } catch {
    return "whatsapp";
  }
}
export function setWaApp(app: WaApp) {
  try {
    localStorage.setItem(APP_KEY, app);
  } catch {
    /* ignore */
  }
}

/** Link that opens the chat with this number, optionally with a draft message. */
export function waHref(phone: string | undefined, text?: string): string | undefined {
  const n = waNumber(phone);
  if (!n) return undefined;
  const t = text ? encodeURIComponent(text) : "";
  return getWaApp() === "business" ? `whatsapp://send?phone=${n}${t ? `&text=${t}` : ""}` : `https://wa.me/${n}${t ? `?text=${t}` : ""}`;
}

/** Link attributes: wa.me must leave the app (new tab) so iOS can hand it to WhatsApp. */
export function waLinkProps(phone: string | undefined, text?: string): { href?: string; target?: string; rel?: string } {
  const href = waHref(phone, text);
  if (!href) return {};
  return href.startsWith("https:") ? { href, target: "_blank", rel: "noopener noreferrer" } : { href };
}

export function openWhatsApp(phone: string | undefined, text?: string): boolean {
  const href = waHref(phone, text);
  if (!href) return false;
  if (href.startsWith("https:")) {
    // (passing "noopener" makes window.open return null even on success, so
    // detach the opener by hand and only fall back when it really was blocked)
    const w = window.open(href, "_blank");
    if (w) w.opener = null;
    else location.href = href;
  } else location.href = href;
  return true;
}
