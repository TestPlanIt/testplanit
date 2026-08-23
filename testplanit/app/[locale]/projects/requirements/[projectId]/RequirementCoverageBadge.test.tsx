// Test inventory scaffold for the requirement coverage badge (COV-01,
// COV-03, D-1). Titles only — converted by 26-05. Do not import
// CoverageChip's CoverageBreakdown/hasCompletedCoverage/coverageSortValue
// helpers when implementing this suite; see 26-PATTERNS.md Trap 1.

import { describe, it } from "vitest";

describe("RequirementCoverageBadge", () => {
  it.todo("renders the dashed warning treatment for an uncovered requirement");
  it.todo("renders passed, failed, and not-run states distinctly from each other");
  it.todo("renders the passed-over-total count alongside the status");
  it.todo(
    "derives its status from the breakdown it is given rather than recomputing a ladder"
  );
  it.todo("carries the full four-counter breakdown in its tooltip and aria-label");
  it.todo("never renders an uncovered treatment for a requirement with passing cases");
  it.todo(
    "encodes the row priority as distinct shrink weights: provenance above coverage above the name"
  );
});
