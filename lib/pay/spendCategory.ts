export type SpendCategory = "taxi" | "shop" | "other" | "soa_car";

export function normalizeSpendCategory(
  raw: string | null | undefined,
): SpendCategory | null {
  const c = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (c === "taxi" || c === "shop" || c === "other" || c === "soa_car") {
    return c;
  }
  return null;
}
