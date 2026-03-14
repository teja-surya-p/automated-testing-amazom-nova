import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..", "..");

const FALLBACK_VERSION = "2026-03-10-functional-login-fix-3";
const runtimeVersion = String(process.env.QA_SERVER_VERSION ?? "").trim() || FALLBACK_VERSION;

function resolveGitShortHash() {
  try {
    const hash = execSync("git rev-parse --short HEAD", {
      cwd: backendRoot,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8"
    });
    return String(hash ?? "").trim() || "unknown";
  } catch {
    return "unknown";
  }
}

export function createServerRuntimeInfo() {
  return Object.freeze({
    service: "qa-server",
    version: runtimeVersion,
    startedAt: new Date().toISOString(),
    gitShortHash: resolveGitShortHash(),
    capabilities: Object.freeze({
      functionalityLoginAssist: true,
      stopAllActiveRuns: true
    })
  });
}
