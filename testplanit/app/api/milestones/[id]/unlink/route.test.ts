import { describe, it } from "vitest";

/**
 * Wave 0 RED scaffold (19-01) for POST /api/milestones/[id]/unlink — the
 * not-yet-created route implemented in Plan 05 (HOOK-03). Path matches the
 * route Plan 05 creates exactly: app/api/milestones/[id]/unlink/route.ts
 * (note: [id], not [milestoneId] — see 19-PATTERNS.md route table).
 *
 * Every behavior is enumerated with `it.todo(...)` rather than a failing
 * assertion so the Wave 0 suite runs green-on-todo. Deliberately NO
 * top-level import of the not-yet-existing `./route` module — `it.todo`
 * bodies never execute, so a static import would only crash the suite at
 * transform time for no verification benefit.
 *
 * See: .planning/phases/19-webhooks-lifecycle/19-VALIDATION.md
 *      (19-05-T1 fills these green), 19-PATTERNS.md (members/overflow
 *      route.ts POST handler — the strongest analog, already resolves
 *      projectId/integrationId/externalId server-side and calls
 *      authorizeProjectMilestoneSyncAdmin).
 */

describe("POST /api/milestones/[id]/unlink", () => {
  // HOOK-03 / D-09: project-admin gated, reusing the existing
  // authorizeProjectMilestoneSyncAdmin helper unmodified.
  it.todo(
    "a project-admin session unlinks — calls convertMilestoneToLocal with reason 'manual_unlink'"
  );

  it.todo("a non-admin session gets 403 Forbidden");

  it.todo("an unauthenticated session gets 401 Unauthorized");

  // The milestone must actually be synced for unlink to make sense.
  it.todo(
    "a milestone with no externalId/integrationId (not synced) gets 400 Bad Request"
  );

  it.todo("a missing/nonexistent milestone id gets 404 Not Found");

  // Server-resolved authorization — never trust a client-supplied mapping id.
  it.todo(
    "resolves projectId/integrationId/externalId from the milestone row server-side, never from client input"
  );

  it.todo(
    "resolves the IntegrationProject mapping server-side before authorizing; missing mapping gets 404"
  );

  // Idempotency: unlinking an already-detached milestone should not error.
  it.todo(
    "calling unlink twice on an already-detached milestone is idempotent (second call succeeds as a no-op)"
  );
});
