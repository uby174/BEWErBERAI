import { validateAnalysisResultSchema } from "../services/analysisSchemaService";
import { parseJdRequirements } from "../services/atsCoverageService";
import { extractNormalizedNumberTokens } from "../services/metricsGuardService";
import { AnalysisMode, AnalysisResult, ApplicationInput } from "../types";

export interface EvalAssertionResult {
  name: string;
  pass: boolean;
  details?: string;
}

export interface EvalAssertionInput {
  fixtureId: string;
  tier: AnalysisMode;
  input: ApplicationInput;
  result: AnalysisResult;
  outboundStagePrompts: Record<"extractFacts" | "scoreMatch" | "rewriteDocs", string[]>;
}

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_REGEX = /(?:\+?\d[\d()\s.-]{7,}\d)/g;
const ADDRESS_REGEX =
  /\b\d{1,5}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct|Place|Pl|Parkway|Pkwy)\b\.?/gi;
const DATE_REGEX = /\b(?:19|20)\d{2}\b|\b(?:19|20)\d{2}\s*-\s*(?:19|20)\d{2}\b|\b\d{1,2}[\/.-]\d{1,2}[\/.-](?:19|20)?\d{2}\b/g;
const COMPANY_AT_REGEX = /\bat\s+([A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,3})/g;
const COMPANY_SUFFIX_REGEX =
  /\b([A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,3}\s(?:Inc|LLC|Ltd|GmbH|Corp|Corporation|Company|Technologies|Labs|Systems))\b/g;

const wordCount = (value: string): number =>
  value
    .trim()
    .split(/\s+/g)
    .filter(Boolean).length;

const unique = (items: string[]): string[] => Array.from(new Set(items));

const normalize = (value: string): string => value.toLowerCase().replace(/\s+/g, " ").trim();

const isLikelyPhoneNumber = (value: string): boolean => {
  const trimmed = value.trim();
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length < 8 || digitsOnly.length > 15) return false;
  if (/^\d{4}\s*[-/]\s*\d{4}$/.test(trimmed)) return false;
  return true;
};

const buildAssertion = (name: string, pass: boolean, details?: string): EvalAssertionResult => ({
  name,
  pass,
  details,
});

const hasAnyMetrics = (input: ApplicationInput): boolean =>
  Object.values(input.metricsVault ?? {}).some(value => typeof value === "string" && value.trim().length > 0);

const collectCompanies = (text: string): string[] => {
  const fromAt = Array.from(text.matchAll(COMPANY_AT_REGEX)).map(match => (match[1] ?? "").trim());
  const fromSuffix = Array.from(text.matchAll(COMPANY_SUFFIX_REGEX)).map(match => (match[1] ?? "").trim());
  return unique([...fromAt, ...fromSuffix].filter(Boolean));
};

const detectLikelyMissingHardRequirement = (jobDescription: string, resumeContent: string): boolean => {
  const parsed = parseJdRequirements(jobDescription);
  const resume = normalize(resumeContent);
  const stopwords = new Set([
    "must",
    "required",
    "requirement",
    "have",
    "with",
    "and",
    "the",
    "for",
    "you",
    "will",
    "need",
    "years",
    "year",
    "experience",
    "minimum",
  ]);

  return parsed.hardRequirements.some(requirement => {
    const tokens = (requirement.toLowerCase().match(/[a-z0-9+#.]{3,}/g) ?? []).filter(token => !stopwords.has(token));
    if (tokens.length === 0) return false;
    const matched = tokens.filter(token => resume.includes(token)).length;
    return matched / tokens.length < 0.6;
  });
};

const getOutboundPrompt = (stagePrompts: EvalAssertionInput["outboundStagePrompts"]): string =>
  stagePrompts.extractFacts[0] ?? "";

const collectPiiValues = (input: ApplicationInput): string[] => {
  const source = `${input.resumeContent}\n${input.coverLetterContent}`;
  const emails = source.match(EMAIL_REGEX) ?? [];
  const phones = (source.match(PHONE_REGEX) ?? []).filter(isLikelyPhoneNumber);
  const addresses = source.match(ADDRESS_REGEX) ?? [];
  return unique([...emails, ...phones, ...addresses].map(item => item.trim()));
};

export const runAssertions = (payload: EvalAssertionInput): EvalAssertionResult[] => {
  const { input, result, outboundStagePrompts } = payload;
  const outputText = `${result.optimizedResume ?? ""}\n${result.optimizedCoverLetter ?? ""}`;
  const results: EvalAssertionResult[] = [];

  const schema = validateAnalysisResultSchema(result);
  results.push(
    buildAssertion(
      "schema validation for AnalysisResult",
      schema.valid,
      schema.valid ? undefined : schema.errors.join(" | ")
    )
  );

  const tooLongSnippets: string[] = [];
  result.improvements.forEach((improvement, index) => {
    const buckets = [
      ...improvement.evidence.resumeQuotes,
      ...improvement.evidence.jdQuotes,
      ...improvement.evidence.missingKeywords,
    ];
    buckets.forEach((snippet, snippetIndex) => {
      if (wordCount(snippet) > 20) {
        tooLongSnippets.push(`improvements[${index}] snippet[${snippetIndex}] exceeds 20 words`);
      }
    });
  });
  results.push(
    buildAssertion(
      "every improvement has evidence snippets <= 20 words",
      tooLongSnippets.length === 0,
      tooLongSnippets.join("; ")
    )
  );

  if (!hasAnyMetrics(input)) {
    const outputNumbers = unique(extractNormalizedNumberTokens(outputText));
    const inputNumbers = new Set(
      extractNormalizedNumberTokens(
        `${input.resumeContent}\n${input.coverLetterContent}\n${input.jobDescription}\n${input.companyInfo}\n${input.additionalContext}`
      )
    );
    const unauthorized = outputNumbers.filter(token => !inputNumbers.has(token));
    results.push(
      buildAssertion(
        "if metricsVault is empty, output has no numeric claims unless present in inputs",
        unauthorized.length === 0,
        unauthorized.length > 0 ? `Unauthorized numbers: ${unauthorized.join(", ")}` : undefined
      )
    );
  } else {
    results.push(buildAssertion("if metricsVault is empty, output has no numeric claims unless present in inputs", true));
  }

  const resumeNormalized = normalize(input.resumeContent);
  const outputCompanies = collectCompanies(outputText);
  const outputDates = unique(outputText.match(DATE_REGEX) ?? []);
  const unknownCompanies = outputCompanies.filter(company => !resumeNormalized.includes(normalize(company)));
  const unknownDates = outputDates.filter(date => !resumeNormalized.includes(normalize(date)));
  results.push(
    buildAssertion(
      "companies/dates in output must be present in resume input",
      unknownCompanies.length === 0 && unknownDates.length === 0,
      [
        unknownCompanies.length > 0 ? `Unknown companies: ${unknownCompanies.join(", ")}` : "",
        unknownDates.length > 0 ? `Unknown dates: ${unknownDates.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" | ")
    )
  );

  const jdHasHardRequirements = parseJdRequirements(input.jobDescription).hardRequirements.length > 0;
  const likelyMissingHardRequirement = detectLikelyMissingHardRequirement(input.jobDescription, input.resumeContent);
  const missingPopulated = !jdHasHardRequirements || !likelyMissingHardRequirement || result.hardRequirementsMissing.length > 0;
  results.push(
    buildAssertion(
      "missing hard requirements must be populated when JD demands them",
      missingPopulated,
      missingPopulated ? undefined : "Expected hardRequirementsMissing to be non-empty."
    )
  );

  if (input.privacyMode) {
    const outboundPrompt = getOutboundPrompt(outboundStagePrompts);
    const piiValues = collectPiiValues(input);
    const leakedValues = piiValues.filter(value => outboundPrompt.includes(value));
    const hasPlaceholders = /\[PII_[A-Z_]+_\d+\]/.test(outboundPrompt);
    results.push(
      buildAssertion(
        "privacy mode redacts email/phone/address before model call",
        leakedValues.length === 0 && hasPlaceholders,
        leakedValues.length > 0
          ? `Found raw PII in outbound payload: ${leakedValues.join(", ")}`
          : hasPlaceholders
            ? undefined
            : "No redaction placeholders found in outbound payload."
      )
    );
  } else {
    results.push(buildAssertion("privacy mode redacts email/phone/address before model call", true));
  }

  const trace = result.analysisTrace.retrievalTrace ?? [];
  const traceHasReasons =
    trace.length > 0 &&
    trace.every(entry => typeof entry.chunkId === "string" && entry.chunkId.length > 0 && typeof entry.reason === "string" && entry.reason.length > 0) &&
    trace.every(entry => result.analysisTrace.retrievalChunkIds.includes(entry.chunkId));
  results.push(
    buildAssertion(
      "retrievalTrace includes chunk ids and reasons",
      traceHasReasons,
      traceHasReasons ? undefined : "analysisTrace.retrievalTrace is missing entries or reasons."
    )
  );

  return results;
};
