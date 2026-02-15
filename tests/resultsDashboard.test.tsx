import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ResultsDashboard from "../components/ResultsDashboard";
import { AnalysisResult } from "../types";

const result: AnalysisResult = {
  scoreBreakdown: { baseline: 60, enhanced: 78, explanation: "Improved keyword coverage." },
  jobFitScore: 78,
  overallFeedback: "Strong overall fit.",
  improvements: [],
  optimizedResume: "Resume",
  optimizedCoverLetter: "Cover",
  languageDetected: "English",
  portfolioAdvice: "Show production case studies.",
  recruiterNotes: "Looks good.",
  evidenceSnippetWordLimit: 20,
  keywordCoverage: { matched: [], missing: [], partial: [] },
  hardRequirementsMissing: [],
  analysisTrace: {
    inputHash: "hash",
    retrievalChunkIds: ["jobDescription:0:0-120"],
    retrievalTrace: [
      {
        chunkId: "jobDescription:0:0-120",
        reason: "Prioritized job description chunk.",
      },
    ],
    modelName: "gemini-2.5-pro",
    tier: "MEDIUM",
    timestamp: "2026-02-15T00:00:00.000Z",
    retries: 0,
  },
};

describe("ResultsDashboard", () => {
  it("renders tabbed sections and technical details accordion", () => {
    render(
      <ResultsDashboard
        result={result}
        docIds={{ resume: "doc1", cover: "doc2" }}
        originalDocs={{ resume: "Original resume text", cover: "Original cover text" }}
        onReset={() => undefined}
      />
    );

    expect(screen.getByText("Must-fix")).toBeInTheDocument();
    expect(screen.getByText("ATS Coverage")).toBeInTheDocument();
    expect(screen.getByText("Rewrite Preview")).toBeInTheDocument();
    expect(screen.getByText("Technical Details")).toBeInTheDocument();
  });

  it("disables docx download until optimized document exists", () => {
    render(
      <ResultsDashboard
        result={{ ...result, optimizedResume: null }}
        docIds={{ resume: "doc1", cover: "doc2" }}
        originalDocs={{ resume: "Original resume text", cover: "Original cover text" }}
        onReset={() => undefined}
      />
    );

    expect(screen.getByRole("button", { name: "Download .docx" })).toBeDisabled();
  });
});
