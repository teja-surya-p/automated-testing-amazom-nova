function outcomeLabel(status) {
  if (status === "passed") {
    return "PASS";
  }
  if (status === "soft-passed") {
    return "SOFT-PASS";
  }
  return "FAIL";
}

function buildMarkdown(session) {
  const blocker = session.primaryBlocker;
  const timeline = (session.timeline ?? [])
    .map((entry) => `- ${entry.at}: [${entry.type}] ${entry.message}`)
    .join("\n");
  const incidents = (session.incidents ?? [])
    .map((incident) => `- ${incident.severity} ${incident.type}: ${incident.title}`)
    .join("\n");

  return [
    `# Run Report`,
    ``,
    `- Session: ${session.id}`,
    `- Outcome: ${outcomeLabel(session.status)}`,
    `- Goal: ${session.goal}`,
    `- URL: ${session.currentUrl ?? session.startUrl}`,
    `- Primary blocker: ${blocker ? `${blocker.type} (${Math.round(blocker.confidence * 100)}%)` : "None"}`,
    ``,
    `## Timeline`,
    timeline || "- No timeline entries recorded.",
    ``,
    `## Incidents`,
    incidents || "- No incidents recorded.",
    ``
  ].join("\n");
}

export function buildRunReport(session) {
  return {
    sessionId: session.id,
    outcome: outcomeLabel(session.status),
    targetAchieved: Boolean(session.outcome?.targetAchieved),
    blockers: session.outcome?.blockers ?? [],
    primaryBlocker: session.primaryBlocker ?? null,
    nextBestAction: session.outcome?.nextBestAction ?? null,
    evidenceQualityScore: session.outcome?.evidenceQualityScore ?? 0,
    timeline: session.timeline ?? [],
    incidents: session.incidents ?? [],
    observations: session.observations ?? [],
    reproducibleSteps: (session.steps ?? []).map((step) => ({
      stepId: step.stepId,
      actionPlan: step.actionPlan,
      actionAttempted: step.actionAttempted,
      result: step.result
    })),
    markdown: buildMarkdown(session)
  };
}
