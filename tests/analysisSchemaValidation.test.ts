import { describe, expect, it } from "vitest";
import { validateAnalysisResultSchema } from "../services/analysisSchemaService";
import { AnalysisResult } from "../types";

const validResult: AnalysisResult = {
  scoreBreakdown: {
    baseline: 62,
    enhanced: 79,
    explanation: "Keyword and requirement coverage improved.",
  },
  jobFitScore: 79,
  overallFeedback: "Good alignment with role requirements.",
  improvements: [
    {
      point: "Add production-grade ML deployment evidence.",
      category: "critical",
      impact: "Stronger ATS relevance.",
      evidence: {
        resumeQuotes: ["Built ML pipelines in Python and SQL"],
        jdQuotes: ["Experience deploying ML models to production"],
        missingKeywords: ["MLOps", "CI/CD"],
      },
    },
  ],
  optimizedResume: "Optimized resume body",
  optimizedCoverLetter: "Optimized cover letter body",
  languageDetected: "English",
  portfolioAdvice: "Highlight production repositories.",
  recruiterNotes: "Use stronger impact framing.",
  evidenceSnippetWordLimit: 20,
  keywordCoverage: {
    matched: ["python", "sql"],
    missing: ["mlops"],
    partial: [],
  },
  hardRequirementsMissing: ["3+ years MLOps"],
  analysisTrace: {
    inputHash: "abc123",
    retrievalChunkIds: ["resumeContent:0:0-120"],
    retrievalTrace: [
      {
        chunkId: "resumeContent:0:0-120",
        reason: "Prioritized resume chunk for deterministic relevance.",
      },
    ],
    modelName: "gemini-2.5-pro",
    tier: "MEDIUM",
    timestamp: "2026-02-15T12:00:00.000Z",
    retries: 1,
  },
};

describe("AnalysisResult schema validation", () => {
  it("accepts a valid AnalysisResult", () => {
    const validation = validateAnalysisResultSchema(validResult);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("rejects malformed payloads", () => {
    const invalid = { ...validResult, analysisTrace: { ...validResult.analysisTrace, retries: "one" } };
    const validation = validateAnalysisResultSchema(invalid);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(error => error.includes("analysisTrace.retries"))).toBe(true);
  });
});
