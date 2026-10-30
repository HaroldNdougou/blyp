const MAX_PROFILE_NAME_LEN = 80;
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

export function isAllowedProfileNamePart(value) {
  const t = String(value ?? "").trim();
  if (t.length < 1 || t.length > MAX_PROFILE_NAME_LEN) return false;
  return !CONTROL_CHARS.test(t);
}

export function parseRegistrationFullName(raw) {
  const normalized = String(raw ?? "").trim();
  if (!isAllowedProfileNamePart(normalized)) return null;
  const spaceIdx = normalized.search(/\s/);
  if (spaceIdx === -1) {
    return { firstName: normalized, lastName: normalized };
  }
  const firstName = normalized.slice(0, spaceIdx).trimEnd();
  const lastName = normalized.slice(spaceIdx).trimStart();
  if (!firstName || !lastName) {
    const compact = normalized.replace(/\s+/g, " ");
    return { firstName: compact, lastName: compact };
  }
  if (
    !isAllowedProfileNamePart(firstName) ||
    !isAllowedProfileNamePart(lastName)
  ) {
    return null;
  }
  return { firstName, lastName };
}
