function normalizeText(value = "") {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function elementText(element = {}) {
  return normalizeText(
    [
      element.text,
      element.ariaLabel,
      element.placeholder,
      element.name,
      element.labelText,
      element.id
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function clampConfidence(value) {
  return Math.max(0, Math.min(0.99, Number(value) || 0));
}

function sortableConfidence(left, right) {
  if (right.confidence !== left.confidence) {
    return right.confidence - left.confidence;
  }
  return String(left.elementId ?? left.inputElementId ?? "").localeCompare(
    String(right.elementId ?? right.inputElementId ?? "")
  );
}

function buildInteractiveLookup(snapshot = {}) {
  const bySelector = new Map();
  for (const entry of snapshot.interactive ?? []) {
    if (!entry?.selector) {
      continue;
    }
    if (!bySelector.has(entry.selector)) {
      bySelector.set(entry.selector, entry);
    }
  }
  return bySelector;
}

function buildSearchForms(snapshot = {}) {
  const interactiveBySelector = buildInteractiveLookup(snapshot);
  const searchHint = /\bsearch\b|\bfind\b|\bquery\b|\blookup\b/i;
  const queryHint = /^q$|query|search[_-]?query|keyword|term/i;
  const submitHint = /\bsearch\b|\bfind\b|\bgo\b|\bsubmit\b|\bapply\b/i;
  const inputById = new Map((snapshot.interactive ?? []).map((entry) => [entry.elementId, entry]));

  const candidates = [];
  for (const control of snapshot.formControls ?? []) {
    const linkedInteractive = interactiveBySelector.get(control.selector);
    const elementId = linkedInteractive?.elementId ?? null;
    if (!elementId) {
      continue;
    }
    const tag = linkedInteractive.tag ?? control.tag ?? "";
    if (!["input", "textarea"].includes(String(tag).toLowerCase())) {
      continue;
    }

    const mergedText = elementText({
      ...control,
      ...linkedInteractive
    });
    const isSearchLike =
      searchHint.test(mergedText) ||
      String(control.type ?? linkedInteractive.type ?? "").toLowerCase() === "search";
    if (!isSearchLike) {
      continue;
    }

    let confidence = 0.58;
    const type = String(control.type ?? linkedInteractive.type ?? "").toLowerCase();
    if (type === "search") {
      confidence += 0.16;
    }
    if (searchHint.test(mergedText)) {
      confidence += 0.14;
    }
    if (queryHint.test(String(control.name ?? linkedInteractive.name ?? ""))) {
      confidence += 0.08;
    }

    const input = inputById.get(elementId);
    const submitCandidate = (snapshot.interactive ?? [])
      .filter((entry) => entry?.elementId && !entry.disabled)
      .filter((entry) => entry.elementId !== elementId)
      .filter((entry) => {
        const tag = (entry.tag ?? "").toLowerCase();
        if (tag === "input") {
          const type = (entry.type ?? "").toLowerCase();
          return ["submit", "button"].includes(type);
        }
        return ["button", "a"].includes(tag);
      })
      .filter((entry) => submitHint.test(elementText(entry)))
      .filter((entry) => {
        if (!input?.bounds || !entry?.bounds) {
          return true;
        }
        const dy = Math.abs((entry.bounds.viewportY ?? entry.bounds.y ?? 0) - (input.bounds.viewportY ?? input.bounds.y ?? 0));
        return dy <= 180;
      })
      .sort((left, right) => {
        const leftY = left.bounds?.viewportY ?? left.bounds?.y ?? 0;
        const rightY = right.bounds?.viewportY ?? right.bounds?.y ?? 0;
        if (leftY !== rightY) {
          return leftY - rightY;
        }
        return String(left.elementId ?? "").localeCompare(String(right.elementId ?? ""));
      })[0];

    if (submitCandidate) {
      confidence += 0.08;
    }

    const rawName = String(control.name ?? linkedInteractive.name ?? "");
    const queryParamHint = queryHint.test(rawName)
      ? rawName
      : queryHint.test(mergedText)
        ? "q"
        : null;

    candidates.push({
      inputElementId: elementId,
      submitElementId: submitCandidate?.elementId ?? null,
      confidence: clampConfidence(confidence),
      queryParamHint
    });
  }

  const deduped = new Map();
  for (const candidate of candidates.sort(sortableConfidence)) {
    if (!deduped.has(candidate.inputElementId)) {
      deduped.set(candidate.inputElementId, candidate);
    }
  }
  return [...deduped.values()];
}

function buildFilterControls(snapshot = {}) {
  const filterHint = /\bfilter\b|\bsort\b|\bcategory\b|\bfacet\b|\brefine\b/i;
  const controls = [];
  const seen = new Set();

  for (const entry of snapshot.interactive ?? []) {
    if (!entry?.elementId || entry.disabled) {
      continue;
    }

    const tag = String(entry.tag ?? "").toLowerCase();
    const inputType = String(entry.type ?? "").toLowerCase();
    const text = elementText(entry);
    const isSelect = tag === "select";
    const isCheckbox = tag === "input" && inputType === "checkbox";
    const isRadio = tag === "input" && inputType === "radio";
    const isFilterButton = ["button", "a"].includes(tag) && filterHint.test(text);
    const isFilterLike = isSelect || isCheckbox || isRadio || isFilterButton;
    if (!isFilterLike) {
      continue;
    }

    const key = entry.elementId;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    let type = "button";
    if (isCheckbox) {
      type = "checkbox";
    } else if (isRadio) {
      type = "radio";
    } else if (isSelect) {
      type = "select";
    }

    let confidence = 0.62;
    if (isSelect || isCheckbox || isRadio) {
      confidence += 0.2;
    }
    if (filterHint.test(text)) {
      confidence += 0.1;
    }
    if (entry.zone === "Primary Content") {
      confidence += 0.05;
    }

    controls.push({
      type,
      elementId: entry.elementId,
      groupLabel: (entry.text || entry.ariaLabel || entry.name || "filter").slice(0, 120),
      confidence: clampConfidence(confidence)
    });
  }

  return controls.sort(sortableConfidence);
}

function buildPaginationControls(snapshot = {}) {
  const nextHint = /\bnext\b|more|older|›|»/i;
  const prevHint = /\bprevious\b|\bprev\b|newer|‹|«/i;
  const pageHint = /[?&](page|p)=\d+/i;

  const controls = (snapshot.interactive ?? [])
    .filter((entry) => entry?.elementId && !entry.disabled)
    .filter((entry) => ["a", "button"].includes(String(entry.tag ?? "").toLowerCase()));

  const next = controls
    .filter((entry) => nextHint.test(elementText(entry)) || pageHint.test(entry.href ?? ""))
    .sort(sortableConfidence)[0];
  const prev = controls
    .filter((entry) => prevHint.test(elementText(entry)))
    .sort(sortableConfidence)[0];
  const pageLinks = controls
    .filter((entry) => /^\d+$/.test(String(entry.text ?? "").trim()) || pageHint.test(entry.href ?? ""))
    .map((entry) => entry.elementId)
    .slice(0, 10);

  if (!next && !prev && pageLinks.length === 0) {
    return [];
  }

  let confidence = 0.56;
  if (next) {
    confidence += 0.14;
  }
  if (prev) {
    confidence += 0.14;
  }
  if (pageLinks.length > 0) {
    confidence += 0.12;
  }

  return [
    {
      nextId: next?.elementId ?? null,
      prevId: prev?.elementId ?? null,
      pageLinks,
      confidence: clampConfidence(confidence)
    }
  ];
}

function classifyRiskType(text) {
  if (!text) {
    return null;
  }
  if (/\b(sign up|signup|register|create account|create profile|join now)\b/i.test(text)) {
    return "sign-up";
  }
  if (/\b(checkout|payment|billing|place order|buy now|card number|cvv)\b/i.test(text)) {
    return "checkout";
  }
  if (/\b(contact us|send message|feedback|support request)\b/i.test(text)) {
    return "contact-us";
  }
  if (/\b(newsletter|subscribe|mailing list)\b/i.test(text)) {
    return "newsletter";
  }
  return null;
}

function buildRiskyForms(snapshot = {}) {
  const risks = [];
  const seen = new Set();
  const interactiveBySelector = buildInteractiveLookup(snapshot);

  for (const entry of snapshot.interactive ?? []) {
    if (!entry?.elementId) {
      continue;
    }
    const riskType = classifyRiskType(elementText(entry));
    if (!riskType) {
      continue;
    }
    const key = `${riskType}:${entry.elementId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    risks.push({
      formType: riskType,
      elementIds: [entry.elementId],
      confidence: 0.92
    });
  }

  for (const control of snapshot.formControls ?? []) {
    const riskType = classifyRiskType(elementText(control));
    if (!riskType) {
      continue;
    }
    const linked = interactiveBySelector.get(control.selector);
    const elementId = linked?.elementId;
    if (!elementId) {
      continue;
    }
    const key = `${riskType}:${elementId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    risks.push({
      formType: riskType,
      elementIds: [elementId],
      confidence: 0.9
    });
  }

  return risks.sort((left, right) => {
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }
    return left.formType.localeCompare(right.formType);
  });
}

export function extractFormSemantics(snapshot = {}) {
  const searchForms = buildSearchForms(snapshot);
  const filterControls = buildFilterControls(snapshot);
  const paginationControls = buildPaginationControls(snapshot);
  const riskyForms = buildRiskyForms(snapshot);

  return {
    searchForms,
    filterControls,
    paginationControls,
    riskyForms
  };
}
