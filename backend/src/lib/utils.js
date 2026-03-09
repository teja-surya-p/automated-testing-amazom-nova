import crypto from "node:crypto";

export function createId(prefix = "session") {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

export function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function pickLast(items, count) {
  return items.slice(Math.max(0, items.length - count));
}

export function nowIso() {
  return new Date().toISOString();
}

export function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function extractJsonObject(value) {
  const parsed = safeJsonParse(value);
  if (parsed) {
    return parsed;
  }

  const match = value.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }

  return safeJsonParse(match[0]);
}

export function normalizeModelText(result) {
  if (!result) {
    return "";
  }

  if (typeof result === "string") {
    return result;
  }

  if (typeof result.outputText === "string") {
    return result.outputText;
  }

  if (typeof result.message === "string") {
    return result.message;
  }

  if (Array.isArray(result.content)) {
    return result.content.map((block) => block.text ?? "").join("\n");
  }

  if (result.lastMessage?.content) {
    return result.lastMessage.content.map((block) => block.text ?? "").join("\n");
  }

  return JSON.stringify(result);
}
