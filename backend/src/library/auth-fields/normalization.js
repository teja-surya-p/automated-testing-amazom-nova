export function normalizeText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeLower(value = "") {
  return normalizeText(value).toLowerCase();
}

export function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
