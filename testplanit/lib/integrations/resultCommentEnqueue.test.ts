import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAdd = vi.fn();
const mockGetSyncQueue = vi.fn();
const mockGetAuditContext = vi.fn();

vi.mock("~/lib/queues", () => ({
  getSyncQueue: () => mockGetSyncQueue(),
}));
vi.mock("~/lib/auditContext", () => ({
  SYSTEM_ACTOR_ID: "__system__",
  getAuditContext: () => mockGetAuditContext(),
}));

import {
  enqueueRunResultComments,
  RESULT_COMMENT_DELAY_MS,
  resultCommentDedupId,
  resultCommentIntegrationId,
} from "./resultCommentEnqueue";

const dbWith = (projectIntegration: unknown) => ({
  projectIntegration: {
    findFirst: vi.fn().mockResolvedValue(projectIntegration),
  },
});

describe("resultCommentIntegrationId", () => {
  it("names the integration of a project that switched comments on", async () => {
    const db = dbWith({
      config: { resultComments: { enabled: true } },
      integration: { id: 14, provider: "GITHUB", authType: "GITHUB_APP" },
    });

    expect(await resultCommentIntegrationId(db, 374)).toBe(14);
    expect(db.projectIntegration.findFirst.mock.calls[0][0].where).toEqual({
      projectId: 374,
      isActive: true,
      integration: { isDeleted: false },
    });
  });

  it("is null when the switch is off, the connection cannot post, or the project has no tracker", async () => {
    for (const projectIntegration of [
      null,
      {
        config: {},
        integration: { id: 14, provider: "GITHUB", authType: "GITHUB_APP" },
      },
      {
        config: { resultComments: { enabled: true } },
        integration: { id: 14, provider: "GITHUB", authType: "OAUTH2" },
      },
    ]) {
      expect(
        await resultCommentIntegrationId(dbWith(projectIntegration), 374)
      ).toBeNull();
    }
  });

  it("is null, never an error, when the lookup fails", async () => {
    const db = {
      projectIntegration: {
        findFirst: vi.fn().mockRejectedValue(new Error("connection lost")),
      },
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await resultCommentIntegrationId(db, 374)).toBeNull();

    logged.mockRestore();
  });
});

describe("enqueueRunResultComments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdd.mockResolvedValue({ id: "job-1" });
    mockGetSyncQueue.mockReturnValue({ add: mockAdd });
    mockGetAuditContext.mockReturnValue({ userId: "user-1" });
  });

  it("queues one delayed job per run for the sync worker", async () => {
    await enqueueRunResultComments({
      runId: 81,
      projectId: 374,
      integrationId: 14,
      tenantId: "tenant-a",
    });

    expect(mockAdd).toHaveBeenCalledTimes(1);
    const [name, data, options] = mockAdd.mock.calls[0];
    expect(name).toBe("post-result-comments");
    expect(data).toMatchObject({
      userId: "user-1",
      integrationId: 14,
      projectId: "374",
      data: { runId: 81 },
      tenantId: "tenant-a",
      actorContext: { userId: "user-1" },
    });
    expect(options).toEqual({
      deduplication: {
        id: "result-comments:tenant-a:81",
        ttl: RESULT_COMMENT_DELAY_MS,
      },
      delay: RESULT_COMMENT_DELAY_MS,
      removeOnComplete: true,
    });
    expect(resultCommentDedupId(81, undefined)).toBe(
      "result-comments:default:81"
    );
  });

  it("queues as the system when nobody is behind the completion", async () => {
    mockGetAuditContext.mockReturnValue(undefined);

    await enqueueRunResultComments({
      runId: 81,
      projectId: 374,
      integrationId: 14,
    });

    expect(mockAdd.mock.calls[0][1]).toMatchObject({
      userId: "__system__",
      actorContext: {
        userId: "__system__",
        systemReason: "result-comments:run-81",
      },
    });
  });

  it("does nothing without a queue and swallows a queue failure", async () => {
    mockGetSyncQueue.mockReturnValueOnce(null);
    await enqueueRunResultComments({
      runId: 81,
      projectId: 374,
      integrationId: 14,
    });
    expect(mockAdd).not.toHaveBeenCalled();

    mockAdd.mockRejectedValueOnce(new Error("valkey down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      enqueueRunResultComments({ runId: 81, projectId: 374, integrationId: 14 })
    ).resolves.toBeUndefined();
    logged.mockRestore();
  });
});
