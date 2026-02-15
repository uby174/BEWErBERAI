import { KeywordCoverage } from "../types";

const HARD_SIGNAL_REGEX =
  /\b(must|required|required qualifications|minimum qualifications|mandatory|essential|need to|you have|at least|min\.)\b/i;
const SOFT_SIGNAL_REGEX =
  /\b(preferred|nice to have|bonus|plus|desirable|ideally|good to have)\b/i;
const HARD_HEADING_REGEX =
  /\b(requirements|required qualifications|minimum qualifications|must[- ]?have|what you(?:'ll| will) need|qualifications)\b/i;
const SOFT_HEADING_REGEX =
  /\b(preferred qualifications|nice to have|bonus points|plus|desirable|good to have)\b/i;
const YEARS_REGEX = /(\d+)\s*\+?\s*(?:years|year|yrs|yr)\b/i;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "their",
  "this",
  "to",
  "we",
  "with",
  "you",
  "your",
  "will",
  "ability",
  "experience",
  "knowledge",
  "strong",
  "excellent",
  "skills",
]);

const KNOWN_TECH_KEYWORDS = [
  "python",
  "sql",
  "r",
  "scala",
  "java",
  "javascript",
  "typescript",
  "react",
  "node.js",
  "node",
  "pandas",
  "numpy",
  "scikit-learn",
  "sklearn",
  "tensorflow",
  "pytorch",
  "keras",
  "spark",
  "hadoop",
  "airflow",
  "dbt",
  "docker",
  "kubernetes",
  "aws",
  "gcp",
  "azure",
  "snowflake",
  "databricks",
  "postgresql",
  "postgres",
  "mysql",
  "mongodb",
  "redis",
  "kafka",
  "tableau",
  "power bi",
  "looker",
  "git",
  "linux",
  "bash",
  "terraform",
  "ansible",
  "ci/cd",
  "ml",
  "ai",
  "llm",
  "rag",
  "nlp",
  "computer vision",
  "langchain",
  "llamaindex",
  "rest api",
  "graphql",
  "c++",
  "c#",
  ".net",
];

const SHORT_TECH_ALLOWLIST = new Set(["ai", "ml", "nlp", "llm", "ci", "cd", "r"]);

type RequirementSection = "hard" | "soft" | "neutral";

export interface ResumeFactsForCoverage {
  skills: string[];
  experience: Array<{
    employer: string | null;
    role: string | null;
    startDate: string | null;
    endDate: string | null;
    achievements: string[];
  }>;
  achievements: string[];
  education: string[];
  certifications: string[];
}

export interface ParsedJdRequirements {
  hardRequirements: string[];
  softRequirements: string[];
  toolsTechKeywords: string[];
}

export interface AtsCoverageResult {
  keywordCoverage: KeywordCoverage;
  hardRequirementsMissing: string[];
}

interface ResumeCorpus {
  rawText: string;
  normalizedText: string;
  tokenSet: Set<string>;
}

const normalizeSpace = (value: string): string => value.replace(/\s+/g, " ").trim();

const normalizeForMatch = (value: string): string => normalizeSpace(value).toLowerCase();

const normalizeKeyword = (value: string): string => normalizeForMatch(value).replace(/\s+/g, " ");

const stripBulletPrefix = (line: string): string => line.replace(/^[\s\-*\u2022]+/, "").trim();

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const dedupePreserveOrder = (items: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const canonical = normalizeForMatch(item);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    result.push(item);
  }

  return result;
};

const tokenize = (value: string): string[] =>
  (value.toLowerCase().match(/[a-z0-9+#.]+/g) ?? []).filter(token => token.length > 0);

const significantTokens = (value: string): string[] =>
  tokenize(value).filter(token => {
    if (SHORT_TECH_ALLOWLIST.has(token)) return true;
    return token.length >= 3 && !STOPWORDS.has(token);
  });

const splitLineIntoClauses = (line: string): string[] =>
  line
    .split(/[;|]/g)
    .map(part => normalizeSpace(part))
    .filter(Boolean);

const detectSectionHeading = (line: string): RequirementSection | null => {
  const clean = normalizeForMatch(line.replace(/[:\-]+$/, ""));
  if (SOFT_HEADING_REGEX.test(clean)) return "soft";
  if (HARD_HEADING_REGEX.test(clean)) return "hard";
  return null;
};

export const parseJdRequirements = (jobDescription: string): ParsedJdRequirements => {
  const hardRequirements: string[] = [];
  const softRequirements: string[] = [];
  let section: RequirementSection = "neutral";

  const lines = jobDescription
    .split(/\r?\n/g)
    .map(line => stripBulletPrefix(normalizeSpace(line)))
    .filter(Boolean);

  for (const line of lines) {
    const sectionHeading = detectSectionHeading(line);
    if (sectionHeading) {
      section = sectionHeading;
      continue;
    }

    const clauses = splitLineIntoClauses(line);
    for (const clause of clauses) {
      if (section === "hard" || (HARD_SIGNAL_REGEX.test(clause) && !SOFT_SIGNAL_REGEX.test(clause))) {
        hardRequirements.push(clause);
        continue;
      }
      if (section === "soft" || SOFT_SIGNAL_REGEX.test(clause)) {
        softRequirements.push(clause);
      }
    }
  }

  // Fallback sentence parsing when bullet sections are absent.
  const sentences = jobDescription
    .split(/[.!?]\s+/g)
    .map(sentence => stripBulletPrefix(normalizeSpace(sentence)))
    .filter(Boolean);
  for (const sentence of sentences) {
    if (HARD_SIGNAL_REGEX.test(sentence) && !SOFT_SIGNAL_REGEX.test(sentence)) {
      hardRequirements.push(sentence);
    } else if (SOFT_SIGNAL_REGEX.test(sentence)) {
      softRequirements.push(sentence);
    }
  }

  const toolsTechKeywords = extractTechKeywords(jobDescription);

  return {
    hardRequirements: dedupePreserveOrder(hardRequirements),
    softRequirements: dedupePreserveOrder(softRequirements),
    toolsTechKeywords: dedupePreserveOrder(toolsTechKeywords),
  };
};

const isWholeWordMatch = (keyword: string, text: string): boolean => {
  const escaped = escapeRegex(keyword.toLowerCase());
  const pattern = new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#.]|$)`, "i");
  return pattern.test(text);
};

const extractTechKeywords = (jobDescription: string): string[] => {
  const normalizedJd = normalizeForMatch(jobDescription);
  const found: string[] = [];

  for (const keyword of KNOWN_TECH_KEYWORDS) {
    const keywordLower = keyword.toLowerCase();
    if (keywordLower.includes(" ")) {
      if (normalizedJd.includes(keywordLower)) {
        found.push(keyword);
      }
      continue;
    }
    if (isWholeWordMatch(keywordLower, normalizedJd)) {
      found.push(keyword);
    }
  }

  const acronymMatches = jobDescription.match(/\b[A-Z][A-Z0-9+#.-]{1,12}\b/g) ?? [];
  for (const acronym of acronymMatches) {
    if (acronym.length < 2) continue;
    if (!/[A-Z]/.test(acronym)) continue;
    found.push(acronym);
  }

  return dedupePreserveOrder(found);
};

const buildResumeCorpus = (resumeFacts: ResumeFactsForCoverage): ResumeCorpus => {
  const chunks: string[] = [];
  chunks.push(...resumeFacts.skills);
  chunks.push(...resumeFacts.achievements);
  chunks.push(...resumeFacts.education);
  chunks.push(...resumeFacts.certifications);
  for (const experience of resumeFacts.experience) {
    if (experience.employer) chunks.push(experience.employer);
    if (experience.role) chunks.push(experience.role);
    chunks.push(...experience.achievements);
  }

  const rawText = normalizeSpace(chunks.join(" "));
  const normalizedText = normalizeForMatch(rawText);
  return {
    rawText,
    normalizedText,
    tokenSet: new Set(tokenize(normalizedText)),
  };
};

const keywordTokenOverlapScore = (keyword: string, tokenSet: Set<string>): number => {
  const keywordTokens = significantTokens(keyword);
  if (keywordTokens.length === 0) return 0;

  let matched = 0;
  for (const token of keywordTokens) {
    if (tokenSet.has(token)) {
      matched += 1;
      continue;
    }
    if (
      token.length >= 4 &&
      Array.from(tokenSet).some(resumeToken => resumeToken.includes(token) || token.includes(resumeToken))
    ) {
      matched += 1;
    }
  }

  return matched / keywordTokens.length;
};

const classifyKeyword = (keyword: string, corpus: ResumeCorpus): "matched" | "partial" | "missing" => {
  const normalizedKeyword = normalizeKeyword(keyword);
  if (!normalizedKeyword) return "missing";

  if (normalizedKeyword.length <= 2 && !SHORT_TECH_ALLOWLIST.has(normalizedKeyword)) {
    return "missing";
  }

  if (normalizedKeyword.includes(" ")) {
    if (corpus.normalizedText.includes(normalizedKeyword)) return "matched";
    const overlap = keywordTokenOverlapScore(normalizedKeyword, corpus.tokenSet);
    if (overlap >= 0.5) return "partial";
    return "missing";
  }

  if (isWholeWordMatch(normalizedKeyword, corpus.normalizedText)) return "matched";

  if (
    normalizedKeyword.length >= 4 &&
    Array.from(corpus.tokenSet).some(token => token.includes(normalizedKeyword) || normalizedKeyword.includes(token))
  ) {
    return "partial";
  }

  return "missing";
};

const extractMaxYears = (value: string): number | null => {
  const matches = Array.from(value.matchAll(/(\d+)\s*\+?\s*(?:years|year|yrs|yr)\b/gi));
  if (matches.length === 0) return null;
  const values = matches
    .map(match => Number.parseInt(match[1], 10))
    .filter(candidate => Number.isFinite(candidate));
  if (values.length === 0) return null;
  return Math.max(...values);
};

const hardRequirementSatisfied = (
  requirement: string,
  corpus: ResumeCorpus,
  matchedKeywords: Set<string>
): boolean => {
  const normalizedRequirement = normalizeForMatch(requirement);

  for (const keyword of matchedKeywords) {
    if (normalizedRequirement.includes(keyword)) {
      return true;
    }
  }

  const tokens = significantTokens(normalizedRequirement);
  if (tokens.length > 0) {
    const matchedTokens = tokens.filter(token => corpus.tokenSet.has(token)).length;
    if (matchedTokens / tokens.length >= 0.6) {
      return true;
    }
  }

  const requiredYears = (() => {
    const match = normalizedRequirement.match(YEARS_REGEX);
    if (!match) return null;
    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  })();

  if (requiredYears !== null) {
    const resumeYears = extractMaxYears(corpus.rawText);
    if (resumeYears === null) return false;
    return resumeYears >= requiredYears;
  }

  return false;
};

export const computeAtsCoverage = (
  jobDescription: string,
  resumeFacts: ResumeFactsForCoverage
): AtsCoverageResult => {
  const parsedJd = parseJdRequirements(jobDescription);
  const corpus = buildResumeCorpus(resumeFacts);

  const matched: string[] = [];
  const partial: string[] = [];
  const missing: string[] = [];

  for (const keyword of parsedJd.toolsTechKeywords) {
    const status = classifyKeyword(keyword, corpus);
    if (status === "matched") matched.push(keyword);
    else if (status === "partial") partial.push(keyword);
    else missing.push(keyword);
  }

  const matchedKeywordSet = new Set(matched.map(keyword => normalizeForMatch(keyword)));
  const hardRequirementsMissing = parsedJd.hardRequirements.filter(
    requirement => !hardRequirementSatisfied(requirement, corpus, matchedKeywordSet)
  );

  return {
    keywordCoverage: {
      matched: dedupePreserveOrder(matched),
      missing: dedupePreserveOrder(missing),
      partial: dedupePreserveOrder(partial),
    },
    hardRequirementsMissing: dedupePreserveOrder(hardRequirementsMissing),
  };
};
