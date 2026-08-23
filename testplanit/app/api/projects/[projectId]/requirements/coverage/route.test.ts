// Test inventory scaffold for the requirement coverage rollup route
// (COV-01/COV-02/COV-03). Titles only — converted by 26-04. See
// 26-PATTERNS.md S2 for the auth/scope shape this route follows and the
// Map-to-object serialization trap named there.

import { describe, it } from "vitest";

describe("GET /api/projects/[projectId]/requirements/coverage", () => {
  it.todo("returns 401 before it looks at the project id");
  it.todo("returns 400 for a non-numeric project id");
  it.todo(
    "returns 403 when the viewer's project scope excludes the requested project"
  );
  it.todo("passes the viewer scope straight through as accessibleProjectIds");
  it.todo(
    "serializes the service Map into a non-empty object keyed by requirement id"
  );
  it.todo("maps the service RangeError and integer guard to 400, not 500");
  it.todo("never leaks the internal error message in a 500 body");
});
