/** Mot de passe de la session courante (mémoire uniquement, pour actions sensibles sans le redemander). */
let sessionPassword: string | null = null;

export function setSessionPassword(password: string | null) {
  sessionPassword = password ? String(password) : null;
}

export function getSessionPassword() {
  return sessionPassword;
}