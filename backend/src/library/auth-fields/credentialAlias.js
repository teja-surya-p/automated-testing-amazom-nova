import { FIRST_CREDENTIAL_KEYS } from "./patterns.js";

export function resolveFirstCredentialAlias(payload = {}) {
  for (const key of FIRST_CREDENTIAL_KEYS) {
    const normalized = String(payload?.[key] ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}
