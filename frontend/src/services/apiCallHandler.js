import { API_BASE_URL, API_PREFIX } from "./constants";

function normalizeApiPath(path = "") {
  const value = String(path || "");
  if (!value) {
    return API_PREFIX;
  }
  if (value.startsWith(`${API_PREFIX}/`) || value === API_PREFIX) {
    return value;
  }
  if (value.startsWith("/")) {
    return `${API_PREFIX}${value}`;
  }
  return `${API_PREFIX}/${value}`;
}

function buildUrl({ path, params = {}, baseUrl = API_BASE_URL }) {
  const normalizedBase = String(baseUrl || API_BASE_URL).replace(/\/+$/, "");
  const normalizedPath = normalizeApiPath(path);
  const url = new URL(`${normalizedBase}${normalizedPath}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function parseApiPayload(response) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }
  const text = await response.text().catch(() => "");
  return text ? { message: text } : null;
}

function normalizeErrorPayload(payload, fallbackMessage) {
  if (payload && typeof payload === "object") {
    if (payload.error && typeof payload.error === "object") {
      return {
        ...payload,
        code: payload.error.code ?? payload.code ?? "REQUEST_FAILED",
        message: payload.error.message ?? payload.message ?? fallbackMessage,
        error: payload.error.code ?? payload.error.message ?? "REQUEST_FAILED"
      };
    }
    return {
      ...payload,
      code: payload.code ?? "REQUEST_FAILED",
      message: payload.message ?? fallbackMessage,
      error: payload.error ?? payload.code ?? "REQUEST_FAILED"
    };
  }

  return {
    code: "REQUEST_FAILED",
    error: "REQUEST_FAILED",
    message: fallbackMessage
  };
}

export async function apiCall({
  path,
  method = "GET",
  params,
  body,
  data,
  headers = {},
  signal,
  baseUrl = API_BASE_URL
}) {
  const payload = body ?? data;
  const resolvedMethod = String(method || "GET").toUpperCase();
  const requestHeaders = {
    ...headers
  };

  const init = {
    method: resolvedMethod,
    headers: requestHeaders,
    signal
  };

  if (payload !== undefined) {
    if (!requestHeaders["Content-Type"] && !requestHeaders["content-type"]) {
      requestHeaders["Content-Type"] = "application/json";
    }
    init.body = typeof payload === "string" ? payload : JSON.stringify(payload);
  }

  const response = await fetch(buildUrl({ path, params, baseUrl }), init);
  const parsed = await parseApiPayload(response);

  if (!response.ok) {
    throw normalizeErrorPayload(parsed, "API request failed.");
  }

  return parsed;
}
