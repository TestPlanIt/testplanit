// Live-DB integration tests for the Issue requirement-lock @deny rules.
//
// This is the first field-level `@deny` ever placed on `Issue`
// (`isRequirement && integrationId != null && requirementDetachedAt ==
// null` on title/description/status/priority/parent-related fields). A
// mocked-Prisma unit test cannot catch a regression here — field-level
// @deny is compiled into the generated policy and only takes effect
// through the real policy-applying client, not through a mocked db object.
//
// Run via (requires the scratch DB migrated with the requirement-lock
// schema change):
//   cd testplanit && DATABASE_URL=<scratch> RUN_DB_INTEGRATION=1 pnpm exec vitest run __tests__/integration/issue-requirement-lock

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRawDbClient } from "~/lib/rawDbClient";
import { getAuthDb } from "~/lib/zenstack";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `irl-${Date.now()}`;

// Mirrors MilestonePolicy.integration.test.ts's authDbFor — the real
// production path for resolving the policy-plugin auth() context (role +
// rolePermissions preloaded, matching what every request-scoped getAuthDb
// call does).
async function authDbFor(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
  if (!user) throw new Error(`Test setup: user ${userId} not found`);
  return getAuthDb(user as never);
}

describeIntegration("Issue requirement-lock @deny (live DB)", () => {
  let adminUserId: string;
  let projectId: number;
  let integrationId: number;
  let syncedRequirementId: number;
  let detachedRequirementId: number;
  let syncedDefectId: number;
  let parentCandidateId: number;

  beforeAll(async () => {
    // Reuse the default role as the acting user's role FK target.
    const role = await db.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");

    // ADMIN-tier acting user: the model-level @@allow('all', access ==
    // 'ADMIN') grants unconditional create/update/delete on Issue, so any
    // rejection we observe below is caused ONLY by the field-level @deny
    // lock, not by a missing project-scoped permission grant. This
    // isolates the assertion, mirroring MilestonePolicy.integration.test.ts.
    const admin = await db.user.create({
      data: {
        email: `${STAMP}-admin@example.com`,
        name: `Issue Lock Admin ${STAMP}`,
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

    // A synced, non-detached requirement — tracker-owned fields locked.
    const syncedRequirement = await db.issue.create({
      data: {
        name: `${STAMP}-synced-requirement`,
        title: `${STAMP}-synced-requirement`,
        createdById: adminUserId,
        projectId,
        integrationId,
        externalId: `${STAMP}-ext-1`,
        isRequirement: true,
      },
      select: { id: true },
    });
    syncedRequirementId = syncedRequirement.id;

    // A detached requirement — requirementDetachedAt set, lock lifted.
    const detachedRequirement = await db.issue.create({
      data: {
        name: `${STAMP}-detached-requirement`,
        title: `${STAMP}-detached-requirement`,
        createdById: adminUserId,
        projectId,
        integrationId,
        externalId: `${STAMP}-ext-2`,
        isRequirement: true,
        requirementDetachedAt: new Date(),
      },
      select: { id: true },
    });
    detachedRequirementId = detachedRequirement.id;

    // An ordinary synced defect — isRequirement false, never locked.
    const syncedDefect = await db.issue.create({
      data: {
        name: `${STAMP}-synced-defect`,
        title: `${STAMP}-synced-defect`,
        createdById: adminUserId,
        projectId,
        integrationId,
        externalId: `${STAMP}-ext-3`,
        isRequirement: false,
      },
      select: { id: true },
    });
    syncedDefectId = syncedDefect.id;

    // A native row (no integrationId) used only as the target of the
    // parentId rejection test.
    const parentCandidate = await db.issue.create({
      data: {
        name: `${STAMP}-parent-candidate`,
        title: `${STAMP}-parent-candidate`,
        createdById: adminUserId,
        projectId,
        isRequirement: true,
      },
      select: { id: true },
    });
    parentCandidateId = parentCandidate.id;
  });

  afterAll(async () => {
    await db.issue.deleteMany({
      where: {
        id: {
          in: [
            syncedRequirementId,
            detachedRequirementId,
            syncedDefectId,
            parentCandidateId,
          ],
        },
      },
    });
    await db.integration.delete({ where: { id: integrationId } });
    await db.projects.delete({ where: { id: projectId } });
    await db.user.delete({ where: { id: adminUserId } });
    await db.$disconnect();
  });

  it("REJECTS updating title on a synced+locked requirement", async () => {
    const edb = await authDbFor(adminUserId);

    await expect(
      edb.issue.update({
        where: { id: syncedRequirementId },
        data: { title: "should-be-denied" },
      })
    ).rejects.toThrow();

    const row = await db.issue.findUnique({
      where: { id: syncedRequirementId },
      select: { title: true },
    });
    expect(row?.title).toBe(`${STAMP}-synced-requirement`);
  });

  it("REJECTS updating parentId on a synced+locked requirement", async () => {
    const edb = await authDbFor(adminUserId);

    await expect(
      edb.issue.update({
        where: { id: syncedRequirementId },
        data: { parentId: parentCandidateId },
      })
    ).rejects.toThrow();

    const row = await db.issue.findUnique({
      where: { id: syncedRequirementId },
      select: { parentId: true },
    });
    expect(row?.parentId).toBeNull();
  });

  it.todo(
    "ALLOWS updating title on a detached requirement (requirementDetachedAt set)"
  );
  it.todo(
    "ALLOWS updating title on an ordinary synced defect (isRequirement=false)"
  );
  it.todo("ALLOWS updating note on a synced+locked requirement");
});
