import { describe, it } from "vitest";

// CFG-01 route authorization scaffold for the requirements-config write
// route. Wave 0 scaffold convention: todo-only entries below, no
// implementation. Deliberately does NOT import "./route" — Vite fails a
// static import at transform time (not per-assertion) when the route file
// is absent, which would take the whole unit lane down for every plan
// running in parallel. Plan 22-03 adds the route file and the import in
// the same commit that converts these titles.

describe("requirements-config route", () => {
  it.todo("rejects an unauthenticated caller with 401");
  it.todo("rejects a caller who is not a project admin with 403");
  it.todo(
    "rejects a projectId that does not own the addressed integration with 404"
  );
  it.todo("rejects a malformed issueTypeIds payload with 400");
  it.todo(
    "writes the config and the classification recompute inside one audited transaction"
  );
  it.todo("preserves the milestoneSync namespace on the shared config column");
});
