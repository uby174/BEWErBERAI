import { MetricsVault } from "../types";

const NUMBER_TOKEN_REGEX = /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;

const normalizeNumberToken = (value: string): string | null => {
  const compact = value.replace(/,/g, "").trim();
  if (!compact) return null;

  const numeric = Number.parseFloat(compact);
  if (!Number.isFinite(numeric)) return null;
  return numeric.toString();
};

export const extractNormalizedNumberTokens = (value: string): string[] => {
  const cleaned = value.replace(/^\s*\d+\.\s+/gm, "");
  const matches = cleaned.match(NUMBER_TOKEN_REGEX) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const token of matches) {
    const normalized = normalizeNumberToken(token);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
};

export const getAllowedMetricNumbers = (metricsVault: MetricsVault): string[] =>
  extractNormalizedNumberTokens(
    Object.values(metricsVault ?? {})
      .filter((value): value is string => typeof value === "string")
      .join(" ")
  );

export const findUnauthorizedNumbersInText = (
  text: string,
  metricsVault: MetricsVault
): string[] => {
  const allowed = new Set(getAllowedMetricNumbers(metricsVault));
  const outputNumbers = extractNormalizedNumberTokens(text);
  return outputNumbers.filter(numberToken => !allowed.has(numberToken));
};

export const findUnauthorizedNumbersForRewrite = (
  rewrite: { optimizedResume: string | null; optimizedCoverLetter: string | null },
  metricsVault: MetricsVault
): string[] => {
  const outputText = `${rewrite.optimizedResume ?? ""}\n${rewrite.optimizedCoverLetter ?? ""}`;
  return findUnauthorizedNumbersInText(outputText, metricsVault);
};
