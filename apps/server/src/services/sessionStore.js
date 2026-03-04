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
      goalFamily: input.goalFamily ?? "generic",
      profileId: input.profileId ?? null,
      profile: input.profile ?? null,
      sessionHealth: input.sessionHealth ?? null,
      currentUrl: input.startUrl,
      currentStep: 0,
      lastThought: "",
      lastAudit: "",
      evidence: null,
      bug: null,
      success: null,
      frame: null,
      currentHighlight: null,
      gateState: "READY",
      primaryBlocker: null,
      outcome: null,
      runSummary: null,
      loginAssist: null,
      history: [],
      timeline: [],
      observations: [],
      incidents: [],
      steps: [],
      graph: {
        nodes: [],
        edges: []
      },
      crawler: {
        mode: input.crawlerMode ?? false,
        actionBudget: input.crawlerBudget ?? null,
        startAt: nowIso()
      },
      report: null
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

  appendObservation(id, observation) {
    const current = this.sessions.get(id);
    if (!current) {
      return null;
    }

    current.observations = [...current.observations, observation].slice(-160);
    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    return current;
  }

  appendIncident(id, incident) {
    const current = this.sessions.get(id);
    if (!current) {
      return null;
    }

    current.incidents = [...current.incidents, incident].slice(-80);
    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    return current;
  }

  upsertStep(id, stepRecord) {
    const current = this.sessions.get(id);
    if (!current) {
      return null;
    }

    const existingIndex = current.steps.findIndex((entry) => entry.stepId === stepRecord.stepId);
    if (existingIndex >= 0) {
      current.steps[existingIndex] = {
        ...current.steps[existingIndex],
        ...stepRecord
      };
    } else {
      current.steps = [...current.steps, stepRecord];
    }

    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    return current;
  }

  appendGraphNode(id, node) {
    const current = this.sessions.get(id);
    if (!current) {
      return null;
    }

    if (!current.graph.nodes.some((entry) => entry.nodeId === node.nodeId)) {
      current.graph.nodes = [...current.graph.nodes, node].slice(-200);
    }

    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    return current;
  }

  appendGraphEdge(id, edge) {
    const current = this.sessions.get(id);
    if (!current) {
      return null;
    }

    current.graph.edges = [...current.graph.edges, edge].slice(-200);
    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    return current;
  }
}
