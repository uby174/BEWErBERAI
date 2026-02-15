import { describe, expect, it } from "vitest";
import { prepareApplicationForGemini, reinsertRedactedPii } from "../services/privacyService";
import { ApplicationInput } from "../types";

const baseInput = (): ApplicationInput => ({
  jobDescription: "ML engineer role in Berlin, Germany.",
  companyInfo: "Remote-first team.",
  resumeContent:
    "John Doe, born 01/12/1990. Email john.doe@example.com, phone +1 (415) 555-1212. Address 221 Baker Street. Senior ML Engineer at DataCorp in Berlin.",
  coverLetterContent: "Passport number: X1234567.",
  portfolioLinks: "https://github.com/johndoe",
  additionalContext: "Please use my verified contact information.",
  analysisMode: "balanced",
  privacyMode: true,
  metricsVault: {
    projectImpact: "18%",
    usersServed: "2.3M users",
  },
});

describe("PII redaction", () => {
  it("redacts targeted PII while keeping city/country and role history", () => {
    const prepared = prepareApplicationForGemini(baseInput());
    const text = prepared.sanitizedInput.resumeContent;

    expect(text).toContain("[PII_EMAIL_1]");
    expect(text).toContain("[PII_PHONE_1]");
    expect(text).toContain("[PII_STREET_ADDRESS_1]");
    expect(text).toContain("[PII_BIRTH_DATE_1]");
    expect(prepared.sanitizedInput.coverLetterContent).toContain("[PII_PERSONAL_ID_1]");

    expect(text).toContain("Berlin");
    expect(prepared.sanitizedInput.jobDescription).toContain("Germany");
    expect(text).toContain("Senior ML Engineer");
  });

  it("re-inserts original values exactly", () => {
    const prepared = prepareApplicationForGemini(baseInput());
    const draft = `Contact: [PII_EMAIL_1], [PII_PHONE_1], [PII_STREET_ADDRESS_1]`;
    const restored = reinsertRedactedPii(draft, prepared.redactionEntries);

    expect(restored).toContain("john.doe@example.com");
    expect(restored).toContain("+1 (415) 555-1212");
    expect(restored).toContain("221 Baker Street");
  });
});
