import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  emitIssueCreated,
  emitIssueDeleted,
  emitIssueUpdated,
} from "./issueEvents";

/**
 * issueEvents emitter contract.
 *
 * Catalog: issue.created / issue.updated / issue.deleted ONLY. NO dedicated
 * resolution event — consumers detect resolution by filtering
 * issue.updated.diff.changedFields.includes("status").
 *
 * issue.created payload MUST carry `linkedRefs` with the IDs of all six
 * related collections. Tests assert presence of every key, even when
 * relations are empty.
 */

vi.mock("~/lib/webhooks/events", () => ({
  webhookEvents: {
    emit: vi.fn(async () => ({
      eventId: "evt_xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
      outboxRowId: "row_1",
    })),
  },
}));

import { webhookEvents } from "~/lib/webhooks/events";

const emitMock = webhookEvents.emit as unknown as ReturnType<typeof vi.fn>;

interface TxStub {
  issue: { findUnique: ReturnType<typeof vi.fn> };
}

function makeTx(
  linked: Partial<{
    repositoryCases: Array<{ id: number }>;
    testRuns: Array<{ id: number }>;
    testRunResults: Array<{ id: number }>;
    testRunStepResults: Array<{ id: number }>;
    sessions: Array<{ id: number }>;
    sessionResults: Array<{ id: number }>;
  }> = {}
): TxStub {
  return {
    issue: {
      findUnique: vi.fn(async () => ({
        // tags/issues implicit m2m -> explicit join model: a case's link to an
        // issue is now read via caseIssues:[{case:{id}}] (RepositoryCaseIssue).
        caseIssues: (linked.repositoryCases ?? []).map((c) => ({ case: c })),
        testRuns: linked.testRuns ?? [],
        testRunResults: linked.testRunResults ?? [],
        testRunStepResults: linked.testRunStepResults ?? [],
        sessions: linked.sessions ?? [],
        sessionResults: linked.sessionResults ?? [],
      })),
    },
  };
}

const baseIssue = {
  id: 42,
  name: "issue-42",
  title: "Login is broken",
  status: "open",
  priority: "high",
  externalId: null,
  externalKey: null,
  externalUrl: null,
  externalStatus: null,
  issueTypeName: null,
  projectId: 7,
  integrationId: null,
};

describe("emitIssueCreated", () => {
  beforeEach(() => emitMock.mockClear());

  it("emits issue.created with id/title/status/projectId", async () => {
    const tx = makeTx();
    await emitIssueCreated(baseIssue, tx as never);
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload] = emitMock.mock.calls[0];
    expect(eventName).toBe("issue.created");
    expect(payload).toMatchObject({
      id: 42,
      name: "issue-42",
      title: "Login is broken",
      status: "open",
      projectId: 7,
    });
  });

  it("payload includes linkedRefs with IDs of all six related collections", async () => {
    const tx = makeTx({
      repositoryCases: [{ id: 100 }, { id: 101 }],
      testRuns: [{ id: 200 }],
      testRunResults: [{ id: 300 }],
      testRunStepResults: [{ id: 400 }, { id: 401 }],
      sessions: [{ id: 500 }],
      sessionResults: [{ id: 600 }, { id: 601 }, { id: 602 }],
    });
    await emitIssueCreated(baseIssue, tx as never);
    const [, payload] = emitMock.mock.calls[0];
    expect(payload).toMatchObject({
      linkedRefs: {
        repositoryCaseIds: [100, 101],
        testRunIds: [200],
        testRunResultIds: [300],
        testRunStepResultIds: [400, 401],
        sessionIds: [500],
        sessionResultIds: [600, 601, 602],
      },
    });
  });

  it("linkedRefs has all six array keys even when relations are empty", async () => {
    const tx = makeTx(); // all empty
    await emitIssueCreated(baseIssue, tx as never);
    const [, payload] = emitMock.mock.calls[0];
    const refs = (payload as { linkedRefs: Record<string, number[]> })
      .linkedRefs;
    expect(Object.keys(refs).sort()).toEqual([
      "repositoryCaseIds",
      "sessionIds",
      "sessionResultIds",
      "testRunIds",
      "testRunResultIds",
      "testRunStepResultIds",
    ]);
    for (const key of Object.keys(refs)) {
      expect(refs[key]).toEqual([]);
    }
  });

  it("returns silently when projectId is null (integration-only issue)", async () => {
    const tx = makeTx();
    await emitIssueCreated({ ...baseIssue, projectId: null }, tx as never);
    expect(emitMock).not.toHaveBeenCalled();
  });
});

describe("emitIssueUpdated", () => {
  beforeEach(() => emitMock.mockClear());

  it("does NOT emit when oldRow === newRow (zero diff)", async () => {
    const tx = makeTx();
    await emitIssueUpdated(baseIssue, baseIssue, tx as never);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("emits issue.updated with diff.changedFields populated", async () => {
    const tx = makeTx();
    await emitIssueUpdated(
      { ...baseIssue, status: "open" },
      { ...baseIssue, status: "closed" },
      tx as never
    );
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload] = emitMock.mock.calls[0];
    expect(eventName).toBe("issue.updated");
    const diff = (payload as { diff: { changedFields: string[] } }).diff;
    expect(diff.changedFields).toContain("status");
  });

  it('status change is detectable by the consumer-side `changedFields.includes("status")` pattern (resolution detection)', async () => {
    const tx = makeTx();
    await emitIssueUpdated(
      { ...baseIssue, status: "open" },
      { ...baseIssue, status: "resolved" },
      tx as never
    );
    const diff = (
      emitMock.mock.calls[0][1] as { diff: { changedFields: string[] } }
    ).diff;
    expect(diff.changedFields.includes("status")).toBe(true);
  });

  it("returns silently when oldRow is null", async () => {
    const tx = makeTx();
    await emitIssueUpdated(null, baseIssue, tx as never);
    expect(emitMock).not.toHaveBeenCalled();
  });
});

describe("emitIssueDeleted", () => {
  beforeEach(() => emitMock.mockClear());

  it("emits issue.deleted with id + title from the pre-delete snapshot", async () => {
    const tx = makeTx();
    await emitIssueDeleted(baseIssue, tx as never);
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload] = emitMock.mock.calls[0];
    expect(eventName).toBe("issue.deleted");
    expect(payload).toMatchObject({
      id: 42,
      title: "Login is broken",
      projectId: 7,
    });
  });
});
