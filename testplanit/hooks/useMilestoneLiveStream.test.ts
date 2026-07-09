import { describe, it } from "vitest";

/**
 * Wave 0 RED scaffold (19-01) for `useMilestoneLiveStream` /
 * `useProjectMilestoneStream` — the not-yet-created hook pair implemented
 * in Plan 02 (SSE). Mirrors `hooks/useTestRunLiveStream.ts` /
 * `useTestRunLiveStream.test.tsx` verbatim per D-14/D-15 (mirror Test
 * Runs, not the Issue-badge singleton-manager pattern — no high-
 * multiplicity-mount problem to solve here).
 *
 * Every behavior is enumerated with `it.todo(...)` rather than a failing
 * assertion so the Wave 0 suite runs green-on-todo. Deliberately NO
 * top-level import of the not-yet-existing `./useMilestoneLiveStream`
 * module — `it.todo` bodies never execute, so a static import would only
 * crash the suite at transform time for no verification benefit.
 *
 * See: .planning/phases/19-webhooks-lifecycle/19-VALIDATION.md
 *      (19-02-T3 fills these green), 19-PATTERNS.md (hook analog,
 *      latest-ref pattern, per-entity vs per-project subscribe/cleanup).
 */

describe("useMilestoneLiveStream", () => {
  it.todo(
    "opens an EventSource on /api/milestones/{milestoneId}/stream for a valid milestoneId"
  );

  it.todo("does not open a stream when disabled");

  it.todo("does not open a stream for a null or zero milestoneId");

  it.todo("invokes onWakeUp with the parsed payload on each message");

  it.todo("swallows malformed (non-JSON) messages without throwing");

  it.todo("closes the EventSource on unmount");

  it.todo("recreates the EventSource when milestoneId changes");

  it.todo(
    "does not recreate the connection when onWakeUp identity changes (latest-ref pattern)"
  );
});

describe("useProjectMilestoneStream", () => {
  it.todo(
    "opens a single EventSource on /api/projects/{projectId}/milestones/stream"
  );

  it.todo("does not open the stream when disabled");

  it.todo("does not open the stream for a null/zero/negative projectId");

  it.todo(
    "invokes onWakeUp with the parsed payload (including milestoneId) for each message"
  );

  it.todo("swallows malformed (non-JSON) messages without throwing");

  it.todo("closes the EventSource on unmount");

  it.todo("recreates the EventSource when projectId changes");

  it.todo(
    "does not recreate the connection when onWakeUp identity changes (latest-ref pattern)"
  );

  // D-15: all milestone surfaces (list cards, detail fields/badge/member
  // table/coverage, import picker) subscribe via this SAME hook pair.
  it.todo(
    "is the single shared hook pair for all milestone live-update surfaces — no bespoke third variant per D-15"
  );
});
