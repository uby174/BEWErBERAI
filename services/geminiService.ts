
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisMode, ApplicationInput, AnalysisResult, ImprovementEvidence, MetricsVault } from "../types";
import { computeAtsCoverage, parseJdRequirements } from "./atsCoverageService";
import { validateAnalysisResultSchema } from "./analysisSchemaService";
import { findUnauthorizedNumbersForRewrite, getAllowedMetricNumbers } from "./metricsGuardService";
import {
  findUnauthorizedPii,
  findUnresolvedPiiPlaceholders,
  PiiRedactionEntry,
  prepareApplicationForGemini,
  reinsertRedactedPii,
} from "./privacyService";
import { selectRetrievalTrace } from "./retrievalService";

type Nullable<T> = T | null;

interface ExtractedExperience {
  employer: Nullable<string>;
  role: Nullable<string>;
  startDate: Nullable<string>;
  endDate: Nullable<string>;
  achievements: string[];
}

interface ExtractFactsResult {
  languageDetected: Nullable<"English" | "German">;
  jdFacts: {
    roleTitle: Nullable<string>;
    companyName: Nullable<string>;
    mustHaveSkills: string[];
    niceToHaveSkills: string[];
    responsibilities: string[];
    requiredExperienceYears: Nullable<number>;
    keywords: string[];
  };
  resumeFacts: {
    candidateName: Nullable<string>;
    skills: string[];
    experience: ExtractedExperience[];
    achievements: string[];
    education: string[];
    certifications: string[];
  };
  coverLetterFacts: {
    keyClaims: string[];
    motivations: string[];
  };
  explicitUserAchievements: string[];
  missingData: string[];
}

interface GapItem {
  point: Nullable<string>;
  category: "critical" | "optional";
  impact: Nullable<string>;
  evidence: ImprovementEvidence;
}

interface ScoreMatchResult {
  baselineScore: Nullable<number>;
  enhancedScore: Nullable<number>;
  jobFitScore: Nullable<number>;
  explanation: Nullable<string>;
  overallFeedback: Nullable<string>;
  gapAnalysis: GapItem[];
  portfolioAdvice: Nullable<string>;
  recruiterNotes: Nullable<string>;
  confidenceNotes: string[];
}

interface RewriteDocsResult {
  optimizedResume: Nullable<string>;
  optimizedCoverLetter: Nullable<string>;
  rewriteNotes: Nullable<string>;
}

type StageName = "extractFacts" | "scoreMatch" | "rewriteDocs";
type AnalysisTier = "SIMPLE" | "MEDIUM" | "COMPLEX";

interface TierConfig {
  tier: AnalysisTier;
  model: string;
  stageMaxOutputTokens: Record<StageName, number>;
  stageGuidance: Record<StageName, string>;
}

interface StageGenerationParams {
  model: string;
  contents: string;
  config: {
    systemInstruction: string;
    responseMimeType: "application/json";
    responseSchema: any;
    maxOutputTokens: number;
  };
}

interface GenerationResponse {
  text?: string;
}

interface GenerationClient {
  models: {
    generateContent: (params: StageGenerationParams) => Promise<GenerationResponse>;
  };
}

export interface StageRequestTrace {
  stageName: StageName;
  model: string;
  tier: AnalysisTier;
  prompt: string;
  systemInstruction: string;
}

export interface AnalysisRuntimeOptions {
  modelMode?: "real" | "mock";
  apiKey?: string;
  onStageRequest?: (trace: StageRequestTrace) => void;
}

const SIMPLE_DOC_CHAR_LIMIT = 3000;
const COMPLEX_DOC_CHAR_LIMIT = 9000;
const COMPLEX_TOTAL_CHAR_LIMIT = 18000;
const APPROX_CHARS_PER_TOKEN = 4;
const COMPLEX_TOKEN_LIMIT = 4500;

const TIER_CONFIG: Record<AnalysisTier, TierConfig> = {
  SIMPLE: {
    tier: "SIMPLE",
    model: "gemini-2.5-flash",
    stageMaxOutputTokens: {
      extractFacts: 900,
      scoreMatch: 1200,
      rewriteDocs: 1600,
    },
    stageGuidance: {
      extractFacts: "Compact extraction. Keep lists concise and prioritize strongest facts only.",
      scoreMatch: "Compact scoring. Limit gapAnalysis to the highest-impact items only.",
      rewriteDocs: "Compact rewrite. Keep wording concise and avoid adding extra sections.",
    },
  },
  MEDIUM: {
    tier: "MEDIUM",
    model: "gemini-2.5-pro",
    stageMaxOutputTokens: {
      extractFacts: 1400,
      scoreMatch: 2000,
      rewriteDocs: 2600,
    },
    stageGuidance: {
      extractFacts: "Standard extraction depth for typical hiring workflows.",
      scoreMatch: "Balanced scoring depth with actionable yet concise gap coverage.",
      rewriteDocs: "Balanced rewrite detail with professional clarity and ATS alignment.",
    },
  },
  COMPLEX: {
    tier: "COMPLEX",
    model: "gemini-3-pro-preview",
    stageMaxOutputTokens: {
      extractFacts: 2200,
      scoreMatch: 3200,
      rewriteDocs: 4200,
    },
    stageGuidance: {
      extractFacts: "Deep extraction. Capture comprehensive role, skills, and evidence context.",
      scoreMatch: "Deep scoring with richer gap decomposition and nuanced ATS rationale.",
      rewriteDocs: "Deep rewrite with thorough optimization while preserving factual grounding.",
    },
  },
};

const MAX_RETRY_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 400;
const MAX_EVIDENCE_WORDS = 20;
const TRANSIENT_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const DEEP_ANALYSIS_REGEX = /\bdeep\s+analysis\b|\bdeep\b/i;
const METRICS_HASH_FIELDS: Array<keyof MetricsVault> = [
  "projectImpact",
  "latencyReduction",
  "costSavings",
  "usersServed",
  "uptime",
  "otherMetrics",
];

const clampWords = (value: string, maxWords = MAX_EVIDENCE_WORDS): string =>
  value
    .split(/\s+/g)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ");

const sanitizeTextWithoutNumbers = (value: string): string =>
  value.replace(/\d+(?:[.,]\d+)*/g, "").replace(/\s+/g, " ").trim();

const splitSentences = (value: string): string[] =>
  value
    .split(/(?<=[.!?])\s+/g)
    .map(part => part.trim())
    .filter(Boolean);

const splitLines = (value: string): string[] =>
  value
    .split(/\r?\n/g)
    .map(line => line.trim())
    .filter(Boolean);

const extractRequiredYears = (jobDescription: string): number | null => {
  const match = jobDescription.match(/(\d+)\s*\+?\s*(?:years|year|yrs|yr)\b/i);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const detectLanguage = (value: string): "English" | "German" =>
  /[äöüß]|(?:\bund\b|\bmit\b|\berfahrung\b|\bkenntnisse\b)/i.test(value) ? "German" : "English";

const findJsonStart = (text: string, fromIndex: number): number => {
  const objectStart = text.indexOf("{", fromIndex);
  const arrayStart = text.indexOf("[", fromIndex);
  if (objectStart === -1) return arrayStart;
  if (arrayStart === -1) return objectStart;
  return Math.min(objectStart, arrayStart);
};

const extractBalancedJson = (text: string, start: number): string | null => {
  const opener = text[start];
  const closer = opener === "{" ? "}" : opener === "[" ? "]" : "";
  if (!closer) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === opener) depth += 1;
    if (char === closer) depth -= 1;

    if (depth === 0) {
      return text.slice(start, index + 1);
    }
  }

  return null;
};

const parseJsonAfterMarker = <T>(prompt: string, marker: string): T | null => {
  const markerIndex = prompt.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = findJsonStart(prompt, markerIndex + marker.length);
  if (start < 0) return null;
  const jsonText = extractBalancedJson(prompt, start);
  if (!jsonText) return null;

  try {
    return JSON.parse(jsonText) as T;
  } catch {
    return null;
  }
};

const toNullableString = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const buildMockExtractFacts = (input: ApplicationInput): ExtractFactsResult => {
  const parsedJd = parseJdRequirements(input.jobDescription);
  const resumeLines = splitLines(input.resumeContent);
  const resumeSentences = splitSentences(input.resumeContent);
  const coverSentences = splitSentences(input.coverLetterContent);

  const candidateName = toNullableString(resumeLines[0] ?? "");
  const experience: ExtractedExperience[] = [];
  let lastExperienceIndex = -1;

  for (const line of resumeLines) {
    const experienceMatch = line.match(/^(.+?),\s*(.+?)\s*\(([^)]*)\)/);
    if (experienceMatch) {
      const [, roleRaw, employerRaw, dateRangeRaw] = experienceMatch;
      const [startDateRaw, endDateRaw] = dateRangeRaw.split("-").map(part => part.trim());
      experience.push({
        employer: toNullableString(employerRaw),
        role: toNullableString(roleRaw),
        startDate: toNullableString(startDateRaw ?? ""),
        endDate: toNullableString(endDateRaw ?? ""),
        achievements: [],
      });
      lastExperienceIndex = experience.length - 1;
      continue;
    }

    if (/^[-*•]/.test(line) && lastExperienceIndex >= 0) {
      experience[lastExperienceIndex].achievements.push(line.replace(/^[-*•]\s*/, ""));
    }
  }

  const achievements =
    resumeLines
      .filter(line => /^[-*•]/.test(line))
      .map(line => line.replace(/^[-*•]\s*/, "")) ||
    [];

  const education = resumeLines.filter(line => /\b(university|college|b\.|m\.|phd|diploma)\b/i.test(line));
  const certifications = resumeLines.filter(line => /\b(cert|certificate|certification)\b/i.test(line));
  const normalizedResume = input.resumeContent.toLowerCase();
  const skills = parsedJd.toolsTechKeywords.filter(keyword => normalizedResume.includes(keyword.toLowerCase()));

  const mustHaveSkills = parsedJd.hardRequirements
    .flatMap(requirement => requirement.split(/[,/]/g))
    .map(item => item.trim())
    .filter(item => item.length > 0)
    .slice(0, 10);

  const firstJdLine = splitLines(input.jobDescription)[0] ?? "";

  return {
    languageDetected: detectLanguage(`${input.resumeContent}\n${input.coverLetterContent}`),
    jdFacts: {
      roleTitle: toNullableString(firstJdLine.replace(/^job title[:\-]?\s*/i, "")),
      companyName: toNullableString(splitLines(input.companyInfo)[0] ?? ""),
      mustHaveSkills,
      niceToHaveSkills: parsedJd.softRequirements.slice(0, 8),
      responsibilities: parsedJd.hardRequirements.slice(0, 6),
      requiredExperienceYears: extractRequiredYears(input.jobDescription),
      keywords: parsedJd.toolsTechKeywords,
    },
    resumeFacts: {
      candidateName,
      skills,
      experience,
      achievements: achievements.length > 0 ? achievements : resumeSentences.slice(0, 4),
      education,
      certifications,
    },
    coverLetterFacts: {
      keyClaims: coverSentences.slice(0, 4),
      motivations: coverSentences.slice(4, 8),
    },
    explicitUserAchievements: parseExplicitUserAchievements(input.additionalContext),
    missingData: [
      ...(input.coverLetterContent.trim().length === 0 ? ["coverLetterContent"] : []),
      ...(experience.length === 0 ? ["resumeExperience"] : []),
    ],
  };
};

const findFirstSentenceWith = (source: string, term: string): string | null => {
  const target = term.toLowerCase();
  for (const sentence of splitSentences(source)) {
    if (sentence.toLowerCase().includes(target)) {
      return sentence;
    }
  }
  return null;
};

const buildMockScoreMatch = (
  extracted: ExtractFactsResult,
  sourceText: Pick<ApplicationInput, "jobDescription" | "resumeContent" | "coverLetterContent">
): ScoreMatchResult => {
  const coverage = computeAtsCoverage(sourceText.jobDescription, extracted.resumeFacts);
  const matchedCount = coverage.keywordCoverage.matched.length;
  const partialCount = coverage.keywordCoverage.partial.length;
  const totalKeywords =
    matchedCount + partialCount + coverage.keywordCoverage.missing.length;
  const baselineScore =
    totalKeywords > 0 ? Math.min(100, Math.max(0, Math.round(((matchedCount + partialCount * 0.5) / totalKeywords) * 100))) : null;
  const enhancedScore =
    baselineScore === null
      ? null
      : Math.min(
          100,
          baselineScore +
            Math.min(20, coverage.hardRequirementsMissing.length * 4 + coverage.keywordCoverage.missing.length * 2)
        );

  const defaultResumeEvidence =
    extracted.resumeFacts.achievements[0] ??
    splitSentences(sourceText.resumeContent)[0] ??
    "";

  const hardRequirementGaps: GapItem[] = coverage.hardRequirementsMissing.slice(0, 4).map(requirement => ({
    point: `Address hard requirement gap: ${clampWords(requirement, 12)}.`,
    category: "critical",
    impact: "Improves must-have qualification coverage.",
    evidence: {
      resumeQuotes: defaultResumeEvidence ? [clampWords(defaultResumeEvidence)] : [],
      jdQuotes: [clampWords(requirement)],
      missingKeywords: coverage.keywordCoverage.missing.slice(0, 3).map(keyword => clampWords(keyword, 5)),
    },
  }));

  const keywordGaps: GapItem[] = coverage.keywordCoverage.missing.slice(0, 3).map(keyword => ({
    point: `Incorporate explicit keyword alignment for ${keyword}.`,
    category: "optional",
    impact: "Raises ATS keyword match confidence.",
    evidence: {
      resumeQuotes: (() => {
        const hit = findFirstSentenceWith(sourceText.resumeContent, keyword) ?? defaultResumeEvidence;
        return hit ? [clampWords(hit)] : [];
      })(),
      jdQuotes: (() => {
        const hit = findFirstSentenceWith(sourceText.jobDescription, keyword) ?? keyword;
        return hit ? [clampWords(hit)] : [];
      })(),
      missingKeywords: [clampWords(keyword, 5)],
    },
  }));

  const gapAnalysis = [...hardRequirementGaps, ...keywordGaps].slice(0, 6);

  return {
    baselineScore,
    enhancedScore,
    jobFitScore: enhancedScore,
    explanation:
      baselineScore === null
        ? "Insufficient deterministic evidence for score computation."
        : `Coverage computed from ${totalKeywords} tracked keywords and hard requirements.`,
    overallFeedback:
      coverage.hardRequirementsMissing.length > 0
        ? "Core requirements remain missing; prioritize must-have alignment."
        : "Core requirements appear aligned.",
    gapAnalysis,
    portfolioAdvice: "Show a portfolio example that mirrors the top missing requirement.",
    recruiterNotes: "Deterministic mock scoring used for local evaluation.",
    confidenceNotes: ["Mock mode output generated without external model calls."],
  };
};

const buildMockRewrite = (
  extracted: ExtractFactsResult,
  explicitUserAchievements: string[]
): RewriteDocsResult => {
  const experienceLines = extracted.resumeFacts.experience.slice(0, 4).map(item => {
    const role = sanitizeTextWithoutNumbers(item.role ?? "Role");
    const employer = sanitizeTextWithoutNumbers(item.employer ?? "Employer");
    return `- ${role} at ${employer}: improved X through collaboration and delivery.`;
  });

  const achievementLines = explicitUserAchievements
    .slice(0, 4)
    .map(item => sanitizeTextWithoutNumbers(item))
    .filter(item => item.length > 0)
    .map(item => `- ${item}`);

  const fallbackAchievements = extracted.resumeFacts.achievements
    .slice(0, 3)
    .map(item => sanitizeTextWithoutNumbers(item))
    .filter(item => item.length > 0)
    .map(item => `- ${item}`);

  const resumeSections = [
    sanitizeTextWithoutNumbers(extracted.resumeFacts.candidateName ?? "Candidate"),
    `Skills: ${extracted.resumeFacts.skills.map(skill => sanitizeTextWithoutNumbers(skill)).filter(Boolean).join(", ") || "Not specified"}`,
    "Experience Highlights:",
    ...(experienceLines.length > 0 ? experienceLines : ["- improved X in relevant initiatives."]),
    "Selected Achievements:",
    ...(achievementLines.length > 0 ? achievementLines : fallbackAchievements.length > 0 ? fallbackAchievements : ["- improved X."]),
  ];

  const coverLetterLines = [
    "Dear Hiring Team,",
    `I am applying for ${sanitizeTextWithoutNumbers(extracted.jdFacts.roleTitle ?? "this role")}.`,
    "My background shows consistent execution and improved X outcomes.",
    "I can contribute quickly using proven delivery patterns and collaboration.",
    "Sincerely,",
    sanitizeTextWithoutNumbers(extracted.resumeFacts.candidateName ?? "Candidate"),
  ];

  return {
    optimizedResume: resumeSections.join("\n"),
    optimizedCoverLetter: coverLetterLines.join("\n"),
    rewriteNotes: "Deterministic mock rewrite generated for local evaluation.",
  };
};

const buildMockGeminiClient = (): GenerationClient => ({
  models: {
    generateContent: async (params: StageGenerationParams): Promise<GenerationResponse> => {
      const instruction = params.config.systemInstruction.toLowerCase();
      const emptyInput: ApplicationInput = {
        jobDescription: "",
        companyInfo: "",
        resumeContent: "",
        coverLetterContent: "",
        portfolioLinks: "",
        additionalContext: "",
        analysisMode: "balanced",
        privacyMode: false,
        metricsVault: {},
      };

      if (instruction.includes("stage 1: fact extraction")) {
        const rawInput = parseJsonAfterMarker<Record<string, unknown>>(params.contents, "INPUT JSON:");
        const normalizedInput: ApplicationInput = {
          jobDescription: String(rawInput?.jobDescription ?? ""),
          companyInfo: String(rawInput?.companyInfo ?? ""),
          resumeContent: String(rawInput?.resumeContent ?? ""),
          coverLetterContent: String(rawInput?.coverLetterContent ?? ""),
          portfolioLinks: String(rawInput?.portfolioLinks ?? ""),
          additionalContext: String(rawInput?.additionalContext ?? rawInput?.additionalUserContext ?? ""),
          analysisMode: "balanced",
          privacyMode: Boolean(rawInput?.privacyMode),
          metricsVault:
            rawInput && typeof rawInput.metricsVault === "object" && rawInput.metricsVault !== null
              ? (rawInput.metricsVault as MetricsVault)
              : {},
        };
        const extracted = buildMockExtractFacts(rawInput ? normalizedInput : emptyInput);
        return { text: JSON.stringify(extracted) };
      }

      if (instruction.includes("stage 2: ats match scoring")) {
        const extracted = parseJsonAfterMarker<ExtractFactsResult>(params.contents, "EXTRACTED_FACTS_JSON:");
        const source = parseJsonAfterMarker<Pick<ApplicationInput, "jobDescription" | "resumeContent" | "coverLetterContent">>(
          params.contents,
          "SOURCE_TEXT_JSON:"
        );
        const scored = buildMockScoreMatch(
          extracted ?? buildMockExtractFacts(emptyInput),
          source ?? { jobDescription: "", resumeContent: "", coverLetterContent: "" }
        );
        return { text: JSON.stringify(scored) };
      }

      if (instruction.includes("stage 3: document rewrite")) {
        const input = parseJsonAfterMarker<{
          extractedFacts: ExtractFactsResult;
          explicitUserAchievements: string[];
        }>(params.contents, "INPUT_JSON:");
        const rewritten = buildMockRewrite(
          input?.extractedFacts ??
            buildMockExtractFacts(emptyInput),
          input?.explicitUserAchievements ?? []
        );
        return { text: JSON.stringify(rewritten) };
      }

      return { text: JSON.stringify({}) };
    },
  },
});

const getGeminiClient = (runtimeOptions?: AnalysisRuntimeOptions): GenerationClient => {
  if (runtimeOptions?.modelMode === "mock") {
    return buildMockGeminiClient();
  }

  const apiKey = runtimeOptions?.apiKey?.trim() || import.meta.env.VITE_GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Missing Gemini API key: set VITE_GEMINI_API_KEY in .env.local and restart the Vite dev server."
    );
  }
  return new GoogleGenAI({ apiKey });
};

const estimateTokensFromChars = (chars: number): number =>
  Math.ceil(chars / APPROX_CHARS_PER_TOKEN);

const normalizeInputText = (value: string): string => value.replace(/\s+/g, " ").trim();

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map(value => value.toString(16).padStart(2, "0"))
    .join("");

const computeInputHash = async (input: ApplicationInput): Promise<string> => {
  const normalizedPayload = JSON.stringify({
    jobDescription: normalizeInputText(input.jobDescription),
    companyInfo: normalizeInputText(input.companyInfo),
    resumeContent: normalizeInputText(input.resumeContent),
    coverLetterContent: normalizeInputText(input.coverLetterContent),
    portfolioLinks: normalizeInputText(input.portfolioLinks),
    additionalContext: normalizeInputText(input.additionalContext),
    analysisMode: input.analysisMode,
    privacyMode: input.privacyMode,
    metricsVault: METRICS_HASH_FIELDS.reduce<Record<string, string>>((accumulator, key) => {
      accumulator[key] = normalizeInputText(input.metricsVault[key] ?? "");
      return accumulator;
    }, {}),
  });

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto API is unavailable; cannot compute SHA-256 input hash.");
  }

  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(normalizedPayload));
  return toHex(digest);
};

export const selectTier = (input: ApplicationInput): AnalysisTier => {
  const jdChars = input.jobDescription.length;
  const resumeChars = input.resumeContent.length;
  const coverChars = input.coverLetterContent.length;
  const companyChars = input.companyInfo.length;
  const contextChars = input.additionalContext.length;
  const metricsChars = Object.values(input.metricsVault ?? {})
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .length;
  const totalChars = jdChars + resumeChars + coverChars + companyChars + contextChars + metricsChars;
  const estimatedTokens = estimateTokensFromChars(totalChars);

  const isSimpleCandidate = jdChars < SIMPLE_DOC_CHAR_LIMIT && resumeChars < SIMPLE_DOC_CHAR_LIMIT;
  const isFastSimpleCandidate =
    jdChars < 4500 &&
    resumeChars < 4500 &&
    estimatedTokens < 3200;
  const isComplexByLength =
    jdChars > COMPLEX_DOC_CHAR_LIMIT ||
    resumeChars > COMPLEX_DOC_CHAR_LIMIT ||
    totalChars > COMPLEX_TOTAL_CHAR_LIMIT ||
    estimatedTokens > COMPLEX_TOKEN_LIMIT;

  const deepRequestedByText = DEEP_ANALYSIS_REGEX.test(
    `${input.additionalContext}\n${input.companyInfo}\n${input.jobDescription}`
  );

  if (input.analysisMode === "deep" || deepRequestedByText || isComplexByLength) {
    return "COMPLEX";
  }

  if (input.analysisMode === "fast") {
    return isFastSimpleCandidate ? "SIMPLE" : "MEDIUM";
  }

  return isSimpleCandidate ? "SIMPLE" : "MEDIUM";
};

const getTierConfig = (tier: AnalysisTier): TierConfig => TIER_CONFIG[tier];

const tierFromMode = (analysisMode: AnalysisMode): AnalysisTier => {
  if (analysisMode === "deep") return "COMPLEX";
  if (analysisMode === "fast") return "SIMPLE";
  return "MEDIUM";
};

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

const isTransientError = (error: unknown): boolean => {
  const maybeError = error as { status?: unknown; code?: unknown; message?: unknown };
  const status =
    typeof maybeError?.status === "number"
      ? maybeError.status
      : typeof maybeError?.code === "number"
        ? maybeError.code
        : null;

  if (status !== null && TRANSIENT_STATUS_CODES.has(status)) return true;

  const message = String(maybeError?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("temporar") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("500") ||
    message.includes("429")
  );
};

const withRetry = async <T>(
  operationName: string,
  operation: () => Promise<T>,
  maxAttempts = MAX_RETRY_ATTEMPTS,
  onRetry?: () => void
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < maxAttempts && isTransientError(error);
      if (!shouldRetry) {
        throw error;
      }

      onRetry?.();
      const delayMs = BASE_BACKOFF_MS * (2 ** (attempt - 1));
      await sleep(delayMs);
    }
  }

  throw new Error(`${operationName} failed after ${maxAttempts} attempts: ${String(lastError)}`);
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asNullableString = (value: unknown): Nullable<string> => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asStringArray = (value: unknown): string[] =>
  asArray(value)
    .map(item => asNullableString(item))
    .filter((item): item is string => item !== null);

const clampSnippetWords = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_EVIDENCE_WORDS)
    .join(" ");

const asSnippetArray = (value: unknown): string[] =>
  asArray(value)
    .map(item => asNullableString(item))
    .filter((item): item is string => item !== null)
    .map(item => clampSnippetWords(item));

const asNullableNumber = (value: unknown): Nullable<number> =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const normalizeLanguage = (value: unknown): Nullable<"English" | "German"> => {
  if (value === "English" || value === "German") return value;
  return null;
};

const normalizeGapCategory = (value: unknown): "critical" | "optional" =>
  value === "optional" ? "optional" : "critical";

const normalizeEvidence = (value: unknown): ImprovementEvidence => {
  const evidence = asRecord(value);
  return {
    resumeQuotes: asSnippetArray(evidence.resumeQuotes),
    jdQuotes: asSnippetArray(evidence.jdQuotes),
    missingKeywords: asSnippetArray(evidence.missingKeywords),
  };
};

const normalizeForMatch = (value: string): string =>
  value.replace(/\s+/g, " ").trim().toLowerCase();

const existsInSource = (snippet: string, source: string): boolean => {
  if (!snippet || !source) return false;
  return normalizeForMatch(source).includes(normalizeForMatch(snippet));
};

const enforceEvidenceFromSource = (
  scoring: ScoreMatchResult,
  sourceText: Pick<ApplicationInput, "jobDescription" | "resumeContent" | "coverLetterContent">
): ScoreMatchResult => {
  const resumeCorpus = `${sourceText.resumeContent}\n${sourceText.coverLetterContent}`;
  return {
    ...scoring,
    gapAnalysis: scoring.gapAnalysis.map(gap => ({
      ...gap,
      evidence: {
        resumeQuotes: gap.evidence.resumeQuotes.filter(quote => existsInSource(quote, resumeCorpus)),
        jdQuotes: gap.evidence.jdQuotes.filter(quote => existsInSource(quote, sourceText.jobDescription)),
        missingKeywords: gap.evidence.missingKeywords.filter(keyword =>
          existsInSource(keyword, sourceText.jobDescription)
        ),
      },
    })),
  };
};

const parseJsonText = (stageName: string, text: string | undefined): unknown => {
  if (!text) {
    throw new Error(`${stageName}: empty response from model`);
  }

  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenceMatch ? fenceMatch[1] : trimmed;

  try {
    return JSON.parse(jsonText);
  } catch {
    throw new Error(`${stageName}: invalid JSON response`);
  }
};

const buildExtractFactsSchema = () =>
  ({
    type: Type.OBJECT,
    properties: {
      languageDetected: { type: Type.STRING, enum: ["English", "German"], nullable: true },
      jdFacts: {
        type: Type.OBJECT,
        properties: {
          roleTitle: { type: Type.STRING, nullable: true },
          companyName: { type: Type.STRING, nullable: true },
          mustHaveSkills: { type: Type.ARRAY, items: { type: Type.STRING } },
          niceToHaveSkills: { type: Type.ARRAY, items: { type: Type.STRING } },
          responsibilities: { type: Type.ARRAY, items: { type: Type.STRING } },
          requiredExperienceYears: { type: Type.NUMBER, nullable: true },
          keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: [
          "roleTitle",
          "companyName",
          "mustHaveSkills",
          "niceToHaveSkills",
          "responsibilities",
          "requiredExperienceYears",
          "keywords",
        ],
      },
      resumeFacts: {
        type: Type.OBJECT,
        properties: {
          candidateName: { type: Type.STRING, nullable: true },
          skills: { type: Type.ARRAY, items: { type: Type.STRING } },
          experience: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                employer: { type: Type.STRING, nullable: true },
                role: { type: Type.STRING, nullable: true },
                startDate: { type: Type.STRING, nullable: true },
                endDate: { type: Type.STRING, nullable: true },
                achievements: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["employer", "role", "startDate", "endDate", "achievements"],
            },
          },
          achievements: { type: Type.ARRAY, items: { type: Type.STRING } },
          education: { type: Type.ARRAY, items: { type: Type.STRING } },
          certifications: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["candidateName", "skills", "experience", "achievements", "education", "certifications"],
      },
      coverLetterFacts: {
        type: Type.OBJECT,
        properties: {
          keyClaims: { type: Type.ARRAY, items: { type: Type.STRING } },
          motivations: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["keyClaims", "motivations"],
      },
      explicitUserAchievements: { type: Type.ARRAY, items: { type: Type.STRING } },
      missingData: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: [
      "languageDetected",
      "jdFacts",
      "resumeFacts",
      "coverLetterFacts",
      "explicitUserAchievements",
      "missingData",
    ],
  }) as any;

const buildScoreMatchSchema = () =>
  ({
    type: Type.OBJECT,
    properties: {
      baselineScore: { type: Type.NUMBER, nullable: true },
      enhancedScore: { type: Type.NUMBER, nullable: true },
      jobFitScore: { type: Type.NUMBER, nullable: true },
      explanation: { type: Type.STRING, nullable: true },
      overallFeedback: { type: Type.STRING, nullable: true },
      gapAnalysis: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            point: { type: Type.STRING, nullable: true },
            category: { type: Type.STRING, enum: ["critical", "optional"] },
            impact: { type: Type.STRING, nullable: true },
            evidence: {
              type: Type.OBJECT,
              properties: {
                resumeQuotes: { type: Type.ARRAY, items: { type: Type.STRING } },
                jdQuotes: { type: Type.ARRAY, items: { type: Type.STRING } },
                missingKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["resumeQuotes", "jdQuotes", "missingKeywords"],
            },
          },
          required: ["point", "category", "impact", "evidence"],
        },
      },
      portfolioAdvice: { type: Type.STRING, nullable: true },
      recruiterNotes: { type: Type.STRING, nullable: true },
      confidenceNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: [
      "baselineScore",
      "enhancedScore",
      "jobFitScore",
      "explanation",
      "overallFeedback",
      "gapAnalysis",
      "portfolioAdvice",
      "recruiterNotes",
      "confidenceNotes",
    ],
  }) as any;

const buildRewriteDocsSchema = () =>
  ({
    type: Type.OBJECT,
    properties: {
      optimizedResume: { type: Type.STRING, nullable: true },
      optimizedCoverLetter: { type: Type.STRING, nullable: true },
      rewriteNotes: { type: Type.STRING, nullable: true },
    },
    required: ["optimizedResume", "optimizedCoverLetter", "rewriteNotes"],
  }) as any;

const normalizeExtractFacts = (raw: unknown): ExtractFactsResult => {
  const root = asRecord(raw);
  const jdFacts = asRecord(root.jdFacts);
  const resumeFacts = asRecord(root.resumeFacts);
  const coverLetterFacts = asRecord(root.coverLetterFacts);

  return {
    languageDetected: normalizeLanguage(root.languageDetected),
    jdFacts: {
      roleTitle: asNullableString(jdFacts.roleTitle),
      companyName: asNullableString(jdFacts.companyName),
      mustHaveSkills: asStringArray(jdFacts.mustHaveSkills),
      niceToHaveSkills: asStringArray(jdFacts.niceToHaveSkills),
      responsibilities: asStringArray(jdFacts.responsibilities),
      requiredExperienceYears: asNullableNumber(jdFacts.requiredExperienceYears),
      keywords: asStringArray(jdFacts.keywords),
    },
    resumeFacts: {
      candidateName: asNullableString(resumeFacts.candidateName),
      skills: asStringArray(resumeFacts.skills),
      experience: asArray(resumeFacts.experience).map(item => {
        const entry = asRecord(item);
        return {
          employer: asNullableString(entry.employer),
          role: asNullableString(entry.role),
          startDate: asNullableString(entry.startDate),
          endDate: asNullableString(entry.endDate),
          achievements: asStringArray(entry.achievements),
        };
      }),
      achievements: asStringArray(resumeFacts.achievements),
      education: asStringArray(resumeFacts.education),
      certifications: asStringArray(resumeFacts.certifications),
    },
    coverLetterFacts: {
      keyClaims: asStringArray(coverLetterFacts.keyClaims),
      motivations: asStringArray(coverLetterFacts.motivations),
    },
    explicitUserAchievements: asStringArray(root.explicitUserAchievements),
    missingData: asStringArray(root.missingData),
  };
};

const normalizeScoreMatch = (raw: unknown): ScoreMatchResult => {
  const root = asRecord(raw);
  return {
    baselineScore: asNullableNumber(root.baselineScore),
    enhancedScore: asNullableNumber(root.enhancedScore),
    jobFitScore: asNullableNumber(root.jobFitScore),
    explanation: asNullableString(root.explanation),
    overallFeedback: asNullableString(root.overallFeedback),
    gapAnalysis: asArray(root.gapAnalysis).map(item => {
      const gap = asRecord(item);
      return {
        point: asNullableString(gap.point),
        category: normalizeGapCategory(gap.category),
        impact: asNullableString(gap.impact),
        evidence: normalizeEvidence(gap.evidence),
      };
    }),
    portfolioAdvice: asNullableString(root.portfolioAdvice),
    recruiterNotes: asNullableString(root.recruiterNotes),
    confidenceNotes: asStringArray(root.confidenceNotes),
  };
};

const normalizeRewriteDocs = (raw: unknown): RewriteDocsResult => {
  const root = asRecord(raw);
  return {
    optimizedResume: asNullableString(root.optimizedResume),
    optimizedCoverLetter: asNullableString(root.optimizedCoverLetter),
    rewriteNotes: asNullableString(root.rewriteNotes),
  };
};

const runStructuredStage = async <T>({
  ai,
  tierConfig,
  stageName,
  systemInstruction,
  prompt,
  responseSchema,
  normalize,
  onRetry,
  onStageRequest,
}: {
  ai: GenerationClient;
  tierConfig: TierConfig;
  stageName: StageName;
  systemInstruction: string;
  prompt: string;
  responseSchema: any;
  normalize: (raw: unknown) => T;
  onRetry?: () => void;
  onStageRequest?: (trace: StageRequestTrace) => void;
}): Promise<T> => {
  onStageRequest?.({
    stageName,
    model: tierConfig.model,
    tier: tierConfig.tier,
    prompt,
    systemInstruction,
  });

  const response = await withRetry(
    stageName,
    async () =>
      ai.models.generateContent({
        model: tierConfig.model,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema,
          maxOutputTokens: tierConfig.stageMaxOutputTokens[stageName],
        },
      }),
    MAX_RETRY_ATTEMPTS,
    onRetry
  );

  const raw = parseJsonText(stageName, response.text);
  return normalize(raw);
};

const parseExplicitUserAchievements = (additionalContext: string): string[] => {
  return additionalContext
    .split(/\r?\n|;/g)
    .map(part => part.trim())
    .filter(part => part.length > 0);
};

const buildMetricsVaultSummary = (metricsVault: MetricsVault): string =>
  JSON.stringify({
    projectImpact: metricsVault.projectImpact ?? null,
    latencyReduction: metricsVault.latencyReduction ?? null,
    costSavings: metricsVault.costSavings ?? null,
    usersServed: metricsVault.usersServed ?? null,
    uptime: metricsVault.uptime ?? null,
    otherMetrics: metricsVault.otherMetrics ?? null,
  });

const summarizePiiIssues = (
  unauthorizedPiiIssues: ReturnType<typeof findUnauthorizedPii>,
  unresolvedPlaceholders: string[]
): string => {
  const parts: string[] = [];
  if (unauthorizedPiiIssues.length > 0) {
    const piiSummary = unauthorizedPiiIssues.map(issue => `${issue.type}:${issue.count}`).join(", ");
    parts.push(`Unauthorized PII detected (${piiSummary}).`);
  }
  if (unresolvedPlaceholders.length > 0) {
    parts.push(`Unknown PII placeholders detected (${unresolvedPlaceholders.length}).`);
  }
  return parts.join(" ");
};

const applyPiiReinsertionToRewrite = (
  rewrite: RewriteDocsResult,
  redactionEntries: PiiRedactionEntry[]
): RewriteDocsResult => ({
  ...rewrite,
  optimizedResume: reinsertRedactedPii(rewrite.optimizedResume, redactionEntries),
  optimizedCoverLetter: reinsertRedactedPii(rewrite.optimizedCoverLetter, redactionEntries),
});

const extractFactsWithClient = async (
  ai: GenerationClient,
  data: ApplicationInput,
  tierConfig: TierConfig,
  onRetry?: () => void,
  onStageRequest?: (trace: StageRequestTrace) => void
): Promise<ExtractFactsResult> => {
  const systemInstruction = `
You are Stage 1: FACT EXTRACTION.
Tier: ${tierConfig.tier}.
Tier Guidance: ${tierConfig.stageGuidance.extractFacts}
Rules:
- Extract facts only. Do not rewrite documents.
- Use only information explicitly present in the input text.
- If a value is missing or uncertain, return null.
- Never invent numbers, employers, dates, certifications, or metrics.
- explicitUserAchievements must contain user-provided achievement statements from ADDITIONAL USER CONTEXT only.
- Return valid JSON only.
`;

  const prompt = `
INPUT JSON:
${JSON.stringify({
    jobDescription: data.jobDescription,
    companyInfo: data.companyInfo,
    resumeContent: data.resumeContent,
    coverLetterContent: data.coverLetterContent,
    portfolioLinks: data.portfolioLinks,
    additionalUserContext: data.additionalContext,
    metricsVault: data.metricsVault,
    privacyMode: data.privacyMode,
  })}
`;

  return runStructuredStage({
    ai,
    tierConfig,
    stageName: "extractFacts",
    systemInstruction,
    prompt,
    responseSchema: buildExtractFactsSchema(),
    normalize: normalizeExtractFacts,
    onRetry,
    onStageRequest,
  });
};

const scoreMatchWithClient = async (
  ai: GenerationClient,
  extracted: ExtractFactsResult,
  sourceText: Pick<ApplicationInput, "jobDescription" | "resumeContent" | "coverLetterContent">,
  tierConfig: TierConfig,
  onRetry?: () => void,
  onStageRequest?: (trace: StageRequestTrace) => void
): Promise<ScoreMatchResult> => {
  const systemInstruction = `
You are Stage 2: ATS MATCH SCORING + GAP ANALYSIS.
Tier: ${tierConfig.tier}.
Tier Guidance: ${tierConfig.stageGuidance.scoreMatch}
Rules:
- Compute ATS scoring and gap analysis from extracted facts.
- Do not rewrite resume or cover letter text.
- If there is insufficient evidence for a score, return null for that score.
- Never invent numbers, employers, dates, or metrics.
- gapAnalysis must contain concise actionable points with category critical|optional.
- For every gapAnalysis item, include evidence with:
  - evidence.resumeQuotes: exact phrases copied from resume or cover letter text.
  - evidence.jdQuotes: exact phrases copied from job description text.
  - evidence.missingKeywords: missing keywords/phrases explicitly present in the job description.
- Every evidence snippet must be 20 words or fewer.
- If no supporting text exists, return empty evidence arrays.
- Return valid JSON only.
`;

  const prompt = `
EXTRACTED_FACTS_JSON:
${JSON.stringify(extracted)}

SOURCE_TEXT_JSON:
${JSON.stringify(sourceText)}
`;

  const scored = await runStructuredStage({
    ai,
    tierConfig,
    stageName: "scoreMatch",
    systemInstruction,
    prompt,
    responseSchema: buildScoreMatchSchema(),
    normalize: normalizeScoreMatch,
    onRetry,
    onStageRequest,
  });

  return enforceEvidenceFromSource(scored, sourceText);
};

const rewriteDocsWithClient = async (
  ai: GenerationClient,
  extracted: ExtractFactsResult,
  scoring: ScoreMatchResult,
  explicitUserAchievements: string[],
  metricsVault: MetricsVault,
  redactionEntries: PiiRedactionEntry[],
  tierConfig: TierConfig,
  onRetry?: () => void,
  onStageRequest?: (trace: StageRequestTrace) => void
): Promise<RewriteDocsResult> => {
  const allowedMetricNumbers = getAllowedMetricNumbers(metricsVault);
  const piiPlaceholders = redactionEntries.map(entry => entry.placeholder);
  const privacyModeEnabled = redactionEntries.length > 0;
  const systemInstruction = `
You are Stage 3: DOCUMENT REWRITE.
Tier: ${tierConfig.tier}.
Tier Guidance: ${tierConfig.stageGuidance.rewriteDocs}
Rules:
- Rewrite resume and cover letter using ONLY:
  1) extracted facts
  2) explicit user-provided achievements
- Do not introduce new employers, dates, titles, certifications, technologies, or metrics.
- Any claim introduced in rewritten text must be grounded in extracted facts and score-stage evidence.
- Numeric metrics constraint:
  - You may use numeric values ONLY if present in metricsVault.
  - If a sentence needs performance impact but no vault number applies, write "improved X" with no numeric tokens.
- Privacy constraint:
  - Input may include redacted placeholders like [PII_EMAIL_1], [PII_PHONE_1], [PII_STREET_ADDRESS_1], [PII_BIRTH_DATE_1], [PII_PERSONAL_ID_1].
  - If placeholders exist, preserve them exactly and do not invent any new personal data.
  - Do not generate new emails, phone numbers, street addresses, birth dates, or personal IDs.
- If safe rewriting is not possible due to missing evidence, return null for the affected document.
- Keep output as plain text (no markdown).
- Return valid JSON only.
`;

  const basePrompt = `
INPUT_JSON:
${JSON.stringify({
    extractedFacts: extracted,
    scoreMatch: scoring,
    explicitUserAchievements,
    metricsVault,
  })}

METRICS_VAULT_JSON:
${buildMetricsVaultSummary(metricsVault)}

ALLOWED_NUMERIC_VALUES_FROM_VAULT_JSON:
${JSON.stringify(allowedMetricNumbers)}

PII_PLACEHOLDERS_JSON:
${JSON.stringify(piiPlaceholders)}
`;

  const validateDraft = (draft: RewriteDocsResult) => {
    const unauthorizedNumbers = findUnauthorizedNumbersForRewrite(draft, metricsVault);
    const withReinsertedPii = privacyModeEnabled ? applyPiiReinsertionToRewrite(draft, redactionEntries) : draft;
    const combinedOutput = `${withReinsertedPii.optimizedResume ?? ""}\n${withReinsertedPii.optimizedCoverLetter ?? ""}`;
    const unauthorizedPiiIssues = privacyModeEnabled ? findUnauthorizedPii(combinedOutput, redactionEntries) : [];
    const unresolvedPlaceholders = privacyModeEnabled
      ? findUnresolvedPiiPlaceholders(combinedOutput, redactionEntries)
      : [];

    const isValid =
      unauthorizedNumbers.length === 0 &&
      unauthorizedPiiIssues.length === 0 &&
      unresolvedPlaceholders.length === 0;

    return {
      correctedDraft: withReinsertedPii,
      isValid,
      unauthorizedNumbers,
      unauthorizedPiiIssues,
      unresolvedPlaceholders,
    };
  };

  const firstDraft = await runStructuredStage({
    ai,
    tierConfig,
    stageName: "rewriteDocs",
    systemInstruction,
    prompt: basePrompt,
    responseSchema: buildRewriteDocsSchema(),
    normalize: normalizeRewriteDocs,
    onRetry,
    onStageRequest,
  });

  const firstValidation = validateDraft(firstDraft);
  if (firstValidation.isValid) {
    return firstValidation.correctedDraft;
  }

  const correctionPrompt = `
${basePrompt}

CORRECTION_REQUIRED:
The previous rewrite violated output constraints.
Unauthorized numeric values detected: ${JSON.stringify(firstValidation.unauthorizedNumbers)}.
${summarizePiiIssues(firstValidation.unauthorizedPiiIssues, firstValidation.unresolvedPlaceholders)}
Rewrite both documents again and fix all violations.
Use only allowed metrics vault numbers: ${JSON.stringify(allowedMetricNumbers)}.
Use only provided PII placeholders: ${JSON.stringify(piiPlaceholders)}.
If no allowed number applies, use "improved X" without numeric tokens.
`;

  onRetry?.();

  const correctedDraft = await runStructuredStage({
    ai,
    tierConfig,
    stageName: "rewriteDocs",
    systemInstruction,
    prompt: correctionPrompt,
    responseSchema: buildRewriteDocsSchema(),
    normalize: normalizeRewriteDocs,
    onRetry,
    onStageRequest,
  });

  const correctedValidation = validateDraft(correctedDraft);
  if (!correctedValidation.isValid) {
    throw new Error(
      "rewriteDocs failed validation after correction prompt."
    );
  }

  return correctedValidation.correctedDraft;
};

export const extractFacts = async (
  data: ApplicationInput,
  runtimeOptions: AnalysisRuntimeOptions = {}
): Promise<ExtractFactsResult> => {
  const ai = getGeminiClient(runtimeOptions);
  const preparedPrivacyInput = prepareApplicationForGemini(data);
  const tierConfig = getTierConfig(selectTier(preparedPrivacyInput.sanitizedInput));
  return extractFactsWithClient(
    ai,
    preparedPrivacyInput.sanitizedInput,
    tierConfig,
    undefined,
    runtimeOptions.onStageRequest
  );
};

export const scoreMatch = async (
  extracted: ExtractFactsResult,
  sourceText: Pick<ApplicationInput, "jobDescription" | "resumeContent" | "coverLetterContent"> = {
    jobDescription: "",
    resumeContent: "",
    coverLetterContent: "",
  },
  analysisMode: AnalysisMode = "balanced",
  runtimeOptions: AnalysisRuntimeOptions = {}
): Promise<ScoreMatchResult> => {
  const ai = getGeminiClient(runtimeOptions);
  const tierConfig = getTierConfig(tierFromMode(analysisMode));
  return scoreMatchWithClient(ai, extracted, sourceText, tierConfig, undefined, runtimeOptions.onStageRequest);
};

export const rewriteDocs = async (
  extracted: ExtractFactsResult,
  scoring: ScoreMatchResult,
  explicitUserAchievements: string[],
  metricsVault: MetricsVault,
  redactionEntries: PiiRedactionEntry[] = [],
  analysisMode: AnalysisMode = "balanced",
  runtimeOptions: AnalysisRuntimeOptions = {}
): Promise<RewriteDocsResult> => {
  const ai = getGeminiClient(runtimeOptions);
  const tierConfig = getTierConfig(tierFromMode(analysisMode));
  return rewriteDocsWithClient(
    ai,
    extracted,
    scoring,
    explicitUserAchievements,
    metricsVault,
    redactionEntries,
    tierConfig,
    undefined,
    runtimeOptions.onStageRequest
  );
};

export const analyzeApplication = async (
  data: ApplicationInput,
  runtimeOptions: AnalysisRuntimeOptions = {}
): Promise<AnalysisResult> => {
  const ai = getGeminiClient(runtimeOptions);
  const preparedPrivacyInput = prepareApplicationForGemini(data);
  const sanitizedInput = preparedPrivacyInput.sanitizedInput;
  const redactionEntries = preparedPrivacyInput.redactionEntries;
  const tierConfig = getTierConfig(selectTier(sanitizedInput));
  const explicitUserAchievements = parseExplicitUserAchievements(sanitizedInput.additionalContext);
  const timestamp = new Date().toISOString();
  const inputHash = await computeInputHash(sanitizedInput);
  let retryCount = 0;
  const incrementRetry = () => {
    retryCount += 1;
  };

  const extracted = await extractFactsWithClient(
    ai,
    sanitizedInput,
    tierConfig,
    incrementRetry,
    runtimeOptions.onStageRequest
  );
  const scored = await scoreMatchWithClient(ai, extracted, {
    jobDescription: sanitizedInput.jobDescription,
    resumeContent: sanitizedInput.resumeContent,
    coverLetterContent: sanitizedInput.coverLetterContent,
  }, tierConfig, incrementRetry, runtimeOptions.onStageRequest);
  const rewritten = await rewriteDocsWithClient(
    ai,
    extracted,
    scored,
    explicitUserAchievements.length > 0 ? explicitUserAchievements : extracted.explicitUserAchievements,
    sanitizedInput.metricsVault,
    redactionEntries,
    tierConfig,
    incrementRetry,
    runtimeOptions.onStageRequest
  );

  const recruiterNotes = [scored.recruiterNotes, rewritten.rewriteNotes]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n\n");
  const deterministicCoverage = computeAtsCoverage(sanitizedInput.jobDescription, extracted.resumeFacts);
  const retrievalTrace = selectRetrievalTrace({
    jobDescription: sanitizedInput.jobDescription,
    resumeContent: sanitizedInput.resumeContent,
    coverLetterContent: sanitizedInput.coverLetterContent,
    companyInfo: sanitizedInput.companyInfo,
    additionalContext: sanitizedInput.additionalContext,
  });
  const retrievalChunkIds = retrievalTrace.map(entry => entry.chunkId);

  const finalResult: AnalysisResult = {
    scoreBreakdown: {
      baseline: scored.baselineScore,
      enhanced: scored.enhancedScore,
      explanation: scored.explanation,
    },
    jobFitScore: scored.jobFitScore,
    overallFeedback: scored.overallFeedback,
    improvements: scored.gapAnalysis.map(gap => ({
      point: gap.point,
      category: gap.category,
      impact: gap.impact,
      evidence: gap.evidence,
    })),
    optimizedResume: rewritten.optimizedResume,
    optimizedCoverLetter: rewritten.optimizedCoverLetter,
    languageDetected: extracted.languageDetected,
    portfolioAdvice: scored.portfolioAdvice,
    recruiterNotes: recruiterNotes || null,
    evidenceSnippetWordLimit: MAX_EVIDENCE_WORDS,
    keywordCoverage: deterministicCoverage.keywordCoverage,
    hardRequirementsMissing: deterministicCoverage.hardRequirementsMissing,
    analysisTrace: {
      inputHash,
      retrievalChunkIds,
      retrievalTrace,
      modelName: tierConfig.model,
      tier: tierConfig.tier,
      timestamp,
      retries: retryCount,
    },
  };

  const schemaValidation = validateAnalysisResultSchema(finalResult);
  if (!schemaValidation.valid) {
    throw new Error(`AnalysisResult schema validation failed: ${schemaValidation.errors.join(" | ")}`);
  }

  return finalResult;
};
