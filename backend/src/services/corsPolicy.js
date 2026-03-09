const LOCAL_DEV_ORIGINS = Object.freeze([
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

function normalizeOrigin(origin) {
  const value = String(origin ?? "").trim();
  if (!value) {
    return null;
  }
  return value.replace(/\/+$/, "");
}

export function resolveAllowedCorsOrigins(config = {}) {
  const fromConfig = Array.isArray(config.dashboardOrigins)
    ? config.dashboardOrigins
    : config.dashboardOrigin
      ? [config.dashboardOrigin]
      : [];
  const normalized = [...fromConfig, ...LOCAL_DEV_ORIGINS]
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);
  return [...new Set(normalized)];
}

export function isAllowedCorsOrigin(origin, allowedOrigins = []) {
  if (!origin) {
    return true;
  }
  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return false;
  }
  return new Set(allowedOrigins.map((entry) => normalizeOrigin(entry))).has(normalized);
}

export function createCorsOptions(config = {}) {
  const allowedOrigins = resolveAllowedCorsOrigins(config);
  return {
    origin(origin, callback) {
      const allowed = isAllowedCorsOrigin(origin, allowedOrigins);
      callback(null, allowed);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204
  };
}
