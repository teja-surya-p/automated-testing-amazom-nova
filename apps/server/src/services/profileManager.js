import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../lib/config.js";
import { hashText, nowIso } from "../lib/utils.js";

function sanitizeTag(value) {
  return (value || "default")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function buildPurpose(goal) {
  const normalized = goal.toLowerCase();
  if (/(premium|subscription|upgrade|plan|trial)/.test(normalized)) {
    return "subscription";
  }
  if (/(youtube|video|watch|play|search)/.test(normalized)) {
    return "media";
  }
  if (/(checkout|payment|billing|cart)/.test(normalized)) {
    return "commerce";
  }
  if (/(login|sign in|auth|account)/.test(normalized)) {
    return "auth";
  }
  return "general";
}

export class ProfileManager {
  constructor(baseDir = config.profileDir) {
    this.baseDir = baseDir;
  }

  async ensureBaseDir() {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  resolveProfile({ startUrl, goal, userProvidedTag = "" }) {
    const domain = new URL(startUrl).hostname;
    const purpose = buildPurpose(goal);
    const tag = sanitizeTag(userProvidedTag || domain.replace(/\./g, "-"));
    const profileId = hashText(`${domain}:${purpose}:${tag}`);
    const profileDir = path.join(this.baseDir, profileId);

    return {
      profileId,
      purpose,
      domain,
      tag,
      profileDir,
      storageStatePath: path.join(profileDir, "storage-state.json"),
      healthPath: path.join(profileDir, "health.json")
    };
  }

  async loadHealth(profile) {
    await this.ensureBaseDir();
    await fs.mkdir(profile.profileDir, { recursive: true });

    try {
      const value = await fs.readFile(profile.healthPath, "utf8");
      return JSON.parse(value);
    } catch {
      return {
        profileId: profile.profileId,
        domain: profile.domain,
        purpose: profile.purpose,
        lastSuccessfulRunAt: null,
        lastLoginAt: null,
        lastBlockerType: null,
        lastUsedAt: null,
        createdAt: nowIso()
      };
    }
  }

  async saveHealth(profile, patch) {
    const current = await this.loadHealth(profile);
    const updated = {
      ...current,
      ...patch,
      lastUsedAt: nowIso()
    };

    await fs.writeFile(profile.healthPath, JSON.stringify(updated, null, 2));
    return updated;
  }
}
