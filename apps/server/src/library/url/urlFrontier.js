const TRACKING_PARAM_PATTERNS = [/^utm_/i, /^gclid$/i, /^fbclid$/i];
const MEANINGFUL_PARAMS = new Set(["q", "query", "search_query", "page", "tab", "view"]);

function normalizeTrailingSlash(pathname) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export function canonicalizeUrl(inputUrl, options = {}) {
  const {
    stripHash = true,
    normalizeTrailingSlash: shouldNormalizeTrailingSlash = true,
    stripTrackingParams = true,
    preserveMeaningfulParamsOnly = false
  } = options;

  const url = new URL(inputUrl);
  if (stripHash) {
    url.hash = "";
  }

  if (shouldNormalizeTrailingSlash) {
    url.pathname = normalizeTrailingSlash(url.pathname);
  }

  const entries = [];
  for (const [key, value] of url.searchParams.entries()) {
    const isTracking = TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(key));
    if (stripTrackingParams && isTracking) {
      continue;
    }
    if (preserveMeaningfulParamsOnly && !MEANINGFUL_PARAMS.has(key)) {
      continue;
    }
    entries.push([key, value]);
  }

  entries.sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    if (leftKey === rightKey) {
      return leftValue.localeCompare(rightValue);
    }
    return leftKey.localeCompare(rightKey);
  });

  url.search = "";
  for (const [key, value] of entries) {
    url.searchParams.append(key, value);
  }

  return url.toString();
}

function sameDomain(hostname, baseHostname) {
  return hostname === baseHostname || hostname.endsWith(`.${baseHostname}`) || baseHostname.endsWith(`.${hostname}`);
}

export class UrlFrontier {
  constructor({
    startUrl,
    perDomainCap = 25,
    maxDepth = 6,
    canonicalizeUrls = true,
    stripTrackingParams = true,
    preserveMeaningfulParamsOnly = false
  }) {
    this.perDomainCap = perDomainCap;
    this.maxDepth = maxDepth;
    this.canonicalizeUrls = canonicalizeUrls;
    this.stripTrackingParams = stripTrackingParams;
    this.preserveMeaningfulParamsOnly = preserveMeaningfulParamsOnly;
    this.baseHostname = new URL(startUrl).hostname;
    this.visitedCanonicalUrls = new Set();
    this.queuedCanonicalUrls = new Set();
    this.queue = [];
    this.domainCounts = new Map();
    this.knownDepths = new Map();
    this.push(startUrl, { depth: 0 });
  }

  canonicalize(url) {
    if (!this.canonicalizeUrls) {
      return new URL(url).toString();
    }

    return canonicalizeUrl(url, {
      stripTrackingParams: this.stripTrackingParams,
      preserveMeaningfulParamsOnly: this.preserveMeaningfulParamsOnly
    });
  }

  canEnqueue(url) {
    const parsed = new URL(url);
    if (!sameDomain(parsed.hostname, this.baseHostname)) {
      return false;
    }

    const count = this.domainCounts.get(parsed.hostname) ?? 0;
    return count < this.perDomainCap;
  }

  push(url, meta = {}) {
    const canonicalUrl = this.canonicalize(url);
    const depth = Number.isInteger(meta.depth) ? meta.depth : this.knownDepths.get(canonicalUrl) ?? 0;
    if (depth > this.maxDepth) {
      return false;
    }
    if (!this.canEnqueue(canonicalUrl)) {
      return false;
    }
    if (this.visitedCanonicalUrls.has(canonicalUrl) || this.queuedCanonicalUrls.has(canonicalUrl)) {
      return false;
    }

    const hostname = new URL(canonicalUrl).hostname;
    this.domainCounts.set(hostname, (this.domainCounts.get(hostname) ?? 0) + 1);
    this.knownDepths.set(canonicalUrl, depth);
    this.queue.push({
      canonicalUrl,
      meta: {
        ...meta,
        depth
      }
    });
    this.queuedCanonicalUrls.add(canonicalUrl);
    return true;
  }

  pushMany(urls, metaFactory = () => ({})) {
    let added = 0;
    urls.forEach((url, index) => {
      if (this.push(url, metaFactory(url, index))) {
        added += 1;
      }
    });
    return added;
  }

  markVisited(url) {
    const canonicalUrl = this.canonicalize(url);
    this.visitedCanonicalUrls.add(canonicalUrl);
    this.queuedCanonicalUrls.delete(canonicalUrl);
    this.queue = this.queue.filter((entry) => entry.canonicalUrl !== canonicalUrl);
    return canonicalUrl;
  }

  getDepth(url) {
    const canonicalUrl = this.canonicalize(url);
    return this.knownDepths.get(canonicalUrl) ?? null;
  }

  next() {
    while (this.queue.length > 0) {
      const nextEntry = this.queue.shift();
      if (!nextEntry) {
        return null;
      }
      if (this.visitedCanonicalUrls.has(nextEntry.canonicalUrl)) {
        this.queuedCanonicalUrls.delete(nextEntry.canonicalUrl);
        continue;
      }
      this.queuedCanonicalUrls.delete(nextEntry.canonicalUrl);
      return nextEntry;
    }

    return null;
  }

  hasNext() {
    return this.queue.length > 0;
  }

  getVisitedCount() {
    return this.visitedCanonicalUrls.size;
  }

  getQueuedCount() {
    return this.queue.length;
  }
}
