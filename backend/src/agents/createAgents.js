import { Agent, ImageBlock, TextBlock } from "@strands-agents/sdk";
import { BedrockModel } from "@strands-agents/sdk/bedrock";
import { config, hasBedrockRuntime } from "../lib/config.js";
import { extractJsonObject, normalizeModelText } from "../lib/utils.js";

function buildBedrockAgent(modelId, systemPrompt) {
  if (!hasBedrockRuntime()) {
    return null;
  }

  return new Agent({
    model: new BedrockModel({
      modelId,
      region: config.awsRegion,
      temperature: 0.1,
      maxTokens: 900
    }),
    systemPrompt
  });
}

async function invokeJson(agent, prompt, screenshotBase64) {
  if (!agent) {
    return null;
  }

  const blocks = [new TextBlock(prompt)];
  if (screenshotBase64) {
    blocks.push(
      new ImageBlock({
        format: "png",
        source: {
          bytes: Buffer.from(screenshotBase64, "base64")
        }
      })
    );
  }

  const result = await agent.invoke(blocks);
  return extractJsonObject(normalizeModelText(result));
}

export function createExplorerAgent() {
  return buildBedrockAgent(
    config.explorerModelId,
    [
      "You are Explorer, the browser-driving agent in a QA orchestrator.",
      "You receive a goal, the current page state, a semantic map, and the last three semantic actions.",
      "Return strict JSON with no markdown.",
      "If you see a cookie consent, sign-in wall, or newsletter popup, dismiss it before pursuing the goal.",
      "Treat the sidebar or guide as a no-go zone when searching on YouTube.",
      "Prefer the header search region for typing and the primary content region for opening results.",
      "Prefer closing blocking popups first.",
      "Avoid repeating the same action if it did not change the screen.",
      "Cross-check the screenshot against the semantic map before selecting an elementId.",
      "If the target is a YouTube video, it must be in the Primary Content landmark.",
      "Only reference elementId values that appear in the provided interactive elements list.",
      "Supported action types: click, type, scroll, wait, done, bug.",
      "For type actions, include a realistic text value.",
      "If the task is a search flow, prefer typing into the search field and pressing Enter instead of hunting for a search icon.",
      "Ignore any result labeled Ad or YouTube Mix.",
      "JSON shape:",
      '{"thinking":"short reason","landmark":"Header Zone","verification":"Selected target from the semantic map","targetText":"Search","action":{"type":"click","elementId":"el-1","text":"","deltaY":0,"durationMs":0,"pressEnter":false},"isDone":false,"bug":null}'
    ].join(" ")
  );
}

export function createAuditorAgent() {
  return buildBedrockAgent(
    config.auditorModelId,
    [
      "You are Auditor, a multimodal QA agent reviewing the live browser state after every move.",
      "Check for blockers before the next move, especially popups, disabled checkout buttons, infinite loaders, and obvious visual defects.",
      "Return strict JSON with no markdown.",
      "Possible statuses: proceed, recoverable, bug, success.",
      "If you detect a bug, include a concise bug object with type, severity, summary, and evidencePrompt.",
      "JSON shape:",
      '{"status":"proceed","thought":"short analysis","nextInstruction":"short instruction","bug":null,"obstruction":{"present":false,"summary":""}}'
    ].join(" ")
  );
}

export async function runExplorerAgent(agent, context) {
  const prompt = [
    `Goal: ${context.parsedGoal?.conciseGoal ?? context.goal}`,
    `Raw goal: ${context.goal}`,
    `Parsed search intent: ${context.parsedGoal?.searchIntent ?? ""}`,
    `Step: ${context.step}`,
    `Current URL: ${context.snapshot.url}`,
    `Recent actions: ${JSON.stringify(context.recentActions)}`,
    `Recent semantic actions: ${JSON.stringify(context.recentSemanticActions ?? [])}`,
    `Auditor instruction: ${context.auditorInstruction || "None"}`,
    `Interactive elements: ${JSON.stringify(context.snapshot.interactive)}`,
    `Semantic map: ${JSON.stringify(context.snapshot.semanticMap ?? [])}`,
    `Visible overlays: ${JSON.stringify(context.snapshot.overlays)}`,
    `Visible text summary: ${context.snapshot.bodyText}`,
    "Use Header zone for search and Primary Content zone for result selection.",
    "Treat Sidebar zone as a no-go area for YouTube result selection.",
    "If an overlay or consent wall is present, dismiss it first.",
    "If a search input is visible, typing and pressing Enter is more reliable than clicking a search icon.",
    "Ignore any result labeled Ad or YouTube Mix.",
    "Before choosing an action, identify the target text from the semantic map and then select the matching elementId."
  ].join("\n");

  return invokeJson(agent, prompt, context.snapshot.screenshotBase64);
}

export async function runAuditorAgent(agent, context) {
  const prompt = [
    `Goal: ${context.goal}`,
    `Phase: ${context.phase}`,
    `Current URL: ${context.snapshot.url}`,
    `Current step: ${context.step}`,
    `Last action: ${JSON.stringify(context.lastAction ?? null)}`,
    `Recent actions: ${JSON.stringify(context.recentActions)}`,
    `Unchanged screen count: ${context.unchangedSteps}`,
    `Interactive elements: ${JSON.stringify(context.snapshot.interactive)}`,
    `Visible overlays: ${JSON.stringify(context.snapshot.overlays)}`,
    `Spinner visible: ${context.snapshot.spinnerVisible}`,
    `Visible text summary: ${context.snapshot.bodyText}`
  ].join("\n");

  return invokeJson(agent, prompt, context.snapshot.screenshotBase64);
}
