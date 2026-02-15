import { AnalysisResult } from "../types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === "string");

const isRetrievalTraceArray = (value: unknown): value is Array<{ chunkId: string; reason: string }> =>
  Array.isArray(value) &&
  value.every(
    entry =>
      typeof entry === "object" &&
      entry !== null &&
      !Array.isArray(entry) &&
      typeof (entry as { chunkId?: unknown }).chunkId === "string" &&
      typeof (entry as { reason?: unknown }).reason === "string"
  );

const isNullableNumber = (value: unknown): boolean => value === null || typeof value === "number";

const isNullableString = (value: unknown): boolean => value === null || typeof value === "string";

export const validateAnalysisResultSchema = (value: unknown): ValidationResult => {
  const errors: string[] = [];

  if (!isObject(value)) {
    return { valid: false, errors: ["Result must be an object."] };
  }

  const result = value as Partial<AnalysisResult> & Record<string, unknown>;

  if (!isObject(result.scoreBreakdown)) {
    errors.push("scoreBreakdown is required and must be an object.");
  } else {
    if (!isNullableNumber(result.scoreBreakdown.baseline)) errors.push("scoreBreakdown.baseline must be number|null.");
    if (!isNullableNumber(result.scoreBreakdown.enhanced)) errors.push("scoreBreakdown.enhanced must be number|null.");
    if (!isNullableString(result.scoreBreakdown.explanation)) errors.push("scoreBreakdown.explanation must be string|null.");
  }

  if (!isNullableNumber(result.jobFitScore)) errors.push("jobFitScore must be number|null.");
  if (!isNullableString(result.overallFeedback)) errors.push("overallFeedback must be string|null.");
  if (!isNullableString(result.optimizedResume)) errors.push("optimizedResume must be string|null.");
  if (!isNullableString(result.optimizedCoverLetter)) errors.push("optimizedCoverLetter must be string|null.");
  if (!isNullableString(result.portfolioAdvice)) errors.push("portfolioAdvice must be string|null.");
  if (!isNullableString(result.recruiterNotes)) errors.push("recruiterNotes must be string|null.");
  if (typeof result.evidenceSnippetWordLimit !== "number") errors.push("evidenceSnippetWordLimit must be a number.");

  if (!isObject(result.keywordCoverage)) {
    errors.push("keywordCoverage is required and must be an object.");
  } else {
    if (!isStringArray(result.keywordCoverage.matched)) errors.push("keywordCoverage.matched must be string[].");
    if (!isStringArray(result.keywordCoverage.missing)) errors.push("keywordCoverage.missing must be string[].");
    if (!isStringArray(result.keywordCoverage.partial)) errors.push("keywordCoverage.partial must be string[].");
  }

  if (!isStringArray(result.hardRequirementsMissing)) {
    errors.push("hardRequirementsMissing must be string[].");
  }

  if (!Array.isArray(result.improvements)) {
    errors.push("improvements must be an array.");
  } else {
    result.improvements.forEach((improvement, index) => {
      if (!isObject(improvement)) {
        errors.push(`improvements[${index}] must be an object.`);
        return;
      }
      if (!isNullableString(improvement.point)) errors.push(`improvements[${index}].point must be string|null.`);
      if (improvement.category !== "critical" && improvement.category !== "optional") {
        errors.push(`improvements[${index}].category must be "critical"|"optional".`);
      }
      if (!isNullableString(improvement.impact)) errors.push(`improvements[${index}].impact must be string|null.`);
      if (!isObject(improvement.evidence)) {
        errors.push(`improvements[${index}].evidence must be an object.`);
      } else {
        if (!isStringArray(improvement.evidence.resumeQuotes)) {
          errors.push(`improvements[${index}].evidence.resumeQuotes must be string[].`);
        }
        if (!isStringArray(improvement.evidence.jdQuotes)) {
          errors.push(`improvements[${index}].evidence.jdQuotes must be string[].`);
        }
        if (!isStringArray(improvement.evidence.missingKeywords)) {
          errors.push(`improvements[${index}].evidence.missingKeywords must be string[].`);
        }
      }
    });
  }

  if (!isObject(result.analysisTrace)) {
    errors.push("analysisTrace is required and must be an object.");
  } else {
    if (typeof result.analysisTrace.inputHash !== "string") errors.push("analysisTrace.inputHash must be string.");
    if (!isStringArray(result.analysisTrace.retrievalChunkIds)) {
      errors.push("analysisTrace.retrievalChunkIds must be string[].");
    }
    if (!isRetrievalTraceArray(result.analysisTrace.retrievalTrace)) {
      errors.push("analysisTrace.retrievalTrace must be { chunkId: string; reason: string }[].");
    }
    if (typeof result.analysisTrace.modelName !== "string") errors.push("analysisTrace.modelName must be string.");
    if (typeof result.analysisTrace.tier !== "string") errors.push("analysisTrace.tier must be string.");
    if (typeof result.analysisTrace.timestamp !== "string") errors.push("analysisTrace.timestamp must be string.");
    if (typeof result.analysisTrace.retries !== "number") errors.push("analysisTrace.retries must be number.");
  }

  return { valid: errors.length === 0, errors };
};
