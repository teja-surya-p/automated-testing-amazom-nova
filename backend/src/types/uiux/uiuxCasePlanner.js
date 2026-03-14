import { hashText } from "../../lib/utils.js";
import { rankUiuxCandidate } from "../../library/policies/uiControlClassifier.js";
import { baselineUiuxChecks } from "./checks/index.js";
import { extractFormSemantics } from "../functional/formSemantics.js";
import {
  buildCoarseWidthSweep,
  resolveUiuxBreakpointSettings
} from "./componentBreakpointAnalysis.js";

export const SAFE_UIUX_ACTION_KINDS = [
  "NAV_CLICK",
  "PAGINATION",
  "MENU_EXPAND",
  "FILTER_TOGGLE",
  "SEARCH_SUBMIT"
];

function deterministicId(parts = []) {
  return `tc_${hashText(parts.join("|")).slice(0, 16)}`;
}

function normalizeText(value = "") {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildBaseCase({
  id,
  pageUrl,
  canonicalUrl,
  deviceLabel = null,
  caseKind,
  expected
}) {
  return {
    id,
    type: "uiux",
    pageUrl,
    canonicalUrl: canonicalUrl ?? pageUrl,
    deviceLabel,
    caseKind,
    status: "queued",
    severity: null,
    expected,
    actual: "",
    evidenceRefs: [],
    startedAt: null,
    endedAt: null
  };
}

function interactionKindForRanked(entry, semantic) {
  const text = normalizeText(entry?.candidate?.text ?? entry?.candidate?.ariaLabel ?? "");
  if (entry?.classification?.flags?.isSearchField) {
    return "SEARCH_SUBMIT";
  }
  if (entry?.classification?.flags?.isMenuExpand) {
    return "MENU_EXPAND";
  }
  if (
    /next|previous|prev|page\s+\d+|older|newer/.test(text) ||
    semantic.paginationControls?.some((item) =>
      [item.nextId, item.prevId, ...(item.pageLinks ?? [])].includes(entry?.candidate?.elementId)
    )
  ) {
    return "PAGINATION";
  }
  if (
    /filter|sort|category|facet|refine/.test(text) ||
    semantic.filterControls?.some((item) => item.elementId === entry?.candidate?.elementId)
  ) {
    return "FILTER_TOGGLE";
  }
  return "NAV_CLICK";
}

function rankedSafeInteractiveCandidates(snapshot = {}, semantic = {}) {
  const repeatedLabels = new Set();
  return (snapshot.interactive ?? [])
    .filter((item) => item?.elementId && !item.disabled)
    .filter((item) => item.inViewport)
    .map((candidate) => rankUiuxCandidate({ candidate, repeatedLabels }))
    .filter((entry) => entry?.classification?.suggestedAction)
    .filter((entry) => ["LOW_RISK", "READ_ONLY"].includes(entry?.classification?.category))
    .map((entry) => ({
      actionKind: interactionKindForRanked(entry, semantic),
      action: entry.classification.suggestedAction,
      elementId: entry.candidate.elementId,
      label: entry.label ?? entry.candidate.text ?? entry.candidate.ariaLabel ?? entry.candidate.tag,
      confidence: 0.8 + Math.min(entry.score / 100, 0.19)
    }))
    .sort((left, right) => {
      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }
      if (left.actionKind !== right.actionKind) {
        return left.actionKind.localeCompare(right.actionKind);
      }
      return String(left.elementId).localeCompare(String(right.elementId));
    });
}

function semanticSafeInteractionCandidates(snapshot = {}, semantic = {}) {
  const candidates = [];

  for (const form of semantic.searchForms ?? []) {
    if ((form.confidence ?? 0) < 0.8 || !form.inputElementId) {
      continue;
    }
    candidates.push({
      actionKind: "SEARCH_SUBMIT",
      action: {
        type: "type",
        elementId: form.inputElementId,
        text: "test",
        pressEnter: true
      },
      elementId: form.inputElementId,
      label: "search",
      confidence: form.confidence
    });
  }

  for (const item of semantic.paginationControls ?? []) {
    if ((item.confidence ?? 0) < 0.8) {
      continue;
    }
    const target = item.nextId ?? item.prevId ?? item.pageLinks?.[0];
    if (!target) {
      continue;
    }
    candidates.push({
      actionKind: "PAGINATION",
      action: { type: "click", elementId: target },
      elementId: target,
      label: "pagination",
      confidence: item.confidence
    });
  }

  for (const filter of semantic.filterControls ?? []) {
    if ((filter.confidence ?? 0) < 0.7 || !filter.elementId) {
      continue;
    }
    candidates.push({
      actionKind: "FILTER_TOGGLE",
      action: { type: "click", elementId: filter.elementId },
      elementId: filter.elementId,
      label: filter.groupLabel ?? "filter",
      confidence: filter.confidence
    });
  }

  return candidates.sort((left, right) => {
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }
    if (left.actionKind !== right.actionKind) {
      return left.actionKind.localeCompare(right.actionKind);
    }
    return String(left.elementId).localeCompare(String(right.elementId));
  });
}

export function selectUiuxSafeInteractionCandidates({
  snapshot,
  runConfig,
  maxInteractionsPerPage
}) {
  const semantic = extractFormSemantics(snapshot);
  const interactiveById = new Map(
    (snapshot.interactive ?? []).map((entry) => [entry.elementId, entry])
  );
  const capFromConfig = Number(runConfig?.uiux?.maxInteractionsPerPage ?? 6);
  const limit = Math.max(0, Number(maxInteractionsPerPage ?? capFromConfig) || capFromConfig);
  if (limit === 0) {
    return [];
  }

  const merged = [...semanticSafeInteractionCandidates(snapshot, semantic), ...rankedSafeInteractiveCandidates(snapshot, semantic)];
  const byElement = new Map();
  const seen = new Set();
  const actionKindPriority = ["SEARCH_SUBMIT", "FILTER_TOGGLE", "PAGINATION", "MENU_EXPAND", "NAV_CLICK"];

  for (const candidate of merged) {
    if (!candidate?.elementId || !candidate?.actionKind || !SAFE_UIUX_ACTION_KINDS.includes(candidate.actionKind)) {
      continue;
    }

    const risky = (semantic.riskyForms ?? []).some((entry) =>
      (entry.elementIds ?? []).includes(candidate.elementId)
    );
    if (risky) {
      continue;
    }

    const interactive = interactiveById.get(candidate.elementId);
    const text = normalizeText(interactive?.text ?? interactive?.ariaLabel ?? candidate.label);
    const href = interactive?.href ?? "";
    const normalizedCandidate = {
      ...candidate,
      actionKind:
        candidate.actionKind === "PAGINATION" &&
        /show more|see more|expand|menu/.test(text) &&
        !/[?&](page|p)=\d+/i.test(href)
          ? "MENU_EXPAND"
          : candidate.actionKind
    };

    const existingByElement = byElement.get(normalizedCandidate.elementId);
    if (
      !existingByElement ||
      normalizedCandidate.confidence > existingByElement.confidence ||
      (
        normalizedCandidate.confidence === existingByElement.confidence &&
        normalizedCandidate.actionKind.localeCompare(existingByElement.actionKind) < 0
      )
    ) {
      byElement.set(normalizedCandidate.elementId, normalizedCandidate);
    }
  }

  const normalizedCandidates = [...byElement.values()].sort((left, right) => {
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }
    if (left.actionKind !== right.actionKind) {
      return left.actionKind.localeCompare(right.actionKind);
    }
    return String(left.elementId).localeCompare(String(right.elementId));
  });

  const deduped = [];
  for (const actionKind of actionKindPriority) {
    const candidate = normalizedCandidates.find((entry) => entry.actionKind === actionKind);
    if (!candidate) {
      continue;
    }
    deduped.push(candidate);
    seen.add(candidate.elementId);
    if (deduped.length >= limit) {
      break;
    }
  }

  for (const candidate of normalizedCandidates) {
    if (deduped.length >= limit) {
      break;
    }
    if (seen.has(candidate.elementId)) {
      continue;
    }
    deduped.push(candidate);
    seen.add(candidate.elementId);
    if (deduped.length >= limit) {
      break;
    }
  }

  return deduped;
}

export function estimateUiuxPlannedCases(runConfig = {}) {
  const maxPages = Math.max(1, Number(runConfig?.uiux?.maxPages ?? 120) || 120);
  const breakpointSettings = resolveUiuxBreakpointSettings(runConfig);
  const sampledWidthCount = Math.max(1, buildCoarseWidthSweep(breakpointSettings).length);
  const representativeWidthCount = Math.max(
    1,
    Number(breakpointSettings.representativeWidthsPerRange ?? 3) || 3
  );
  const coverageMultiplier = Math.max(
    representativeWidthCount,
    Math.min(sampledWidthCount, 8)
  );
  const checkCount = baselineUiuxChecks.length;
  const interactionsPerPage = Math.max(0, Number(runConfig?.uiux?.maxInteractionsPerPage ?? 6) || 6);

  return maxPages * coverageMultiplier * (1 + checkCount) + maxPages * interactionsPerPage;
}

export function planUiuxCasesForPage({
  pageUrl,
  canonicalUrl,
  runConfig,
  deviceLabels = [],
  checkIds = baselineUiuxChecks.map((check) => check.id),
  interactionCandidates = []
}) {
  const normalizedDevices = (deviceLabels.length ? deviceLabels : ["mobile", "tablet", "desktop"])
    .map((label) => String(label))
    .filter(Boolean);
  const renderCases = [];
  const checkCases = [];
  const interactionCases = [];

  for (const deviceLabel of normalizedDevices) {
    renderCases.push(
      {
        ...buildBaseCase({
        id: deterministicId([pageUrl, deviceLabel, "VIEWPORT_RENDER"]),
        pageUrl,
        canonicalUrl,
        deviceLabel,
        caseKind: "VIEWPORT_RENDER",
        expected: `Page should render and become ready on ${deviceLabel}.`
        }),
        checkId: null,
        actionKind: null
      }
    );

    for (const checkId of checkIds) {
      checkCases.push(
        {
          ...buildBaseCase({
          id: deterministicId([pageUrl, deviceLabel, "UI_CHECK", checkId]),
          pageUrl,
          canonicalUrl,
          deviceLabel,
          caseKind: "UI_CHECK",
          expected: `${checkId} should not produce a UI/UX issue on ${deviceLabel}.`
          }),
          checkId,
          actionKind: null
        }
      );
    }
  }

  for (const candidate of interactionCandidates) {
    interactionCases.push(
      {
        ...buildBaseCase({
        id: deterministicId([pageUrl, candidate.actionKind, candidate.elementId, "SAFE_INTERACTION"]),
        pageUrl,
        canonicalUrl,
        deviceLabel: null,
        caseKind: "SAFE_INTERACTION",
        expected: `${candidate.actionKind} should execute safely and reveal additional state.`
        }),
        checkId: null,
        actionKind: candidate.actionKind
      }
    );
  }

  return {
    renderCases,
    checkCases,
    interactionCases,
    allCases: [...renderCases, ...checkCases, ...interactionCases]
  };
}
