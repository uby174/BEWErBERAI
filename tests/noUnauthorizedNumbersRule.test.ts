import { describe, expect, it } from "vitest";
import { findUnauthorizedNumbersForRewrite, getAllowedMetricNumbers } from "../services/metricsGuardService";
import { MetricsVault } from "../types";

const metricsVault: MetricsVault = {
  projectImpact: "conversion +18%",
  latencyReduction: "p95 latency reduced by 120 ms",
  costSavings: "$40,000 annual savings",
  usersServed: "2.3M monthly users",
  uptime: "99.95% uptime",
};

describe("no unauthorized numbers rule", () => {
  it("extracts allowed numeric tokens from metrics vault", () => {
    const allowed = getAllowedMetricNumbers(metricsVault);
    expect(allowed).toEqual(expect.arrayContaining(["18", "120", "40000", "2.3", "99.95"]));
  });

  it("flags numbers not present in metrics vault", () => {
    const unauthorized = findUnauthorizedNumbersForRewrite(
      {
        optimizedResume: "Improved conversion by 18% and retention by 42%.",
        optimizedCoverLetter: "Reduced latency by 120 ms.",
      },
      metricsVault
    );

    expect(unauthorized).toContain("42");
    expect(unauthorized).not.toContain("18");
    expect(unauthorized).not.toContain("120");
  });
});
