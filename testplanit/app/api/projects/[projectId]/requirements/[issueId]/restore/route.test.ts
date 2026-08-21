// Wave 0 scaffold — titles only, converted by 25-05. The route module
// (./route.ts) does not exist yet; do NOT import it here. Vite fails a
// static import at transform time, not per-assertion, so importing an
// unbuilt route would turn the whole suite RED.
import { describe, it } from "vitest";

describe("POST /api/projects/[projectId]/requirements/[issueId]/restore", () => {
  it.todo("returns 401 when there is no session");
  it.todo("returns 400 when projectId or issueId is not a number");
  it.todo("returns 400 when the request body fails schema validation");
  it.todo(
    "returns 403 when the caller is not a project admin for the addressed project"
  );
  it.todo(
    "returns 404 when the addressed issue is not a live requirement in the addressed project"
  );
  it.todo(
    "returns the restoredIds array produced by restoreRequirementSubtree"
  );
});
