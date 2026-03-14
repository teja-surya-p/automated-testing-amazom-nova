export function inferAuthFormStep(probe = {}) {
  const explicit = String(probe?.visibleStep ?? "").trim().toLowerCase();
  if (["username", "password", "credentials", "otp", "authenticated"].includes(explicit)) {
    return explicit;
  }

  if (probe?.otpFieldDetected || probe?.otpChallengeDetected) {
    return "otp";
  }

  const identifierDetected =
    Boolean(probe?.identifierFieldDetected || probe?.usernameFieldDetected) ||
    Number(probe?.identifierFieldVisibleCount ?? probe?.usernameFieldVisibleCount ?? 0) > 0;
  const passwordDetected =
    Boolean(probe?.passwordFieldDetected) || Number(probe?.passwordFieldVisibleCount ?? 0) > 0;

  if (identifierDetected && passwordDetected) {
    return "credentials";
  }
  if (passwordDetected) {
    return "password";
  }
  if (identifierDetected) {
    return "username";
  }
  if (probe?.authenticatedHint) {
    return "authenticated";
  }

  return "unknown";
}
