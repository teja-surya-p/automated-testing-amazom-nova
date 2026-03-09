import { config } from "../lib/config.js";
import { createExplorerAgent, runExplorerAgent } from "../agents/createAgents.js";

function matchElement(interactive, patterns, options = {}) {
  const normalizedPatterns = patterns.map((pattern) => pattern.toLowerCase());
  return interactive.find((element) => {
    const haystack = [
      element.text,
      element.ariaLabel,
      element.placeholder,
      element.name,
      element.type
    ]
      .join(" ")
      .toLowerCase();

    if (options.inputOnly && !["input", "textarea", "select"].includes(element.tag)) {
      return false;
    }

    if (options.zone && element.zone !== options.zone) {
      return false;
    }

    return normalizedPatterns.some((pattern) => haystack.includes(pattern));
  });
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function cleanPhrase(value) {
  return normalizeWhitespace(
    value
      .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, "")
      .replace(/\b(?:and|then)\s+press\s+the\s+enter\s+key\b.*$/i, "")
      .replace(/\b(?:once|after|before)\b.*$/i, "")
      .replace(/\b(?:explicitly\s+)?ignore\b.*$/i, "")
      .replace(/\bscan\s+the\b.*$/i, "")
      .replace(/\bcross-verify\b.*$/i, "")
      .replace(/[.;]+$/g, "")
  );
}

function scoreQuotedCandidate(goalLower, candidate, index) {
  const normalizedCandidate = candidate.toLowerCase();
  const prefix = goalLower.slice(Math.max(0, index - 50), index);
  const suffix = goalLower.slice(index, Math.min(goalLower.length, index + candidate.length + 50));
  let score = 0;

  if (!normalizedCandidate || normalizedCandidate.length > 80) {
    return -100;
  }

  if (/^(shopping|ad|youtube mix|semanticmap|shopping tab|left sidebar)$/i.test(candidate)) {
    score -= 50;
  }

  if (/\b(?:type|search(?: for)?|look up|find|play|matching|title matching|song)\b/.test(prefix)) {
    score += 12;
  }

  if (/\b(?:ignore|excluding|skip|labeled as)\b/.test(prefix)) {
    score -= 12;
  }

  if (/\b(?:ignore|excluding|skip|labeled as)\b/.test(suffix)) {
    score -= 10;
  }

  const wordCount = normalizedCandidate.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 1 && wordCount <= 6) {
    score += 5;
  }

  if (/^[a-z0-9][a-z0-9\s-]{1,40}$/i.test(candidate)) {
    score += 4;
  }

  if (/[,.]/.test(candidate)) {
    score -= 8;
  }

  return score;
}

function extractQuotedSearchIntent(goal) {
  const normalizedGoal = normalizeWhitespace(goal);
  const goalLower = normalizedGoal.toLowerCase();
  const quotePattern = /["“”'‘’]([^"“”'‘’]{1,120})["“”'‘’]/g;
  let best = "";
  let bestScore = -100;

  for (const match of normalizedGoal.matchAll(quotePattern)) {
    const candidate = cleanPhrase(match[1] ?? "");
    const score = scoreQuotedCandidate(goalLower, candidate, match.index ?? 0);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : "";
}

function extractPatternSearchIntent(goal) {
  const patterns = [
    /\btype\s+["“”'‘’]?([^"“”'‘’.,;]+?)["“”'‘’]?(?:,|\band\b|\bthen\b|\bonce\b|$)/i,
    /\bsearch(?:\s+for)?\s+["“”'‘’]?([^"“”'‘’.,;]+?)["“”'‘’]?(?:\s+on\b|,|\band\b|\bthen\b|$)/i,
    /\bfind\s+["“”'‘’]?([^"“”'‘’.,;]+?)["“”'‘’]?(?:\s+on\b|,|\band\b|\bthen\b|$)/i,
    /\bmatching\s+["“”'‘’]?([^"“”'‘’.,;]+?)["“”'‘’]?(?:,|\band\b|\bthen\b|$)/i
  ];

  for (const pattern of patterns) {
    const match = goal.match(pattern);
    if (match?.[1]) {
      const cleaned = cleanPhrase(match[1]);
      if (cleaned) {
        return cleaned;
      }
    }
  }

  return "";
}

function parseVideoSearchGoal(goal) {
  const searchIntent = extractQuotedSearchIntent(goal) || extractPatternSearchIntent(goal);
  const normalizedGoal = normalizeWhitespace(goal);

  return {
    rawGoal: normalizedGoal,
    searchIntent,
    conciseGoal: searchIntent
      ? `Search YouTube for "${searchIntent}" and play the matching official video.`
      : normalizedGoal
  };
}

function extractSearchIntent(goal) {
  return parseVideoSearchGoal(goal).searchIntent;
}

function inferGoalFamily(goal) {
  const normalized = goal.toLowerCase();
  if (/(sign up|signup|register|create.*user|new user|account)/.test(normalized)) {
    return "signup";
  }
  if (/(youtube|play.*song|play.*video|search.*youtube|premium landing page|get premium)/.test(normalized)) {
    return "video-search";
  }
  if (/(checkout|purchase|buy|credit card|cart)/.test(normalized)) {
    return "checkout";
  }
  return "generic";
}

function isLikelyYouTubeResult(element) {
  const haystack = [element.text, element.ariaLabel, element.name].join(" ").toLowerCase();
  if (!haystack || haystack.length < 8) {
    return false;
  }

  if (element.zone !== "Primary Content") {
    return false;
  }

  if (/(home|shorts|subscriptions|history|you|sign in|settings|explore|shopping)/.test(haystack)) {
    return false;
  }

  if (/\bad\b|youtube mix|mix - /.test(haystack)) {
    return false;
  }

  return element.tag === "a" || /play|watch|video/.test(haystack);
}

function scoreYouTubeResult(searchIntent, element) {
  const normalizedIntent = searchIntent.toLowerCase();
  const normalizedText = [element.text, element.ariaLabel, element.name].join(" ").toLowerCase();
  if (!normalizedText) {
    return -1;
  }

  let score = 0;
  if (normalizedText.includes(normalizedIntent)) {
    score += 6;
  }

  const tokens = normalizedIntent.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (normalizedText.includes(token)) {
      score += 1;
    }
  }

  if (/official|video|song|lyrics/.test(normalizedText)) {
    score += 1;
  }

  return score;
}

function summarizeSemanticAction(snapshot, action) {
  const target = snapshot.interactive.find((element) => element.elementId === action?.elementId) ?? null;
  if (!target) {
    return null;
  }

  return {
    elementId: target.elementId,
    label: target.text || target.ariaLabel || target.placeholder || target.name || target.id || target.tag,
    zone: target.zone,
    landmark: target.landmark,
    center: [Math.round(target.bounds.centerX), Math.round(target.bounds.centerY)]
  };
}

function heuristicPlanVideoSearch(goal, snapshot) {
  const parsedGoal = parseVideoSearchGoal(goal);

  if (/youtube\.com\/watch|youtu\.be\//i.test(snapshot.url)) {
    return {
      thinking: "Video playback page is open.",
      action: { type: "done" },
      isDone: true,
      bug: null
    };
  }

  const closeModal = matchElement(snapshot.interactive, [
    "close",
    "dismiss",
    "not now",
    "skip",
    "no thanks",
    "accept",
    "reject",
    "agree",
    "later",
    "got it"
  ]);
  if (snapshot.overlays.length && closeModal) {
    return {
      thinking: "Clearing a blocking YouTube overlay first.",
      action: { type: "click", elementId: closeModal.elementId },
      isDone: false,
      bug: null
    };
  }

  const searchIntent = parsedGoal.searchIntent;
  const searchInput = matchElement(
    snapshot.interactive,
    ["search", "what do you want to watch", "search youtube", "search query"],
    { inputOnly: true, zone: "Header" }
  );
  if (searchInput && searchIntent && searchInput.value !== searchIntent) {
    return {
      thinking: `Executing search for "${searchIntent}"`,
      landmark: "Header Zone",
      verification: "Header search input is visible and paired with the primary masthead search area.",
      action: { type: "type", elementId: searchInput.elementId, text: searchIntent, pressEnter: true },
      isDone: false,
      bug: null
    };
  }

  const firstResult = snapshot.interactive.find((element) => !element.disabled && isLikelyYouTubeResult(element));
  const rankedResult = searchIntent
    ? snapshot.interactive
        .filter((element) => !element.disabled && isLikelyYouTubeResult(element))
        .map((element) => ({
          element,
          score: scoreYouTubeResult(searchIntent, element)
        }))
        .sort((left, right) => right.score - left.score)[0]?.element ?? null
    : firstResult;
  if (rankedResult && /results\?search_query=|youtube\.com\//i.test(snapshot.url)) {
    return {
      thinking: `Selecting "${rankedResult.text}" from search results.`,
      landmark: "Primary Content Zone",
      verification: `Target matches "${rankedResult.text}" in the primary content zone and excludes sidebar, ad, and mix candidates.`,
      targetText: rankedResult.text,
      action: { type: "click", elementId: rankedResult.elementId },
      isDone: false,
      bug: null
    };
  }

  return {
    thinking: "Waiting for YouTube search UI to settle.",
    landmark: "Primary Content Zone",
    verification: "Waiting for visible video results before selecting a content card.",
    action: { type: "wait", durationMs: 1200 },
    isDone: false,
    bug: null
  };
}

function heuristicPlanSignup(snapshot) {
  const hasSignupSuccess =
    !/\bno account created\b/i.test(snapshot.bodyText) &&
    /(welcome,\s|profile is ready|registration complete|account created\b)/i.test(snapshot.bodyText);

  if (hasSignupSuccess) {
    return {
      thinking: "The page shows account creation success.",
      action: { type: "done" },
      isDone: true,
      bug: null
    };
  }

  const closeModal = matchElement(snapshot.interactive, ["close", "dismiss", "not now", "skip"]);
  if (snapshot.overlays.length && closeModal) {
    return {
      thinking: "A popup is blocking the flow, closing it first.",
      action: { type: "click", elementId: closeModal.elementId },
      isDone: false,
      bug: null
    };
  }

  const navToSignup = matchElement(snapshot.interactive, ["sign up", "signup", "create account", "register"]);
  if (navToSignup && !/signup|register/.test(snapshot.url)) {
    return {
      thinking: "The registration entrypoint is visible.",
      action: { type: "click", elementId: navToSignup.elementId },
      isDone: false,
      bug: null
    };
  }

  const nameInput = matchElement(snapshot.interactive, ["name", "full name"], { inputOnly: true });
  if (nameInput && !nameInput.value) {
    return {
      thinking: "The name field is empty.",
      action: { type: "type", elementId: nameInput.elementId, text: "Hackathon Tester" },
      isDone: false,
      bug: null
    };
  }

  const emailInput = matchElement(snapshot.interactive, ["email"], { inputOnly: true });
  if (emailInput && !emailInput.value) {
    return {
      thinking: "The email field is empty.",
      action: { type: "type", elementId: emailInput.elementId, text: "qa.agent@example.com" },
      isDone: false,
      bug: null
    };
  }

  const passwordInput = matchElement(snapshot.interactive, ["password"], { inputOnly: true });
  if (passwordInput && !passwordInput.value) {
    return {
      thinking: "The password field is empty.",
      action: { type: "type", elementId: passwordInput.elementId, text: "TestPass123!" },
      isDone: false,
      bug: null
    };
  }

  const submit =
    snapshot.interactive.find(
      (element) =>
        !element.disabled &&
        (element.tag === "button" || element.type === "submit") &&
        /create account|sign up|register|submit/i.test(element.text)
    ) ?? null;
  if (submit) {
    return {
      thinking: "The form looks ready to submit.",
      action: { type: "click", elementId: submit.elementId },
      isDone: false,
      bug: null
    };
  }

  return {
    thinking: "No registration action is obvious yet, pausing briefly.",
    action: { type: "wait", durationMs: 1200 },
    isDone: false,
    bug: null
  };
}

function heuristicPlanCheckout(snapshot) {
  const cartHasItems =
    /checkout \(([1-9]\d*)\)/i.test(snapshot.bodyText) ||
    /[1-9]\d* items in cart/i.test(snapshot.bodyText) ||
    snapshot.interactive.some((element) => /checkout \(([1-9]\d*)\)/i.test(element.text));

  if (/order placed without a credit card|thanks for your order|purchase complete|invoice approved/i.test(snapshot.bodyText)) {
    return {
      thinking: "Checkout success is visible on screen.",
      action: { type: "done" },
      isDone: true,
      bug: null
    };
  }

  const closeModal = matchElement(snapshot.interactive, ["close", "dismiss", "not now", "skip"]);
  if (snapshot.overlays.length && closeModal) {
    return {
      thinking: "A popup is obstructing the checkout controls.",
      action: { type: "click", elementId: closeModal.elementId },
      isDone: false,
      bug: null
    };
  }

  const checkout = matchElement(snapshot.interactive, ["checkout", "cart"]);
  if (checkout && cartHasItems && !/checkout/.test(snapshot.url)) {
    return {
      thinking: "Moving into the checkout flow.",
      action: { type: "click", elementId: checkout.elementId },
      isDone: false,
      bug: null
    };
  }

  const addToCart = matchElement(snapshot.interactive, ["add to cart"]);
  if (addToCart && !cartHasItems) {
    return {
      thinking: "A product can be added to the cart.",
      action: { type: "click", elementId: addToCart.elementId },
      isDone: false,
      bug: null
    };
  }

  const address = matchElement(snapshot.interactive, ["address"], { inputOnly: true });
  if (address && !address.value) {
    return {
      thinking: "Checkout requires an address before payment.",
      action: { type: "type", elementId: address.elementId, text: "221B Baker Street" },
      isDone: false,
      bug: null
    };
  }

  const reviewOrder =
    snapshot.interactive.find(
      (element) => !element.disabled && element.tag === "button" && /review order/i.test(element.text)
    ) ?? null;
  const invoice =
    snapshot.interactive.find(
      (element) =>
        !element.disabled &&
        element.tag === "button" &&
        /invoice|pay later|cash on delivery|without card/i.test(element.text)
    ) ?? null;
  if (invoice && !invoice.pressed) {
    return {
      thinking: "An alternative payment path is visible.",
      action: { type: "click", elementId: invoice.elementId },
      isDone: false,
      bug: null
    };
  }

  const placeOrder =
    snapshot.interactive.find(
      (element) =>
        !element.disabled &&
        element.tag === "button" &&
        /place order|buy now|complete order/i.test(element.text)
    ) ?? null;
  if (placeOrder && !placeOrder.disabled) {
    return {
      thinking: "The order button is enabled.",
      action: { type: "click", elementId: placeOrder.elementId },
      isDone: false,
      bug: null
    };
  }

  if (snapshot.spinnerVisible) {
    return {
      thinking: "The page is still processing the checkout review.",
      action: { type: "wait", durationMs: 1200 },
      isDone: false,
      bug: null
    };
  }

  if (reviewOrder && !snapshot.spinnerVisible) {
    return {
      thinking: "The order needs to be reviewed before final submission.",
      action: { type: "click", elementId: reviewOrder.elementId },
      isDone: false,
      bug: null
    };
  }

  return {
    thinking: "The page may need another render cycle before a checkout action is possible.",
    action: { type: "wait", durationMs: 1200 },
    isDone: false,
    bug: null
  };
}

function heuristicPlanGeneric(goal, snapshot) {
  const closeModal = matchElement(snapshot.interactive, [
    "close",
    "dismiss",
    "not now",
    "skip",
    "no thanks",
    "accept",
    "reject",
    "agree",
    "later"
  ]);
  if (snapshot.overlays.length && closeModal) {
    return {
      thinking: "Closing a blocking popup before continuing.",
      action: { type: "click", elementId: closeModal.elementId },
      isDone: false,
      bug: null
    };
  }

  const searchIntent = extractSearchIntent(goal);
  const searchInput = matchElement(
    snapshot.interactive,
    ["search", "search query", "what do you want to watch", "search youtube"],
    { inputOnly: true }
  );
  if (searchInput && searchIntent && searchInput.value !== searchIntent) {
    return {
      thinking: `Locating search bar to input "${searchIntent}".`,
      action: { type: "type", elementId: searchInput.elementId, text: searchIntent, pressEnter: true },
      isDone: false,
      bug: null
    };
  }

  const primaryButton = snapshot.interactive.find((element) => !element.disabled && ["button", "a"].includes(element.tag));
  if (primaryButton) {
    return {
      thinking: "Trying the first available primary interaction.",
      action: { type: "click", elementId: primaryButton.elementId },
      isDone: false,
      bug: null
    };
  }

  return {
    thinking: "Nothing actionable is available, waiting.",
    action: { type: "wait", durationMs: 1000 },
    isDone: false,
    bug: null
  };
}

export function createExplorerProvider() {
  const agent = config.explorerProvider === "bedrock" ? createExplorerAgent() : null;

  return {
    async plan(context) {
      const parsedGoal = parseVideoSearchGoal(context.goal);

      if (agent) {
        const response = await runExplorerAgent(agent, {
          ...context,
          parsedGoal
        });
        if (response?.action?.type) {
          return {
            ...response,
            targetText:
              response.targetText ??
              summarizeSemanticAction(context.snapshot, response.action)?.label ??
              null,
            landmark:
              response.landmark ??
              summarizeSemanticAction(context.snapshot, response.action)?.zone ??
              null,
            verification:
              response.verification ??
              summarizeSemanticAction(context.snapshot, response.action)?.landmark ??
              null
          };
        }
      }

      const family = inferGoalFamily(context.goal);
      if (family === "signup") {
        return heuristicPlanSignup(context.snapshot);
      }
      if (family === "checkout") {
        return heuristicPlanCheckout(context.snapshot);
      }
      if (family === "video-search") {
        return heuristicPlanVideoSearch(parsedGoal.conciseGoal, context.snapshot);
      }
      return heuristicPlanGeneric(context.goal, context.snapshot);
    }
  };
}
