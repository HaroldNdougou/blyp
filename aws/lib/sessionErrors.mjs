import { unauthorized } from "./http.mjs";

export const SESSION_REPLACED_CODE = "SESSION_REPLACED";
export const SESSION_REPLACED_MESSAGE =
  "Compte connecté sur un autre téléphone";

export function sessionReplacedUnauthorized() {
  return unauthorized(SESSION_REPLACED_MESSAGE, {
    code: SESSION_REPLACED_CODE,
  });
}

export function isSessionReplacedError(err) {
  return String(err?.message ?? "") === "SESSION_REPLACED";
}
