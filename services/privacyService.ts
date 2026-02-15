import { ApplicationInput } from "../types";

type PiiType = "EMAIL" | "PHONE" | "STREET_ADDRESS" | "BIRTH_DATE" | "PERSONAL_ID";

interface PiiDetection {
  type: PiiType;
  value: string;
}

export interface PiiRedactionEntry {
  placeholder: string;
  original: string;
  type: PiiType;
}

export interface PiiValidationIssue {
  count: number;
  type: PiiType;
}

export interface PrivacyPreparationResult {
  redactedPreview: string;
  redactionEntries: PiiRedactionEntry[];
  sanitizedInput: ApplicationInput;
}

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_CANDIDATE_REGEX = /(?:\+?\d[\d()\s.-]{7,}\d)/g;
const STREET_ADDRESS_REGEX =
  /\b\d{1,5}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct|Place|Pl|Parkway|Pkwy)\b\.?/gi;
const BIRTH_DATE_LABELED_REGEX =
  /\b(?:date of birth|dob|born)\b(\s*[:\-]?\s*)([A-Za-z]+\s+\d{1,2},\s*\d{4}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})/gi;
const PERSONAL_ID_LABELED_REGEX =
  /\b(?:ssn|social security number|passport(?:\s*(?:no\.?|number))?|national id|id number|tax id|tin|aadhaar|driver(?:'s)? license)\b(\s*[:#-]?\s*)([A-Za-z0-9-]{4,})/gi;
const PII_PLACEHOLDER_REGEX = /\[PII_[A-Z_]+_\d+\]/g;

const TEXT_FIELDS: Array<keyof Pick<
  ApplicationInput,
  "jobDescription" | "companyInfo" | "resumeContent" | "coverLetterContent" | "portfolioLinks" | "additionalContext"
>> = [
  "jobDescription",
  "companyInfo",
  "resumeContent",
  "coverLetterContent",
  "portfolioLinks",
  "additionalContext",
];

const METRIC_FIELDS: Array<keyof ApplicationInput["metricsVault"]> = [
  "projectImpact",
  "latencyReduction",
  "costSavings",
  "usersServed",
  "uptime",
  "otherMetrics",
];

const isLikelyPhoneNumber = (value: string): boolean => {
  const trimmed = value.trim();
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length < 8 || digitsOnly.length > 15) return false;
  if (/^\d{4}\s*[-/]\s*\d{4}$/.test(trimmed)) return false;
  return true;
};

const normalizeForKey = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();

const normalizePiiKey = (type: PiiType, value: string): string => {
  if (type === "PHONE") return value.replace(/\D/g, "");
  if (type === "EMAIL") return normalizeForKey(value);
  if (type === "PERSONAL_ID") return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return normalizeForKey(value);
};

const buildPreview = (sanitizedInput: ApplicationInput): string => {
  const sections: Array<{ label: string; value: string }> = [
    { label: "Job Description", value: sanitizedInput.jobDescription },
    { label: "Company Context", value: sanitizedInput.companyInfo },
    { label: "Resume Content", value: sanitizedInput.resumeContent },
    { label: "Cover Letter Content", value: sanitizedInput.coverLetterContent },
    { label: "Portfolio Links", value: sanitizedInput.portfolioLinks },
    { label: "Additional Context", value: sanitizedInput.additionalContext },
  ];

  const metricsSummary = METRIC_FIELDS.map(field => `${field}: ${sanitizedInput.metricsVault[field] ?? ""}`).join("\n");
  sections.push({ label: "Metrics Vault", value: metricsSummary });

  const truncate = (text: string): string => {
    const normalized = text.trim();
    if (normalized.length <= 1200) return normalized;
    return `${normalized.slice(0, 1200)}\n...[truncated]`;
  };

  return sections
    .map(section => `## ${section.label}\n${truncate(section.value || "(empty)")}`)
    .join("\n\n");
};

const createRedactor = () => {
  const counters: Record<PiiType, number> = {
    EMAIL: 0,
    PHONE: 0,
    STREET_ADDRESS: 0,
    BIRTH_DATE: 0,
    PERSONAL_ID: 0,
  };

  const keyToPlaceholder = new Map<string, string>();
  const placeholderToOriginal = new Map<string, { original: string; type: PiiType }>();

  const register = (value: string, type: PiiType): string => {
    const normalized = normalizePiiKey(type, value);
    const key = `${type}:${normalized}`;
    const existing = keyToPlaceholder.get(key);
    if (existing) return existing;

    counters[type] += 1;
    const placeholder = `[PII_${type}_${counters[type]}]`;
    keyToPlaceholder.set(key, placeholder);
    placeholderToOriginal.set(placeholder, { original: value, type });
    return placeholder;
  };

  const entries = (): PiiRedactionEntry[] =>
    Array.from(placeholderToOriginal.entries()).map(([placeholder, record]) => ({
      placeholder,
      original: record.original,
      type: record.type,
    }));

  return { entries, register };
};

const applyPiiRedaction = (
  text: string,
  register: (value: string, type: PiiType) => string
): string => {
  let redacted = text;

  redacted = redacted.replace(EMAIL_REGEX, value => register(value, "EMAIL"));

  redacted = redacted.replace(BIRTH_DATE_LABELED_REGEX, (full, _sep: string, birthDate: string) =>
    full.replace(birthDate, register(birthDate, "BIRTH_DATE"))
  );

  redacted = redacted.replace(PERSONAL_ID_LABELED_REGEX, (full, sep: string, idValue: string) => {
    const placeholder = register(idValue, "PERSONAL_ID");
    return full.replace(`${sep}${idValue}`, `${sep}${placeholder}`);
  });

  redacted = redacted.replace(PHONE_CANDIDATE_REGEX, candidate => {
    if (!isLikelyPhoneNumber(candidate)) return candidate;
    return register(candidate, "PHONE");
  });

  redacted = redacted.replace(STREET_ADDRESS_REGEX, value => register(value, "STREET_ADDRESS"));

  return redacted;
};

export const prepareApplicationForGemini = (input: ApplicationInput): PrivacyPreparationResult => {
  if (!input.privacyMode) {
    return {
      sanitizedInput: input,
      redactionEntries: [],
      redactedPreview: buildPreview(input),
    };
  }

  const redactor = createRedactor();
  const sanitizedInput: ApplicationInput = {
    ...input,
    metricsVault: { ...input.metricsVault },
  };

  for (const field of TEXT_FIELDS) {
    sanitizedInput[field] = applyPiiRedaction(sanitizedInput[field], redactor.register);
  }

  for (const field of METRIC_FIELDS) {
    const value = sanitizedInput.metricsVault[field];
    if (typeof value !== "string" || value.length === 0) continue;
    sanitizedInput.metricsVault[field] = applyPiiRedaction(value, redactor.register);
  }

  return {
    sanitizedInput,
    redactionEntries: redactor.entries(),
    redactedPreview: buildPreview(sanitizedInput),
  };
};

export const reinsertRedactedPii = (text: string | null, entries: PiiRedactionEntry[]): string | null => {
  if (text === null) return null;

  let restored = text;
  for (const entry of entries) {
    restored = restored.split(entry.placeholder).join(entry.original);
  }
  return restored;
};

const detectPii = (text: string): PiiDetection[] => {
  const detections: PiiDetection[] = [];

  for (const match of text.match(EMAIL_REGEX) ?? []) {
    detections.push({ type: "EMAIL", value: match });
  }

  for (const match of text.match(PHONE_CANDIDATE_REGEX) ?? []) {
    if (isLikelyPhoneNumber(match)) detections.push({ type: "PHONE", value: match });
  }

  for (const match of text.match(STREET_ADDRESS_REGEX) ?? []) {
    detections.push({ type: "STREET_ADDRESS", value: match });
  }

  for (const match of text.matchAll(BIRTH_DATE_LABELED_REGEX)) {
    const birthDate = match[2];
    if (birthDate) detections.push({ type: "BIRTH_DATE", value: birthDate });
  }

  for (const match of text.matchAll(PERSONAL_ID_LABELED_REGEX)) {
    const idValue = match[2];
    if (idValue) detections.push({ type: "PERSONAL_ID", value: idValue });
  }

  return detections;
};

export const findUnauthorizedPii = (text: string, entries: PiiRedactionEntry[]): PiiValidationIssue[] => {
  const allowed = new Set(entries.map(entry => `${entry.type}:${normalizePiiKey(entry.type, entry.original)}`));
  const counts = new Map<PiiType, number>();
  const detections = detectPii(text);

  for (const detection of detections) {
    const key = `${detection.type}:${normalizePiiKey(detection.type, detection.value)}`;
    if (allowed.has(key)) continue;
    counts.set(detection.type, (counts.get(detection.type) ?? 0) + 1);
  }

  return Array.from(counts.entries()).map(([type, count]) => ({ type, count }));
};

export const findUnresolvedPiiPlaceholders = (text: string, entries: PiiRedactionEntry[]): string[] => {
  const known = new Set(entries.map(entry => entry.placeholder));
  const found = text.match(PII_PLACEHOLDER_REGEX) ?? [];
  const unresolved = found.filter(token => !known.has(token));
  return Array.from(new Set(unresolved));
};
