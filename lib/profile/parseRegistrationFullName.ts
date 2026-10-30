const MAX_PROFILE_NAME_LEN = 80;

/** Caractères de contrôle interdits ; le reste est accepté (emoji, chiffres, ponctuation…). */
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

export function isAllowedProfileNamePart(value: string): boolean {
  const t = String(value ?? "").trim();
  if (t.length < 1 || t.length > MAX_PROFILE_NAME_LEN) return false;
  return !CONTROL_CHARS.test(t);
}

/** Découpe le nom complet saisi à l'inscription pour l'API (prénom + nom). */
export function parseRegistrationFullName(
  raw: string,
): { firstName: string; lastName: string } | null {
  const normalized = raw.trim();
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

export function formatRegistrationFullName(
  firstName?: string | null,
  lastName?: string | null,
): string {
  const fn = String(firstName ?? "").trim();
  const ln = String(lastName ?? "").trim();
  if (fn && ln) {
    if (fn === ln) return fn;
    return `${fn} ${ln}`;
  }
  return fn || ln;
}

export { MAX_PROFILE_NAME_LEN };
