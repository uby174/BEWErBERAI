
export interface ImprovementEvidence {
  resumeQuotes: string[];
  jdQuotes: string[];
  missingKeywords: string[];
}

export interface Improvement {
  point: string | null;
  category: 'critical' | 'optional';
  impact: string | null;
  evidence: ImprovementEvidence;
}

export interface ScoreBreakdown {
  baseline: number | null;
  enhanced: number | null;
  explanation: string | null;
}

export interface KeywordCoverage {
  matched: string[];
  missing: string[];
  partial: string[];
}

export interface AnalysisTrace {
  inputHash: string;
  retrievalChunkIds: string[];
  retrievalTrace: Array<{
    chunkId: string;
    reason: string;
  }>;
  modelName: string;
  tier: string;
  timestamp: string;
  retries: number;
}

export interface AnalysisResult {
  scoreBreakdown: ScoreBreakdown;
  jobFitScore: number | null;
  overallFeedback: string | null;
  improvements: Improvement[];
  optimizedResume: string | null;
  optimizedCoverLetter: string | null;
  languageDetected: 'English' | 'German' | null;
  portfolioAdvice: string | null;
  recruiterNotes: string | null;
  evidenceSnippetWordLimit: number;
  keywordCoverage: KeywordCoverage;
  hardRequirementsMissing: string[];
  analysisTrace: AnalysisTrace;
}

export type AnalysisMode = 'fast' | 'balanced' | 'deep';

export interface MetricsVault {
  projectImpact?: string;
  latencyReduction?: string;
  costSavings?: string;
  usersServed?: string;
  uptime?: string;
  otherMetrics?: string;
}

export interface ApplicationInput {
  jobDescription: string;
  companyInfo: string;
  resumeContent: string;
  coverLetterContent: string;
  portfolioLinks: string;
  additionalContext: string;
  analysisMode: AnalysisMode;
  privacyMode: boolean;
  metricsVault: MetricsVault;
}
