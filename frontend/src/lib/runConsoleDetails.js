function withCount(label, count) {
  const normalized = Number.isFinite(Number(count)) ? Math.max(Number(count), 0) : 0;
  return normalized > 0 ? `${label} (${normalized})` : label;
}

export function buildRunConsoleDetailToggleOptions({
  mode = "default",
  failureCount = 0,
  advisoryCount = 0,
  hasUiuxHandbook = false,
  hasWebsiteDocs = false
} = {}) {
  const options = [
    { key: "activity", label: "Activity" },
    { key: "currentCase", label: "Current Case" },
    { key: "devices", label: "Devices" },
    { key: "failures", label: withCount("Failures", failureCount) },
    { key: "summary", label: "Summary" },
    { key: "artifacts", label: "Artifacts" }
  ];

  if (mode === "uiux") {
    options.splice(4, 0, { key: "advisories", label: withCount("Advisories", advisoryCount) });
    if (hasUiuxHandbook) {
      options.splice(5, 0, { key: "handbook", label: "Handbook" });
    }
  }

  if (mode === "functional" && hasWebsiteDocs) {
    options.splice(options.length - 1, 0, { key: "websiteDocs", label: "Website Docs" });
  }

  return options;
}

export function toggleRunConsoleDetailSelection(current = null, key = "") {
  const normalizedKey = String(key ?? "").trim();
  if (!normalizedKey) {
    const currentKey = String(current ?? "").trim();
    return currentKey || null;
  }

  const currentKey = String(current ?? "").trim();
  if (currentKey === normalizedKey) {
    return null;
  }
  return normalizedKey;
}

export function isRunConsoleDetailVisible(selected = null, key = "", availableKeys = null) {
  const normalizedKey = String(key ?? "").trim();
  if (!normalizedKey) {
    return false;
  }
  if (Array.isArray(availableKeys) && availableKeys.length > 0 && !availableKeys.includes(normalizedKey)) {
    return false;
  }
  if (Array.isArray(selected)) {
    return selected.map((entry) => String(entry)).includes(normalizedKey);
  }
  return String(selected ?? "").trim() === normalizedKey;
}
