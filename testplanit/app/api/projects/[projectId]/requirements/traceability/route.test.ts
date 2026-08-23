// Test inventory scaffold for the requirement traceability export route
// (COV-04). Titles only — converted by 26-08. This route composes the
// shipped rollup + drill-down services rather than hand-rolling a third
// "latest result" query (26-PATTERNS.md, "Traceability matrix export").

import { describe, it } from "vitest";

describe("GET /api/projects/[projectId]/requirements/traceability", () => {
  it.todo("returns 401 then 400 then 403 in that order");
  it.todo("emits one row per requirement and covering case");
  it.todo("emits a single null-case row for a requirement with zero covering cases");
  it.todo("stamps generatedAt and projectId onto the envelope");
});
