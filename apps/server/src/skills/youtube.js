function findCallToAction(snapshot, patterns) {
  return snapshot.interactive.find((element) => {
    const haystack = [element.text, element.ariaLabel, element.name, element.placeholder].join(" ").toLowerCase();
    return patterns.some((pattern) => haystack.includes(pattern)) && !element.disabled;
  });
}

export const youtubeSkillPack = {
  id: "youtube",
  match({ startUrl, snapshot }) {
    return /(^https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\b/i.test(startUrl ?? snapshot?.url ?? "");
  },
  classify(snapshot) {
    const url = snapshot.url ?? "";
    if (/results\?search_query=/i.test(url)) {
      return { pageType: "results", blockers: [], confidence: 0.94 };
    }
    if (/youtube\.com\/watch|youtu\.be\//i.test(url)) {
      return { pageType: "watch", blockers: [], confidence: 0.96 };
    }
    if (/premium/i.test(url) || /premium/i.test(snapshot.bodyText)) {
      return { pageType: "premium", blockers: [], confidence: 0.92 };
    }

    return { pageType: "home", blockers: [], confidence: 0.74 };
  },
  sanitizeView() {
    return {
      ignoreZones: ["Sidebar"],
      ignoredTerms: ["Shopping", "Ad", "YouTube Mix"]
    };
  },
  suggestNextActions({ snapshot, parsedGoal }) {
    const actions = [];
    const premiumEntry = findCallToAction(snapshot, ["premium", "get premium", "try premium", "subscribe"]);
    if (premiumEntry) {
      actions.push({
        action: { type: "click", elementId: premiumEntry.elementId },
        score: 0.87,
        landmark: premiumEntry.zone ?? "Header",
        verification: `Premium CTA "${premiumEntry.text}" is visible in the current view.`,
        targetText: premiumEntry.text
      });
    }

    if (parsedGoal?.searchIntent) {
      const videoResult = snapshot.interactive.find((element) => {
        const haystack = [element.text, element.ariaLabel].join(" ").toLowerCase();
        return (
          element.zone === "Primary Content" &&
          haystack.includes(parsedGoal.searchIntent.toLowerCase()) &&
          !/\bad\b|youtube mix/.test(haystack)
        );
      });

      if (videoResult) {
        actions.push({
          action: { type: "click", elementId: videoResult.elementId },
          score: 0.91,
          landmark: "Primary Content Zone",
          verification: `Semantic match found for "${videoResult.text}" in the primary content area.`,
          targetText: videoResult.text
        });
      }
    }

    return actions.sort((left, right) => right.score - left.score);
  },
  verify({ snapshot, goal }) {
    const checks = [];
    if (/(premium|subscription|upgrade|plan|trial)/i.test(goal)) {
      checks.push("Premium options page visible");
      checks.push("Payment wall or plan cards visible");
    }
    if (/(video|song|play|watch)/i.test(goal)) {
      checks.push("Video playback page visible");
    }
    return checks;
  }
};
