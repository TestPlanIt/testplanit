// Live-DB regression proof for LINK-03's RequirementIssueReference join
// model (D-09/D-11/D-15). A reference joins a requirement (the Issue row
// with isRequirement: true) to a referenced Issue -- internal, or, via the
// existing linked-issue-shell upsert path, an imported external ticket.
//
// Load-bearing companion rule under proof here: a reference-created shell
// NEVER sets isRequirement (D-09) -- references must never appear in the
// requirements tree -- and removal hard-deletes only the join row, leaving
// the referenced Issue intact (D-15), mirroring the bare-join
// RepositoryCaseIssue unlink semantics.
//
// STAMP-based fixture creation + explicit afterAll cleanup, NOT a
// per-test $transaction rollback: getAuthDb (lib/zenstack.ts) binds the
// app's own module-level policyClient, itself bound to
// process.env.DATABASE_URL's connection pool -- a SEPARATE pool from the
// one createRawDbClient() opens here. A raw-client transaction cannot
// wrap writes issued through that other pool, so the two would never
// share a rollback boundary. issue-case-link-routes.integration.test.ts
// and issue-requirement-lock.test.ts (this suite's actual structural
// precedents, since both mix a raw fixture client with the real enhanced
// policy client) use the same STAMP + explicit-cleanup discipline for
// exactly this reason.
//
// Run via (never against the default .env DATABASE_URL -- that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirement-issue-reference.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

import { createRawDbClient } from "~/lib/rawDbClient";
import { getAuthDb } from "~/lib/zenstack";
import {
  isRequirementLocked,
  LOCKED_ISSUE_FIELDS,
  upsertLinkedIssueShell,
} from "~/lib/services/linkedIssueUpsert";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const DB_URL = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `rir-${Date.now()}`;

async function authDbFor(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
  if (!user) throw new Error(`Test setup: user ${userId} not found`);
  return getAuthDb(user as never);
}

describeIntegration("RequirementIssueReference join model (live DB)", () => {
  let adminUserId: string;
  let projectId: number;
  let integrationId: number;

  // Basic pair: a plain native requirement plus three independent referenced
  // issues, one per non-interfering scenario -- kept separate so no test's
  // assertions depend on another test's leftover join-row state.
  let requirementId: number;
  let refIssueCreateReadId: number;
  let refIssueDuplicateId: number;
  let refIssueDeleteId: number;

  // parentId non-interference fixture: both rows start with a real,
  // distinguishable parentId set at creation time.
  let parentCandidateId: number;
  let requirementParentTestId: number;
  let refIssueParentTestId: number;

  // Lock-safety fixture: a real Integration row and a synced+locked
  // requirement whose five LOCKED_ISSUE_FIELDS all carry real,
  // distinguishable values (not just null defaults).
  let lockedReqId: number;
  let refIssueLockTestId: number;

  const allIssueIds: number[] = [];

  beforeAll(async () => {
    // Refuse to run against anything but a scratch database -- the
    // worktree .env DATABASE_URL resolves to `ew`, and this suite writes
    // real join rows through the enhanced client.
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
      const { rows } = await client.query<{ current_database: string }>(
        "select current_database()"
      );
      const dbName = rows[0]?.current_database;
      if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
        throw new Error(
          `Refusing to run against database "${dbName}" — the ` +
            `RequirementIssueReference integration suite only runs against ` +
            `tpi_req20 (scratch) or tpi_test (CI's ephemeral service database).`
        );
      }
    } finally {
      await client.end();
    }

    const role = await db.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");

    // ADMIN-tier acting user: the model-level @@allow('all', access ==
    // 'ADMIN') grants unconditional create/update/delete on
    // RequirementIssueReference and Issue, so any rejection observed below
    // is caused ONLY by the specific rule under test (the self-reference
    // @@deny, the requirement-lock field-level @deny), not by a missing
    // project-scoped permission grant.
    const admin = await db.user.create({
      data: {
        email: `${STAMP}-admin@example.com`,
        name: `Requirement Reference Admin ${STAMP}`,
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
      data: { name: `${STAMP}-project`, createdBy: adminUserId },
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

    async function createIssue(
      name: string,
      extra: Record<string, unknown> = {}
    ): Promise<number> {
      const created = await db.issue.create({
        data: {
          name: `${STAMP}-${name}`,
          title: `${STAMP}-${name}`,
          createdById: adminUserId,
          projectId,
          ...extra,
        },
        select: { id: true },
      });
      allIssueIds.push(created.id);
      return created.id;
    }

    requirementId = await createIssue("requirement-1", {
      isRequirement: true,
    });
    refIssueCreateReadId = await createIssue("ref-create-read");
    refIssueDuplicateId = await createIssue("ref-duplicate");
    refIssueDeleteId = await createIssue("ref-delete");

    parentCandidateId = await createIssue("parent-candidate", {
      isRequirement: true,
    });
    requirementParentTestId = await createIssue("requirement-parent-test", {
      isRequirement: true,
      parentId: parentCandidateId,
    });
    refIssueParentTestId = await createIssue("ref-parent-test", {
      parentId: parentCandidateId,
    });

    lockedReqId = await createIssue("locked-requirement", {
      isRequirement: true,
      integrationId,
      externalId: `${STAMP}-locked-ext`,
      description: `${STAMP}-locked-description`,
      status: `${STAMP}-locked-status`,
      priority: "high",
      parentId: parentCandidateId,
    });
    refIssueLockTestId = await createIssue("ref-lock-test");
  });

  afterAll(async () => {
    await db.requirementIssueReference.deleteMany({
      where: { requirementId: { in: allIssueIds } },
    });
    // The upsertLinkedIssueShell test (below) mints its own extra Issue row
    // via a fresh externalId -- sweep it up by STAMP prefix rather than
    // tracking its id separately.
    await db.issue.deleteMany({ where: { name: { startsWith: STAMP } } });
    await db.integration.delete({ where: { id: integrationId } });
    await db.projects.delete({ where: { id: projectId } });
    await db.user.delete({ where: { id: adminUserId } });

    const remainingIssues = await db.issue.count({
      where: { name: { startsWith: STAMP } },
    });
    const remainingProjects = await db.projects.count({
      where: { name: { startsWith: STAMP } },
    });
    expect(remainingIssues).toBe(0);
    expect(remainingProjects).toBe(0);

    await db.$disconnect();
  });

  it("creates a reference row joining a requirement to an internal issue", async () => {
    const created = await db.requirementIssueReference.create({
      data: {
        requirementId,
        referencedIssueId: refIssueCreateReadId,
        createdById: adminUserId,
      },
    });
    expect(created.requirementId).toBe(requirementId);
    expect(created.referencedIssueId).toBe(refIssueCreateReadId);

    const readBack = await db.requirementIssueReference.findUnique({
      where: {
        requirementId_referencedIssueId: {
          requirementId,
          referencedIssueId: refIssueCreateReadId,
        },
      },
    });
    expect(readBack).not.toBeNull();
    expect(readBack?.createdById).toBe(adminUserId);
  });

  it("rejects a second reference row for the same requirement and referenced issue", async () => {
    await db.requirementIssueReference.create({
      data: {
        requirementId,
        referencedIssueId: refIssueDuplicateId,
        createdById: adminUserId,
      },
    });

    // The composite primary key (@@id([requirementId, referencedIssueId]))
    // is a database constraint, so either client proves it -- the raw
    // client is used here since no policy decision is under test.
    await expect(
      db.requirementIssueReference.create({
        data: {
          requirementId,
          referencedIssueId: refIssueDuplicateId,
          createdById: adminUserId,
        },
      })
    ).rejects.toThrow();
  });

  it("rejects a self-reference where requirementId equals referencedIssueId", async () => {
    const edb = await authDbFor(adminUserId);

    // Driving the ENHANCED client so the model's own
    // @@deny('create', requirementId == referencedIssueId) is the actual
    // decision under test -- a raw-client write bypasses policy entirely
    // and would prove nothing.
    await expect(
      edb.requirementIssueReference.create({
        data: {
          requirementId,
          referencedIssueId: requirementId,
          createdById: adminUserId,
        },
      })
    ).rejects.toThrow();

    const row = await db.requirementIssueReference.findUnique({
      where: {
        requirementId_referencedIssueId: {
          requirementId,
          referencedIssueId: requirementId,
        },
      },
    });
    expect(row).toBeNull();
  });

  it("never sets isRequirement on a reference-created issue shell", async () => {
    // Exercises the exact function the references POST route's external
    // branch calls -- proving the invariant at the shell-creation layer
    // itself, one level below the route's own mocked unit-test coverage.
    const shell = await upsertLinkedIssueShell(db, {
      externalId: `${STAMP}-shell-ext`,
      integrationId,
      create: {
        name: `${STAMP}-shell`,
        title: `${STAMP}-shell`,
        description: "",
        externalId: `${STAMP}-shell-ext`,
        integrationId,
        projectId,
        createdById: adminUserId,
      },
      update: {
        title: `${STAMP}-shell-updated`,
      },
      select: { id: true, isRequirement: true },
    });

    expect(shell.isRequirement).toBe(false);
  });

  it("never writes parentId when attaching a reference", async () => {
    const before = await db.$queryRaw<
      Array<{ id: number; parentId: number | null }>
    >`
      SELECT "id", "parentId" FROM "Issue" WHERE "id" IN (${requirementParentTestId}, ${refIssueParentTestId})
    `;
    const beforeById = new Map(before.map((row) => [row.id, row.parentId]));
    expect(beforeById.get(requirementParentTestId)).toBe(parentCandidateId);
    expect(beforeById.get(refIssueParentTestId)).toBe(parentCandidateId);

    const edb = await authDbFor(adminUserId);
    await edb.requirementIssueReference.create({
      data: {
        requirementId: requirementParentTestId,
        referencedIssueId: refIssueParentTestId,
        createdById: adminUserId,
      },
    });

    const after = await db.$queryRaw<
      Array<{ id: number; parentId: number | null }>
    >`
      SELECT "id", "parentId" FROM "Issue" WHERE "id" IN (${requirementParentTestId}, ${refIssueParentTestId})
    `;
    const afterById = new Map(after.map((row) => [row.id, row.parentId]));

    expect(afterById.get(requirementParentTestId)).toBe(
      beforeById.get(requirementParentTestId)
    );
    expect(afterById.get(refIssueParentTestId)).toBe(
      beforeById.get(refIssueParentTestId)
    );
  });

  it("hard-deletes only the join row and leaves the referenced Issue intact", async () => {
    await db.requirementIssueReference.create({
      data: {
        requirementId,
        referencedIssueId: refIssueDeleteId,
        createdById: adminUserId,
      },
    });

    const edb = await authDbFor(adminUserId);
    const result = await edb.requirementIssueReference.deleteMany({
      where: { requirementId, referencedIssueId: refIssueDeleteId },
    });
    expect(result.count).toBe(1);

    const joinRow = await db.requirementIssueReference.findUnique({
      where: {
        requirementId_referencedIssueId: {
          requirementId,
          referencedIssueId: refIssueDeleteId,
        },
      },
    });
    expect(joinRow).toBeNull();

    const referencedIssue = await db.issue.findUnique({
      where: { id: refIssueDeleteId },
      select: { id: true, isDeleted: true },
    });
    expect(referencedIssue).not.toBeNull();
    expect(referencedIssue?.isDeleted).toBe(false);
  });

  it("allows attaching a reference to a synced, locked requirement", async () => {
    const lockedFieldsSelect = Object.fromEntries(
      LOCKED_ISSUE_FIELDS.map((field) => [field, true])
    ) as Record<(typeof LOCKED_ISSUE_FIELDS)[number], true>;

    const before = await db.issue.findUnique({
      where: { id: lockedReqId },
      select: {
        ...lockedFieldsSelect,
        isRequirement: true,
        integrationId: true,
        requirementDetachedAt: true,
      },
    });
    expect(before).not.toBeNull();
    // Fixture-drift guard: if a future change to this file (or the schema
    // defaults) accidentally produces an unlocked row, fail loudly here
    // instead of the field-equality assertions below silently passing on
    // an unlocked row for the wrong reason.
    expect(isRequirementLocked(before)).toBe(true);

    const edb = await authDbFor(adminUserId);
    await expect(
      edb.requirementIssueReference.create({
        data: {
          requirementId: lockedReqId,
          referencedIssueId: refIssueLockTestId,
          createdById: adminUserId,
        },
      })
    ).resolves.toMatchObject({
      requirementId: lockedReqId,
      referencedIssueId: refIssueLockTestId,
    });

    const after = await db.issue.findUnique({
      where: { id: lockedReqId },
      select: {
        ...lockedFieldsSelect,
        isRequirement: true,
        integrationId: true,
        requirementDetachedAt: true,
      },
    });
    expect(after).not.toBeNull();

    for (const field of LOCKED_ISSUE_FIELDS) {
      expect(
        after![field],
        `LOCKED_ISSUE_FIELDS value "${field}" changed after attaching a reference to a locked requirement`
      ).toBe(before![field]);
    }
  });
});
