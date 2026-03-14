import { hashText } from "../../lib/utils.js";

function normalizeText(value = "") {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function toLower(value = "") {
  return normalizeText(value).toLowerCase();
}

function clampConfidence(value, min = 0.05, max = 0.99) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }
  return Math.min(Math.max(number, min), max);
}

function fieldLabel(control = {}) {
  return (
    normalizeText(control.labelText) ||
    normalizeText(control.placeholder) ||
    normalizeText(control.ariaLabel) ||
    normalizeText(control.name) ||
    normalizeText(control.type) ||
    "Input"
  );
}

function fieldType(control = {}) {
  const explicit = toLower(control.type);
  if (explicit) {
    return explicit;
  }
  return toLower(control.tag) || "text";
}

function purposeFromSignals(signals = "", title = "", url = "") {
  const text = [signals, title, url].join(" ").toLowerCase();

  if (/\b(search|query|find|lookup)\b/.test(text)) {
    return {
      purpose: "Search form",
      confidence: 0.95
    };
  }
  if (/\b(log ?in|login|sign in|username|password|access key|account id)\b/.test(text)) {
    return {
      purpose: "Authentication form",
      confidence: 0.94
    };
  }
  if (/\b(otp|one[- ]time|verification code|2fa|two[- ]factor)\b/.test(text)) {
    return {
      purpose: "Verification code form",
      confidence: 0.93
    };
  }
  if (/\b(checkout|billing|payment|card|cvv|invoice|place order)\b/.test(text)) {
    return {
      purpose: "Checkout or payment form",
      confidence: 0.9
    };
  }
  if (/\b(contact|support|feedback|message|help)\b/.test(text)) {
    return {
      purpose: "Contact or support form",
      confidence: 0.86
    };
  }
  if (/\b(register|sign up|signup|create account|join)\b/.test(text)) {
    return {
      purpose: "Registration form",
      confidence: 0.88
    };
  }

  return {
    purpose: "General data entry form",
    confidence: 0.72
  };
}

function distanceBetween(a = {}, b = {}) {
  const ax = Number(a.centerX ?? a.x ?? 0);
  const ay = Number(a.centerY ?? a.y ?? 0);
  const bx = Number(b.centerX ?? b.x ?? 0);
  const by = Number(b.centerY ?? b.y ?? 0);
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function submitLikeEntry(entry = {}) {
  if (entry?.disabled) {
    return false;
  }
  const tag = toLower(entry.tag);
  const type = toLower(entry.type);
  const text = toLower([entry.text, entry.ariaLabel, entry.placeholder, entry.name].join(" "));
  if (tag === "input" && ["submit", "button"].includes(type)) {
    return true;
  }
  if (!["button", "a", "input"].includes(tag)) {
    return false;
  }
  return /\b(submit|save|continue|next|go|search|send|apply|login|sign in|verify|confirm)\b/.test(text);
}

function resolveGroupSubmitControl(groupControls = [], interactive = []) {
  if (!groupControls.length || !interactive.length) {
    return null;
  }

  const controlsWithBounds = groupControls.filter((control) => control?.bounds);
  const averageBounds = controlsWithBounds.length
    ? controlsWithBounds.reduce(
        (accumulator, control) => ({
          centerX: accumulator.centerX + Number(control.bounds?.centerX ?? control.bounds?.x ?? 0),
          centerY: accumulator.centerY + Number(control.bounds?.centerY ?? control.bounds?.y ?? 0)
        }),
        { centerX: 0, centerY: 0 }
      )
    : null;
  const groupCenter = averageBounds
    ? {
        centerX: averageBounds.centerX / controlsWithBounds.length,
        centerY: averageBounds.centerY / controlsWithBounds.length
      }
    : null;

  const candidates = interactive
    .filter((entry) => submitLikeEntry(entry))
    .map((entry) => {
      const text = toLower([entry.text, entry.ariaLabel, entry.placeholder, entry.name].join(" "));
      let score = 0.6;
      if (/\b(submit|save|send|confirm|continue|next)\b/.test(text)) {
        score += 0.2;
      }
      if (/\b(search|go|apply)\b/.test(text)) {
        score += 0.1;
      }
      if (groupCenter && entry?.bounds) {
        const distance = distanceBetween(groupCenter, entry.bounds);
        if (distance <= 260) {
          score += 0.1;
        } else if (distance > 520) {
          score -= 0.15;
        }
      }
      return {
        entry,
        score
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return String(left.entry?.elementId ?? "").localeCompare(String(right.entry?.elementId ?? ""));
    });

  return candidates[0]?.entry ?? null;
}

function buildGroupKey(control = {}, index = 0) {
  const formSelector = normalizeText(control.formSelector);
  if (formSelector) {
    return `form:${formSelector}`;
  }

  const nearestHeading = normalizeText(control.nearestHeading);
  if (nearestHeading) {
    return `heading:${nearestHeading.toLowerCase()}`;
  }

  const bounds = control.bounds ?? {};
  const y = Number(bounds.y ?? 0);
  const x = Number(bounds.x ?? 0);
  const verticalBucket = Math.floor(y / 260);
  const horizontalBucket = Math.floor(x / 380);
  return `bucket:${verticalBucket}:${horizontalBucket}:${index}`;
}

function sortableField(left = {}, right = {}) {
  const leftY = Number(left.bounds?.y ?? 0);
  const rightY = Number(right.bounds?.y ?? 0);
  if (leftY !== rightY) {
    return leftY - rightY;
  }
  const leftX = Number(left.bounds?.x ?? 0);
  const rightX = Number(right.bounds?.x ?? 0);
  if (leftX !== rightX) {
    return leftX - rightX;
  }
  return String(left.selector ?? "").localeCompare(String(right.selector ?? ""));
}

function uniqueBy(items = [], selector) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = selector(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function buildGroupDescription({ controls = [], snapshot = {}, fallbackName = "" }) {
  const labels = controls
    .map((control) => fieldLabel(control))
    .filter(Boolean)
    .slice(0, 6);
  const signalText = [
    fallbackName,
    ...labels,
    ...(controls.map((control) => normalizeText(control.nearestHeading)).filter(Boolean))
  ].join(" ");
  const purpose = purposeFromSignals(signalText, snapshot?.title, snapshot?.url);
  const lead = fallbackName ? `${fallbackName}: ` : "";
  const fieldPreview = labels.length ? `Fields: ${labels.join(", ")}.` : "Fields are visible but not fully labeled.";
  return {
    purpose: purpose.purpose,
    confidence: purpose.confidence,
    description: `${lead}${purpose.purpose}. ${fieldPreview}`.trim()
  };
}

export function deriveFunctionalFormGroups(snapshot = {}) {
  const formControls = Array.isArray(snapshot?.formControls) ? snapshot.formControls : [];
  if (!formControls.length) {
    return [];
  }

  const interactive = Array.isArray(snapshot?.interactive) ? snapshot.interactive : [];
  const interactiveBySelector = new Map(
    interactive
      .filter((entry) => entry?.selector)
      .map((entry) => [entry.selector, entry])
  );

  const groupsByKey = new Map();
  for (let index = 0; index < formControls.length; index += 1) {
    const control = formControls[index];
    if (!control?.selector) {
      continue;
    }
    const key = buildGroupKey(control, index);
    if (!groupsByKey.has(key)) {
      groupsByKey.set(key, []);
    }
    groupsByKey.get(key).push(control);
  }

  const groups = [];
  for (const [groupKey, controls] of groupsByKey.entries()) {
    const sortedControls = [...controls].sort(sortableField);
    const fallbackName =
      normalizeText(sortedControls[0]?.formName) ||
      normalizeText(sortedControls[0]?.nearestHeading) ||
      "";
    const description = buildGroupDescription({
      controls: sortedControls,
      snapshot,
      fallbackName
    });
    const submitControl = resolveGroupSubmitControl(sortedControls, interactive);

    const fields = uniqueBy(
      sortedControls.map((control, fieldIndex) => {
        const linkedInteractive = interactiveBySelector.get(control.selector);
        const label = fieldLabel(control);
        const normalizedType = fieldType(control);
        const fieldId = `field_${hashText(`${groupKey}:${control.selector}:${fieldIndex}`)}`;
        return {
          fieldId,
          selector: control.selector,
          tag: toLower(control.tag || linkedInteractive?.tag || "input") || "input",
          type: normalizedType,
          name: normalizeText(control.name || linkedInteractive?.name || ""),
          label,
          placeholder: normalizeText(control.placeholder || linkedInteractive?.placeholder || ""),
          ariaLabel: normalizeText(control.ariaLabel || linkedInteractive?.ariaLabel || ""),
          required: Boolean(control.requiredAttr || control.ariaRequired),
          formSelector: normalizeText(control.formSelector || ""),
          formName: normalizeText(control.formName || ""),
          nearestHeading: normalizeText(control.nearestHeading || ""),
          bounds: control.bounds ?? null,
          options: Array.isArray(control.options) ? control.options.slice(0, 12) : []
        };
      }),
      (field) => field.selector
    );

    const groupId = `form_${hashText(`${groupKey}:${fields.map((field) => field.selector).join("|")}`)}`;
    groups.push({
      groupId,
      key: groupKey,
      purpose: description.purpose,
      purposeConfidence: clampConfidence(description.confidence),
      description: description.description,
      originalDescription: description.description,
      pageUrl: snapshot?.url ?? "",
      formSelector: normalizeText(sortedControls[0]?.formSelector || ""),
      formName: normalizeText(sortedControls[0]?.formName || ""),
      nearestHeading: normalizeText(sortedControls[0]?.nearestHeading || ""),
      submitElementId: submitControl?.elementId ?? null,
      submitSelector: submitControl?.selector ?? null,
      submitLabel: normalizeText(
        submitControl?.text || submitControl?.ariaLabel || submitControl?.placeholder || submitControl?.name || ""
      ),
      fields
    });
  }

  return groups
    .filter((group) => group.fields.length > 0)
    .sort((left, right) => {
      const leftY = Number(left?.fields?.[0]?.bounds?.y ?? 0);
      const rightY = Number(right?.fields?.[0]?.bounds?.y ?? 0);
      if (leftY !== rightY) {
        return leftY - rightY;
      }
      return String(left.groupId).localeCompare(String(right.groupId));
    });
}

export function buildFunctionalFormDocs(groups = []) {
  return groups.map((group) => ({
    groupId: group.groupId,
    purpose: group.purpose,
    description: group.description,
    submitLabel: group.submitLabel || null,
    fieldCount: group.fields.length,
      fields: group.fields.map((field) => ({
        fieldId: field.fieldId,
        label: field.label,
        type: field.type,
        required: Boolean(field.required),
      placeholder: field.placeholder || null
    }))
  }));
}
