import { describe, it } from "vitest";

/**
 * Wave 0 RED scaffold (19-01) for `MilestoneSyncService.convertMilestoneToLocal`
 * — the not-yet-added conversion method implemented in Plan 03 (HOOK-02).
 * Mirrors the naming convention of the sibling `.membership`/.reconciliation`/
 * `.provisioning`/`.upsert`/`.autoTrack` test files in this directory.
 *
 * Every behavior is enumerated with `it.todo(...)` rather than a failing
 * assertion so the Wave 0 suite runs green-on-todo. Deliberately NO
 * top-level import of `convertMilestoneToLocal` — `it.todo` bodies never
 * execute, so importing the not-yet-added method would only crash the
 * suite at transform/type time for no verification benefit.
 *
 * See: .planning/phases/19-webhooks-lifecycle/19-VALIDATION.md
 *      (19-03-T1/T2 fill these green), 19-RESEARCH.md Pitfall 3
 *      (detachedAt marker design — why integrationId must stay non-null),
 *      Pitfall 4 (automaticCompletion worker interaction), Pitfall 5
 *      (MilestoneIssue.source flip propagation), 19-PATTERNS.md
 *      (_upsertMilestoneShell raw-db-bypass idiom to follow).
 */

describe("MilestoneSyncService.convertMilestoneToLocal", () => {
  // HOOK-02 / Pitfall 3: integrationId is DELIBERATELY preserved — only
  // detachedAt distinguishes converted-but-still-linked from actively synced.
  it.todo(
    "sets detachedAt to the current time and keeps integrationId non-null (Pitfall 3 — never nulls integrationId)"
  );

  it.todo(
    "does NOT touch @@unique([externalId, integrationId]) — externalId stays set for re-link detection (D-07)"
  );

  // D-05 / Pitfall 5: bulk-flip all SYNCED membership links to MANUAL in the
  // SAME transaction as the detach write.
  it.todo(
    "flips all SYNCED MilestoneIssue links for the milestone to MANUAL in one transaction with the detachedAt write"
  );

  // Idempotency: a second conversion call on an already-detached milestone
  // is a clean no-op, mirroring the existing isDeleted tombstone short-circuit.
  it.todo(
    "is idempotent — calling convertMilestoneToLocal on an already-detached milestone is a no-op success"
  );

  // externalState carries THREE distinct string values in the SAME column
  // (not a new enum column) — deleted / merged / manual_unlink.
  it.todo(
    "writes externalState='deleted' for the upstream-delete conversion reason"
  );

  it.todo(
    "writes externalState='merged' for the upstream-merge conversion reason and records mergedToExternalId"
  );

  it.todo(
    "writes externalState='manual_unlink' for the admin-initiated unlink conversion reason (HOOK-03 caller)"
  );

  // Audit: a dedicated event distinct from the webhook receipt's
  // WEBHOOK_RECEIVED audit row (see applyInboundMilestoneEvent scaffold).
  it.todo(
    "emits a post-commit audit event with metadata.reason after the transaction commits"
  );

  // Raw-db write path bypassing @deny — the ONLY writer permitted through
  // the integrationId != null && detachedAt == null field locks.
  it.todo(
    "writes via the raw db client (rawDb/defaultDb), never the enhanced/policy-governed client — mirrors _upsertMilestoneShell's documented bypass contract"
  );

  // Pitfall 4: automaticCompletion force-disable / completion worker skip
  // condition must be detachedAt-aware after conversion, not just
  // integrationId-aware.
  it.todo(
    "a converted (detached) milestone is eligible for the completion worker to process again — integrationId != null alone no longer means 'skip'"
  );

  // SSE wake-up (D-13/D-14): one publish call site per write path.
  it.todo(
    "publishes a milestone wake-up event (thin payload, deferred via setImmediate, post-commit) so live subscribers refetch"
  );

  // Re-import / re-link (D-07, D-12): a later explicit re-import clears
  // detachedAt and resumes sync-locked state.
  it.todo(
    "re-importing a detached milestone through the picker clears detachedAt and re-establishes tracker-owned field locks"
  );
});
