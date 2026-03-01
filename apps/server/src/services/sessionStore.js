import { createId, nowIso } from "../lib/utils.js";

export class SessionStore {
  constructor() {
    this.sessions = new Map();
  }

  createSession(input) {
    const id = createId("qa");
    const session = {
      id,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: "queued",
      goal: input.goal,
      startUrl: input.startUrl,
      providerMode: input.providerMode,
      currentUrl: input.startUrl,
      currentStep: 0,
      lastThought: "",
      lastAudit: "",
      evidence: null,
      bug: null,
      success: null,
      frame: null,
      currentHighlight: null,
      history: [],
      timeline: []
    };

    this.sessions.set(id, session);
    return session;
  }

  getSession(id) {
    return this.sessions.get(id) ?? null;
  }

  listSessions() {
    return Array.from(this.sessions.values()).sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1
    );
  }

  patchSession(id, patch) {
    const current = this.sessions.get(id);
    if (!current) {
      return null;
    }

    const updated = {
      ...current,
      ...patch,
      updatedAt: nowIso()
    };

    this.sessions.set(id, updated);
    return updated;
  }

  appendTimeline(id, entry) {
    const current = this.sessions.get(id);
    if (!current) {
      return null;
    }

    current.timeline = [...current.timeline, { ...entry, at: nowIso() }].slice(-120);
    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    return current;
  }
}
