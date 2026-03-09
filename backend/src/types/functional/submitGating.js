export const FUNCTIONAL_SUBMIT_CONFIDENCE_THRESHOLD = 0.8;

function normalizedSubmitKind(functionalKind = "") {
  if (functionalKind === "filter-clear") {
    return "filter";
  }
  return functionalKind;
}

function isSubmitKind(functionalKind = "") {
  return ["search", "filter", "filter-clear", "pagination"].includes(functionalKind);
}

function riskyElementSet(semantics = {}) {
  const risky = new Set();
  for (const form of semantics.riskyForms ?? []) {
    for (const elementId of form.elementIds ?? []) {
      risky.add(elementId);
    }
  }
  return risky;
}

function classifySearch(action, semantics = {}) {
  const match = (semantics.searchForms ?? [])
    .filter(
      (entry) =>
        entry.inputElementId === action?.elementId || entry.submitElementId === action?.elementId
    )
    .sort((left, right) => right.confidence - left.confidence)[0];

  if (!match) {
    return {
      submitType: "search",
      confidence: 0,
      matched: false
    };
  }

  return {
    submitType: "search",
    confidence: Number(match.confidence ?? 0),
    matched: true
  };
}

function classifyFilter(action, semantics = {}) {
  const match = (semantics.filterControls ?? [])
    .filter((entry) => entry.elementId === action?.elementId)
    .sort((left, right) => right.confidence - left.confidence)[0];

  if (match) {
    return {
      submitType: "filter",
      confidence: Number(match.confidence ?? 0),
      matched: true
    };
  }

  const label = String(action?.label ?? "").toLowerCase();
  if (action?.functionalKind === "filter-clear" && /\bclear\b|\breset\b|\ball\b/.test(label)) {
    return {
      submitType: "filter",
      confidence: 0.84,
      matched: true
    };
  }

  return {
    submitType: "filter",
    confidence: 0,
    matched: false
  };
}

function classifyPagination(action, semantics = {}) {
  const controls = semantics.paginationControls ?? [];
  for (const entry of controls) {
    const pageLinks = new Set(entry.pageLinks ?? []);
    if (
      action?.elementId &&
      (entry.nextId === action.elementId ||
        entry.prevId === action.elementId ||
        pageLinks.has(action.elementId))
    ) {
      return {
        submitType: "pagination",
        confidence: Number(entry.confidence ?? 0),
        matched: true
      };
    }
  }

  return {
    submitType: "pagination",
    confidence: 0,
    matched: false
  };
}

export function classifyFunctionalSubmitAction(action, semantics = {}) {
  const kind = action?.functionalKind ?? "";
  if (!isSubmitKind(kind)) {
    return {
      submitType: null,
      confidence: 1,
      matched: true
    };
  }

  if (kind === "search") {
    return classifySearch(action, semantics);
  }
  if (kind === "filter" || kind === "filter-clear") {
    return classifyFilter(action, semantics);
  }
  return classifyPagination(action, semantics);
}

export function evaluateFunctionalSubmitGate({
  action,
  runConfig,
  semantics,
  safetyAllowed = true,
  confidenceThreshold = FUNCTIONAL_SUBMIT_CONFIDENCE_THRESHOLD
}) {
  const functionalKind = action?.functionalKind ?? "";
  if (!isSubmitKind(functionalKind)) {
    return {
      allowed: true,
      code: "FUNCTIONAL_NOT_SUBMIT",
      reason: "Action is not a submit-class action.",
      confidence: 1
    };
  }

  const submitType = normalizedSubmitKind(functionalKind);
  const allowFormSubmit = Boolean(runConfig?.functional?.allowFormSubmit);
  if (!allowFormSubmit) {
    return {
      allowed: false,
      code: "FUNCTIONAL_SUBMIT_DISABLED",
      reason: "Functional submit actions are disabled unless functional.allowFormSubmit is true.",
      confidence: 0.99,
      submitType
    };
  }

  const allowedSubmitTypes = runConfig?.functional?.allowedSubmitTypes ?? [
    "search",
    "filter",
    "pagination"
  ];
  if (!allowedSubmitTypes.includes(submitType)) {
    return {
      allowed: false,
      code: "FUNCTIONAL_SUBMIT_TYPE_BLOCKED",
      reason: `Submit type ${submitType} is not in functional.allowedSubmitTypes.`,
      confidence: 0.98,
      submitType
    };
  }

  if (!safetyAllowed) {
    return {
      allowed: false,
      code: "FUNCTIONAL_SAFETY_POLICY_BLOCKED",
      reason: "Safety policy rejected this submit action.",
      confidence: 0.99,
      submitType
    };
  }

  const riskyElements = riskyElementSet(semantics);
  if (action?.elementId && riskyElements.has(action.elementId)) {
    return {
      allowed: false,
      code: "FUNCTIONAL_RISKY_FORM_BLOCKED",
      reason: "Submit target is classified as a risky form control.",
      confidence: 0.97,
      submitType
    };
  }

  const classification = classifyFunctionalSubmitAction(action, semantics);
  if ((classification.confidence ?? 0) < confidenceThreshold) {
    return {
      allowed: false,
      code: "FUNCTIONAL_SUBMIT_LOW_CONFIDENCE",
      reason: `Submit classifier confidence ${Number(classification.confidence ?? 0).toFixed(2)} is below threshold ${confidenceThreshold}.`,
      confidence: 0.95,
      submitType
    };
  }

  return {
    allowed: true,
    code: "FUNCTIONAL_SUBMIT_ALLOWED",
    reason: "Submit action passed functional submit gating.",
    confidence: Number(classification.confidence ?? 1),
    submitType
  };
}

