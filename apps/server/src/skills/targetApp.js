function findElement(snapshot, patterns) {
  return snapshot.interactive.find((element) => {
    const haystack = [element.text, element.ariaLabel, element.placeholder, element.name].join(" ").toLowerCase();
    return patterns.some((pattern) => haystack.includes(pattern)) && !element.disabled;
  });
}

export const targetAppSkillPack = {
  id: "target-app",
  match({ startUrl }) {
    return /localhost:4174/.test(startUrl ?? "");
  },
  classify(snapshot) {
    if (/signup/i.test(snapshot.url)) {
      return { pageType: "signup", blockers: [], confidence: 0.93 };
    }
    if (/checkout/i.test(snapshot.url)) {
      return { pageType: "checkout", blockers: [], confidence: 0.95 };
    }
    if (/store/i.test(snapshot.url)) {
      return { pageType: "store", blockers: [], confidence: 0.9 };
    }
    return { pageType: "home", blockers: [], confidence: 0.74 };
  },
  sanitizeView() {
    return {
      ignoreZones: [],
      ignoredTerms: []
    };
  },
  suggestNextActions({ snapshot, goal }) {
    const actions = [];

    if (/(sign up|signup|register|create.*user)/i.test(goal)) {
      const signup = findElement(snapshot, ["sign up", "create account", "register"]);
      if (signup) {
        actions.push({
          action: { type: "click", elementId: signup.elementId },
          score: 0.86,
          landmark: signup.zone ?? "Primary Content",
          verification: `Signup entry point "${signup.text}" is visible.`,
          targetText: signup.text
        });
      }
    }

    if (/(checkout|cart|credit card|payment)/i.test(goal)) {
      const checkout = findElement(snapshot, ["checkout", "cart", "review order", "place order"]);
      if (checkout) {
        actions.push({
          action: { type: "click", elementId: checkout.elementId },
          score: 0.84,
          landmark: checkout.zone ?? "Primary Content",
          verification: `Checkout-related control "${checkout.text}" is visible.`,
          targetText: checkout.text
        });
      }
    }

    return actions.sort((left, right) => right.score - left.score);
  },
  verify({ goal }) {
    if (/(sign up|signup|register|create.*user)/i.test(goal)) {
      return ["Account created state visible"];
    }
    if (/(checkout|cart|credit card|payment)/i.test(goal)) {
      return ["Checkout page visible", "Order result visible"];
    }
    return [];
  }
};
