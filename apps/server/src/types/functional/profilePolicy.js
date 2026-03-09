function normalizeTag(value = "") {
  return String(value ?? "").trim();
}

export function resolveFunctionalProfilePolicy({ runConfig } = {}) {
  const mode = runConfig?.testMode ?? "default";
  const isFunctional = mode === "functional";
  const profileConfig = runConfig?.functional?.profile ?? {};
  const profileTag = normalizeTag(runConfig?.profileTag);

  if (!isFunctional) {
    return {
      ok: true,
      isFunctional: false,
      requireProfileTag: false,
      reuseProfileAcrossRuns: true,
      storageStateEnabled: true,
      profileTag
    };
  }

  const requireProfileTag = profileConfig.requireProfileTag !== false;
  const reuseProfileAcrossRuns = profileConfig.reuseProfileAcrossRuns !== false;
  if (requireProfileTag && !profileTag) {
    return {
      ok: false,
      isFunctional: true,
      errorCode: "FUNCTIONAL_PROFILE_TAG_REQUIRED",
      errorMessage:
        "Functional mode requires runConfig.profileTag when functional.profile.requireProfileTag is true.",
      requireProfileTag,
      reuseProfileAcrossRuns,
      storageStateEnabled: reuseProfileAcrossRuns,
      profileTag
    };
  }

  return {
    ok: true,
    isFunctional: true,
    requireProfileTag,
    reuseProfileAcrossRuns,
    storageStateEnabled: reuseProfileAcrossRuns,
    profileTag
  };
}

