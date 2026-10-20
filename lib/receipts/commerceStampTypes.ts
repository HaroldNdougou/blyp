export type CommerceStampShape = "circle" | "line";
export type CommerceStampColor = "red" | "blue";

export type CommerceStamp = {
  line1: string;
  line2: string;
  shape: CommerceStampShape;
  color: CommerceStampColor;
  updatedAt: string;
};

export function stampScopeKey(
  userId: string,
  commerceId: string | null | undefined,
): string {
  const uid = String(userId ?? "").trim();
  const cid = String(commerceId ?? "").trim();
  if (!uid) return "";
  return cid ? `${uid}::commerce::${cid}` : `${uid}::personal`;
}

export function stampFingerprint(stamp: CommerceStamp): string {
  const line1 = stamp.line1.trim().toLowerCase();
  const line2 = stamp.line2.trim().toLowerCase();
  return `${stamp.shape}|${stamp.color}|${line1}|${line2}`;
}
