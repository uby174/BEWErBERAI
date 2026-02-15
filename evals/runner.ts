import fs from "node:fs";
import path from "node:path";
import { runAssertions } from "./assertions";
import { buildEvalReport, EvalFixtureRunResult, writeEvalReport } from "./report";
import { analyzeApplication, AnalysisRuntimeOptions, StageRequestTrace } from "../services/geminiService";
import { AnalysisMode, ApplicationInput, MetricsVault } from "../types";

interface FixtureConfig {
  id: string;
  directory: string;
  companyInfo: string;
  portfolioLinks: string;
  additionalContext: string;
  privacyMode: boolean;
  metricsVault: MetricsVault;
}

const FIXTURE_ROOT = path.resolve(process.cwd(), "evals", "fixtures");
const TIERS: AnalysisMode[] = ["fast", "balanced", "deep"];
const USE_REAL_API = /^(1|true)$/i.test(process.env.EVALS_REAL_API ?? "");
const REAL_API_KEY =
  process.env.VITE_GEMINI_API_KEY?.trim() ||
  process.env.GEMINI_API_KEY?.trim() ||
  "";

const FIXTURES: FixtureConfig[] = [
  {
    id: "A_missing-hard-requirement",
    directory: "a-missing-hard-requirement",
    companyInfo: "Berlin, Germany. Platform ML team.",
    portfolioLinks: "https://github.com/example/mlops",
    additionalContext: "Prioritize must-have requirement coverage.",
    privacyMode: false,
    metricsVault: {
      projectImpact: "Improved X",
    },
  },
  {
    id: "B_metrics-vault-empty",
    directory: "b-metrics-vault-empty",
    companyInfo: "Remote USA SaaS team.",
    portfolioLinks: "https://github.com/example/fullstack",
    additionalContext: "No approved metrics provided.",
    privacyMode: false,
    metricsVault: {},
  },
  {
    id: "C_privacy-redaction",
    directory: "c-privacy-redaction",
    companyInfo: "Munich, Germany AI product group.",
    portfolioLinks: "https://github.com/example/applied-ai",
    additionalContext: "Preserve privacy with strict redaction.",
    privacyMode: true,
    metricsVault: {},
  },
];

const readFixtureFile = (fixtureDirectory: string, fileName: string): string => {
  const fullPath = path.join(FIXTURE_ROOT, fixtureDirectory, fileName);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8").trim() : "";
};

const toInput = (fixture: FixtureConfig, tier: AnalysisMode): ApplicationInput => ({
  jobDescription: readFixtureFile(fixture.directory, "jd.txt"),
  resumeContent: readFixtureFile(fixture.directory, "resume.txt"),
  coverLetterContent: readFixtureFile(fixture.directory, "cover.txt"),
  companyInfo: fixture.companyInfo,
  portfolioLinks: fixture.portfolioLinks,
  additionalContext: fixture.additionalContext,
  analysisMode: tier,
  privacyMode: fixture.privacyMode,
  metricsVault: fixture.metricsVault,
});

const createStagePromptCollector = () => {
  const prompts: Record<"extractFacts" | "scoreMatch" | "rewriteDocs", string[]> = {
    extractFacts: [],
    scoreMatch: [],
    rewriteDocs: [],
  };

  const onStageRequest = (trace: StageRequestTrace) => {
    prompts[trace.stageName].push(trace.prompt);
  };

  return { prompts, onStageRequest };
};

const evaluateSingleRun = async (fixture: FixtureConfig, tier: AnalysisMode): Promise<EvalFixtureRunResult> => {
  const input = toInput(fixture, tier);
  const { prompts, onStageRequest } = createStagePromptCollector();
  const runtimeOptions: AnalysisRuntimeOptions = {
    modelMode: USE_REAL_API ? "real" : "mock",
    apiKey: USE_REAL_API ? REAL_API_KEY : undefined,
    onStageRequest,
  };

  const startedAt = Date.now();

  try {
    const result = await analyzeApplication(input, runtimeOptions);
    const assertionResults = runAssertions({
      fixtureId: fixture.id,
      tier,
      input,
      result,
      outboundStagePrompts: prompts,
    });
    const pass = assertionResults.every(assertion => assertion.pass);

    return {
      fixtureId: fixture.id,
      tier,
      durationMs: Date.now() - startedAt,
      pass,
      assertionResults,
    };
  } catch (error) {
    return {
      fixtureId: fixture.id,
      tier,
      durationMs: Date.now() - startedAt,
      pass: false,
      assertionResults: [
        {
          name: "pipeline execution",
          pass: false,
          details: String(error),
        },
      ],
      error: String(error),
    };
  }
};

const main = async (): Promise<void> => {
  if (USE_REAL_API && !REAL_API_KEY) {
    throw new Error("EVALS_REAL_API is enabled but no VITE_GEMINI_API_KEY/GEMINI_API_KEY is set.");
  }

  const runs: EvalFixtureRunResult[] = [];
  for (const fixture of FIXTURES) {
    for (const tier of TIERS) {
      const run = await evaluateSingleRun(fixture, tier);
      runs.push(run);
      const status = run.pass ? "PASS" : "FAIL";
      console.log(`[${status}] ${run.fixtureId} :: ${tier} (${run.durationMs} ms)`);
      if (!run.pass) {
        run.assertionResults
          .filter(assertion => !assertion.pass)
          .forEach(assertion => {
            console.log(`  - ${assertion.name}: ${assertion.details ?? "failed"}`);
          });
      }
    }
  }

  const report = buildEvalReport(runs);
  writeEvalReport(report);

  console.log("");
  console.log(`Eval summary: ${report.summary.passedRuns}/${report.summary.totalRuns} passed.`);
  console.log(`Report written to evals/report.json`);

  if (report.summary.failedRuns > 0) {
    process.exitCode = 1;
  }
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
