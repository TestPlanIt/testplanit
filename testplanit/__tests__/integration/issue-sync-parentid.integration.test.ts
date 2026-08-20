// Live-DB integration proof for PROV-04 — synced parentId resolution and
// the cycle-guard trigger interaction on the real sync write path.
//
// Two plans convert these todos, in order:
//   - 22-02 converts todos 1-5 (the inline best-effort resolve-on-sync
//     write, the cross-project/cycle-rejection cases, and the
//     isRequirement classification write).
//   - 22-05 converts todo 6 (the end-of-import re-resolution pass —
//     completing the hierarchy within one import run when a child is
//     imported before its parent).
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/issue-sync-parentid.integration.test.ts

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";

// Mock only what actually needs mocking. `publishIssueUpdate` is already
// internally guarded (no-ops when valkeyConnection is null) and
// `syncIssueToElasticsearch` is `.catch()`-wrapped at its call site, so
// neither can abort the write path — but the module-level `~/lib/valkey`
// import opens a real connection as a side effect of import alone (the
// worktree .env sets VALKEY_URL), and syncIssueToElasticsearch would hit
// the shared Elasticsearch node. Both are mocked to keep this suite's
// writes isolated to tpi_req20 and its process exit clean of open handles.
vi.mock("~/services/issueSearch", () => ({
  syncIssueToElasticsearch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/valkey", () => ({
  default: null,
  createSubscriberClient: () => null,
}));

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `sp-${Date.now()}`;
const REQUIREMENT_TYPE_ID = "10001";
const NON_REQUIREMENT_TYPE_ID = "10002";

function makeIssueData(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id,
    key: overrides.key ?? `${STAMP}-${overrides.id}`,
    title: `${STAMP} ${overrides.id}`,
    status: "open",
    priority: "medium",
    createdAt: new Date(),
    updatedAt: new Date(),
    customFields: {},
    labels: [],
    components: [],
    ...overrides,
  };
}

describeIntegration("SyncService synced parentId (live DB)", () => {
  let adminUserId: string;
  let integrationId: number;
  let project1Id: number;
  let project2Id: number;
  // P1's ProjectIntegration row id and the IntegrationProject mapping that
  // performProjectImport itself resolves (todo 6 / plan 22-05) — neither
  // is needed by the five pre-existing entries above, only by the final
  // end-of-run re-resolution case.
  let projectIntegration1Id: string;
  let runMappingId: string;
  const allIssueIds: number[] = [];

  beforeAll(async () => {
    // Refuse to run against anything but a scratch database — the
    // worktree .env DATABASE_URL resolves to `ew`, and this suite writes
    // real rows through the live cycle-guard trigger.
    const [{ current_database: dbName }] = await db.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
      throw new Error(
        `refusing to run against database "${dbName}" — this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
      );
    }

    const role = await db.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");

    const admin = await db.user.create({
      data: {
        email: `${STAMP}-admin@example.com`,
        name: `Issue Sync ParentId Admin ${STAMP}`,
        authMethod: "INTERNAL",
        access: "ADMIN",
        accessSource: "MANUAL",
        roleId: role.id,
        password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
      },
      select: { id: true },
    });
    adminUserId = admin.id;

    const project1 = await db.projects.create({
      data: { name: `${STAMP}-project-1`, createdBy: adminUserId },
      select: { id: true },
    });
    project1Id = project1.id;

    const project2 = await db.projects.create({
      data: { name: `${STAMP}-project-2`, createdBy: adminUserId },
      select: { id: true },
    });
    project2Id = project2.id;

    const integration = await db.integration.create({
      data: {
        name: `${STAMP}-integration`,
        provider: "JIRA",
        authType: "OAUTH2",
        status: "ACTIVE",
        credentials: {},
        settings: {},
      },
      select: { id: true },
    });
    integrationId = integration.id;

    // P1's requirements config — makes the classification assertion (entry
    // 5) real rather than mocked. isActive: true matches the predicate
    // resolveSyncedRequirementFlag queries on.
    const projectIntegration1 = await db.projectIntegration.create({
      data: {
        projectId: project1Id,
        integrationId,
        isActive: true,
        config: {
          requirements: {
            enabled: true,
            issueTypeIds: [REQUIREMENT_TYPE_ID],
          },
        },
      },
      select: { id: true },
    });
    projectIntegration1Id = projectIntegration1.id;

    // performProjectImport (todo 6 / plan 22-05) additionally needs a real
    // IntegrationProject mapping — the five entries above drive
    // upsertIssueFromExternal directly and never touch this model.
    const runMapping = await db.integrationProject.create({
      data: {
        projectIntegrationId: projectIntegration1Id,
        externalProjectId: `${STAMP}-run`,
        externalProjectKey: `${STAMP}-run`,
        externalProjectName: `${STAMP} run project`,
        isActive: true,
      },
      select: { id: true },
    });
    runMappingId = runMapping.id;
  });

  afterAll(async () => {
    await db.issue.deleteMany({ where: { id: { in: allIssueIds } } });
    // FK order: the IntegrationProject mapping references ProjectIntegration.
    await db.integrationProject.delete({ where: { id: runMappingId } });
    await db.projectIntegration.deleteMany({
      where: { integrationId },
    });
    await db.integration.delete({ where: { id: integrationId } });
    await db.projects.delete({ where: { id: project1Id } });
    await db.projects.delete({ where: { id: project2Id } });
    await db.user.delete({ where: { id: adminUserId } });
    await db.$disconnect();
  });

  it("links a synced child to its parent row against the live database", async () => {
    const { syncService } = await import("~/lib/integrations/services/SyncService");

    const parentExternalId = `${STAMP}-parent-1`;
    const childExternalId = `${STAMP}-child-1`;

    const parentResult = await syncService.upsertIssueFromExternal(
      db,
      integrationId,
      project1Id,
      makeIssueData({ id: parentExternalId })
    );
    allIssueIds.push(parentResult.id);

    const childResult = await syncService.upsertIssueFromExternal(
      db,
      integrationId,
      project1Id,
      makeIssueData({
        id: childExternalId,
        parent: { id: parentExternalId, key: `${STAMP}-${parentExternalId}` },
      })
    );
    allIssueIds.push(childResult.id);

    const childRow = await db.issue.findUnique({
      where: { id: childResult.id },
      select: { parentId: true },
    });
    expect(childRow?.parentId).toBe(parentResult.id);
  });

  it("does not link a parent that lives in a different project", async () => {
    const { syncService } = await import("~/lib/integrations/services/SyncService");

    const candidateParentExternalId = `${STAMP}-p2-parent`;
    const childExternalId = `${STAMP}-p1-child`;

    // Candidate parent lives in P2, synced through the SAME integration.
    const candidateParent = await syncService.upsertIssueFromExternal(
      db,
      integrationId,
      project2Id,
      makeIssueData({ id: candidateParentExternalId })
    );
    allIssueIds.push(candidateParent.id);

    const child = await syncService.upsertIssueFromExternal(
      db,
      integrationId,
      project1Id,
      makeIssueData({
        id: childExternalId,
        parent: {
          id: candidateParentExternalId,
          key: `${STAMP}-${candidateParentExternalId}`,
        },
      })
    );
    allIssueIds.push(child.id);

    const childRow = await db.issue.findUnique({
      where: { id: child.id },
      select: { parentId: true },
    });
    expect(childRow?.parentId).toBeNull();
  });

  it("clears a previously linked parent when the tracker stops reporting one", async () => {
    const { syncService } = await import("~/lib/integrations/services/SyncService");

    const parentExternalId = `${STAMP}-clear-parent`;
    const childExternalId = `${STAMP}-clear-child`;

    const parent = await syncService.upsertIssueFromExternal(
      db,
      integrationId,
      project1Id,
      makeIssueData({ id: parentExternalId })
    );
    allIssueIds.push(parent.id);

    const child = await syncService.upsertIssueFromExternal(
      db,
      integrationId,
      project1Id,
      makeIssueData({
        id: childExternalId,
        parent: { id: parentExternalId, key: `${STAMP}-${parentExternalId}` },
      })
    );
    allIssueIds.push(child.id);

    const linkedRow = await db.issue.findUnique({
      where: { id: child.id },
      select: { parentId: true },
    });
    expect(linkedRow?.parentId).toBe(parent.id);

    // Re-upsert the same external issue with no parent ref — the tracker
    // is now reporting no parent. This is the staleness bug's regression
    // test: parentId must be explicitly cleared, not left stale.
    await syncService.upsertIssueFromExternal(
      db,
      integrationId,
      project1Id,
      makeIssueData({ id: childExternalId })
    );

    const clearedRow = await db.issue.findUnique({
      where: { id: child.id },
      select: { parentId: true },
    });
    expect(clearedRow?.parentId).toBeNull();
  });

  it("a cyclic tracker parent is rejected by the live cycle-guard trigger", async () => {
    const { syncService } = await import("~/lib/integrations/services/SyncService");

    const bExternalId = `${STAMP}-cyc-b`;
    const aExternalId = `${STAMP}-cyc-a`;

    const b = await syncService.upsertIssueFromExternal(
      db,
      integrationId,
      project1Id,
      makeIssueData({ id: bExternalId })
    );
    allIssueIds.push(b.id);

    // A's parent is B.
    const a = await syncService.upsertIssueFromExternal(
      db,
      integrationId,
      project1Id,
      makeIssueData({
        id: aExternalId,
        parent: { id: bExternalId, key: `${STAMP}-${bExternalId}` },
      })
    );
    allIssueIds.push(a.id);

    const bRowBefore = await db.issue.findUnique({
      where: { id: b.id },
      select: { parentId: true },
    });
    expect(bRowBefore?.parentId).toBeNull();

    // Re-upsert B with its parent pointing at A — A is already B's child,
    // so this closes a 2-node cycle. No application-side cycle handling
    // exists on this path (CONTEXT P3c) — the live trigger is the sole
    // authority and must reject this write outright.
    await expect(
      syncService.upsertIssueFromExternal(
        db,
        integrationId,
        project1Id,
        makeIssueData({
          id: bExternalId,
          parent: { id: aExternalId, key: `${STAMP}-${aExternalId}` },
        })
      )
    ).rejects.toThrow(/cycle|own parent/i);

    // The rejected write must not have partially applied.
    const bRowAfter = await db.issue.findUnique({
      where: { id: b.id },
      select: { parentId: true },
    });
    expect(bRowAfter?.parentId).toBeNull();
  });

  it("sets isRequirement from the project's stored requirements config", async () => {
    const { syncService } = await import("~/lib/integrations/services/SyncService");

    const reqExternalId = `${STAMP}-req-issue`;
    const nonReqExternalId = `${STAMP}-non-req-issue`;

    const reqIssue = await syncService.upsertIssueFromExternal(
      db,
      integrationId,
      project1Id,
      makeIssueData({
        id: reqExternalId,
        issueType: { id: REQUIREMENT_TYPE_ID, name: "Epic" },
      })
    );
    allIssueIds.push(reqIssue.id);

    const nonReqIssue = await syncService.upsertIssueFromExternal(
      db,
      integrationId,
      project1Id,
      makeIssueData({
        id: nonReqExternalId,
        issueType: { id: NON_REQUIREMENT_TYPE_ID, name: "Task" },
      })
    );
    allIssueIds.push(nonReqIssue.id);

    const reqRow = await db.issue.findUnique({
      where: { id: reqIssue.id },
      select: { isRequirement: true },
    });
    expect(reqRow?.isRequirement).toBe(true);

    const nonReqRow = await db.issue.findUnique({
      where: { id: nonReqIssue.id },
      select: { isRequirement: true },
    });
    expect(nonReqRow?.isRequirement).toBe(false);
  });

  it("completes the hierarchy within one import run when a child is imported before its parent", async () => {
    const { syncService } = await import(
      "~/lib/integrations/services/SyncService"
    );
    const { integrationManager } = await import(
      "~/lib/integrations/IntegrationManager"
    );

    const childExternalId = `${STAMP}-run-child`;
    const parentExternalId = `${STAMP}-run-parent`;

    // Child-first, then parent, in ONE page — the whole point. Parent-first
    // would still pass even with the end-of-run re-resolution pass deleted,
    // which is exactly the regression this test exists to catch.
    const searchIssues = vi.fn().mockResolvedValueOnce({
      issues: [
        makeIssueData({
          id: childExternalId,
          parent: {
            id: parentExternalId,
            key: `${STAMP}-${parentExternalId}`,
          },
        }),
        makeIssueData({ id: parentExternalId }),
      ],
      total: 2,
      hasMore: false,
    });
    vi.spyOn(integrationManager, "getAdapter").mockResolvedValueOnce({
      searchIssues,
      getCapabilities: vi.fn().mockReturnValue({ searchIssues: true }),
    } as any);

    // Drive the real entry point through the raw scratch-DB client so the
    // pass's $executeRaw write and the live cycle-guard trigger both
    // exercise for real — exactly ONE call. A second call would make this
    // pass even with the pass under test removed.
    const result = await syncService.performProjectImport(
      integrationId,
      runMappingId,
      { cap: 50 },
      undefined,
      { dbClient: db }
    );

    expect(result.errors).toHaveLength(0);

    const childRow = await db.issue.findFirst({
      where: { externalId: childExternalId, integrationId },
      select: { id: true, parentId: true },
    });
    const parentRow = await db.issue.findFirst({
      where: { externalId: parentExternalId, integrationId },
      select: { id: true, parentId: true },
    });
    if (childRow) allIssueIds.push(childRow.id);
    if (parentRow) allIssueIds.push(parentRow.id);

    // The case P3a previously deferred to "the next sync pass": correct at
    // the END of this single run, re-read through the raw client rather
    // than trusted from the import result.
    expect(childRow?.parentId).toBe(parentRow?.id);
    // Proves the pass links the right direction, not both.
    expect(parentRow?.parentId).toBeNull();
  });
});
