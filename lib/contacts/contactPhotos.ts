import type { PhoneContactRow } from "@/lib/contacts/phoneContacts";
import { normalizeContactPhoneE164 } from "@/lib/phone/e164";

const byE164 = new Map<string, string>();

export function indexContactPhotos(rows: readonly PhoneContactRow[]): void {
  byE164.clear();
  for (const r of rows) {
    const uri = String(r.imageUri ?? "").trim();
    const e164 = r.phoneE164;
    if (!uri || !e164) continue;
    if (!byE164.has(e164)) byE164.set(e164, uri);
  }
}

export function contactPhotoUriForPhone(
  phone: string | null | undefined,
): string | null {
  const raw = String(phone ?? "").trim();
  if (!raw) return null;
  const e164 = raw.startsWith("+")
    ? raw
    : normalizeContactPhoneE164(raw);
  if (!e164) return null;
  return byE164.get(e164) ?? null;
}
