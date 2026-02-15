import { describe, expect, it } from "vitest";
import { selectRetrievalChunkIds } from "../services/retrievalService";
import { ApplicationInput } from "../types";

const buildInput = (): ApplicationInput => ({
  jobDescription:
    "We need a Senior ML Engineer with Python, SQL, and AWS. Build production pipelines and improve latency.",
  companyInfo: "Berlin, Germany. Team focused on experimentation and reliable delivery.",
  resumeContent:
    "Senior Data Scientist at ExampleCorp. Built ML pipelines in Python and SQL on AWS. Reduced latency by 120ms.",
  coverLetterContent: "I align product and ML teams and ship measurable outcomes.",
  portfolioLinks: "https://github.com/example",
  additionalContext: "deep analysis not requested",
  analysisMode: "balanced",
  privacyMode: true,
  metricsVault: {
    latencyReduction: "120ms",
    projectImpact: "18%",
  },
});

describe("retrieval chunk selection determinism", () => {
  it("returns stable chunk ids for identical input", () => {
    const input = buildInput();
    const first = selectRetrievalChunkIds(input, 6);
    const second = selectRetrievalChunkIds(input, 6);
    expect(first).toEqual(second);
  });

  it("is deterministic despite irrelevant whitespace differences", () => {
    const inputA = buildInput();
    const inputB = {
      ...buildInput(),
      resumeContent: `  ${buildInput().resumeContent}\n\n`,
    };

    const first = selectRetrievalChunkIds(inputA, 6);
    const second = selectRetrievalChunkIds(inputB, 6);
    expect(first).toEqual(second);
  });
});
