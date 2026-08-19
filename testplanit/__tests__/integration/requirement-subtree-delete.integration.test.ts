// Live-DB integration proof for deleteRequirementSubtree /
// restoreRequirementSubtree (P2/P6 — cascade soft-delete tree policy).
//
// Issue.parentId's ON DELETE CASCADE foreign key is a hard-delete-only
// mechanism and never fires on a soft-delete UPDATE, so it cannot implement
// this policy — the cascade soft-delete is an explicit application-level
// operation, mirroring the shipped RepositoryFolders subtree delete
// (app/api/projects/[projectId]/folders/delete-subtree/route.ts): resolve
// the subtree with a recursive CTE, then soft-delete the whole set in one
// transaction.
//
// Entry 5 is the symmetry proof: restoreRequirementSubtree must restore
// exactly the rows the matching cascade delete touched, and must not
// resurrect a descendant that was already soft-deleted before the cascade
// ran — a naive "restore everything in the subtree" implementation would
// incorrectly un-delete that row too.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirement-subtree-delete.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import {
  deleteRequirementSubtree,
  restoreRequirementSubtree,
} from "~/lib/services/requirementHierarchy";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `del-${Date.now()}`;

describeIntegration("requirement subtree delete and restore (live DB)", () => {
  let adminUserId: string;
  let projectId: number;

  // Tree A: rootA -> childA1, childA2; childA1 -> grandchildA1a, grandchildA1b.
  // Four nodes deep counting the pre-deleted grandchild's own generation —
  // enough reach that a shallow (root + one level) cascade would visibly
  // under-delete.
  let rootAId: number;
  let childA1Id: number;
  let childA2Id: number;
  let grandchildA1aId: number;
  let grandchildA1bId: number;

  // Tree B: independent second root with one child, same project — used
  // only to prove the cascade does not spill outside its own tree.
  let rootBId: number;
  let childB1Id: number;

  // Soft-deleted directly, BEFORE any cascade runs — the row the
  // restore-symmetry assertion (entry 5) depends on. A correct
  // cohort-scoped restore must leave this row alone.
  let preDeletedGrandchildId: number;

  const allIssueIds: number[] = [];
  const treeAIds: number[] = [];
  const treeBIds: number[] = [];
  // The subset of tree A the cascade itself flips false->true — excludes
  // the grandchild that was already deleted beforehand, since the bulk
  // UPDATE's `AND "isDeleted" = false` predicate (and the live-only
  // subtree CTE feeding it) never touches an already-deleted row.
  let cascadeDeletedIds: number[];

  beforeAll(async () => {
    // Refuse to run against anything but a scratch database — the
    // worktree .env DATABASE_URL resolves to `ew`, and this suite runs a
    // bulk soft-delete.
    const [{ current_database: dbName }] = await db.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
      throw new Error(
        `refusing to run against database "${dbName}" — this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
      );
    }

    // Confirm the soft-delete stamp trigger is actually attached to this
    // database before trusting any deletedAt assertion below — otherwise
    // a failure here would look like a code bug when it is really a
    // missing trigger apply.
    const stampTriggers = await db.$queryRaw<Array<{ trigger_name: string }>>`
        SELECT trigger_name FROM information_schema.triggers
        WHERE event_object_table = 'Issue'
          AND trigger_name LIKE 'tpl_stamp_deleted_at_%'
      `;
    if (stampTriggers.length === 0) {
      throw new Error(
        "the soft-delete stamp trigger is not attached to Issue on this database — run the trigger applier (scripts/apply-triggers.ts) before running this suite; the deletedAt assertions below have no mechanism behind them without it"
      );
    }

    const role = await db.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");

    // ADMIN-tier acting user: the model-level allow for ADMIN means any
    // rejection would come from the cascade logic, not a missing
    // row-level grant.
    const admin = await db.user.create({
      data: {
        email: `${STAMP}-admin@example.com`,
        name: `Requirement Subtree Delete Admin ${STAMP}`,
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

    async function createIssue(name: string, parentId: number | null) {
      const issue = await db.issue.create({
        data: {
          name: `${STAMP}-${name}`,
          title: `${STAMP}-${name}`,
          createdById: adminUserId,
          projectId,
          parentId,
        },
        select: { id: true },
      });
      allIssueIds.push(issue.id);
      return issue.id;
    }

    // Tree A: rootA -> childA1, childA2; childA1 -> grandchildA1a, grandchildA1b.
    rootAId = await createIssue("root-a", null);
    childA1Id = await createIssue("child-a1", rootAId);
    childA2Id = await createIssue("child-a2", rootAId);
    grandchildA1aId = await createIssue("grandchild-a1a", childA1Id);
    grandchildA1bId = await createIssue("grandchild-a1b", childA1Id);
    treeAIds.push(
      rootAId,
      childA1Id,
      childA2Id,
      grandchildA1aId,
      grandchildA1bId
    );

    // Tree B: independent second root, one child, same project — isolation only.
    rootBId = await createIssue("root-b", null);
    childB1Id = await createIssue("child-b1", rootBId);
    treeBIds.push(rootBId, childB1Id);

    // Soft-delete ONE grandchild of tree A directly, in its own operation,
    // BEFORE any cascade runs.
    await db.issue.update({
      where: { id: grandchildA1bId },
      data: { isDeleted: true },
    });
    preDeletedGrandchildId = grandchildA1bId;

    cascadeDeletedIds = treeAIds.filter((id) => id !== preDeletedGrandchildId);
  });

  afterAll(async () => {
    await db.issue.deleteMany({ where: { id: { in: allIssueIds } } });
    await db.projects.delete({ where: { id: projectId } });
    await db.user.delete({ where: { id: adminUserId } });
    await db.$disconnect();
  });

  it("deleteRequirementSubtree soft-deletes the root and every descendant in one transaction", async () => {
    await deleteRequirementSubtree(rootAId, projectId);

    const rows = await db.issue.findMany({
      where: { id: { in: treeAIds } },
      select: { id: true, isDeleted: true },
    });
    expect(rows).toHaveLength(treeAIds.length);
    for (const row of rows) {
      expect(row.isDeleted).toBe(true);
    }
  });

  it("deleteRequirementSubtree leaves a sibling tree in the same project untouched", async () => {
    const rows = await db.issue.findMany({
      where: { id: { in: treeBIds } },
      select: { id: true, isDeleted: true },
    });
    expect(rows).toHaveLength(treeBIds.length);
    for (const row of rows) {
      expect(row.isDeleted).toBe(false);
    }
  });

  it("deleteRequirementSubtree stamps deletedAt on every row it soft-deletes", async () => {
    const rows = await db.issue.findMany({
      where: { id: { in: cascadeDeletedIds } },
      select: { id: true, deletedAt: true },
    });
    expect(rows).toHaveLength(cascadeDeletedIds.length);
    for (const row of rows) {
      expect(row.deletedAt).not.toBeNull();
    }
    // The shared value is not incidental — it is the cohort marker
    // restore depends on, so assert equality across rows, not merely
    // non-nullness.
    const distinctTimestamps = new Set(
      rows.map((row) => row.deletedAt?.getTime())
    );
    expect(distinctTimestamps.size).toBe(1);
  });

  it("restoreRequirementSubtree restores exactly the rows the matching cascade deleted", async () => {
    await restoreRequirementSubtree(rootAId, projectId);

    const rows = await db.issue.findMany({
      where: { id: { in: cascadeDeletedIds } },
      select: { id: true, isDeleted: true, deletedAt: true },
    });
    expect(rows).toHaveLength(cascadeDeletedIds.length);
    for (const row of rows) {
      expect(row.isDeleted).toBe(false);
      expect(row.deletedAt).toBeNull();
    }
  });

  it("restoreRequirementSubtree leaves a descendant that was already deleted before the cascade deleted", async () => {
    const row = await db.issue.findUnique({
      where: { id: preDeletedGrandchildId },
      select: { isDeleted: true, deletedAt: true },
    });
    expect(row?.isDeleted).toBe(true);
    expect(row?.deletedAt).not.toBeNull();
  });
});
