export type SpendCategory = "taxi" | "shop" | "other";

export function normalizeSpendCategory(
  raw: string | null | undefined,
): SpendCategory | null {
  const c = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (c === "taxi" || c === "shop" || c === "other") return c;
  return null;
}
