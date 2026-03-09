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
  return path.join(config.uiuxBaselinesDir, `${baselineId}.json`);
}

function severityRank(level = "P2") {
  return {
    P0: 0,
    P1: 1,
    P2: 2,
    P3: 3
  }[level] ?? 9;
}

function normalizeClusterMetadata(cluster = {}) {
  const viewportsAffected = [
    cluster.viewportLabel,
    cluster.topRepro?.viewportLabel
  ].filter(Boolean);
  return {
    clusterKey: cluster.clusterKey,
    issueType: cluster.issueType ?? "UNKNOWN",
    viewportLabel: cluster.viewportLabel ?? "default",
    normalizedPath: cluster.normalizedPath ?? "/",
    worstSeverity: cluster.finalWorstSeverity ?? cluster.worstSeverity ?? "P2",
    count: cluster.count ?? 0,
    viewportsAffected: [...new Set(viewportsAffected)].slice(0, 8)
  };
}

export function buildUiuxBaselinePayload({ baselineId, clusters = [] }) {
  const safeBaselineId = sanitizeBaselineId(baselineId);
  return {
    baselineId: safeBaselineId,
    generatedAt: new Date().toISOString(),
    clusters: clusters.map((cluster) => normalizeClusterMetadata(cluster))
  };
}

export function writeUiuxBaseline(payload) {
  if (!payload?.baselineId) {
    return null;
  }

  fs.mkdirSync(config.uiuxBaselinesDir, { recursive: true });
  const filePath = baselineFilePath(payload.baselineId);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}

export function readUiuxBaseline(baselineId) {
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

export function diffUiuxBaseline({
  baseline = null,
  currentClusters = []
}) {
  const baselineClusters = baseline?.clusters ?? [];
  const baselineMap = new Map(baselineClusters.map((cluster) => [cluster.clusterKey, cluster]));
  const currentMap = new Map(
    currentClusters.map((cluster) => [cluster.clusterKey, normalizeClusterMetadata(cluster)])
  );

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
        issueType: current.issueType,
        from: previous.worstSeverity,
        to: current.worstSeverity
      });
    }
    if (afterRank > beforeRank) {
      severityDecreases.push({
        clusterKey,
        issueType: current.issueType,
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

export function resolveUiuxBaselineMode(runConfig = {}) {
  const mode = runConfig?.uiux?.baseline?.mode ?? "off";
  if (["off", "write", "compare"].includes(mode)) {
    return mode;
  }
  return "off";
}

export function resolveUiuxBaselineId(runConfig = {}) {
  return sanitizeBaselineId(runConfig?.uiux?.baseline?.baselineId ?? "");
}
