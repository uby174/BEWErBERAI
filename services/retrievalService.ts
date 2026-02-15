import { ApplicationInput } from "../types";

type RetrievalSource = "jobDescription" | "resumeContent" | "coverLetterContent" | "companyInfo" | "additionalContext";

export interface RetrievalChunk {
  id: string;
  source: RetrievalSource;
  text: string;
  start: number;
  end: number;
  tokenEstimate: number;
}

export interface RetrievalTraceEntry {
  chunkId: string;
  reason: string;
}

const SOURCE_PRIORITY: Record<RetrievalSource, number> = {
  jobDescription: 5,
  resumeContent: 4,
  coverLetterContent: 3,
  companyInfo: 2,
  additionalContext: 1,
};

const APPROX_CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_CHARS = 900;
const DEFAULT_OVERLAP = 140;
const MIN_SPLIT_POINT = 220;

const normalizeText = (value: string): string => value.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();

const estimateTokens = (value: string): number => Math.max(1, Math.ceil(value.length / APPROX_CHARS_PER_TOKEN));

const findSplitPoint = (text: string, start: number, end: number): number => {
  const candidate = text.slice(start, end);
  const punctuation = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("! "), candidate.lastIndexOf("? "));
  if (punctuation >= MIN_SPLIT_POINT) {
    return start + punctuation + 1;
  }

  const newline = candidate.lastIndexOf("\n");
  if (newline >= MIN_SPLIT_POINT) {
    return start + newline + 1;
  }

  const whitespace = candidate.lastIndexOf(" ");
  if (whitespace >= MIN_SPLIT_POINT) {
    return start + whitespace;
  }

  return end;
};

export const chunkTextForRetrieval = (
  source: RetrievalSource,
  text: string,
  maxChars = DEFAULT_MAX_CHARS,
  overlap = DEFAULT_OVERLAP
): RetrievalChunk[] => {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const chunks: RetrievalChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < normalized.length) {
    const hardEnd = Math.min(start + maxChars, normalized.length);
    const splitPoint = hardEnd < normalized.length ? findSplitPoint(normalized, start, hardEnd) : hardEnd;
    const end = Math.max(splitPoint, Math.min(start + MIN_SPLIT_POINT, normalized.length));
    const chunkText = normalized.slice(start, end).trim();
    if (chunkText.length > 0) {
      chunks.push({
        id: `${source}:${index}:${start}-${end}`,
        source,
        text: chunkText,
        start,
        end,
        tokenEstimate: estimateTokens(chunkText),
      });
      index += 1;
    }

    if (end >= normalized.length) break;
    const nextStart = Math.max(end - overlap, start + 1);
    start = nextStart;
  }

  return chunks;
};

export const buildRetrievalChunks = (
  input: Pick<ApplicationInput, RetrievalSource>,
  maxChars = DEFAULT_MAX_CHARS,
  overlap = DEFAULT_OVERLAP
): RetrievalChunk[] => {
  const sources: RetrievalSource[] = [
    "jobDescription",
    "resumeContent",
    "coverLetterContent",
    "companyInfo",
    "additionalContext",
  ];

  return sources.flatMap(source => chunkTextForRetrieval(source, input[source] ?? "", maxChars, overlap));
};

const scoreChunk = (chunk: RetrievalChunk): number => {
  const sourceScore = SOURCE_PRIORITY[chunk.source];
  const lengthScore = Math.min(chunk.tokenEstimate / 200, 1);
  return sourceScore + lengthScore;
};

export const selectRetrievalChunks = (
  input: Pick<ApplicationInput, RetrievalSource>,
  limit = 8
): RetrievalChunk[] => {
  const chunks = buildRetrievalChunks(input);
  return chunks
    .slice()
    .sort((left, right) => {
      const scoreDelta = scoreChunk(right) - scoreChunk(left);
      if (scoreDelta !== 0) return scoreDelta;
      return left.id.localeCompare(right.id);
    })
    .slice(0, limit);
};

export const selectRetrievalChunkIds = (
  input: Pick<ApplicationInput, RetrievalSource>,
  limit = 8
): string[] => selectRetrievalChunks(input, limit).map(chunk => chunk.id);

const buildRetrievalReason = (chunk: RetrievalChunk): string => {
  const sourcePriority = SOURCE_PRIORITY[chunk.source];
  return `Prioritized ${chunk.source} chunk (sourcePriority=${sourcePriority}, tokenEstimate=${chunk.tokenEstimate}).`;
};

export const selectRetrievalTrace = (
  input: Pick<ApplicationInput, RetrievalSource>,
  limit = 8
): RetrievalTraceEntry[] =>
  selectRetrievalChunks(input, limit).map(chunk => ({
    chunkId: chunk.id,
    reason: buildRetrievalReason(chunk),
  }));
