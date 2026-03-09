function safeParseUrl(url) {
  if (!url || typeof url !== "string") {
    return null;
  }

  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function normalizeEndpointPath(url = "") {
  const parsed = safeParseUrl(url);
  if (parsed) {
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return pathname;
  }

  const trimmed = String(url ?? "").trim();
  if (!trimmed) {
    return "/";
  }
  const withoutQuery = trimmed.split("?")[0].split("#")[0] || "/";
  const normalized = withoutQuery.replace(/\/+$/, "") || "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

export function normalizeEndpointStatus(value) {
  if (value === null || value === undefined) {
    return "timeout";
  }

  const numeric = Number.parseInt(String(value), 10);
  if (Number.isNaN(numeric)) {
    return "unknown";
  }
  return String(numeric);
}

function toPatternRegex(pattern) {
  const source = String(pattern ?? "").trim();
  if (!source) {
    return null;
  }

  const regexLiteral = source.match(/^\/(.+)\/([dgimsuvy]*)$/i);
  if (regexLiteral) {
    try {
      return new RegExp(regexLiteral[1], regexLiteral[2]);
    } catch {
      return null;
    }
  }

  const escaped = source
    .replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
    .replace(/\*/g, ".*");
  try {
    return new RegExp(`^${escaped}$`, "i");
  } catch {
    return null;
  }
}

export function matchesEndpointPattern(value = "", patterns = []) {
  const target = String(value ?? "");
  if (!patterns.length) {
    return false;
  }

  return patterns
    .map((pattern) => toPatternRegex(pattern))
    .filter(Boolean)
    .some((regex) => regex.test(target));
}

export function filterApiCallsByContracts(apiCalls = [], contractsConfig = {}) {
  const allowlist = contractsConfig?.endpointAllowlistPatterns ?? [];
  const blocklist = contractsConfig?.endpointBlocklistPatterns ?? [];

  return apiCalls.filter((call) => {
    const path = call?.urlPath ?? "/";

    if (blocklist.length > 0 && matchesEndpointPattern(path, blocklist)) {
      return false;
    }

    if (allowlist.length > 0) {
      return matchesEndpointPattern(path, allowlist);
    }

    return true;
  });
}

export function summarizeApiErrorCounts(apiCalls = []) {
  return apiCalls.reduce(
    (counts, call) => {
      const status = Number.parseInt(String(call?.status ?? ""), 10);
      if (Number.isNaN(status)) {
        return counts;
      }
      if (status >= 400 && status < 500) {
        counts["4xx"] += 1;
      }
      if (status >= 500) {
        counts["5xx"] += 1;
      }
      return counts;
    },
    {
      "4xx": 0,
      "5xx": 0,
      timeouts: 0
    }
  );
}

export function groupFailingEndpoints(records = [], { limit = 10 } = {}) {
  const grouped = new Map();

  for (const record of records) {
    const status = Number.parseInt(String(record?.status ?? ""), 10);
    const timedOut = Boolean(record?.timedOut);
    const failed = timedOut || (!Number.isNaN(status) && status >= 400);
    if (!failed) {
      continue;
    }

    const urlPath = normalizeEndpointPath(record?.urlPath ?? record?.url ?? "/");
    const current = grouped.get(urlPath) ?? {
      urlPath,
      count: 0,
      statusCodes: new Set(),
      isThirdParty: false,
      timeouts: 0
    };

    current.count += 1;
    current.isThirdParty = current.isThirdParty || Boolean(record?.isThirdParty);
    if (timedOut) {
      current.timeouts += 1;
      current.statusCodes.add("timeout");
    } else {
      current.statusCodes.add(normalizeEndpointStatus(status));
    }

    grouped.set(urlPath, current);
  }

  return [...grouped.values()]
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.urlPath.localeCompare(right.urlPath);
    })
    .slice(0, limit)
    .map((entry) => ({
      urlPath: entry.urlPath,
      count: entry.count,
      statusCodes: [...entry.statusCodes].sort((left, right) => left.localeCompare(right)),
      isThirdParty: entry.isThirdParty,
      timeouts: entry.timeouts
    }));
}
