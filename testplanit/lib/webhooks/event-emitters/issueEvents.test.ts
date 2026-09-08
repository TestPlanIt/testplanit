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
 *
 * Multi-project fan-out: created/updated write ONE outbox row per unique
 * project in {home project} ∪ {projects of the linked entities}. Delete is
 * routed to the home project only.
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

const HOME_PROJECT = 7;

interface TxStub {
  issue: { findUnique: ReturnType<typeof vi.fn> };
}

type LinkedItem = { id: number; projectId?: number };

/**
 * Build a tx stub whose `issue.findUnique` returns the six linked collections
 * in the exact nested shape `loadIssueLinkage` selects. Each linked item may
 * carry its own `projectId`; when omitted it defaults to the issue's home
 * project so single-project tests route to exactly one destination.
 */
function makeTx(
  linked: Partial<{
    repositoryCases: LinkedItem[];
    testRuns: LinkedItem[];
    testRunResults: LinkedItem[];
    testRunStepResults: LinkedItem[];
    sessions: LinkedItem[];
    sessionResults: LinkedItem[];
  }> = {}
): TxStub {
  const p = (item: LinkedItem) => item.projectId ?? HOME_PROJECT;
  return {
    issue: {
      findUnique: vi.fn(async () => ({
        // A case's link to an issue is read via caseIssues:[{case:{id,projectId}}]
        // (the RepositoryCaseIssue join model).
        caseIssues: (linked.repositoryCases ?? []).map((c) => ({
          case: { id: c.id, projectId: p(c) },
        })),
        testRuns: (linked.testRuns ?? []).map((r) => ({
          id: r.id,
          projectId: p(r),
        })),
        testRunResults: (linked.testRunResults ?? []).map((r) => ({
          id: r.id,
          testRun: { projectId: p(r) },
        })),
        testRunStepResults: (linked.testRunStepResults ?? []).map((r) => ({
          id: r.id,
          testRunResult: { testRun: { projectId: p(r) } },
        })),
        sessions: (linked.sessions ?? []).map((r) => ({
          id: r.id,
          projectId: p(r),
        })),
        sessionResults: (linked.sessionResults ?? []).map((r) => ({
          id: r.id,
          session: { projectId: p(r) },
        })),
      })),
    },
  };
}

/** Collect the routing projectId (emit opts) from every emit call, sorted. */
function routedProjectIds(): number[] {
  return emitMock.mock.calls
    .map((c) => (c[2] as { projectId: number }).projectId)
    .sort((a, b) => a - b);
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
  projectId: HOME_PROJECT,
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

  it("returns silently when projectId is null and there are no linked entities", async () => {
    const tx = makeTx();
    await emitIssueCreated({ ...baseIssue, projectId: null }, tx as never);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("fans out one outbox row per unique linked project (home + two others)", async () => {
    const tx = makeTx({
      testRuns: [{ id: 200, projectId: 8 }],
      sessions: [{ id: 500, projectId: 9 }],
    });
    await emitIssueCreated(baseIssue, tx as never);
    expect(emitMock).toHaveBeenCalledTimes(3);
    expect(routedProjectIds()).toEqual([7, 8, 9]);
    // Every fan-out row carries the same issue.created payload (home projectId).
    for (const call of emitMock.mock.calls) {
      expect(call[0]).toBe("issue.created");
      expect((call[1] as { id: number; projectId: number | null }).id).toBe(42);
      expect((call[1] as { projectId: number | null }).projectId).toBe(7);
    }
  });

  it("deduplicates projects — many links in one project route to a single row", async () => {
    const tx = makeTx({
      testRuns: [{ id: 200, projectId: 8 }],
      testRunResults: [{ id: 300, projectId: 8 }],
      sessions: [{ id: 500, projectId: 8 }],
    });
    await emitIssueCreated({ ...baseIssue, projectId: null }, tx as never);
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(routedProjectIds()).toEqual([8]);
  });

  it("integration-only issue (null home) still routes to its linked project", async () => {
    const tx = makeTx({ testRuns: [{ id: 200, projectId: 8 }] });
    await emitIssueCreated({ ...baseIssue, projectId: null }, tx as never);
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(routedProjectIds()).toEqual([8]);
    expect(
      (emitMock.mock.calls[0][1] as { projectId: number | null }).projectId
    ).toBeNull();
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

  it("fans out a status change to home + every linked project", async () => {
    const tx = makeTx({
      testRuns: [{ id: 200, projectId: 8 }],
      sessionResults: [{ id: 600, projectId: 9 }],
    });
    await emitIssueUpdated(
      { ...baseIssue, status: "open" },
      { ...baseIssue, status: "resolved" },
      tx as never
    );
    expect(emitMock).toHaveBeenCalledTimes(3);
    expect(routedProjectIds()).toEqual([7, 8, 9]);
    for (const call of emitMock.mock.calls) {
      expect(call[0]).toBe("issue.updated");
      expect(
        (call[1] as { diff: { changedFields: string[] } }).diff.changedFields
      ).toContain("status");
    }
  });

  it("returns silently when oldRow is null", async () => {
    const tx = makeTx();
    await emitIssueUpdated(null, baseIssue, tx as never);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("returns silently when null home and no linked entities", async () => {
    const tx = makeTx();
    await emitIssueUpdated(
      { ...baseIssue, projectId: null, status: "open" },
      { ...baseIssue, projectId: null, status: "closed" },
      tx as never
    );
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

  it("is routed to the home project only (no cross-project fan-out on delete)", async () => {
    const tx = makeTx();
    await emitIssueDeleted(baseIssue, tx as never);
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(routedProjectIds()).toEqual([7]);
  });

  it("returns silently when the deleted issue had no home project", async () => {
    const tx = makeTx();
    await emitIssueDeleted({ ...baseIssue, projectId: null }, tx as never);
    expect(emitMock).not.toHaveBeenCalled();
  });
});
