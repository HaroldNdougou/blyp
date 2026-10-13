import { checkContactsPermission } from "@/lib/contacts/permissions";
import {
  cameroonNineFromE164,
  normalizeContactPhoneE164,
} from "@/lib/phone/e164";
import * as Contacts from "expo-contacts";
import { Platform } from "react-native";
import { indexContactPhotos } from "@/lib/contacts/contactPhotos";

export type PhoneContactRow = {
  id: string;
  name: string;
  /** E.164 pour messagerie / lookup (+237…, +33…). */
  phoneE164: string | null;
  /** 9 chiffres CM si +237 6… (wallet / affichage). */
  phoneDigits: string | null;
  phoneLabel: string;
  /** Photo du répertoire (file://…) — prioritaire sur le CDN pour l’UI locale. */
  imageUri?: string | null;
  onBlyp?: boolean | null;
};

let cachedRows: PhoneContactRow[] | null = null;

/** @deprecated utiliser normalizeContactPhoneE164 */
export function cameroonMobileNineFromRaw(raw: string): string | null {
  const e164 = normalizeContactPhoneE164(raw);
  return cameroonNineFromE164(e164);
}

function displayName(c: Contacts.Contact): string {
  const fromParts = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
  if (fromParts) return fromParts;
  const n = String(c.name ?? "").trim();
  if (n) return n;
  const nick = String(c.nickname ?? "").trim();
  if (nick) return nick;
  return "";
}

export function clearPhoneContactsCache() {
  cachedRows = null;
}

export type LoadPhoneContactsResult =
  | {
      ok: true;
      items: PhoneContactRow[];
      fromCache: boolean;
      rawContactCount: number;
    }
  | {
      ok: false;
      reason: "unsupported" | "denied" | "failed";
      items: PhoneContactRow[];
      rawContactCount: number;
    };

function rowsFromContacts(data: Contacts.Contact[]): PhoneContactRow[] {
  const byE164 = new Map<string, PhoneContactRow>();

  for (const c of data) {
    const name = displayName(c) || "—";
    const phones = c.phoneNumbers ?? [];
    for (let i = 0; i < phones.length; i++) {
      const raw = String(phones[i]?.number ?? "").trim();
      if (!raw) continue;
      const phoneE164 = normalizeContactPhoneE164(raw);
      if (!phoneE164) continue;

      const existing = byE164.get(phoneE164);
      const imageUri = String(c.image?.uri ?? "").trim() || null;
      const row: PhoneContactRow = {
        id: `${c.id ?? "c"}-${phoneE164}`,
        name,
        phoneE164,
        phoneDigits: cameroonNineFromE164(phoneE164),
        phoneLabel: raw,
        imageUri,
      };
      if (!existing || name.length > existing.name.length) {
        byE164.set(phoneE164, row);
      }
    }
  }

  return [...byE164.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

async function fetchAllContacts(): Promise<Contacts.Contact[]> {
  const { data } = await Contacts.getContactsAsync({
    fields: [
      Contacts.Fields.PhoneNumbers,
      Contacts.Fields.FirstName,
      Contacts.Fields.LastName,
      Contacts.Fields.Name,
      Contacts.Fields.Nickname,
      Contacts.Fields.Image,
    ],
    sort: Contacts.SortTypes.FirstName,
    pageSize: 0,
  });
  return data ?? [];
}

/** Liste répertoire — permission déjà accordée. */
export async function loadPhoneContacts(
  excludeOwnerPhoneE164: string | null,
): Promise<LoadPhoneContactsResult> {
  if (Platform.OS === "web") {
    return { ok: false, reason: "unsupported", items: [], rawContactCount: 0 };
  }

  if (cachedRows && cachedRows.length > 0) {
    indexContactPhotos(cachedRows);
    return {
      ok: true,
      items: filterSelf(cachedRows, excludeOwnerPhoneE164),
      fromCache: true,
      rawContactCount: cachedRows.length,
    };
  }

  try {
    const available = await Contacts.isAvailableAsync();
    if (!available) {
      return { ok: false, reason: "unsupported", items: [], rawContactCount: 0 };
    }

    const perm = await checkContactsPermission();
    if (perm !== "granted") {
      return { ok: false, reason: "denied", items: [], rawContactCount: 0 };
    }

    const data = await fetchAllContacts();
    const items = rowsFromContacts(data);

    if (items.length > 0) {
      cachedRows = items;
      indexContactPhotos(items);
    } else {
      cachedRows = null;
      indexContactPhotos([]);
    }

    if (__DEV__) {
      console.log(
        `[contacts] raw=${data.length} parsed=${items.length} onBlypLookupKeys=${items.filter((r) => r.phoneE164).length}`,
      );
    }

    return {
      ok: true,
      items: filterSelf(items, excludeOwnerPhoneE164),
      fromCache: false,
      rawContactCount: data.length,
    };
  } catch (err) {
    if (__DEV__) {
      console.warn("[contacts] load failed", err);
    }
    return { ok: false, reason: "failed", items: [], rawContactCount: 0 };
  }
}

export async function pickContactFromDevice(): Promise<
  | { ok: true; phoneE164: string }
  | { ok: false; reason: "cancelled" | "invalid" | "failed" }
> {
  if (Platform.OS === "web") {
    return { ok: false, reason: "failed" };
  }
  try {
    const available = await Contacts.isAvailableAsync();
    if (!available) return { ok: false, reason: "failed" };

    const picked = await Contacts.presentContactPickerAsync();
    if (!picked) return { ok: false, reason: "cancelled" };

    for (const p of picked.phoneNumbers ?? []) {
      const e164 = normalizeContactPhoneE164(p.number ?? "");
      if (e164) return { ok: true, phoneE164: e164 };
    }
    return { ok: false, reason: "invalid" };
  } catch (err) {
    if (__DEV__) {
      console.warn("[contacts] picker failed", err);
    }
    return { ok: false, reason: "failed" };
  }
}

function filterSelf(
  items: PhoneContactRow[],
  excludeE164: string | null,
): PhoneContactRow[] {
  if (!excludeE164) return items;
  return items.filter((r) => r.phoneE164 !== excludeE164);
}

export function filterPhoneContacts(
  items: PhoneContactRow[],
  query: string,
): PhoneContactRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const qDigits = q.replace(/\D/g, "");
  return items.filter((r) => {
    if (r.name.toLowerCase().includes(q)) return true;
    if (r.phoneE164?.toLowerCase().includes(q)) return true;
    if (r.phoneLabel.toLowerCase().includes(q)) return true;
    if (
      qDigits &&
      (r.phoneLabel.replace(/\D/g, "").includes(qDigits) ||
        r.phoneE164?.replace(/\D/g, "").includes(qDigits) ||
        r.phoneDigits?.includes(qDigits))
    ) {
      return true;
    }
    return false;
  });
}
