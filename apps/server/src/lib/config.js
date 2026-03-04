import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, "../..");

export const config = {
  port: Number(process.env.PORT ?? 8787),
  dashboardOrigin: process.env.DASHBOARD_ORIGIN ?? "http://localhost:4173",
  targetAppUrl: process.env.TARGET_APP_URL ?? "http://localhost:4174",
  awsRegion: process.env.AWS_REGION ?? "us-east-1",
  explorerProvider: process.env.EXPLORER_PROVIDER ?? "heuristic",
  auditorProvider: process.env.AUDITOR_PROVIDER ?? "heuristic",
  evidenceProvider: process.env.EVIDENCE_PROVIDER ?? "local",
  explorerModelId:
    process.env.NOVA_LITE_ID ?? process.env.NOVA_PRO_ID ?? process.env.EXPLORER_MODEL_ID ?? "eu.amazon.nova-lite-v1:0",
  auditorModelId:
    process.env.NOVA_PRO_ID ?? process.env.AUDITOR_MODEL_ID ?? "eu.amazon.nova-pro-v1:0",
  novaReelModelId: process.env.NOVA_REEL_MODEL_ID ?? "amazon.nova-reel-v1:1",
  novaActBaseUrl: process.env.NOVA_ACT_BASE_URL ?? "",
  novaActApiKey: process.env.NOVA_ACT_API_KEY ?? "",
  evidenceBucketUri: process.env.S3_OUTPUT_BUCKET ?? process.env.EVIDENCE_BUCKET_URI ?? "",
  bedrockEnabled: process.env.BEDROCK_ENABLED === "true",
  headless: process.env.PLAYWRIGHT_HEADLESS !== "false",
  storageStatePath: process.env.PLAYWRIGHT_STORAGE_STATE_PATH ?? "",
  maxSteps: Number(process.env.MAX_STEPS ?? 18),
  stagnationLimit: Number(process.env.STAGNATION_LIMIT ?? 3),
  screenshotLimit: Number(process.env.SCREENSHOT_LIMIT ?? 10),
  actionRetryCount: Number(process.env.ACTION_RETRY_COUNT ?? 3),
  actionRetryDelayMs: Number(process.env.ACTION_RETRY_DELAY_MS ?? 900),
  selectorVisibleTimeoutMs: Number(process.env.SELECTOR_VISIBLE_TIMEOUT_MS ?? 5_000),
  clickTimeoutMs: Number(process.env.CLICK_TIMEOUT_MS ?? 5_000),
  networkIdleTimeoutMs: Number(process.env.NETWORK_IDLE_TIMEOUT_MS ?? 10_000),
  domReadyTimeoutMs: Number(process.env.DOM_READY_TIMEOUT_MS ?? 5_000),
  postActionDelayMs: Number(process.env.POST_ACTION_DELAY_MS ?? 1_000),
  profileDir: process.env.PROFILE_DIR ?? path.join(serverRoot, "profiles"),
  loginAssistPollMs: Number(process.env.LOGIN_ASSIST_POLL_MS ?? 3_000),
  loginAssistTimeoutMs: Number(process.env.LOGIN_ASSIST_TIMEOUT_MS ?? 180_000),
  crawlerActionBudget: Number(process.env.CRAWLER_ACTION_BUDGET ?? 40),
  crawlerDepthLimit: Number(process.env.CRAWLER_DEPTH_LIMIT ?? 6),
  crawlerTimeBudgetMs: Number(process.env.CRAWLER_TIME_BUDGET_MS ?? 300_000),
  artifactsDir: process.env.ARTIFACTS_DIR ?? path.join(serverRoot, "artifacts")
};

export function hasBedrockRuntime() {
  return config.bedrockEnabled;
}
