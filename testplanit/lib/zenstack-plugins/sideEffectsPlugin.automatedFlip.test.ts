/**
 * Version snapshots for `RepositoryCases.automated` changes.
 *
 * Automation Trends reads a case's automated state off its version timeline,
 * so the hook must snapshot every flag change that reaches the hooked client
 * — and only those, or every caller that already snapshots for itself would
 * double up. The routing is what's under test; the snapshot itself is
 * covered by caseAutomatedVersioning.test.ts and the live-DB suite.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/services/sessionSearch", () => ({
  syncSessionToElasticsearch: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/services/testRunSearch", () => ({
  syncTestRunToElasticsearch: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/lib/webhooks/event-emitters/caseEvents", () => ({
  emitCaseCreated: vi.fn(() => Promise.resolve()),
  emitCaseUpdated: vi.fn(() => Promise.resolve()),
  emitCaseDeleted: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/lib/services/reviewCancellation", () => ({
  cancelReviewsForDeletedEntities: vi.fn(() => Promise.resolve([])),
  announceDeletionCancelledReviews: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/lib/services/caseAutomatedVersioning", () => ({
  snapshotAutomatedFlip: vi.fn(() => Promise.resolve()),
}));

import { snapshotAutomatedFlip } from "~/lib/services/caseAutomatedVersioning";
import { sideEffectsPlugin } from "./sideEffectsPlugin";

const afterEntityMutation = (sideEffectsPlugin as any).onEntityMutation
  .afterEntityMutation;

/** A plugin-free client the hook derives from the mutation's client. */
const plainClient = { tag: "unuseAll" };
const hookClient = { $unuseAll: vi.fn(() => plainClient) };

function caseRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    projectId: 5,
    stateId: 3,
    isDeleted: false,
    automated: false,
    currentVersion: 1,
    ...overrides,
  };
}

function caseUpdate(before: unknown[] | undefined, after: unknown[]) {
  return afterEntityMutation({
    model: "RepositoryCases",
    action: before ? "update" : "create",
    client: hookClient,
    loadAfterMutationEntities: async () => after,
    beforeMutationEntities: before,
  });
}

describe("sideEffectsPlugin — automated flag version snapshots", () => {
  beforeEach(() => vi.clearAllMocks());

  it("snapshots a manual→automated flip on the plugin-free transaction client", async () => {
    await caseUpdate(
      [caseRow({ automated: false })],
      [caseRow({ automated: true })]
    );

    expect(hookClient.$unuseAll).toHaveBeenCalledTimes(1);
    expect(snapshotAutomatedFlip).toHaveBeenCalledTimes(1);
    expect(snapshotAutomatedFlip).toHaveBeenCalledWith(plainClient, 1);
  });

  it("snapshots a revert (automated→manual)", async () => {
    await caseUpdate(
      [caseRow({ automated: true })],
      [caseRow({ automated: false })]
    );
    expect(snapshotAutomatedFlip).toHaveBeenCalledWith(plainClient, 1);
  });

  it("does nothing when the flag did not change", async () => {
    await caseUpdate(
      [caseRow({ automated: true, name: "a" })],
      [caseRow({ automated: true, name: "b" })]
    );
    expect(snapshotAutomatedFlip).not.toHaveBeenCalled();
    expect(hookClient.$unuseAll).not.toHaveBeenCalled();
  });

  it("leaves the snapshot to a caller that bumped currentVersion in the same write", async () => {
    await caseUpdate(
      [caseRow({ automated: false, currentVersion: 4 })],
      [caseRow({ automated: true, currentVersion: 5 })]
    );
    expect(snapshotAutomatedFlip).not.toHaveBeenCalled();
  });

  it("ignores creates — the creator writes version 1", async () => {
    await caseUpdate(undefined, [caseRow({ automated: true })]);
    expect(snapshotAutomatedFlip).not.toHaveBeenCalled();
  });

  it("pairs before and after rows by id, not by position, for a multi-row update", async () => {
    // Before rows come back in the opposite order to the RETURNING rows.
    // Only case 2 flips; positional pairing would snapshot 1 and 3 instead.
    await caseUpdate(
      [
        caseRow({ id: 3, automated: true }),
        caseRow({ id: 2, automated: false }),
        caseRow({ id: 1, automated: false }),
      ],
      [
        caseRow({ id: 1, automated: false }),
        caseRow({ id: 2, automated: true }),
        caseRow({ id: 3, automated: true }),
      ]
    );
    expect(snapshotAutomatedFlip).toHaveBeenCalledTimes(1);
    expect(snapshotAutomatedFlip).toHaveBeenCalledWith(plainClient, 2);
  });

  it("snapshots every flipped row of an updateMany", async () => {
    await caseUpdate(
      [
        caseRow({ id: 1, automated: false }),
        caseRow({ id: 2, automated: false }),
      ],
      [caseRow({ id: 1, automated: true }), caseRow({ id: 2, automated: true })]
    );
    expect(snapshotAutomatedFlip).toHaveBeenCalledTimes(2);
    expect(snapshotAutomatedFlip).toHaveBeenCalledWith(plainClient, 1);
    expect(snapshotAutomatedFlip).toHaveBeenCalledWith(plainClient, 2);
  });
});
