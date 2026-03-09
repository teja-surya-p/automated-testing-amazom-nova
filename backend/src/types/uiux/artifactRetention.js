import fs from "node:fs/promises";

const RETENTION_TARGET_KINDS = ["dom", "a11y"];

const DEFAULT_ARTIFACT_RETENTION = {
  maxSnapshotsPerViewport: 12,
  keepOnlyFailedOrFlaggedSteps: false,
  keepDomForIssuesOnly: false
};

function cloneArtifactIndex(artifactIndex = {}) {
  return JSON.parse(JSON.stringify(artifactIndex ?? {}));
}

function toRetentionConfig(retention = {}) {
  return {
    maxSnapshotsPerViewport: Math.max(
      1,
      Number.isFinite(Number(retention.maxSnapshotsPerViewport))
        ? Number(retention.maxSnapshotsPerViewport)
        : DEFAULT_ARTIFACT_RETENTION.maxSnapshotsPerViewport
    ),
    keepOnlyFailedOrFlaggedSteps: Boolean(retention.keepOnlyFailedOrFlaggedSteps),
    keepDomForIssuesOnly: Boolean(retention.keepDomForIssuesOnly)
  };
}

function artifactRefKey(ref = "") {
  if (!ref || typeof ref !== "string") {
    return null;
  }

  const normalized = ref.trim();
  if (!normalized) {
    return null;
  }

  return normalized;
}

function collectIssueArtifactRefs(issues = []) {
  const refs = new Set();
  for (const issue of issues) {
    for (const evidence of issue?.evidenceRefs ?? []) {
      const ref = artifactRefKey(evidence?.ref);
      if (ref) {
        refs.add(ref);
      }
    }
  }
  return refs;
}

function normalizeViewportLabel(entry) {
  return entry?.viewportLabel ?? "default";
}

function countArtifacts(artifactIndex = {}) {
  return Object.values(artifactIndex).reduce((count, value) => {
    if (!value) {
      return count;
    }
    if (Array.isArray(value)) {
      return count + value.length;
    }
    return count + 1;
  }, 0);
}

function isIssueBoundEntry(entry, issueRefs) {
  return (
    issueRefs.has(entry?.url ?? "") ||
    issueRefs.has(entry?.relativePath ?? "") ||
    issueRefs.has(entry?.path ?? "")
  );
}

function shouldForcePruneByPolicy(kind, retentionConfig, issueBound, isFinalForViewport) {
  if (issueBound || isFinalForViewport) {
    return false;
  }

  if (retentionConfig.keepOnlyFailedOrFlaggedSteps) {
    return true;
  }

  if (kind === "dom" && retentionConfig.keepDomForIssuesOnly) {
    return true;
  }

  return false;
}

export function resolveUiuxArtifactRetention(runConfig = {}) {
  return toRetentionConfig(runConfig?.uiux?.artifactRetention ?? {});
}

export function computeUiuxArtifactRetentionPlan({
  artifactIndex = {},
  issues = [],
  retention = {}
}) {
  const retentionConfig = toRetentionConfig(retention);
  const issueRefs = collectIssueArtifactRefs(issues);
  const nextArtifactIndex = cloneArtifactIndex(artifactIndex);
  const prunedArtifacts = [];

  for (const kind of RETENTION_TARGET_KINDS) {
    const entries = Array.isArray(nextArtifactIndex[kind]) ? nextArtifactIndex[kind] : [];
    if (!entries.length) {
      continue;
    }

    const withMeta = entries.map((entry, index) => ({
      ...entry,
      __index: index,
      __viewportLabel: normalizeViewportLabel(entry),
      __issueBound: isIssueBoundEntry(entry, issueRefs)
    }));

    const grouped = withMeta.reduce((map, entry) => {
      const label = entry.__viewportLabel;
      const current = map.get(label) ?? [];
      map.set(label, [...current, entry]);
      return map;
    }, new Map());

    const pruneIndices = new Set();

    for (const [, viewportEntries] of grouped.entries()) {
      const finalEntry = viewportEntries.at(-1) ?? null;
      const intermediateCandidates = [];

      for (const entry of viewportEntries) {
        const isFinalForViewport = finalEntry?.__index === entry.__index;
        if (
          shouldForcePruneByPolicy(
            kind,
            retentionConfig,
            entry.__issueBound,
            isFinalForViewport
          )
        ) {
          pruneIndices.add(entry.__index);
          continue;
        }

        if (!entry.__issueBound && !isFinalForViewport) {
          intermediateCandidates.push(entry);
        }
      }

      if (intermediateCandidates.length > retentionConfig.maxSnapshotsPerViewport) {
        const overflow = intermediateCandidates.length - retentionConfig.maxSnapshotsPerViewport;
        for (const entry of intermediateCandidates.slice(0, overflow)) {
          pruneIndices.add(entry.__index);
        }
      }
    }

    nextArtifactIndex[kind] = withMeta
      .filter((entry) => {
        if (!pruneIndices.has(entry.__index)) {
          return true;
        }
        prunedArtifacts.push({
          kind,
          path: entry.path ?? null,
          relativePath: entry.relativePath ?? null,
          url: entry.url ?? null,
          step: entry.step ?? null,
          viewportLabel: entry.__viewportLabel
        });
        return false;
      })
      .map(({ __index, __viewportLabel, __issueBound, ...entry }) => entry);
  }

  return {
    nextArtifactIndex,
    prunedArtifacts,
    artifactsPrunedCount: prunedArtifacts.length,
    artifactsRetainedCount: countArtifacts(nextArtifactIndex),
    retention: retentionConfig
  };
}

export async function removePrunedArtifactFiles(prunedArtifacts = []) {
  for (const artifact of prunedArtifacts) {
    if (!artifact?.path) {
      continue;
    }
    await fs.unlink(artifact.path).catch(() => {});
  }
}

