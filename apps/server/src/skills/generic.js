export const genericSkillPack = {
  id: "generic",
  match() {
    return true;
  },
  classify(snapshot) {
    return {
      pageType: /checkout/i.test(snapshot.url) ? "checkout" : "generic",
      blockers: [],
      confidence: 0.5
    };
  },
  sanitizeView() {
    return {
      ignoreZones: [],
      ignoredTerms: []
    };
  },
  suggestNextActions() {
    return [];
  },
  verify() {
    return [];
  }
};
