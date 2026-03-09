import fs from "node:fs";
import path from "node:path";
import { config } from "../../lib/config.js";

function sanitizeBaselineId(value = "") {
  const id = String(value ?? "").trim().toLowerCase();
  if (!id) {
    return "";
  }
  return id.replace(/[^a-z0-9_-]/g, "-").slice(0, 120);
}

function baselineFilePath(baselineId) {
  return path.join(config.functionalBaselinesDir, `${baselineId}.json`);
}

function severityRank(level = "P2") {
  return {
    P0: 0,
    P1: 1,
    P2: 2,
    P3: 3
  }[level] ?? 9;
}

function normalizeSeverity(level = "P2") {
  return ["P0", "P1", "P2", "P3"].includes(level) ? level : "P2";
}

function normalizeFlowSignature(flow = {}) {
  const type = flow.flowType ?? "UNKNOWN_FLOW";
  const label = flow.label ?? "Unnamed flow";
  return `${type}:${label}`.replace(/\s+/g, " ").trim();
}

function flowOutcome(flow = {}) {
  if (flow.blocked) {
    return "blocked";
  }
  if ((flow.assertionFailures ?? 0) > 0) {
    return "failed";
  }
  return "passed";
}

function countBy(items = [], keyField) {
  const map = new Map();
  for (const item of items) {
    const key = String(item?.[keyField] ?? "").trim();
    if (!key) {
      continue;
    }
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  return [...map.entries()]
    .map(([key, count]) => ({ [keyField]: key, count }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return String(left[keyField]).localeCompare(String(right[keyField]));
    });
}

function mapToCountMap(items = [], keyField) {
  const map = new Map();
  for (const item of items) {
    const key = String(item?.[keyField] ?? "").trim();
    const count = Number(item?.count ?? 0);
    if (!key) {
      continue;
    }
    map.set(key, count);
  }
  return map;
}

function buildFailureTypeCounts(issues = []) {
  const keyed = issues.map((issue) => ({ assertionId: issue.assertionId ?? issue.issueType ?? "UNKNOWN" }));
  return countBy(keyed, "assertionId");
}

function buildBlockerTypeCounts(blockers = []) {
  const keyed = blockers.map((blocker) => ({ blockerType: blocker.type ?? "UNKNOWN_BLOCKER" }));
  return countBy(keyed, "blockerType");
}

function worstSeverityFromIssues(issues = []) {
  if (!issues.length) {
    return "P2";
  }
  return issues
    .map((issue) => normalizeSeverity(issue.finalSeverity ?? issue.severity ?? "P2"))
    .sort((left, right) => severityRank(left) - severityRank(right))[0];
}

export function buildFunctionalBaselinePayload({ baselineId, functional = {} }) {
  const safeBaselineId = sanitizeBaselineId(baselineId);
  const flows = (functional.flows ?? [])
    .map((flow) => ({
      signature: normalizeFlowSignature(flow),
      outcome: flowOutcome(flow)
    }))
    .sort((left, right) => left.signature.localeCompare(right.signature));

  const failingAssertionTypes = buildFailureTypeCounts(functional.issues ?? []);
  const topFailingEndpoints = (functional.contractSummary?.topFailingEndpoints ?? [])
    .map((endpoint) => ({
      urlPath: endpoint.urlPath ?? "/",
      count: Number(endpoint.count ?? 0)
    }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.urlPath.localeCompare(right.urlPath);
    })
    .slice(0, 30);

  const blockerTypes = buildBlockerTypeCounts(functional.blockers ?? []);
  const worstSeverity = worstSeverityFromIssues(functional.issues ?? []);

  return {
    baselineId: safeBaselineId,
    generatedAt: new Date().toISOString(),
    flows,
    failingAssertionTypes,
    topFailingEndpoints,
    blockerTypes,
    worstSeverity
  };
}

export function writeFunctionalBaseline(payload) {
  if (!payload?.baselineId) {
    return null;
  }

  fs.mkdirSync(config.functionalBaselinesDir, { recursive: true });
  const filePath = baselineFilePath(payload.baselineId);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}

export function readFunctionalBaseline(baselineId) {
  const safeBaselineId = sanitizeBaselineId(baselineId);
  if (!safeBaselineId) {
    return null;
  }

  const filePath = baselineFilePath(safeBaselineId);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function diffFunctionalBaseline({ baseline = null, current = null }) {
  const baselineFailures = mapToCountMap(baseline?.failingAssertionTypes ?? [], "assertionId");
  const currentFailures = mapToCountMap(current?.failingAssertionTypes ?? [], "assertionId");
  const baselineEndpoints = mapToCountMap(baseline?.topFailingEndpoints ?? [], "urlPath");
  const currentEndpoints = mapToCountMap(current?.topFailingEndpoints ?? [], "urlPath");
  const baselineBlockers = mapToCountMap(baseline?.blockerTypes ?? [], "blockerType");
  const currentBlockers = mapToCountMap(current?.blockerTypes ?? [], "blockerType");

  const newFailures = [];
  const resolvedFailures = [];

  for (const [assertionId, after] of currentFailures.entries()) {
    const before = baselineFailures.get(assertionId) ?? 0;
    if (before === 0 && after > 0) {
      newFailures.push({ assertionId, before, after, delta: after - before });
    }
  }

  for (const [assertionId, before] of baselineFailures.entries()) {
    const after = currentFailures.get(assertionId) ?? 0;
    if (before > 0 && after === 0) {
      resolvedFailures.push({ assertionId, before, after, delta: after - before });
    }
  }

  const endpointKeys = [...new Set([...baselineEndpoints.keys(), ...currentEndpoints.keys()])];
  const endpointFailureDeltas = endpointKeys
    .map((urlPath) => {
      const before = baselineEndpoints.get(urlPath) ?? 0;
      const after = currentEndpoints.get(urlPath) ?? 0;
      return {
        urlPath,
        before,
        after,
        delta: after - before
      };
    })
    .filter((entry) => entry.delta !== 0)
    .sort((left, right) => {
      const absoluteDiff = Math.abs(right.delta) - Math.abs(left.delta);
      if (absoluteDiff !== 0) {
        return absoluteDiff;
      }
      return left.urlPath.localeCompare(right.urlPath);
    });

  const blockerKeys = [...new Set([...baselineBlockers.keys(), ...currentBlockers.keys()])];
  const blockerDeltas = blockerKeys
    .map((blockerType) => {
      const before = baselineBlockers.get(blockerType) ?? 0;
      const after = currentBlockers.get(blockerType) ?? 0;
      return {
        blockerType,
        before,
        after,
        delta: after - before
      };
    })
    .filter((entry) => entry.delta !== 0)
    .sort((left, right) => {
      const absoluteDiff = Math.abs(right.delta) - Math.abs(left.delta);
      if (absoluteDiff !== 0) {
        return absoluteDiff;
      }
      return left.blockerType.localeCompare(right.blockerType);
    });

  return {
    baselineId: baseline?.baselineId ?? current?.baselineId ?? null,
    baselineGeneratedAt: baseline?.generatedAt ?? null,
    currentGeneratedAt: current?.generatedAt ?? null,
    newFailures: newFailures.sort((left, right) => left.assertionId.localeCompare(right.assertionId)),
    resolvedFailures: resolvedFailures.sort((left, right) => left.assertionId.localeCompare(right.assertionId)),
    endpointFailureDeltas,
    blockerDeltas
  };
}

export function resolveFunctionalBaselineMode(runConfig = {}) {
  const mode = runConfig?.functional?.baseline?.mode ?? "off";
  if (["off", "write", "compare"].includes(mode)) {
    return mode;
  }
  return "off";
}

export function resolveFunctionalBaselineId(runConfig = {}) {
  return sanitizeBaselineId(runConfig?.functional?.baseline?.baselineId ?? "");
}
