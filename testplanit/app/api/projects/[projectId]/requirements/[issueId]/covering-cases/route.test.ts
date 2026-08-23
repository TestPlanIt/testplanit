// Test inventory scaffold for the requirement covering-cases drill-down
// route. Titles only — converted by 26-07. The route wraps the same
// closure builder the rollup consumes (26-PATTERNS.md, "Covering-case
// drill-down") so it can never resolve a different case set than the
// badge sitting above it.

import { describe, it } from "vitest";

describe(
  "GET /api/projects/[projectId]/requirements/[issueId]/covering-cases",
  () => {
    it.todo(
      "returns 404 when the addressed issue is not a live requirement in this project"
    );
    it.todo("returns 404 when the addressed id is a defect rather than a requirement");
    it.todo("returns 403 before it performs the row lookup");
    it.todo("returns the extended covering-case rows with each case's latest result");
    it.todo(
      "marks a case linked directly to this requirement as direct and an inherited one as not"
    );
    it.todo("returns an empty list, not an error, for a requirement with no covering cases");
  }
);
