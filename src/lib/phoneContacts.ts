// Bring people in from the iPhone's Contacts app.
//
// 1. Contact Picker API (navigator.contacts.select): opens the native iOS
//    contacts sheet; you pick one person and only that person's name, phone
//    and email are handed to the app. No standing permission, nothing else is
//    readable. On iOS it is currently behind a Safari feature flag
//    (Settings → Apps → Safari → Advanced → Feature Flags → "Contact Picker API").
// 2. vCard (.vcf) files: always works. In Contacts, open a person → Share
//    Contact → Save to Files, then pick the file here. A .vcf with many
//    people (e.g. exported from iCloud.com) can be imported in bulk.

export interface PhoneContact {
  name: string;
  phones: string[];
  emails: string[];
  org?: string;
  title?: string;
}

interface ContactsManagerLike {
  select(props: string[], opts?: { multiple?: boolean }): Promise<{ name?: string[]; tel?: string[]; email?: string[] }[]>;
}

export function contactPickerSupported(): boolean {
  return typeof navigator !== "undefined" && "contacts" in navigator && typeof (navigator as unknown as { contacts: ContactsManagerLike }).contacts?.select === "function";
}

/** Opens the native contacts sheet. Resolves to null if the user cancels. */
export async function pickPhoneContact(): Promise<PhoneContact | null> {
  const mgr = (navigator as unknown as { contacts: ContactsManagerLike }).contacts;
  const res = await mgr.select(["name", "tel", "email"], { multiple: false });
  const c = res?.[0];
  if (!c) return null;
  return {
    name: (c.name?.find((n) => n.trim()) ?? "").trim(),
    phones: (c.tel ?? []).map((t) => t.trim()).filter(Boolean),
    emails: (c.email ?? []).map((e) => e.trim()).filter(Boolean),
  };
}

/** Decode a vCard value: escapes (\n \, \;) and QUOTED-PRINTABLE (old Android exports). */
function decodeValue(raw: string, params: string): string {
  let v = raw;
  if (/ENCODING=QUOTED-PRINTABLE/i.test(params)) {
    const bytes: number[] = [];
    v = v.replace(/=\r?\n/g, "");
    for (let i = 0; i < v.length; i++) {
      if (v[i] === "=" && /^[0-9A-F]{2}$/i.test(v.slice(i + 1, i + 3))) {
        bytes.push(parseInt(v.slice(i + 1, i + 3), 16));
        i += 2;
      } else bytes.push(v.charCodeAt(i));
    }
    try {
      v = new TextDecoder().decode(new Uint8Array(bytes));
    } catch {
      /* keep raw */
    }
  }
  return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();
}

/** Parse one or many vCards (versions 2.1, 3.0, 4.0). */
export function parseVCards(text: string): PhoneContact[] {
  // Unfold continuation lines (RFC 6350 §3.2).
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out: PhoneContact[] = [];
  let cur: (PhoneContact & { n?: string }) | null = null;
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const left = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const [rawName, ...paramParts] = left.split(";");
    const key = rawName.replace(/^item\d+\./i, "").toUpperCase();
    const params = paramParts.join(";");
    if (key === "BEGIN" && /VCARD/i.test(value)) {
      cur = { name: "", phones: [], emails: [] };
      continue;
    }
    if (!cur) continue;
    if (key === "END" && /VCARD/i.test(value)) {
      const name = cur.name || cur.n || cur.org || cur.phones[0] || "";
      if (name) out.push({ name, phones: [...new Set(cur.phones)], emails: [...new Set(cur.emails)], org: cur.org, title: cur.title });
      cur = null;
      continue;
    }
    const v = decodeValue(value, params);
    switch (key) {
      case "FN":
        cur.name = v;
        break;
      case "N": {
        const [last, first, middle] = v.split(";");
        cur.n = [first, middle, last].filter((s) => s && s.trim()).join(" ").trim();
        break;
      }
      case "TEL":
        if (v) cur.phones.push(v.replace(/^tel:/i, ""));
        break;
      case "EMAIL":
        if (v) cur.emails.push(v);
        break;
      case "ORG":
        cur.org = v.split(";")[0].trim() || undefined;
        break;
      case "TITLE":
        cur.title = v || undefined;
        break;
    }
  }
  return out;
}

/** Digits-only key for de-duplicating by phone (last 10 digits, so 0300… and +92300… match). */
export function phoneKey(phone: string | undefined): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}
