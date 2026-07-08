// Live-DB integration tests for the Phase 17 Milestones @deny locks.
//
// These prove the SCIM-style `@deny('update', integrationId != null)` rules
// added to Milestones.name/note/startedAt/completedAt/isStarted/isCompleted
// are actually enforced by the PolicyPlugin at runtime — a mocked-Prisma unit
// test cannot catch a regression here (field-level @deny is compiled into the
// generated policy and only takes effect through the real policy-applying
// client). Per feedback_prisma_helper_live_db_test.
//
// Run via (requires the dev DB migrated with milestone_sync_foundation):
//   cd testplanit && RUN_DB_INTEGRATION=1 pnpm test MilestonePolicy.integration --run
//
// Cleanup: every fixture row is created with a unique per-run timestamp
// prefix and torn down in afterAll (Milestones -> Integration -> Projects,
// respecting FK order; onDelete: SetNull on Milestones.integrationId means
// the Integration can be deleted independently, but we delete Milestones
// first regardless for clarity).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRawDbClient } from "~/lib/rawDbClient";
import { getAuthDb } from "~/lib/zenstack";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `mspit-${Date.now()}`;

// Mirrors lib/auth/utils.ts#getUserWithRole — the real production path for
// resolving the policy-plugin auth() context (role + rolePermissions
// preloaded, matching what every request-scoped getEnhancedDb call does).
async function authDbFor(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
  if (!user) throw new Error(`Test setup: user ${userId} not found`);
  return getAuthDb(user as never);
}

describeIntegration("Milestones @deny(integrationId != null) locks (live DB)", () => {
  let adminUserId: string;
  let projectId: number;
  let milestoneTypeId: number;
  let integrationId: number;
  let syncedMilestoneId: number;
  let localMilestoneId: number;

  beforeAll(async () => {
    // Reuse the default role as the acting user's role FK target.
    const role = await db.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");

    // ADMIN-tier acting user: the model-level @@allow('all', access == 'ADMIN')
    // grants unconditional create/update/delete on Milestones, so any rejection
    // we observe below is caused ONLY by the field-level @deny lock, not by a
    // missing project-scoped permission grant. This isolates the assertion.
    const admin = await db.user.create({
      data: {
        email: `${STAMP}-admin@example.com`,
        name: `MS Policy Admin ${STAMP}`,
        authMethod: "INTERNAL",
        access: "ADMIN",
        accessSource: "MANUAL",
        roleId: role.id,
        password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
      },
      select: { id: true },
    });
    adminUserId = admin.id;

    const project = await db.projects.create({
      data: {
        name: `${STAMP}-project`,
        createdBy: adminUserId,
      },
      select: { id: true },
    });
    projectId = project.id;

    const milestoneType = await db.milestoneTypes.create({
      data: { name: `${STAMP}-type` },
      select: { id: true },
    });
    milestoneTypeId = milestoneType.id;

    const integration = await db.integration.create({
      data: {
        name: `${STAMP}-jira`,
        provider: "JIRA",
        authType: "OAUTH2",
        status: "ACTIVE",
        credentials: {},
        settings: {},
      },
      select: { id: true },
    });
    integrationId = integration.id;

    // A synced milestone: integrationId set, tracker-owned fields locked.
    const synced = await db.milestones.create({
      data: {
        projectId,
        milestoneTypesId: milestoneTypeId,
        createdBy: adminUserId,
        name: `${STAMP}-synced`,
        integrationId,
        externalId: `${STAMP}-ext-1`,
        externalKind: "RELEASE",
      },
      select: { id: true },
    });
    syncedMilestoneId = synced.id;

    // A local milestone: integrationId null, no locks apply.
    const local = await db.milestones.create({
      data: {
        projectId,
        milestoneTypesId: milestoneTypeId,
        createdBy: adminUserId,
        name: `${STAMP}-local`,
      },
      select: { id: true },
    });
    localMilestoneId = local.id;
  });

  afterAll(async () => {
    // NOTE: does not call db.$disconnect() here — `db` is a module-level
    // client shared with the MilestoneIssue describe block below (and any
    // future blocks in this file). Disconnecting after the first block's
    // afterAll destroys the connection before later blocks' beforeAll runs.
    // The final describe block in the file owns the $disconnect() call.
    await db.milestones.deleteMany({
      where: { id: { in: [syncedMilestoneId, localMilestoneId] } },
    });
    await db.integration.delete({ where: { id: integrationId } });
    await db.milestoneTypes.delete({ where: { id: milestoneTypeId } });
    await db.projects.delete({ where: { id: projectId } });
    await db.user.delete({ where: { id: adminUserId } });
  });

  it("REJECTS updating name on a synced milestone (integrationId != null)", async () => {
    const edb = await authDbFor(adminUserId);
    await expect(
      edb.milestones.update({
        where: { id: syncedMilestoneId },
        data: { name: "should-be-denied" },
      })
    ).rejects.toThrow();

    const row = await db.milestones.findUnique({
      where: { id: syncedMilestoneId },
      select: { name: true },
    });
    expect(row?.name).toBe(`${STAMP}-synced`);
  });

  it("REJECTS updating note/startedAt/isCompleted on a synced milestone", async () => {
    const edb = await authDbFor(adminUserId);

    await expect(
      edb.milestones.update({
        where: { id: syncedMilestoneId },
        data: { note: { text: "denied" } },
      })
    ).rejects.toThrow();

    await expect(
      edb.milestones.update({
        where: { id: syncedMilestoneId },
        data: { startedAt: new Date() },
      })
    ).rejects.toThrow();

    await expect(
      edb.milestones.update({
        where: { id: syncedMilestoneId },
        data: { isCompleted: true },
      })
    ).rejects.toThrow();
  });

  it("ALLOWS updating a local-owned field (milestoneTypesId) on a synced milestone", async () => {
    const edb = await authDbFor(adminUserId);

    const secondType = await db.milestoneTypes.create({
      data: { name: `${STAMP}-type-2` },
      select: { id: true },
    });

    const updated = await edb.milestones.update({
      where: { id: syncedMilestoneId },
      data: { milestoneTypesId: secondType.id },
      select: { id: true, milestoneTypesId: true },
    });
    expect(updated.milestoneTypesId).toBe(secondType.id);

    // Revert + cleanup the extra type row.
    await db.milestones.update({
      where: { id: syncedMilestoneId },
      data: { milestoneTypesId: milestoneTypeId },
    });
    await db.milestoneTypes.delete({ where: { id: secondType.id } });
  });

  it("ALLOWS updating name on a LOCAL milestone (integrationId == null) — lock is conditional", async () => {
    const edb = await authDbFor(adminUserId);

    const updated = await edb.milestones.update({
      where: { id: localMilestoneId },
      data: { name: `${STAMP}-local-renamed` },
      select: { id: true, name: true },
    });
    expect(updated.name).toBe(`${STAMP}-local-renamed`);
  });
});

describeIntegration("MilestoneIssue @deny('create,delete', source == SYNCED) locks (live DB)", () => {
  let adminUserId: string;
  let projectId: number;
  let milestoneTypeId: number;
  let milestoneId: number;
  let syncedIssueId: number;
  let manualIssueId: number;
  let bypassIssueId: number;

  beforeAll(async () => {
    // Reuse the default role as the acting user's role FK target.
    const role = await db.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");

    // ADMIN-tier acting user: the model-level @@allow('all', access == 'ADMIN')
    // grants unconditional create/update/delete on MilestoneIssue, so any
    // rejection we observe below is caused ONLY by the source == SYNCED lock,
    // not by a missing project-scoped permission grant. This isolates the
    // assertion, mirroring the Milestones name-lock tests above.
    const admin = await db.user.create({
      data: {
        email: `${STAMP}-mi-admin@example.com`,
        name: `MI Policy Admin ${STAMP}`,
        authMethod: "INTERNAL",
        access: "ADMIN",
        accessSource: "MANUAL",
        roleId: role.id,
        password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
      },
      select: { id: true },
    });
    adminUserId = admin.id;

    const project = await db.projects.create({
      data: {
        name: `${STAMP}-mi-project`,
        createdBy: adminUserId,
      },
      select: { id: true },
    });
    projectId = project.id;

    const milestoneType = await db.milestoneTypes.create({
      data: { name: `${STAMP}-mi-type` },
      select: { id: true },
    });
    milestoneTypeId = milestoneType.id;

    const milestone = await db.milestones.create({
      data: {
        projectId,
        milestoneTypesId: milestoneTypeId,
        createdBy: adminUserId,
        name: `${STAMP}-mi-milestone`,
      },
      select: { id: true },
    });
    milestoneId = milestone.id;

    const syncedIssue = await db.issue.create({
      data: {
        name: `${STAMP}-mi-synced-issue`,
        title: `${STAMP}-mi-synced-issue`,
        createdById: adminUserId,
        projectId,
      },
      select: { id: true },
    });
    syncedIssueId = syncedIssue.id;

    const manualIssue = await db.issue.create({
      data: {
        name: `${STAMP}-mi-manual-issue`,
        title: `${STAMP}-mi-manual-issue`,
        createdById: adminUserId,
        projectId,
      },
      select: { id: true },
    });
    manualIssueId = manualIssue.id;

    const bypassIssue = await db.issue.create({
      data: {
        name: `${STAMP}-mi-bypass-issue`,
        title: `${STAMP}-mi-bypass-issue`,
        createdById: adminUserId,
        projectId,
      },
      select: { id: true },
    });
    bypassIssueId = bypassIssue.id;

    // Pre-existing SYNCED link, created via the raw client (sync-service path).
    await db.milestoneIssue.create({
      data: { milestoneId, issueId: syncedIssueId, source: "SYNCED" },
    });

    // Pre-existing MANUAL link, created via the raw client — used by the
    // enhanced-client-ALLOWS-delete case below.
    await db.milestoneIssue.create({
      data: { milestoneId, issueId: manualIssueId, source: "MANUAL" },
    });
  });

  afterAll(async () => {
    await db.milestoneIssue.deleteMany({ where: { milestoneId } });
    await db.issue.deleteMany({
      where: { id: { in: [syncedIssueId, manualIssueId, bypassIssueId] } },
    });
    await db.milestones.delete({ where: { id: milestoneId } });
    await db.milestoneTypes.delete({ where: { id: milestoneTypeId } });
    await db.projects.delete({ where: { id: projectId } });
    await db.user.delete({ where: { id: adminUserId } });
    await db.$disconnect();
  });

  it("REJECTS enhanced-client delete of a SYNCED MilestoneIssue link", async () => {
    const edb = await authDbFor(adminUserId);

    await expect(
      edb.milestoneIssue.delete({
        where: { milestoneId_issueId: { milestoneId, issueId: syncedIssueId } },
      })
    ).rejects.toThrow();

    const row = await db.milestoneIssue.findUnique({
      where: { milestoneId_issueId: { milestoneId, issueId: syncedIssueId } },
    });
    expect(row).not.toBeNull();
    expect(row?.source).toBe("SYNCED");
  });

  it("REJECTS enhanced-client create of a SYNCED MilestoneIssue link", async () => {
    const edb = await authDbFor(adminUserId);

    await expect(
      edb.milestoneIssue.create({
        data: { milestoneId, issueId: bypassIssueId, source: "SYNCED" },
      })
    ).rejects.toThrow();

    const row = await db.milestoneIssue.findUnique({
      where: { milestoneId_issueId: { milestoneId, issueId: bypassIssueId } },
    });
    expect(row).toBeNull();
  });

  it("ALLOWS enhanced-client create and delete of a MANUAL MilestoneIssue link", async () => {
    const edb = await authDbFor(adminUserId);

    const created = await edb.milestoneIssue.create({
      data: { milestoneId, issueId: bypassIssueId, source: "MANUAL" },
      select: { milestoneId: true, issueId: true, source: true },
    });
    expect(created.source).toBe("MANUAL");

    await edb.milestoneIssue.delete({
      where: { milestoneId_issueId: { milestoneId, issueId: bypassIssueId } },
    });

    const row = await db.milestoneIssue.findUnique({
      where: { milestoneId_issueId: { milestoneId, issueId: bypassIssueId } },
    });
    expect(row).toBeNull();
  });

  it("ALLOWS the raw db client to create and delete a SYNCED MilestoneIssue link (sync-service bypass)", async () => {
    const created = await db.milestoneIssue.create({
      data: { milestoneId, issueId: bypassIssueId, source: "SYNCED" },
      select: { milestoneId: true, issueId: true, source: true },
    });
    expect(created.source).toBe("SYNCED");

    await db.milestoneIssue.delete({
      where: { milestoneId_issueId: { milestoneId, issueId: bypassIssueId } },
    });

    const row = await db.milestoneIssue.findUnique({
      where: { milestoneId_issueId: { milestoneId, issueId: bypassIssueId } },
    });
    expect(row).toBeNull();
  });
});
