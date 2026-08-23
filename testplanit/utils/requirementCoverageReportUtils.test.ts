// Test inventory scaffold for the requirement coverage report utility
// (gaps + traceability variants, D-2/COV-04). Titles only — converted
// by 26-12. One handler derives both report variants from a single
// traceability load rather than two separate queries.

import { describe, it } from "vitest";

describe("requirementCoverageReportUtils", () => {
  it.todo("rejects a request with no projectId");
  it.todo("authorizes through the shared report request authorizer before reading");
  it.todo("returns only uncovered requirements for the gaps variant");
  it.todo("returns every requirement and covering case for the traceability variant");
  it.todo("derives both variants from one traceability load rather than two queries");
});
