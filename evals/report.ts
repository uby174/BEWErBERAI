import fs from "node:fs";
import path from "node:path";
import { EvalAssertionResult } from "./assertions";

export interface EvalFixtureRunResult {
  fixtureId: string;
  tier: string;
  durationMs: number;
  pass: boolean;
  assertionResults: EvalAssertionResult[];
  error?: string;
}

export interface EvalReport {
  generatedAt: string;
  summary: {
    totalRuns: number;
    passedRuns: number;
    failedRuns: number;
  };
  runs: EvalFixtureRunResult[];
}

export const buildEvalReport = (runs: EvalFixtureRunResult[]): EvalReport => {
  const passedRuns = runs.filter(run => run.pass).length;
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalRuns: runs.length,
      passedRuns,
      failedRuns: runs.length - passedRuns,
    },
    runs,
  };
};

export const writeEvalReport = (report: EvalReport, outputPath = path.resolve(process.cwd(), "evals", "report.json")): void => {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
};
