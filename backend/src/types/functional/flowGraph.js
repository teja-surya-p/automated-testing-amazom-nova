import { hashText } from "../../lib/utils.js";
import { canonicalizeUrl } from "../../library/url/urlFrontier.js";

function canonicalUrl(url) {
  if (!url) {
    return null;
  }
  try {
    return canonicalizeUrl(url, {
      stripTrackingParams: true,
      preserveMeaningfulParamsOnly: false
    });
  } catch {
    return url;
  }
}

export function buildLandmarksSignature(snapshot = {}) {
  return hashText(
    JSON.stringify(
      (snapshot.semanticMap ?? []).slice(0, 24).map((item) => ({
        text: item.text,
        zone: item.zone,
        landmark: item.landmark
      }))
    )
  );
}

export function buildFlowNode(snapshot = {}) {
  return {
    nodeId: hashText(
      `${canonicalUrl(snapshot.url) ?? "unknown"}:${buildLandmarksSignature(snapshot)}`
    ),
    urlCanonical: canonicalUrl(snapshot.url),
    pageTypeHints: snapshot.pageTypeHints ?? {},
    landmarksSignature: buildLandmarksSignature(snapshot)
  };
}

export function buildFlowEdge({
  fromNode,
  toNode,
  actionType,
  selector = null,
  label = null
}) {
  const edgeId = hashText(
    `${fromNode?.nodeId ?? "unknown"}:${toNode?.nodeId ?? "unknown"}:${actionType}:${selector ?? ""}:${label ?? ""}`
  );

  return {
    edgeId,
    from: fromNode?.nodeId ?? null,
    to: toNode?.nodeId ?? null,
    actionType: actionType ?? "unknown",
    selector,
    label
  };
}

export class FunctionalFlowGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = [];
  }

  addSnapshot(snapshot) {
    const node = buildFlowNode(snapshot);
    if (!node.nodeId) {
      return null;
    }
    this.nodes.set(node.nodeId, node);
    return node;
  }

  addTransition({ fromSnapshot, toSnapshot, actionType, selector = null, label = null }) {
    const fromNode = this.addSnapshot(fromSnapshot);
    const toNode = this.addSnapshot(toSnapshot);
    const edge = buildFlowEdge({ fromNode, toNode, actionType, selector, label });
    this.edges.push(edge);
    return edge;
  }

  toJSON() {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges]
    };
  }
}
