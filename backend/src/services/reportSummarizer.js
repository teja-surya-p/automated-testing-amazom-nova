import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { config } from "../lib/config.js";

const SUMMARY_PROMPT = [
  "You are a QA executive summary assistant.",
  "Return 4-6 concise lines.",
  "Each line must be factual and derived from the JSON input.",
  "Do not invent facts, recommendations, or mitigation steps not present in input.",
  "No markdown headings or bullet symbols."
].join(" ");

function compactReportForSummary(report = {}) {
  return {
    sessionId: report.sessionId,
    outcome: report.outcome,
    mode: report.runConfig?.testMode ?? "default",
    targetAchieved: report.targetAchieved,
    primaryBlocker: report.primaryBlocker ?? null,
    evidenceQualityScore: report.evidenceQualityScore,
    uiux: {
      pagesVisited: report.uiuxSummary?.pagesVisited ?? 0,
      uniqueStates: report.uiuxSummary?.uniqueStates ?? 0,
      topIssues: (report.uiuxSummary?.topIssues ?? []).slice(0, 5),
      failingDevices: report.uiux?.failingDevices ?? []
    },
    functional: {
      flowsRun: report.functional?.flowsRun ?? 0,
      assertionCounts: report.functional?.assertionCounts ?? null,
      blockers: (report.functional?.blockers ?? []).slice(0, 5),
      summary: report.functional?.summary ?? ""
    },
    accessibility: {
      pagesScanned: report.accessibility?.summary?.pagesScanned ?? 0,
      severityCounts: report.accessibility?.summary?.severityCounts ?? {},
      topRules: (report.accessibility?.summary?.ruleCounts ?? []).slice(0, 5),
      summaryText: report.accessibility?.summary?.summaryText ?? ""
    }
  };
}

function extractOutputText(response = {}) {
  const contents = response?.output?.message?.content ?? [];
  const text = contents
    .map((item) => item?.text ?? "")
    .join("\n")
    .trim();
  return text.length ? text : null;
}

export class ReportSummarizer {
  constructor() {
    this.enabled = config.bedrockEnabled;
    this.modelId = config.explorerModelId;
    this.client = this.enabled
      ? new BedrockRuntimeClient({
          region: config.awsRegion
        })
      : null;
  }

  isEnabled() {
    return Boolean(this.enabled && this.client && this.modelId);
  }

  async summarize({ report, mode }) {
    if (!this.isEnabled() || !report || mode === "default") {
      return null;
    }

    const payload = JSON.stringify(compactReportForSummary(report));
    try {
      const response = await this.client.send(
        new ConverseCommand({
          modelId: this.modelId,
          messages: [
            {
              role: "user",
              content: [
                {
                  text: `${SUMMARY_PROMPT}\nMode: ${mode}\nReport JSON:\n${payload}`
                }
              ]
            }
          ],
          inferenceConfig: {
            maxTokens: 220,
            temperature: 0.1
          }
        })
      );
      const text = extractOutputText(response);
      if (!text) {
        return null;
      }
      return {
        text,
        modelId: this.modelId
      };
    } catch {
      return null;
    }
  }
}

