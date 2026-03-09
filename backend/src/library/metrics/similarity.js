function normalizeToken(value = "") {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeNavLabels(labels = []) {
  return [...new Set(labels.map((value) => normalizeToken(value)).filter(Boolean))];
}

export function jaccardSimilarity(leftLabels = [], rightLabels = []) {
  const left = new Set(normalizeNavLabels(leftLabels));
  const right = new Set(normalizeNavLabels(rightLabels));
  if (!left.size && !right.size) {
    return 1;
  }
  if (!left.size || !right.size) {
    return 0;
  }

  let intersection = 0;
  for (const label of left) {
    if (right.has(label)) {
      intersection += 1;
    }
  }

  const union = new Set([...left, ...right]).size;
  return intersection / Math.max(union, 1);
}

export function resolvePrimaryPageType(pageTypeHints = {}) {
  if (pageTypeHints.isCheckout) {
    return "checkout";
  }
  if (pageTypeHints.isAuth) {
    return "auth";
  }
  if (pageTypeHints.isProduct) {
    return "product";
  }
  if (pageTypeHints.isSearch) {
    return "search";
  }
  if (pageTypeHints.isDocs) {
    return "docs";
  }
  if (pageTypeHints.isHome) {
    return "home";
  }
  return "generic";
}

