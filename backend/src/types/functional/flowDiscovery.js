import { hashText } from "../../lib/utils.js";
import { extractFormSemantics } from "./formSemantics.js";

const DESTRUCTIVE_HINT = /delete|remove|close account|pay|purchase|checkout|unsubscribe|reset|wipe|logout|sign out/i;
const CLEAR_FILTER_HINT = /clear|reset|remove filter|all products|all results/i;
const ITEM_LINK_HINT = /product|item|details|view|open/i;

function normalizeText(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function isSafeElement(element) {
  const text = [element.text, element.ariaLabel, element.placeholder, element.name].join(" ");
  return !DESTRUCTIVE_HINT.test(text);
}

function scoreElement(element, scoreConfig) {
  let score = 0;
  if (element.zone === "Header") {
    score += scoreConfig.header ?? 0;
  }
  if (element.zone === "Primary Content") {
    score += scoreConfig.primary ?? 0;
  }
  if (element.inViewport) {
    score += scoreConfig.viewport ?? 0;
  }
  if (element.isPrimaryCta) {
    score += scoreConfig.primaryCta ?? 0;
  }
  return score;
}

function sortElements(elements, scoreConfig) {
  return [...elements].sort((left, right) => {
    const scoreDiff = scoreElement(right, scoreConfig) - scoreElement(left, scoreConfig);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    const yDiff = (left.bounds?.viewportY ?? left.bounds?.y ?? 0) - (right.bounds?.viewportY ?? right.bounds?.y ?? 0);
    if (yDiff !== 0) {
      return yDiff;
    }
    return normalizeText(left.text || left.ariaLabel || left.selector || "").localeCompare(
      normalizeText(right.text || right.ariaLabel || right.selector || "")
    );
  });
}

function buildActionFromElement(element, overrides = {}) {
  if (!element) {
    return null;
  }
  if (overrides.type === "type") {
    return {
      type: "type",
      elementId: element.elementId,
      text: overrides.text ?? "test",
      submitOnEnter: overrides.submitOnEnter ?? true,
      functionalKind: overrides.functionalKind ?? "search",
      selector: element.selector ?? null,
      label: element.text || element.ariaLabel || element.placeholder || element.name || "input"
    };
  }
  return {
    type: "click",
    elementId: element.elementId,
    functionalKind: overrides.functionalKind ?? "navigation",
    selector: element.selector ?? null,
    label: element.text || element.ariaLabel || element.placeholder || element.name || element.tag
  };
}

function compactActions(actions = []) {
  return actions.filter(Boolean);
}

function buildFlow(flowType, label, actions) {
  return {
    flowId: `${flowType.toLowerCase()}-${hashText(`${flowType}:${label}`)}`,
    flowType,
    label,
    actions,
    expectedOutcome: label
  };
}

function resolvePageType(pageTypeHints = {}) {
  if (pageTypeHints.isAuth) {
    return "auth";
  }
  if (pageTypeHints.isCheckout) {
    return "checkout";
  }
  if (pageTypeHints.isSearch) {
    return "search";
  }
  if (pageTypeHints.isProduct) {
    return "product";
  }
  if (pageTypeHints.isDocs) {
    return "docs";
  }
  if (pageTypeHints.isHome) {
    return "home";
  }
  return "generic";
}

export function discoverFunctionalElements(snapshot = {}) {
  const interactive = (snapshot.interactive ?? [])
    .filter((item) => item.inViewport && !item.disabled)
    .filter((item) => isSafeElement(item));

  const navLinks = sortElements(
    interactive.filter((item) => item.tag === "a").filter((item) => item.href),
    { header: 4, primary: 2, viewport: 1 }
  );

  const itemLinks = sortElements(
    interactive
      .filter((item) => item.tag === "a" && item.zone === "Primary Content")
      .filter((item) => item.href)
      .filter((item) => ITEM_LINK_HINT.test([item.text, item.ariaLabel, item.href].join(" ")) || item.isPrimaryCta),
    { primary: 4, viewport: 1, primaryCta: 2 }
  );

  const clearFilterControls = sortElements(
    interactive.filter((item) =>
      CLEAR_FILTER_HINT.test([item.text, item.ariaLabel, item.placeholder, item.name].join(" "))
    ),
    { primary: 3, header: 1, viewport: 1 }
  );

  return {
    interactive,
    navLinks,
    itemLinks,
    clearFilterControls
  };
}

function buildHomeNavSmoke(elements) {
  const nav = elements.navLinks[0];
  if (!nav) {
    return null;
  }
  return buildFlow("HOME_NAV_SMOKE", "Home/Nav smoke", compactActions([
    buildActionFromElement(nav, { functionalKind: "navigation" }),
    { type: "back", functionalKind: "navigation", label: "Back" }
  ]));
}

function buildSearchSmoke(elements, semantics) {
  const search = (semantics.searchForms ?? []).sort((left, right) => right.confidence - left.confidence)[0];
  if (!search?.inputElementId) {
    return null;
  }

  const interactiveById = new Map((elements.interactive ?? []).map((entry) => [entry.elementId, entry]));
  const input = interactiveById.get(search.inputElementId);
  if (!input) {
    return null;
  }
  const item = elements.itemLinks[0] ?? null;
  return buildFlow("SEARCH_SMOKE", "Search smoke", compactActions([
    buildActionFromElement(input, {
      type: "type",
      text: "test",
      functionalKind: "search",
      submitOnEnter: true
    }),
    item ? buildActionFromElement(item, { functionalKind: "navigation" }) : null,
    item ? { type: "back", functionalKind: "navigation", label: "Back" } : null
  ]));
}

function buildFilterSmoke(elements, semantics) {
  const filterControl = (semantics.filterControls ?? [])
    .sort((left, right) => right.confidence - left.confidence)[0];
  if (!filterControl?.elementId) {
    return null;
  }
  const interactiveById = new Map((elements.interactive ?? []).map((entry) => [entry.elementId, entry]));
  const filterElement = interactiveById.get(filterControl.elementId);
  if (!filterElement) {
    return null;
  }
  const clearFilter = elements.clearFilterControls[0] ?? null;
  return buildFlow("FILTER_SMOKE", "Filter smoke", compactActions([
    buildActionFromElement(filterElement, { functionalKind: "filter" }),
    clearFilter ? buildActionFromElement(clearFilter, { functionalKind: "filter-clear" }) : null
  ]));
}

function buildPaginationSmoke(elements, semantics) {
  const pagination = (semantics.paginationControls ?? [])[0];
  if (!pagination) {
    return null;
  }
  const interactiveById = new Map((elements.interactive ?? []).map((entry) => [entry.elementId, entry]));
  const next = pagination.nextId ? interactiveById.get(pagination.nextId) : null;
  const prev = pagination.prevId ? interactiveById.get(pagination.prevId) : null;
  const pageLink = pagination.pageLinks?.[0] ? interactiveById.get(pagination.pageLinks[0]) : null;
  const first = next ?? pageLink;
  if (!first) {
    return null;
  }
  return buildFlow("PAGINATION_SMOKE", "Pagination smoke", compactActions([
    buildActionFromElement(first, { functionalKind: "pagination" }),
    prev
      ? buildActionFromElement(prev, { functionalKind: "pagination" })
      : { type: "back", functionalKind: "pagination", label: "Back" }
  ]));
}

function buildDetailPageSmoke(elements) {
  const item = elements.itemLinks[0] ?? elements.navLinks[0];
  if (!item) {
    return null;
  }
  return buildFlow("DETAIL_PAGE_SMOKE", "Detail-page smoke", compactActions([
    buildActionFromElement(item, { functionalKind: "navigation" }),
    { type: "back", functionalKind: "navigation", label: "Back" }
  ]));
}

function templateOrderForPageType(pageType) {
  if (pageType === "home") {
    return ["HOME_NAV_SMOKE", "DETAIL_PAGE_SMOKE", "SEARCH_SMOKE", "FILTER_SMOKE", "PAGINATION_SMOKE"];
  }
  if (pageType === "search") {
    return ["SEARCH_SMOKE", "PAGINATION_SMOKE", "DETAIL_PAGE_SMOKE", "FILTER_SMOKE", "HOME_NAV_SMOKE"];
  }
  if (pageType === "product") {
    return ["DETAIL_PAGE_SMOKE", "HOME_NAV_SMOKE", "PAGINATION_SMOKE", "SEARCH_SMOKE", "FILTER_SMOKE"];
  }
  if (pageType === "docs") {
    return ["HOME_NAV_SMOKE", "DETAIL_PAGE_SMOKE", "SEARCH_SMOKE"];
  }
  return ["HOME_NAV_SMOKE", "DETAIL_PAGE_SMOKE", "SEARCH_SMOKE", "FILTER_SMOKE", "PAGINATION_SMOKE"];
}

function removeSubmitFlowsWhenDisabled(flows, runConfig) {
  if (runConfig?.functional?.allowFormSubmit) {
    return flows;
  }
  const submitFlowTypes = new Set(["SEARCH_SMOKE", "FILTER_SMOKE", "PAGINATION_SMOKE"]);
  return flows.filter((flow) => !submitFlowTypes.has(flow.flowType));
}

export function discoverFlowCandidates({ snapshot, runConfig, formSemantics = null }) {
  const maxFlows = runConfig?.functional?.maxFlows ?? 6;
  const elements = discoverFunctionalElements(snapshot);
  const semantics = formSemantics ?? extractFormSemantics(snapshot);
  const pageType = resolvePageType(snapshot?.pageTypeHints ?? {});

  const templates = {
    HOME_NAV_SMOKE: buildHomeNavSmoke(elements),
    SEARCH_SMOKE: buildSearchSmoke(elements, semantics),
    FILTER_SMOKE: buildFilterSmoke(elements, semantics),
    PAGINATION_SMOKE: buildPaginationSmoke(elements, semantics),
    DETAIL_PAGE_SMOKE: buildDetailPageSmoke(elements)
  };

  const orderedTemplates = templateOrderForPageType(pageType)
    .map((key) => templates[key])
    .filter(Boolean);

  const uniqueFlows = [];
  const seen = new Set();
  for (const flow of orderedTemplates) {
    if (!flow || seen.has(flow.flowType)) {
      continue;
    }
    seen.add(flow.flowType);
    uniqueFlows.push(flow);
  }

  const gatedFlows = removeSubmitFlowsWhenDisabled(uniqueFlows, runConfig);

  if (gatedFlows.length > 0) {
    return gatedFlows.slice(0, maxFlows);
  }

  const fallback = templates.HOME_NAV_SMOKE ?? templates.DETAIL_PAGE_SMOKE;
  return fallback ? [fallback] : [];
}
