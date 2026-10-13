import { lookupBlypPhones } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/authSession";
import type { PhoneContactRow } from "@/lib/contacts/phoneContacts";

export async function attachBlypStatus(
  rows: PhoneContactRow[],
  accessToken?: string | null,
): Promise<PhoneContactRow[]> {
  const keys = [
    ...new Set(
      rows.map((r) => r.phoneE164).filter((d): d is string => Boolean(d)),
    ),
  ];
  if (keys.length === 0) return rows;

  const token = accessToken ?? getAccessToken();
  if (!token) {
    return rows.map((r) => ({
      ...r,
      onBlyp: r.phoneE164 ? false : null,
    }));
  }

  try {
    const { items } = await lookupBlypPhones(token, keys);
    const map = new Map(items.map((i) => [i.phone, i.onBlyp]));
    const merged = rows.map((r) => ({
      ...r,
      onBlyp:
        r.phoneE164 != null ? (map.get(r.phoneE164) ?? false) : null,
    }));
    if (__DEV__) {
      const off = merged.filter((r) => r.onBlyp === false).length;
      console.log(`[contacts] blyp lookup: ${keys.length} keys, ${off} hors Blyp`);
    }
    return merged;
  } catch (e) {
    if (__DEV__) console.warn("[contacts] blyp lookup failed", e);
    return rows.map((r) => ({
      ...r,
      onBlyp: r.phoneE164 ? false : null,
    }));
  }
}
