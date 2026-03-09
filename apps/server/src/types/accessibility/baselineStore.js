import fs from "node:fs";
import path from "node:path";
import { config } from "../lib/config.js";

function sanitizeBaselineId(value = "") {
  const id = String(value ?? "").trim().toLowerCase();
  if (!id) {
    return "";
  }
  return id.replace(/[^a-z0-9_-]/g, "-").slice(0, 120);
}

function baselineFilePath(baselineId) {
  return path.join(config.accessibilityBaselinesDir, `${baselineId}.json`);
}

function severityRank(level = "P2") {
  return {
    P0: 0,
    P1: 1,
    P2: 2,
    P3: 3
  }[level] ?? 9;
}

function normalizeCluster(cluster = {}) {
  return {
    clusterKey: cluster.clusterKey,
    ruleId: cluster.ruleId ?? "A11Y_RULE",
    normalizedPath: cluster.normalizedPath ?? "/",
    worstSeverity: cluster.worstSeverity ?? "P2",
    count: Number(cluster.count ?? 0)
  };
}

export function buildAccessibilityBaselinePayload({ baselineId, clusters = [] }) {
  return {
    baselineId: sanitizeBaselineId(baselineId),
    generatedAt: new Date().toISOString(),
    clusters: clusters.map((cluster) => normalizeCluster(cluster))
  };
}

export function writeAccessibilityBaseline(payload) {
  if (!payload?.baselineId) {
    return null;
  }

  fs.mkdirSync(config.accessibilityBaselinesDir, { recursive: true });
  const filePath = baselineFilePath(payload.baselineId);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}

export function readAccessibilityBaseline(baselineId) {
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

export function diffAccessibilityBaseline({ baseline = null, currentClusters = [] }) {
  const baselineClusters = baseline?.clusters ?? [];
  const baselineMap = new Map(baselineClusters.map((cluster) => [cluster.clusterKey, cluster]));
  const currentMap = new Map(currentClusters.map((cluster) => [cluster.clusterKey, normalizeCluster(cluster)]));

  const newClusters = [];
  const resolvedClusters = [];
  const severityIncreases = [];
  const severityDecreases = [];

  for (const [clusterKey, current] of currentMap.entries()) {
    const previous = baselineMap.get(clusterKey);
    if (!previous) {
      newClusters.push(current);
      continue;
    }

    const beforeRank = severityRank(previous.worstSeverity);
    const afterRank = severityRank(current.worstSeverity);

    if (afterRank < beforeRank) {
      severityIncreases.push({
        clusterKey,
        ruleId: current.ruleId,
        from: previous.worstSeverity,
        to: current.worstSeverity
      });
    }

    if (afterRank > beforeRank) {
      severityDecreases.push({
        clusterKey,
        ruleId: current.ruleId,
        from: previous.worstSeverity,
        to: current.worstSeverity
      });
    }
  }

  for (const [clusterKey, previous] of baselineMap.entries()) {
    if (!currentMap.has(clusterKey)) {
      resolvedClusters.push(previous);
    }
  }

  return {
    baselineId: baseline?.baselineId ?? null,
    baselineGeneratedAt: baseline?.generatedAt ?? null,
    newClusters,
    resolvedClusters,
    severityIncreases,
    severityDecreases
  };
}

export function resolveAccessibilityBaselineMode(runConfig = {}) {
  const mode = runConfig?.accessibility?.baseline?.mode ?? "off";
  if (["off", "write", "compare"].includes(mode)) {
    return mode;
  }
  return "off";
}

export function resolveAccessibilityBaselineId(runConfig = {}) {
  return sanitizeBaselineId(runConfig?.accessibility?.baseline?.baselineId ?? "");
}
