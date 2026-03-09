const DESTRUCTIVE_PATTERNS = /delete|remove|close account|confirm purchase|pay|place order|unsubscribe|reset|wipe|logout|sign out/i;
const STATE_CHANGING_PATTERNS = /sign up|register|create account|submit|save|send|checkout|buy|purchase|apply|join/i;
const MENU_PATTERNS = /menu|open|expand|show more|see more|details|accordion|tab|section/i;
const PAGINATION_PATTERNS = /next|previous|prev|page\s+\d+/i;
const SEARCH_PATTERNS = /search|find|query/i;

function elementText(element) {
  return [element.text, element.ariaLabel, element.placeholder, element.name, element.href]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function riskScoreFor(level) {
  switch (level) {
    case "READ_ONLY":
      return 0;
    case "LOW_RISK":
      return 1;
    case "STATE_CHANGING":
      return 3;
    case "DESTRUCTIVE":
      return 5;
    default:
      return 4;
  }
}

const REPEAT_PENALTY = 10;

export function classifyUiuxElement(element) {
  const haystack = elementText(element);
  const isAnchor = element.tag === "a";
  const isSearchField = [element.type, haystack].join(" ").match(SEARCH_PATTERNS) && ["input", "textarea"].includes(element.tag);
  const isPagination = PAGINATION_PATTERNS.test(haystack);
  const isMenuExpand = MENU_PATTERNS.test(haystack) || element.pressed === true;
  const isNavigation = isAnchor || /^\//.test(element.href ?? "") || /^https?:/i.test(element.href ?? "");

  if (DESTRUCTIVE_PATTERNS.test(haystack)) {
    return {
      category: "DESTRUCTIVE",
      suggestedAction: null,
      reason: "Sensitive or destructive control"
    };
  }

  if (STATE_CHANGING_PATTERNS.test(haystack)) {
    return {
      category: "STATE_CHANGING",
      suggestedAction: null,
      reason: "Likely submits data or changes account/order state"
    };
  }

  if (isSearchField) {
    return {
      category: "LOW_RISK",
      suggestedAction: {
        type: "type",
        elementId: element.elementId,
        text: "test",
        pressEnter: true
      },
      flags: { isSearchField: true, isNavigation: false, isMenuExpand: false },
      reason: "Search field with safe generic query"
    };
  }

  if (isPagination || isNavigation || isMenuExpand) {
    return {
      category: "LOW_RISK",
      suggestedAction: {
        type: "click",
        elementId: element.elementId
      },
      flags: { isSearchField: false, isNavigation, isMenuExpand },
      reason: "Navigation, pagination, or expandable UI control"
    };
  }

  return {
    category: "STATE_CHANGING",
    suggestedAction: null,
    flags: { isSearchField: false, isNavigation: false, isMenuExpand: false },
    reason: "Control is not a clearly safe UI/UX exploration target"
  };
}

export function classifyUiuxAction(actionPlan, snapshot) {
  const element = snapshot?.interactive?.find((item) => item.elementId === actionPlan?.target?.semanticId) ?? null;

  if (!element) {
    if (["wait", "scroll", "back", "refresh", "goto"].includes(actionPlan?.actionType)) {
      return { category: "READ_ONLY", reason: "Browser-level read-only navigation" };
    }
    return { category: "STATE_CHANGING", reason: "Unknown action target" };
  }

  return classifyUiuxElement(element);
}

export function rankUiuxCandidate({ candidate, repeatedLabels = new Set() }) {
  const classification = classifyUiuxElement(candidate);
  const flags = classification.flags ?? {
    isSearchField: false,
    isNavigation: false,
    isMenuExpand: false
  };
  const label = candidate.text || candidate.ariaLabel || candidate.placeholder || candidate.tag;
  const newStateLikelihood = flags.isNavigation ? 4 : flags.isSearchField || flags.isMenuExpand ? 3 : 1;
  const noveltyWeight = 5;
  const navWeight = flags.isNavigation ? 3 : 0;
  const menuWeight = flags.isMenuExpand ? 2 : 0;
  const riskWeight = riskScoreFor(classification.category) * 3;
  const repeatPenalty = repeatedLabels.has(label) ? REPEAT_PENALTY : 0;
  const score = noveltyWeight * newStateLikelihood + navWeight + menuWeight - riskWeight - repeatPenalty;

  return {
    score,
    classification,
    candidate,
    label
  };
}

export function chooseBestUiuxCandidate(snapshot, recentActions = []) {
  const repeatedLabels = new Set(
    recentActions.map((entry) => entry.semanticAction?.label).filter(Boolean)
  );

  return (snapshot.interactive ?? [])
    .filter((element) => !element.disabled)
    .filter((element) => {
      if (!element.inViewport || !element.centerProbe?.targetInViewport) {
        return true;
      }

      return Boolean(element.centerProbe.sameTarget) && !element.centerProbe.covered;
    })
    .map((candidate) => rankUiuxCandidate({ candidate, repeatedLabels }))
    .filter((entry) => ["READ_ONLY", "LOW_RISK"].includes(entry.classification.category))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.label.localeCompare(right.label);
    })[0] ?? null;
}
