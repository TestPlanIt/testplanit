import type { AdapterType } from "~/zenstack/models";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApplyInboundMilestoneEventInput } from "./types";

/**
 * Hoisted mocks mirroring `applyInboundIssueUpdate.test.ts`'s shape:
 * `baseDb` (delivery-log tx + post-commit lookups), `captureAuditEvent`,
 * `getAdapter` (adapter-side `extractMilestoneEventRef`), `integrationManager`
 * (board->project resolution for sprint events), and `milestoneSyncService`
 * (refresh/convert dispatch targets).
 */
const mocks = vi.hoisted(() => {
  const tx = {
    webhookDelivery: {
      create: vi.fn(),
      update: vi.fn(),
    },
    webhookEventDedup: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    webhookConfig: {
      update: vi.fn(),
    },
  };
  const $transaction = vi.fn(async (fn: any) => fn(tx));
  const integrationProjectFindMany = vi.fn(
    async (..._args: any[]): Promise<any[]> => []
  );
  const projectIntegrationFindUnique = vi.fn(
    async (..._args: any[]): Promise<any> => null
  );
  const milestonesFindMany = vi.fn(
    async (..._args: any[]): Promise<any[]> => []
  );
  const adapter = {
    adapterType: "JIRA" as AdapterType,
    verify: vi.fn(),
    extractLinkedIssueRef: vi.fn(),
    extractExternalStatus: vi.fn(),
    extractMilestoneEventRef: vi.fn(),
  };
  const getAdapter = vi.fn(() => adapter);
  const performMilestoneRefresh = vi.fn(async () => ({ success: true }));
  const performMilestoneImport = vi.fn(async () => ({
    success: true,
    imported: 1,
    updated: 0,
    errors: [] as string[],
    membershipErrors: [] as string[],
  }));
  const convertMilestoneToLocal = vi.fn(async () => ({ success: true }));
  const boardAdapter = {
    resolveBoardProject: vi.fn(async (..._args: any[]): Promise<any> => null),
  };
  const integrationManagerGetAdapter = vi.fn(
    async (..._args: any[]): Promise<any> => boardAdapter
  );
  return {
    tx,
    baseDb: {
      $transaction,
      integrationProject: {
        findMany: integrationProjectFindMany,
      },
      projectIntegration: { findUnique: projectIntegrationFindUnique },
      milestones: { findMany: milestonesFindMany },
    },
    captureAuditEvent: vi.fn(async () => undefined),
    adapter,
    getAdapter,
    milestoneSyncService: {
      performMilestoneRefresh,
      performMilestoneImport,
      convertMilestoneToLocal,
    },
    performMilestoneRefresh,
    performMilestoneImport,
    convertMilestoneToLocal,
    integrationManager: { getAdapter: integrationManagerGetAdapter },
    integrationManagerGetAdapter,
    boardAdapter,
    integrationProjectFindMany,
    projectIntegrationFindUnique,
    milestonesFindMany,
  };
});

vi.mock("~/lib/db", () => ({
  baseDb: mocks.baseDb,
}));

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: mocks.captureAuditEvent,
}));

vi.mock("~/lib/webhooks/adapters", () => ({
  getAdapter: mocks.getAdapter,
}));

vi.mock("~/lib/integrations/services/MilestoneSyncService", () => ({
  milestoneSyncService: mocks.milestoneSyncService,
}));

vi.mock("~/lib/integrations/IntegrationManager", () => ({
  integrationManager: mocks.integrationManager,
}));

const importSut = async () =>
  (await import("./applyInboundMilestoneEvent")).applyInboundMilestoneEvent;

const RECEIVED_AT = new Date("2026-07-09T20:00:00.000Z");

const baseInput = (
  overrides: Partial<ApplyInboundMilestoneEventInput> = {}
): ApplyInboundMilestoneEventInput => ({
  webhookConfigId: "wc_demo",
  adapterType: "JIRA",
  eventType: "jira:version_updated",
  payload: {
    eventType: "jira:version_updated",
    issueKey: "",
    externalStatus: "",
    synthetic: false,
    data: {
      webhookEvent: "jira:version_updated",
      version: { id: "10100" },
      project: { id: "10050" },
    },
  },
  payloadDigest: "deadbeef".padEnd(64, "0"),
  receivedAt: RECEIVED_AT,
  latencyMs: 12,
  statusCode: 200,
  ...overrides,
});

const resetMocks = () => {
  for (const model of Object.values(mocks.tx)) {
    for (const fn of Object.values(model)) {
      (fn as ReturnType<typeof vi.fn>).mockReset();
    }
  }
  mocks.baseDb.$transaction.mockClear();
  mocks.baseDb.$transaction.mockImplementation(async (fn: any) => fn(mocks.tx));
  mocks.captureAuditEvent.mockReset();
  mocks.captureAuditEvent.mockResolvedValue(undefined);

  mocks.tx.webhookDelivery.create.mockResolvedValue({ id: "del_1" });
  mocks.tx.webhookDelivery.update.mockResolvedValue({});
  mocks.tx.webhookConfig.update.mockResolvedValue({});
  mocks.tx.webhookEventDedup.create.mockResolvedValue({});
  mocks.tx.webhookEventDedup.findFirst.mockResolvedValue(null);

  mocks.integrationProjectFindMany.mockReset();
  mocks.integrationProjectFindMany.mockResolvedValue([]);
  mocks.projectIntegrationFindUnique.mockReset();
  mocks.projectIntegrationFindUnique.mockResolvedValue(null);
  mocks.milestonesFindMany.mockReset();
  mocks.milestonesFindMany.mockResolvedValue([]);

  mocks.performMilestoneRefresh.mockReset();
  mocks.performMilestoneRefresh.mockResolvedValue({ success: true });
  mocks.performMilestoneImport.mockReset();
  mocks.performMilestoneImport.mockResolvedValue({
    success: true,
    imported: 1,
    updated: 0,
    errors: [],
    membershipErrors: [],
  });
  mocks.convertMilestoneToLocal.mockReset();
  mocks.convertMilestoneToLocal.mockResolvedValue({ success: true });
  mocks.integrationManagerGetAdapter.mockReset();
  mocks.integrationManagerGetAdapter.mockResolvedValue(mocks.boardAdapter);
  mocks.boardAdapter.resolveBoardProject.mockReset();
  mocks.boardAdapter.resolveBoardProject.mockResolvedValue(null);

  (mocks.adapter.extractMilestoneEventRef as Mock).mockReset();
  mocks.getAdapter.mockClear();
  mocks.getAdapter.mockReturnValue(mocks.adapter);
};

const activeIntegrationProject = (overrides: Record<string, unknown> = {}) => ({
  externalProjectId: "10050",
  projectIntegration: { projectId: 7, integrationId: 42 },
  ...overrides,
});

describe("applyInboundMilestoneEvent", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("HOOK-01: jira:version_updated for a linked milestone calls performMilestoneRefresh with minFreshnessSeconds:15", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "RELEASE",
      externalId: "10100",
      externalProjectId: "10050",
      merge: false,
    });
    mocks.integrationProjectFindMany.mockResolvedValue([
      activeIntegrationProject(),
    ]);
    mocks.milestonesFindMany.mockResolvedValue([
      { id: 555, projectId: 7, integrationId: 42 },
    ]);

    const result = await applyInboundMilestoneEvent(baseInput());

    expect(result.outcome).toBe("refreshed");
    expect(mocks.performMilestoneRefresh).toHaveBeenCalledWith(
      "__system__",
      42,
      "10100",
      { minFreshnessSeconds: 15, projectId: 7 }
    );
  });

  it("HOOK-01: jira:version_created is a no-op when the project's auto-track setting is OFF (D-02)", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "RELEASE",
      externalId: "10100",
      externalProjectId: "10050",
      merge: false,
    });
    mocks.integrationProjectFindMany.mockResolvedValue([
      activeIntegrationProject(),
    ]);
    mocks.projectIntegrationFindUnique.mockResolvedValue({
      config: { milestoneSync: { autoTrack: false } },
    });

    const result = await applyInboundMilestoneEvent(
      baseInput({ eventType: "jira:version_created" })
    );

    expect(result.outcome).toBe("unmatched");
    expect(result.reason).toBe("auto-track-off");
    expect(mocks.performMilestoneRefresh).not.toHaveBeenCalled();
  });

  it("HOOK-01 (WR-01): jira:version_created with auto-track ON IMPORTS the new artifact (a refresh would notFound-no-op — no linked row exists yet), attributed to autoTrackAdminId", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "RELEASE",
      externalId: "10100",
      externalProjectId: "10050",
      merge: false,
    });
    mocks.integrationProjectFindMany.mockResolvedValue([
      activeIntegrationProject(),
    ]);
    mocks.projectIntegrationFindUnique.mockResolvedValue({
      config: {
        milestoneSync: { autoTrack: true, autoTrackAdminId: "admin-1" },
      },
    });

    const result = await applyInboundMilestoneEvent(
      baseInput({ eventType: "jira:version_created" })
    );

    expect(result.outcome).toBe("imported");
    expect(mocks.performMilestoneImport).toHaveBeenCalledWith(
      "__system__",
      42,
      7,
      { externalIds: ["10100"], kinds: ["RELEASE"] },
      "admin-1"
    );
    // Never the dead refresh dispatch — performMilestoneRefresh returns
    // notFound for a row that does not exist yet.
    expect(mocks.performMilestoneRefresh).not.toHaveBeenCalled();
  });

  it("HOOK-01 (WR-01): sprint_created with auto-track ON imports with kind ITERATION", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "ITERATION",
      externalId: "55",
      originBoardId: "3",
    });
    mocks.integrationProjectFindMany.mockResolvedValue([
      activeIntegrationProject(),
    ]);
    mocks.boardAdapter.resolveBoardProject.mockResolvedValue({
      projectId: "10050",
      projectKey: "DEMO",
    });
    mocks.projectIntegrationFindUnique.mockResolvedValue({
      config: {
        milestoneSync: { autoTrack: true, autoTrackAdminId: "admin-1" },
      },
    });

    const result = await applyInboundMilestoneEvent(
      baseInput({
        eventType: "sprint_created",
        payload: {
          eventType: "sprint_created",
          issueKey: "",
          externalStatus: "",
          synthetic: false,
          data: {
            webhookEvent: "sprint_created",
            sprint: { id: 55, originBoardId: 3 },
          },
        },
      })
    );

    expect(result.outcome).toBe("imported");
    expect(mocks.performMilestoneImport).toHaveBeenCalledWith(
      "__system__",
      42,
      7,
      { externalIds: ["55"], kinds: ["ITERATION"] },
      "admin-1"
    );
  });

  it("HOOK-01 (WR-01): jira:version_created with auto-track ON but NO autoTrackAdminId configured refuses to import (mirrors performProjectMilestoneSync's attribution rule)", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "RELEASE",
      externalId: "10100",
      externalProjectId: "10050",
      merge: false,
    });
    mocks.integrationProjectFindMany.mockResolvedValue([
      activeIntegrationProject(),
    ]);
    mocks.projectIntegrationFindUnique.mockResolvedValue({
      config: { milestoneSync: { autoTrack: true } },
    });

    const result = await applyInboundMilestoneEvent(
      baseInput({ eventType: "jira:version_created" })
    );

    expect(result.outcome).toBe("unmatched");
    expect(result.reason).toBe("auto-track-admin-missing");
    expect(mocks.performMilestoneImport).not.toHaveBeenCalled();
    expect(mocks.performMilestoneRefresh).not.toHaveBeenCalled();
  });

  it("HOOK-01: sprint_updated resolves its project via board->project lookup, not payload.project (sprints carry no project field)", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "ITERATION",
      externalId: "55",
      originBoardId: "3",
    });
    mocks.integrationProjectFindMany.mockResolvedValue([
      activeIntegrationProject(),
    ]);
    mocks.boardAdapter.resolveBoardProject.mockResolvedValue({
      projectId: "10050",
      projectKey: "DEMO",
    });
    mocks.milestonesFindMany.mockResolvedValue([
      { id: 556, projectId: 7, integrationId: 42 },
    ]);

    const result = await applyInboundMilestoneEvent(
      baseInput({
        eventType: "sprint_updated",
        payload: {
          eventType: "sprint_updated",
          issueKey: "",
          externalStatus: "",
          synthetic: false,
          data: {
            webhookEvent: "sprint_updated",
            sprint: { id: 55, originBoardId: 3 },
          },
        },
      })
    );

    expect(mocks.boardAdapter.resolveBoardProject).toHaveBeenCalledWith("3");
    expect(result.outcome).toBe("refreshed");
    expect(mocks.performMilestoneRefresh).toHaveBeenCalledWith(
      "__system__",
      42,
      "55",
      { minFreshnessSeconds: 15, projectId: 7 }
    );
  });

  it("REGRESSION (CR-02): a sprint event matches a project's SECOND mapping — the full mapping list is queried (no distinct collapse) and the board resolves against every mapping row", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "ITERATION",
      externalId: "55",
      originBoardId: "3",
    });
    // ONE ProjectIntegration (projectId 7 / integration 42) mapped to TWO
    // Jira projects. A `distinct: ["projectIntegrationId"]` fetch would
    // retain only the first row (externalProjectId "10050") and the board
    // owned by the second mapping ("20060") could never match.
    mocks.integrationProjectFindMany.mockResolvedValue([
      activeIntegrationProject({ externalProjectId: "10050" }),
      activeIntegrationProject({ externalProjectId: "20060" }),
    ]);
    mocks.boardAdapter.resolveBoardProject.mockResolvedValue({
      projectId: "20060",
      projectKey: "ADM",
    });
    mocks.milestonesFindMany.mockResolvedValue([
      { id: 557, projectId: 7, integrationId: 42 },
    ]);

    const result = await applyInboundMilestoneEvent(
      baseInput({
        eventType: "sprint_updated",
        payload: {
          eventType: "sprint_updated",
          issueKey: "",
          externalStatus: "",
          synthetic: false,
          data: {
            webhookEvent: "sprint_updated",
            sprint: { id: 55, originBoardId: 3 },
          },
        },
      })
    );

    // The mapping query must NOT collapse rows per projectIntegration.
    const findManyArgs = mocks.integrationProjectFindMany.mock.calls[0]?.[0];
    expect(findManyArgs).not.toHaveProperty("distinct");
    // Integrations are still deduped for the board lookup — one upstream
    // call, not one per mapping row.
    expect(mocks.boardAdapter.resolveBoardProject).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe("refreshed");
    expect(mocks.performMilestoneRefresh).toHaveBeenCalledWith(
      "__system__",
      42,
      "55",
      { minFreshnessSeconds: 15, projectId: 7 }
    );
  });

  it("REGRESSION (CR-02): sprint_deleted for a milestone reachable only via a non-first mapping still converts (no silent lock-forever drop)", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "ITERATION",
      externalId: "55",
      originBoardId: "3",
    });
    mocks.integrationProjectFindMany.mockResolvedValue([
      activeIntegrationProject({ externalProjectId: "10050" }),
      activeIntegrationProject({ externalProjectId: "20060" }),
    ]);
    mocks.boardAdapter.resolveBoardProject.mockResolvedValue({
      projectId: "20060",
      projectKey: "ADM",
    });
    mocks.milestonesFindMany.mockResolvedValue([
      { id: 777, projectId: 7, integrationId: 42 },
    ]);

    const result = await applyInboundMilestoneEvent(
      baseInput({
        eventType: "sprint_deleted",
        payload: {
          eventType: "sprint_deleted",
          issueKey: "",
          externalStatus: "",
          synthetic: false,
          data: {
            webhookEvent: "sprint_deleted",
            sprint: { id: 55, originBoardId: 3 },
          },
        },
      })
    );

    expect(result.outcome).toBe("converted");
    expect(mocks.convertMilestoneToLocal).toHaveBeenCalledWith(
      mocks.baseDb,
      777,
      "deleted",
      undefined
    );
  });

  it("REGRESSION (WR-07): a version event for a milestone tracked in the SECOND TPI project mapped to the same Jira project resolves via the milestone row, not the oldest mapping", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "RELEASE",
      externalId: "10100",
      externalProjectId: "10050",
      merge: false,
    });
    // The same Jira project ("10050") mapped into TWO TPI projects (7 and 8)
    // on one integration. The tracked Milestones row lives in project 8 —
    // an oldest-mapping pick (project 7) would make performMilestoneRefresh
    // return notFound forever.
    mocks.integrationProjectFindMany.mockResolvedValue([
      activeIntegrationProject({
        projectIntegration: { projectId: 7, integrationId: 42 },
      }),
      activeIntegrationProject({
        projectIntegration: { projectId: 8, integrationId: 42 },
      }),
    ]);
    mocks.milestonesFindMany.mockResolvedValue([
      { id: 808, projectId: 8, integrationId: 42 },
    ]);

    const result = await applyInboundMilestoneEvent(baseInput());

    expect(result.outcome).toBe("refreshed");
    expect(mocks.performMilestoneRefresh).toHaveBeenCalledWith(
      "__system__",
      42,
      "10100",
      { minFreshnessSeconds: 15, projectId: 8 }
    );
  });

  it("HOOK-01/D-03: an event whose resolved project has no active integration mapping is silently acked (200) with NO write", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "RELEASE",
      externalId: "10100",
      externalProjectId: "unmapped-project",
      merge: false,
    });
    mocks.integrationProjectFindMany.mockResolvedValue([]);

    const result = await applyInboundMilestoneEvent(baseInput());

    expect(result.outcome).toBe("unmatched");
    expect(mocks.performMilestoneRefresh).not.toHaveBeenCalled();
    expect(mocks.convertMilestoneToLocal).not.toHaveBeenCalled();
  });

  it("Pitfall 6: resolves the milestone event's own project from the payload, never assumes webhookConfig.projectId", async () => {
    // ApplyInboundMilestoneEventInput deliberately carries NO projectId field
    // at all — this test asserts the type shape itself enforces the rule
    // (a TS compile error would occur if the input required projectId).
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "RELEASE",
      externalId: "10100",
      externalProjectId: "10050",
      merge: false,
    });
    mocks.integrationProjectFindMany.mockResolvedValue([
      activeIntegrationProject({
        projectIntegration: { projectId: 99, integrationId: 42 },
      }),
    ]);
    mocks.milestonesFindMany.mockResolvedValue([
      { id: 990, projectId: 99, integrationId: 42 },
    ]);

    await applyInboundMilestoneEvent(baseInput());

    // The resolved projectId (99, from the payload's own project.id lookup)
    // is what gets passed to performMilestoneRefresh — NOT any
    // webhookConfig-derived value (the input type has no such field).
    expect(mocks.performMilestoneRefresh).toHaveBeenCalledWith(
      "__system__",
      42,
      "10100",
      { minFreshnessSeconds: 15, projectId: 99 }
    );
  });

  it("HOOK-02: jira:version_deleted calls convertMilestoneToLocal with reason 'deleted'", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "RELEASE",
      externalId: "10100",
      externalProjectId: "10050",
      merge: false,
    });
    mocks.integrationProjectFindMany.mockResolvedValue([
      activeIntegrationProject(),
    ]);
    mocks.milestonesFindMany.mockResolvedValue([
      { id: 555, projectId: 7, integrationId: 42 },
    ]);

    const result = await applyInboundMilestoneEvent(
      baseInput({ eventType: "jira:version_deleted" })
    );

    expect(result.outcome).toBe("converted");
    expect(mocks.convertMilestoneToLocal).toHaveBeenCalledWith(
      mocks.baseDb,
      555,
      "deleted",
      undefined
    );
  });

  it("HOOK-02: a version merged into another (payload.mergedTo present) calls convertMilestoneToLocal with reason 'merged' and the merge target's external id", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "RELEASE",
      externalId: "10100",
      externalProjectId: "10050",
      merge: true,
      mergedToExternalId: "10200",
    });
    mocks.integrationProjectFindMany.mockResolvedValue([
      activeIntegrationProject(),
    ]);
    mocks.milestonesFindMany.mockResolvedValue([
      { id: 555, projectId: 7, integrationId: 42 },
    ]);

    const result = await applyInboundMilestoneEvent(
      baseInput({ eventType: "jira:version_deleted" })
    );

    expect(result.outcome).toBe("converted");
    expect(mocks.convertMilestoneToLocal).toHaveBeenCalledWith(
      mocks.baseDb,
      555,
      "merged",
      "10200"
    );
  });

  it("HOOK-02: sprint_deleted calls convertMilestoneToLocal with reason 'deleted'", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "ITERATION",
      externalId: "55",
      originBoardId: "3",
    });
    mocks.integrationProjectFindMany.mockResolvedValue([
      activeIntegrationProject(),
    ]);
    mocks.boardAdapter.resolveBoardProject.mockResolvedValue({
      projectId: "10050",
      projectKey: "DEMO",
    });
    mocks.milestonesFindMany.mockResolvedValue([
      { id: 777, projectId: 7, integrationId: 42 },
    ]);

    const result = await applyInboundMilestoneEvent(
      baseInput({
        eventType: "sprint_deleted",
        payload: {
          eventType: "sprint_deleted",
          issueKey: "",
          externalStatus: "",
          synthetic: false,
          data: {
            webhookEvent: "sprint_deleted",
            sprint: { id: 55, originBoardId: 3 },
          },
        },
      })
    );

    expect(result.outcome).toBe("converted");
    expect(mocks.convertMilestoneToLocal).toHaveBeenCalledWith(
      mocks.baseDb,
      777,
      "deleted",
      undefined
    );
  });

  it("PER-PROJECT FAN-OUT: an update event refreshes EVERY project tracking the artifact, each scoped to its own row", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "RELEASE",
      externalId: "10100",
      externalProjectId: "10050",
      merge: false,
    });
    mocks.integrationProjectFindMany.mockResolvedValue([
      activeIntegrationProject({
        projectIntegration: { projectId: 7, integrationId: 42 },
      }),
      activeIntegrationProject({
        projectIntegration: { projectId: 8, integrationId: 42 },
      }),
    ]);
    // External identity is per-project: BOTH projects track the same
    // artifact via their own rows.
    mocks.milestonesFindMany.mockResolvedValue([
      { id: 701, projectId: 7, integrationId: 42 },
      { id: 801, projectId: 8, integrationId: 42 },
    ]);

    const result = await applyInboundMilestoneEvent(baseInput());

    expect(result.outcome).toBe("refreshed");
    expect(mocks.performMilestoneRefresh).toHaveBeenCalledTimes(2);
    expect(mocks.performMilestoneRefresh).toHaveBeenCalledWith(
      "__system__",
      42,
      "10100",
      { minFreshnessSeconds: 15, projectId: 7 }
    );
    expect(mocks.performMilestoneRefresh).toHaveBeenCalledWith(
      "__system__",
      42,
      "10100",
      { minFreshnessSeconds: 15, projectId: 8 }
    );
  });

  it("PER-PROJECT FAN-OUT: an upstream deletion converts EVERY project's tracking row, not just the first", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "RELEASE",
      externalId: "10100",
      externalProjectId: "10050",
      merge: false,
    });
    mocks.integrationProjectFindMany.mockResolvedValue([
      activeIntegrationProject(),
    ]);
    mocks.milestonesFindMany.mockResolvedValue([
      { id: 701, projectId: 7, integrationId: 42 },
      { id: 801, projectId: 8, integrationId: 42 },
    ]);

    const result = await applyInboundMilestoneEvent(
      baseInput({ eventType: "jira:version_deleted" })
    );

    expect(result.outcome).toBe("converted");
    expect(mocks.convertMilestoneToLocal).toHaveBeenCalledTimes(2);
    expect(mocks.convertMilestoneToLocal).toHaveBeenCalledWith(
      mocks.baseDb,
      701,
      "deleted",
      undefined
    );
    expect(mocks.convertMilestoneToLocal).toHaveBeenCalledWith(
      mocks.baseDb,
      801,
      "deleted",
      undefined
    );
  });

  it("PER-PROJECT FAN-OUT: a created event imports into EVERY mapped project with auto-track ON, skipping projects with it OFF", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "RELEASE",
      externalId: "10100",
      externalProjectId: "10050",
      merge: false,
    });
    mocks.integrationProjectFindMany.mockResolvedValue([
      activeIntegrationProject({
        projectIntegration: { projectId: 7, integrationId: 42 },
      }),
      activeIntegrationProject({
        projectIntegration: { projectId: 8, integrationId: 42 },
      }),
    ]);
    // Project 7: auto-track ON; project 8: auto-track OFF.
    mocks.projectIntegrationFindUnique.mockImplementation(async (args: any) => {
      const projectId = args?.where?.projectId_integrationId?.projectId;
      if (projectId === 7) {
        return {
          config: {
            milestoneSync: { autoTrack: true, autoTrackAdminId: "admin-1" },
          },
        };
      }
      return { config: { milestoneSync: { autoTrack: false } } };
    });

    const result = await applyInboundMilestoneEvent(
      baseInput({ eventType: "jira:version_created" })
    );

    expect(result.outcome).toBe("imported");
    expect(mocks.performMilestoneImport).toHaveBeenCalledTimes(1);
    expect(mocks.performMilestoneImport).toHaveBeenCalledWith(
      "__system__",
      42,
      7,
      { externalIds: ["10100"], kinds: ["RELEASE"] },
      "admin-1"
    );
  });

  it("a convert event for a milestone with no local row is dropped (unmatched) rather than erroring", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "RELEASE",
      externalId: "10100",
      externalProjectId: "10050",
      merge: false,
    });
    mocks.integrationProjectFindMany.mockResolvedValue([
      activeIntegrationProject(),
    ]);
    mocks.milestonesFindMany.mockResolvedValue([]);

    const result = await applyInboundMilestoneEvent(
      baseInput({ eventType: "jira:version_deleted" })
    );

    expect(result.outcome).toBe("unmatched");
    expect(mocks.convertMilestoneToLocal).not.toHaveBeenCalled();
  });

  it("route dispatch: jira:version_* and sprint_* eventTypes route to applyInboundMilestoneEvent — verified via isMilestoneEventType", async () => {
    const { isMilestoneEventType } =
      await import("~/lib/webhooks/adapters/types");
    expect(isMilestoneEventType("jira:version_updated")).toBe(true);
    expect(isMilestoneEventType("jira:version_deleted")).toBe(true);
    expect(isMilestoneEventType("sprint_created")).toBe(true);
    expect(isMilestoneEventType("sprint_deleted")).toBe(true);
  });

  it("route dispatch: issue eventTypes (jira:issue_updated etc.) continue to route to applyInboundIssueUpdate, unaffected by this service's addition", async () => {
    const { isMilestoneEventType } =
      await import("~/lib/webhooks/adapters/types");
    expect(isMilestoneEventType("jira:issue_updated")).toBe(false);
    expect(isMilestoneEventType("jira:issue_created")).toBe(false);
    expect(isMilestoneEventType("jira:issue_deleted")).toBe(false);
  });

  it("webhook delivery/dedup transaction shape mirrors applyInboundIssueUpdate: delivery row always inserted first, pre-INSERT SELECT dedup check, shared finalize tail for every outcome", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "RELEASE",
      externalId: "10100",
      externalProjectId: "10050",
      merge: false,
    });
    mocks.integrationProjectFindMany.mockResolvedValue([
      activeIntegrationProject(),
    ]);

    await applyInboundMilestoneEvent(baseInput());

    expect(mocks.tx.webhookDelivery.create).toHaveBeenCalledTimes(1);
    expect(mocks.tx.webhookEventDedup.findFirst).toHaveBeenCalledTimes(1);
    expect(mocks.tx.webhookEventDedup.create).toHaveBeenCalledTimes(1);
    expect(mocks.tx.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: { statusCode: 200, latencyMs: 12, error: null },
    });
    expect(mocks.tx.webhookConfig.update).toHaveBeenCalledWith({
      where: { id: "wc_demo" },
      data: { lastReceivedAt: RECEIVED_AT },
    });
  });

  it("a duplicate payloadDigest short-circuits without dispatching refresh/convert", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "RELEASE",
      externalId: "10100",
      externalProjectId: "10050",
      merge: false,
    });
    mocks.tx.webhookEventDedup.findFirst.mockResolvedValue({ id: "dedup_1" });

    const result = await applyInboundMilestoneEvent(baseInput());

    expect(result.outcome).toBe("duplicate");
    expect(mocks.tx.webhookEventDedup.create).not.toHaveBeenCalled();
    expect(mocks.performMilestoneRefresh).not.toHaveBeenCalled();
    expect(mocks.convertMilestoneToLocal).not.toHaveBeenCalled();
  });

  it("a payload the adapter cannot extract a ref from returns no-ref without touching dedup", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue(null);

    const result = await applyInboundMilestoneEvent(baseInput());

    expect(result.outcome).toBe("no-ref");
    expect(mocks.tx.webhookEventDedup.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.webhookEventDedup.create).not.toHaveBeenCalled();
  });

  it("audit emission: WEBHOOK_RECEIVED on the WebhookDelivery row, awaited, after tx commit — separate from convertMilestoneToLocal's own audit event", async () => {
    const applyInboundMilestoneEvent = await importSut();
    (mocks.adapter.extractMilestoneEventRef as Mock).mockReturnValue({
      kind: "RELEASE",
      externalId: "10100",
      externalProjectId: "10050",
      merge: false,
    });
    mocks.integrationProjectFindMany.mockResolvedValue([
      activeIntegrationProject(),
    ]);
    mocks.milestonesFindMany.mockResolvedValue([
      { id: 555, projectId: 7, integrationId: 42 },
    ]);

    await applyInboundMilestoneEvent(
      baseInput({ eventType: "jira:version_deleted" })
    );

    expect(mocks.captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "WEBHOOK_RECEIVED",
        entityType: "WebhookDelivery",
        entityId: "del_1",
        userId: "__system__",
        metadata: expect.objectContaining({ outcome: "converted" }),
      })
    );
    // The service itself never calls convertMilestoneToLocal's own audit
    // logic directly — that's an internal concern of MilestoneSyncService,
    // mocked here and asserted only via the call above.
    expect(mocks.convertMilestoneToLocal).toHaveBeenCalledTimes(1);
  });
});
