// Test inventory scaffold for the pure requirement traceability export
// shaping module (COV-04). Titles only — converted by 26-08. This module
// must stay free of any runtime dependency on Prisma or any server-only
// module, mirroring lib/services/milestoneExport.ts's split (26-PATTERNS.md
// "Traceability matrix export").

import { describe, it } from "vitest";

describe("requirementTraceabilityExport", () => {
  it.todo("builds a hierarchy path from a requirement's ancestors");
  it.todo("emits one row per requirement and covering case, ordered by path then case name");
  it.todo("emits a null caseName row for an uncovered requirement");
  it.todo("emits a null statusName for a covering case with no execution");
  it.todo("derives the gap rows as exactly the null-case rows");
  it.todo("imports no server-only module");
});
