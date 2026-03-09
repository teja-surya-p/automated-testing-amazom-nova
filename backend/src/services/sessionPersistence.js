import fs from "node:fs";
import path from "node:path";
import { config } from "../lib/config.js";

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export class SessionPersistence {
  constructor(baseDir = config.sessionsDir) {
    this.baseDir = baseDir;
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  filePath(sessionId) {
    return path.join(this.baseDir, `${sessionId}.json`);
  }

  saveSession(session) {
    if (!session?.id) {
      return;
    }

    fs.mkdirSync(this.baseDir, { recursive: true });
    fs.writeFileSync(this.filePath(session.id), JSON.stringify(session, null, 2));
  }

  loadSession(sessionId) {
    const filePath = this.filePath(sessionId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const parsed = safeParse(fs.readFileSync(filePath, "utf8"));
    return parsed && parsed.id ? parsed : null;
  }

  loadAllSessions() {
    if (!fs.existsSync(this.baseDir)) {
      return [];
    }

    return fs
      .readdirSync(this.baseDir)
      .filter((fileName) => fileName.endsWith(".json"))
      .map((fileName) => safeParse(fs.readFileSync(path.join(this.baseDir, fileName), "utf8")))
      .filter((session) => session && session.id)
      .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));
  }
}
