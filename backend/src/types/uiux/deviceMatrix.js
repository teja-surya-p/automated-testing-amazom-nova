const DEVICE_CLASS_ORDER = {
  mobile: 0,
  tablet: 1,
  laptop: 2,
  desktop: 3
};

const MOBILE_FAMILIES = [
  {
    brand: "Apple",
    line: "iPhone",
    models: [
      "12 mini",
      "12",
      "12 Pro",
      "12 Pro Max",
      "13 mini",
      "13",
      "13 Pro",
      "13 Pro Max",
      "14",
      "14 Pro",
      "14 Pro Max",
      "15",
      "15 Pro",
      "15 Pro Max"
    ]
  },
  {
    brand: "Samsung",
    line: "Galaxy S",
    models: [
      "S21",
      "S21+",
      "S21 Ultra",
      "S22",
      "S22+",
      "S22 Ultra",
      "S23",
      "S23+",
      "S23 Ultra",
      "S24",
      "S24+",
      "S24 Ultra"
    ]
  },
  {
    brand: "Samsung",
    line: "Galaxy Z",
    models: ["Fold 4", "Fold 5", "Flip 4", "Flip 5"]
  },
  {
    brand: "Google",
    line: "Pixel",
    models: ["6", "6 Pro", "7", "7 Pro", "8", "8 Pro"]
  },
  {
    brand: "OnePlus",
    line: "OnePlus",
    models: ["9", "9 Pro", "10", "10 Pro", "11", "11R", "12"]
  },
  {
    brand: "Xiaomi",
    line: "Mi",
    models: ["11", "11 Pro", "12", "12 Pro", "13", "13 Pro"]
  },
  {
    brand: "Oppo",
    line: "Find",
    models: ["X3", "X5", "X6"]
  },
  {
    brand: "Vivo",
    line: "X",
    models: ["60", "70", "80", "90", "100"]
  }
];

const TABLET_FAMILIES = [
  {
    brand: "Apple",
    line: "iPad",
    models: ["9th Gen", "10th Gen", "Air 4", "Air 5", "Pro 11", "Pro 12.9"]
  },
  {
    brand: "Samsung",
    line: "Galaxy Tab",
    models: ["S7", "S8", "S9", "A8", "A9"]
  }
];

const LAPTOP_FAMILIES = [
  {
    brand: "Apple",
    line: "MacBook Air",
    models: ["13", "15"]
  },
  {
    brand: "Apple",
    line: "MacBook Pro",
    models: ["14", "16"]
  },
  {
    brand: "Lenovo",
    line: "ThinkPad",
    models: ["T14", "T15", "X1 Carbon"]
  },
  {
    brand: "Dell",
    line: "XPS",
    models: ["13", "15"]
  }
];

const DESKTOP_CLASSES = [
  {
    label: "Desktop 1080p",
    sizes: [
      [1920, 1080],
      [1366, 768],
      [1536, 864]
    ]
  },
  {
    label: "Desktop 1440p",
    sizes: [
      [2560, 1440],
      [2304, 1296]
    ]
  },
  {
    label: "Desktop 4K",
    sizes: [[3840, 2160]]
  }
];

const DPR_BUCKETS = {
  mobile: [2, 3],
  tablet: [2],
  laptop: [2],
  desktop: [1, 2]
};

const VIEWPORTS_PER_MODEL = {
  mobile: 18,
  tablet: 8,
  laptop: 6
};

function stableHash(input = "") {
  let hash = 0;
  for (const char of String(input)) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function slugify(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function makeId(parts = []) {
  return slugify(parts.filter(Boolean).join("-"));
}

function normalizeViewportPair(pair) {
  if (!Array.isArray(pair) || pair.length < 2) {
    return null;
  }
  const width = Number(pair[0]);
  const height = Number(pair[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  if (width < 240 || height < 320) {
    return null;
  }
  return {
    width: Math.round(width),
    height: Math.round(height)
  };
}

function sortProfiles(entries = []) {
  return [...entries].sort((left, right) => {
    const classDiff =
      (DEVICE_CLASS_ORDER[left.deviceClass] ?? 99) - (DEVICE_CLASS_ORDER[right.deviceClass] ?? 99);
    if (classDiff !== 0) {
      return classDiff;
    }

    const brandDiff = String(left._brand ?? "").localeCompare(String(right._brand ?? ""));
    if (brandDiff !== 0) {
      return brandDiff;
    }

    const lineDiff = String(left._line ?? "").localeCompare(String(right._line ?? ""));
    if (lineDiff !== 0) {
      return lineDiff;
    }

    const modelDiff = String(left._model ?? "").localeCompare(String(right._model ?? ""));
    if (modelDiff !== 0) {
      return modelDiff;
    }

    if (left.width !== right.width) {
      return left.width - right.width;
    }
    if (left.height !== right.height) {
      return left.height - right.height;
    }
    if (left.dpr !== right.dpr) {
      return left.dpr - right.dpr;
    }
    return left.label.localeCompare(right.label);
  });
}

function toPublicProfile(entry = {}, includeUserAgents = false) {
  const profile = {
    id: entry.id,
    label: entry.label,
    width: entry.width,
    height: entry.height,
    dpr: entry.dpr,
    deviceClass: entry.deviceClass,
    isMobile: entry.isMobile
  };

  if (includeUserAgents && entry.userAgent) {
    profile.userAgent = entry.userAgent;
  }

  return profile;
}

function makeViewportBank({
  widths = [],
  heights = [],
  minAspectRatio = 1.2,
  maxAspectRatio = 2.7,
  limit = 60,
  portrait = true
}) {
  const candidates = [];
  for (const rawWidth of widths) {
    for (const rawHeight of heights) {
      const width = Number(rawWidth);
      const height = Number(rawHeight);
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        continue;
      }
      const normalized = portrait
        ? { width: Math.min(width, height), height: Math.max(width, height) }
        : { width: Math.max(width, height), height: Math.min(width, height) };
      if (normalized.width === normalized.height) {
        continue;
      }
      const ratio = normalized.height / normalized.width;
      if (ratio < minAspectRatio || ratio > maxAspectRatio) {
        continue;
      }
      candidates.push([normalized.width, normalized.height]);
    }
  }

  const seen = new Set();
  return candidates
    .map((pair) => normalizeViewportPair(pair))
    .filter(Boolean)
    .filter((pair) => {
      const key = `${pair.width}x${pair.height}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      if (left.width !== right.width) {
        return left.width - right.width;
      }
      return left.height - right.height;
    })
    .slice(0, limit);
}

const MOBILE_VIEWPORTS = makeViewportBank({
  widths: [320, 360, 375, 390, 393, 400, 412, 414, 428, 430, 440],
  heights: [568, 640, 667, 690, 720, 740, 760, 780, 800, 812, 844, 851, 873, 896, 915, 926, 932],
  minAspectRatio: 1.55,
  maxAspectRatio: 2.7,
  limit: 92,
  portrait: true
});

const TABLET_VIEWPORTS = makeViewportBank({
  widths: [600, 640, 700, 720, 744, 768, 800, 810, 820, 834, 853, 962, 1024, 1112, 1180],
  heights: [800, 900, 960, 1000, 1024, 1080, 1112, 1180, 1280, 1366, 1600],
  minAspectRatio: 1.2,
  maxAspectRatio: 2.1,
  limit: 38,
  portrait: true
});

const LAPTOP_VIEWPORTS = makeViewportBank({
  widths: [1280, 1366, 1400, 1440, 1470, 1512, 1536, 1600, 1680, 1728, 1800, 1920],
  heights: [720, 768, 800, 840, 864, 900, 940, 982, 1000, 1050, 1080, 1120, 1200],
  minAspectRatio: 0.45,
  maxAspectRatio: 1.1,
  limit: 28,
  portrait: false
});

function pickViewportSet(viewportBank, desiredCount, seed = "") {
  if (!Array.isArray(viewportBank) || viewportBank.length === 0) {
    return [];
  }

  const count = Math.max(1, Math.min(desiredCount, viewportBank.length));
  const start = stableHash(seed) % viewportBank.length;
  const selected = [];
  const seen = new Set();
  for (let index = 0; index < viewportBank.length && selected.length < count; index += 1) {
    const candidate = viewportBank[(start + index) % viewportBank.length];
    const key = `${candidate.width}x${candidate.height}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    selected.push(candidate);
  }
  return selected;
}

function buildUserAgent({
  deviceClass,
  brand,
  line,
  model
}) {
  if (deviceClass === "mobile") {
    if (brand === "Apple") {
      return `Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 (${line} ${model})`;
    }
    return `Mozilla/5.0 (Linux; Android 14; ${line} ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36`;
  }

  if (deviceClass === "tablet") {
    if (brand === "Apple") {
      return `Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 (${line} ${model})`;
    }
    return `Mozilla/5.0 (Linux; Android 14; ${line} ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`;
  }

  if (deviceClass === "laptop") {
    const platform = brand === "Apple" ? "Macintosh; Intel Mac OS X 14_0" : "Windows NT 10.0; Win64; x64";
    return `Mozilla/5.0 (${platform}; ${line} ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`;
  }

  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
}

function buildFamilyProfiles({
  families,
  deviceClass,
  viewportBank,
  viewportsPerModel
}) {
  const profiles = [];
  for (const family of families) {
    for (const model of family.models) {
      const selectedViewports = pickViewportSet(
        viewportBank,
        viewportsPerModel,
        `${family.brand}|${family.line}|${model}`
      );
      for (const viewport of selectedViewports) {
        for (const dpr of DPR_BUCKETS[deviceClass]) {
          const label = `${family.brand} ${family.line} ${model} (${viewport.width}x${viewport.height} @${dpr}x)`;
          profiles.push({
            id: makeId([
              family.brand,
              family.line,
              model,
              viewport.width,
              viewport.height,
              `${dpr}x`
            ]),
            label,
            width: viewport.width,
            height: viewport.height,
            dpr,
            deviceClass,
            isMobile: deviceClass === "mobile" || deviceClass === "tablet",
            userAgent: buildUserAgent({
              deviceClass,
              brand: family.brand,
              line: family.line,
              model
            }),
            _brand: family.brand,
            _line: family.line,
            _model: model
          });
        }
      }
    }
  }
  return profiles;
}

function buildDesktopProfiles() {
  const profiles = [];
  for (const deviceClass of DESKTOP_CLASSES) {
    for (const size of deviceClass.sizes) {
      const normalized = normalizeViewportPair(size);
      if (!normalized) {
        continue;
      }
      for (const dpr of DPR_BUCKETS.desktop) {
        const label = `${deviceClass.label} (${normalized.width}x${normalized.height} @${dpr}x)`;
        profiles.push({
          id: makeId([deviceClass.label, normalized.width, normalized.height, `${dpr}x`]),
          label,
          width: normalized.width,
          height: normalized.height,
          dpr,
          deviceClass: "desktop",
          isMobile: false,
          userAgent: buildUserAgent({
            deviceClass: "desktop",
            brand: "Desktop",
            line: deviceClass.label,
            model: `${normalized.width}x${normalized.height}`
          }),
          _brand: "Desktop",
          _line: deviceClass.label,
          _model: `${normalized.width}x${normalized.height}`
        });
      }
    }
  }
  return profiles;
}

let cachedFullMatrixWithoutUa = null;
let cachedFullMatrixWithUa = null;

function materializeFullMatrix(includeUserAgents = false) {
  if (includeUserAgents && cachedFullMatrixWithUa) {
    return cachedFullMatrixWithUa;
  }
  if (!includeUserAgents && cachedFullMatrixWithoutUa) {
    return cachedFullMatrixWithoutUa;
  }

  const profiles = sortProfiles([
    ...buildFamilyProfiles({
      families: MOBILE_FAMILIES,
      deviceClass: "mobile",
      viewportBank: MOBILE_VIEWPORTS,
      viewportsPerModel: VIEWPORTS_PER_MODEL.mobile
    }),
    ...buildFamilyProfiles({
      families: TABLET_FAMILIES,
      deviceClass: "tablet",
      viewportBank: TABLET_VIEWPORTS,
      viewportsPerModel: VIEWPORTS_PER_MODEL.tablet
    }),
    ...buildFamilyProfiles({
      families: LAPTOP_FAMILIES,
      deviceClass: "laptop",
      viewportBank: LAPTOP_VIEWPORTS,
      viewportsPerModel: VIEWPORTS_PER_MODEL.laptop
    }),
    ...buildDesktopProfiles()
  ]).map((profile) => toPublicProfile(profile, includeUserAgents));

  if (includeUserAgents) {
    cachedFullMatrixWithUa = profiles;
  } else {
    cachedFullMatrixWithoutUa = profiles;
  }
  return profiles;
}

export const QUICK_DEVICE_PROFILES = [
  {
    id: "quick-mobile-390x844-3x",
    label: "mobile",
    width: 390,
    height: 844,
    dpr: 3,
    deviceClass: "mobile",
    isMobile: true
  },
  {
    id: "quick-tablet-768x1024-2x",
    label: "tablet",
    width: 768,
    height: 1024,
    dpr: 2,
    deviceClass: "tablet",
    isMobile: true
  },
  {
    id: "quick-desktop-1440x900-2x",
    label: "desktop",
    width: 1440,
    height: 900,
    dpr: 2,
    deviceClass: "desktop",
    isMobile: false
  }
];

function normalizeCustomViewportProfiles(viewports = []) {
  const seen = new Set();
  return (Array.isArray(viewports) ? viewports : [])
    .map((viewport, index) => ({
      label: String(viewport?.label ?? `custom-${index + 1}`).trim(),
      width: Number(viewport?.width),
      height: Number(viewport?.height),
      dpr: Number(viewport?.dpr ?? 2),
      deviceClass: Number(viewport?.width) <= 640 ? "mobile" : Number(viewport?.width) <= 1024 ? "tablet" : "desktop",
      isMobile: Number(viewport?.width) <= 1024
    }))
    .filter((viewport) => viewport.label && Number.isFinite(viewport.width) && Number.isFinite(viewport.height))
    .map((viewport) => ({
      ...viewport,
      dpr: Math.min(Math.max(Math.round(viewport.dpr), 1), 4),
      id: makeId(["custom", viewport.label, viewport.width, viewport.height, `${viewport.dpr}x`])
    }))
    .filter((viewport) => {
      if (seen.has(viewport.id)) {
        return false;
      }
      seen.add(viewport.id);
      return true;
    });
}

function matchesFilter(profile, token) {
  const normalizedToken = String(token ?? "").trim().toLowerCase();
  if (!normalizedToken) {
    return false;
  }
  if (profile.id.toLowerCase() === normalizedToken) {
    return true;
  }
  return (
    profile.id.toLowerCase().includes(normalizedToken) ||
    profile.label.toLowerCase().includes(normalizedToken)
  );
}

function applyAllowBlocklist(profiles = [], allowlist = [], blocklist = []) {
  const allowTokens = (Array.isArray(allowlist) ? allowlist : [])
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
  const blockTokens = (Array.isArray(blocklist) ? blocklist : [])
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);

  const allowFiltered = allowTokens.length
    ? profiles.filter((profile) => allowTokens.some((token) => matchesFilter(profile, token)))
    : profiles;

  return allowFiltered.filter(
    (profile) => !blockTokens.some((token) => matchesFilter(profile, token))
  );
}

function resolveDeviceSelection(mode, rawSelection) {
  if (rawSelection === "all") {
    return "all";
  }
  return mode === "quick" ? "cap" : "cap";
}

function resolveMaxDevices(mode, selection, rawMaxDevices) {
  const defaultCap = mode === "quick" ? 3 : 250;
  if (rawMaxDevices === null || rawMaxDevices === undefined || rawMaxDevices === "") {
    return defaultCap;
  }
  const parsed = Number(rawMaxDevices);
  if (!Number.isFinite(parsed)) {
    return defaultCap;
  }
  const rounded = Math.max(0, Math.floor(parsed));
  if (selection === "all" && mode === "full" && rounded === 0) {
    return 0;
  }
  if (rounded === 0) {
    return defaultCap;
  }
  return rounded;
}

export function buildFullDeviceMatrix(options = {}) {
  const includeUserAgents = Boolean(options.includeUserAgents);
  return materializeFullMatrix(includeUserAgents).map((profile) => ({ ...profile }));
}

export function resolveUiuxDeviceProfiles(runConfig = {}) {
  const explicitViewports = runConfig?.uiux?.viewports;
  if (Array.isArray(explicitViewports) && explicitViewports.length > 0) {
    const custom = normalizeCustomViewportProfiles(explicitViewports);
    return custom.length ? custom : QUICK_DEVICE_PROFILES.map((profile) => ({ ...profile }));
  }

  const devicesConfig = runConfig?.uiux?.devices ?? {};
  const mode = devicesConfig.mode === "full" ? "full" : "quick";
  const includeUserAgents = Boolean(devicesConfig.includeUserAgents);
  const selection = resolveDeviceSelection(mode, devicesConfig.selection);
  const maxDevices = resolveMaxDevices(mode, selection, devicesConfig.maxDevices);

  const sourceProfiles =
    mode === "full"
      ? buildFullDeviceMatrix({ includeUserAgents })
      : QUICK_DEVICE_PROFILES.map((profile) => ({ ...profile }));

  const filteredProfiles = applyAllowBlocklist(
    sourceProfiles,
    devicesConfig.allowlist,
    devicesConfig.blocklist
  );

  if (filteredProfiles.length === 0) {
    return mode === "full"
      ? sourceProfiles.slice(0, Math.min(1, sourceProfiles.length))
      : QUICK_DEVICE_PROFILES.map((profile) => ({ ...profile }));
  }

  if (selection === "all" && mode === "full" && maxDevices === 0) {
    return filteredProfiles;
  }

  const capped = filteredProfiles.slice(0, Math.max(1, maxDevices));
  return capped;
}

export function estimateUiuxDeviceCount(runConfig = {}) {
  const explicitViewports = runConfig?.uiux?.viewports;
  if (Array.isArray(explicitViewports) && explicitViewports.length > 0) {
    return normalizeCustomViewportProfiles(explicitViewports).length;
  }

  const mode = runConfig?.uiux?.devices?.mode === "full" ? "full" : "quick";
  if (mode === "quick") {
    return QUICK_DEVICE_PROFILES.length;
  }
  return buildFullDeviceMatrix({ includeUserAgents: false }).length;
}
