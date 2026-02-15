import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateAnalysisResultSchema } from "../services/analysisSchemaService";
import { computeAtsCoverage, parseJdRequirements, ResumeFactsForCoverage } from "../services/atsCoverageService";
import { selectTier } from "../services/geminiService";
import { findUnauthorizedNumbersForRewrite } from "../services/metricsGuardService";
import { prepareApplicationForGemini } from "../services/privacyService";
import { selectRetrievalChunkIds } from "../services/retrievalService";
import { AnalysisResult, ApplicationInput, MetricsVault } from "../types";

const GOLDEN_DIR = path.resolve(process.cwd(), "tests", "golden");

const readGolden = (fileName: string): string =>
  readFileSync(path.join(GOLDEN_DIR, fileName), "utf8").trim();

const buildResumeFacts = (caseId: "case-1" | "case-2"): ResumeFactsForCoverage => {
  if (caseId === "case-1") {
    return {
      skills: ["Python", "SQL", "AWS", "Airflow", "Docker", "Scikit-learn"],
      experience: [
        {
          employer: "DataCore GmbH",
          role: "Senior Data Scientist",
          startDate: "2021",
          endDate: "2025",
          achievements: [
            "Built production ML pipelines in Python and SQL on AWS.",
            "Reduced p95 inference latency by 120 ms.",
            "Improved conversion by 18% in ranking experiments.",
          ],
        },
      ],
      achievements: ["Reduced p95 inference latency by 120 ms.", "Improved conversion by 18%."],
      education: ["M.Sc. Computer Science, TU Berlin"],
      certifications: [],
    };
  }

  return {
    skills: ["React", "TypeScript", "Node.js", "GraphQL", "Jest", "Cypress", "Figma"],
    experience: [
      {
        employer: "Nimbus Apps",
        role: "Frontend Engineer",
        startDate: "2022",
        endDate: "2025",
        achievements: [
          "Built React + TypeScript analytics dashboard for 120000 monthly users.",
          "Improved Lighthouse score from 68 to 91.",
          "Shipped Node.js APIs with backend engineers.",
        ],
      },
    ],
    achievements: ["Improved Lighthouse score from 68 to 91."],
    education: ["B.E. Information Technology, Anna University"],
    certifications: [],
  };
};

const buildMetricsVault = (caseId: "case-1" | "case-2"): MetricsVault => {
  if (caseId === "case-1") {
    return {
      projectImpact: "18%",
      latencyReduction: "120 ms",
      usersServed: "25000 users",
    };
  }

  return {
    projectImpact: "Lighthouse score 91",
    usersServed: "120000 monthly users",
    uptime: "99.9%",
  };
};

const buildInput = (caseId: "case-1" | "case-2", resumeContent: string, jobDescription: string): ApplicationInput => ({
  jobDescription,
  companyInfo: caseId === "case-1" ? "Berlin, Germany. Product ML team." : "Remote USA SaaS company.",
  resumeContent,
  coverLetterContent:
    caseId === "case-1"
      ? "I delivered improved ranking quality and partnered with product stakeholders."
      : "I focus on accessibility, performance, and reliable frontend delivery.",
  portfolioLinks:
    caseId === "case-1"
      ? "https://github.com/alex-ml"
      : "https://github.com/priya-ui",
  additionalContext:
    caseId === "case-1"
      ? "Highlight production ML deployment outcomes."
      : "Balanced analysis for full stack role.",
  analysisMode: "balanced",
  privacyMode: true,
  metricsVault: buildMetricsVault(caseId),
});

const buildSchemaProbe = (
  coverage: ReturnType<typeof computeAtsCoverage>,
  retrievalChunkIds: string[],
  tier: string
): AnalysisResult => ({
  scoreBreakdown: {
    baseline: 60,
    enhanced: 75,
    explanation: "Deterministic schema probe.",
  },
  jobFitScore: 75,
  overallFeedback: "Deterministic output for snapshot validation.",
  improvements: [
    {
      point: "Add one clearer must-have requirement match.",
      category: "critical",
      impact: "Improves ATS fit clarity.",
      evidence: {
        resumeQuotes: ["Built production ML pipelines in Python and SQL on AWS."],
        jdQuotes: ["Required: Python, SQL, AWS."],
        missingKeywords: coverage.keywordCoverage.missing.slice(0, 3),
      },
    },
  ],
  optimizedResume: "N/A",
  optimizedCoverLetter: "N/A",
  languageDetected: "English",
  portfolioAdvice: "N/A",
  recruiterNotes: "N/A",
  evidenceSnippetWordLimit: 20,
  keywordCoverage: coverage.keywordCoverage,
  hardRequirementsMissing: coverage.hardRequirementsMissing,
  analysisTrace: {
    inputHash: "test-hash",
    retrievalChunkIds,
    retrievalTrace: retrievalChunkIds.map(chunkId => ({
      chunkId,
      reason: "Deterministic retrieval trace probe.",
    })),
    modelName: "test-model",
    tier,
    timestamp: "2026-02-15T00:00:00.000Z",
    retries: 0,
  },
});

describe("golden structured outputs", () => {
  it("matches deterministic snapshots for two golden fixtures", () => {
    const fixtures = [
      { id: "case-1" as const, resumeFile: "case-1.resume.txt", jdFile: "case-1.jd.txt" },
      { id: "case-2" as const, resumeFile: "case-2.resume.txt", jdFile: "case-2.jd.txt" },
    ];

    const outputs = fixtures.map(fixture => {
      const resume = readGolden(fixture.resumeFile);
      const jd = readGolden(fixture.jdFile);
      const input = buildInput(fixture.id, resume, jd);

      const parsedJd = parseJdRequirements(jd);
      const coverage = computeAtsCoverage(jd, buildResumeFacts(fixture.id));
      const retrievalChunkIds = selectRetrievalChunkIds(
        {
          jobDescription: input.jobDescription,
          resumeContent: input.resumeContent,
          coverLetterContent: input.coverLetterContent,
          companyInfo: input.companyInfo,
          additionalContext: input.additionalContext,
        },
        6
      );

      const preparedPrivacy = prepareApplicationForGemini(input);
      const unauthorizedNumbers = findUnauthorizedNumbersForRewrite(
        {
          optimizedResume:
            fixture.id === "case-1"
              ? "Improved conversion by 18% and retention by 42%."
              : "Improved Lighthouse score to 91 and uptime to 99.99%.",
          optimizedCoverLetter: fixture.id === "case-1" ? "Reduced latency by 120 ms." : "Served 120000 users.",
        },
        input.metricsVault
      );

      const tier = selectTier(input);
      const schemaProbe = buildSchemaProbe(coverage, retrievalChunkIds, tier);
      const schemaValidation = validateAnalysisResultSchema(schemaProbe);

      return {
        caseId: fixture.id,
        tier,
        parsedJd,
        coverage,
        retrievalChunkIds,
        privacy: {
          redactionCount: preparedPrivacy.redactionEntries.length,
          placeholders: preparedPrivacy.redactionEntries.map(entry => entry.placeholder),
          redactionTypes: preparedPrivacy.redactionEntries.map(entry => entry.type),
          sanitizedResumeSnippet: preparedPrivacy.sanitizedInput.resumeContent.slice(0, 220),
        },
        unauthorizedNumbers,
        schemaValidation,
      };
    });

    expect(outputs).toMatchSnapshot();
  });
});
