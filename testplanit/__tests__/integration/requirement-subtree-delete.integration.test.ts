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
// Tree C is the DELETE-side role-containment proof. `Issue` holds requirement
// rows and defect rows on one table, and the sync writer sets `parentId` for
// every synced issue regardless of classification — so a requirement-classified
// Epic routinely has unclassified Story/Bug children. The cascade must stop
// at every such node: those rows are not in the requirements tree, are not
// in the count the delete confirmation shows the user, and deleting them is
// silent destruction of unrelated defects.
//
// Tree E is tree C read backwards: the RESTORE-side role-containment proof.
// It needs one thing tree C does not — every non-cohort row soft-deleted with
// the SAME `deletedAt` as the cascade cohort. Otherwise restore's cohort
// timestamp predicate alone excludes them, and the restore walk's own role
// predicates are never load-bearing under test even when they are the only
// thing that would hold a real walk inside the requirement tree.
//
// Trees D and F cover the two bulk statements' OWN role predicates. Those can
// only matter when the candidate id list disagrees with the rows on disk,
// which is reachable in production because both walks resolve their candidates
// outside the write transaction: a concurrent `recomputeRequirementClassification`
// (the requirements-config save) can reclassify a row out of the requirement
// set in between. Each test reproduces exactly that interleaving by flipping
// `isRequirement` inside the caller's transaction — invisible to the walk,
// which reads through a different connection — and then asserting on which
// rows actually survived.
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

  // Tree C: a requirement root with BOTH requirement and non-requirement
  // children, the mixed-classification shape Jira sync produces.
  //
  //   rootC (req)
  //   |- childC1 (req)                      <- the only descendant that may be deleted
  //   |  `- defectUnderChildC1              <- gateway an unscoped RECURSIVE ARM opens
  //   |     `- reqUnderDefectUnderChildC1 (req)  <- ...and the row it destroys
  //   `- defectC1                           <- gateway an unscoped ANCHOR opens
  //      |- defectGrandchildC1              <- must not be reached transitively
  //      `- reqUnderDefectC1 (req)          <- ...and the row it destroys
  //
  // A requirement behind each non-requirement gateway is what makes the two
  // walk predicates observable at all. The bulk statement filters
  // `isRequirement` on its own, so a widened walk that swept only the defect
  // rows in would change nothing on disk and prove nothing. It is the
  // requirement hiding behind each gateway — one no requirements tree ever
  // showed beneath rootC, since neither is reachable through requirement-only
  // edges — that a widened walk actually destroys.
  let rootCId: number;
  let childC1Id: number;
  let defectC1Id: number;
  let defectUnderChildC1Id: number;
  let reqUnderDefectUnderChildC1Id: number;
  let defectGrandchildC1Id: number;
  let reqUnderDefectC1Id: number;
  // Every tree C row the cascade must leave completely untouched.
  let treeCSurvivorIds: number[];

  // Tree D: rootD with two interchangeable requirement children. childD1 is
  // reclassified out of the requirement set inside the caller's transaction
  // after the walk has already resolved it as a candidate; childD2 is the
  // control that proves the walk really did reach this generation.
  let rootDId: number;
  let childD1Id: number;
  let childD2Id: number;

  // Tree E: the restore-side mirror of tree C.
  //
  //   rootE (req)                              <- cascade-deleted
  //   |- childE1 (req)                         <- cascade-deleted
  //   |  `- defectUnderChildE1                 <- catches an unscoped RECURSIVE ARM
  //   |     `- reqUnderDefectUnderChildE1 (req)   ...by way of this row
  //   `- defectE1                              <- catches an unscoped ANCHOR
  //      `- reqUnderDefectE1 (req)                ...by way of this row
  //
  // The two requirement rows sitting BEHIND a non-requirement node are what
  // make the walk's role predicates observable: restore's own UPDATE filters
  // `isRequirement`, so an unscoped walk that only swept the two defect rows
  // in would change nothing on disk. It is the requirement hiding behind each
  // of them that a widened walk would wrongly resurrect.
  let rootEId: number;
  let childE1Id: number;
  let defectE1Id: number;
  let reqUnderDefectE1Id: number;
  let defectUnderChildE1Id: number;
  let reqUnderDefectUnderChildE1Id: number;
  // Deleted alongside the cascade, sharing its deletedAt — never part of it.
  let treeENonCohortIds: number[];

  // Tree F: tree D's restore-side twin.
  let rootFId: number;
  let childF1Id: number;
  let childF2Id: number;

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

    // Written column-explicitly rather than through the ORM: this suite needs
    // a Projects row only as the FK anchor its Issue fixtures hang off, and it
    // asserts nothing about Projects. Creating it through the generated client
    // would enumerate every column that client knows about, which couples a
    // scratch-database suite to schema changes it has no stake in.
    const [project] = await db.$queryRaw<Array<{ id: number }>>`
      INSERT INTO "Projects" ("name", "createdBy", "createdAt")
      VALUES (${`${STAMP}-project`}, ${adminUserId}, now())
      RETURNING id
    `;
    projectId = project.id;

    // `isRequirement` is explicit on every fixture rather than left to the
    // column default: this whole suite exercises the REQUIREMENT cascade, so
    // a fixture that silently defaulted to a defect row would make the
    // cascade's own role scoping untestable.
    async function createIssue(
      name: string,
      parentId: number | null,
      isRequirement = true
    ) {
      const issue = await db.issue.create({
        data: {
          name: `${STAMP}-${name}`,
          title: `${STAMP}-${name}`,
          createdById: adminUserId,
          projectId,
          parentId,
          isRequirement,
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

    // Tree C: mixed classification under one requirement root.
    rootCId = await createIssue("root-c", null);
    childC1Id = await createIssue("child-c1", rootCId);
    defectUnderChildC1Id = await createIssue(
      "defect-under-child-c1",
      childC1Id,
      false
    );
    reqUnderDefectUnderChildC1Id = await createIssue(
      "req-under-defect-under-child-c1",
      defectUnderChildC1Id,
      true
    );
    defectC1Id = await createIssue("defect-c1", rootCId, false);
    defectGrandchildC1Id = await createIssue(
      "defect-grandchild-c1",
      defectC1Id,
      false
    );
    reqUnderDefectC1Id = await createIssue(
      "req-under-defect-c1",
      defectC1Id,
      true
    );
    treeCSurvivorIds = [
      defectUnderChildC1Id,
      reqUnderDefectUnderChildC1Id,
      defectC1Id,
      defectGrandchildC1Id,
      reqUnderDefectC1Id,
    ];

    // Tree D: two identical live requirement children under one root.
    rootDId = await createIssue("root-d", null);
    childD1Id = await createIssue("child-d1", rootDId);
    childD2Id = await createIssue("child-d2", rootDId);

    // Tree E: mixed classification, two levels deep on both branches.
    rootEId = await createIssue("root-e", null);
    childE1Id = await createIssue("child-e1", rootEId);
    defectUnderChildE1Id = await createIssue(
      "defect-under-child-e1",
      childE1Id,
      false
    );
    reqUnderDefectUnderChildE1Id = await createIssue(
      "req-under-defect-under-child-e1",
      defectUnderChildE1Id,
      true
    );
    defectE1Id = await createIssue("defect-e1", rootEId, false);
    reqUnderDefectE1Id = await createIssue(
      "req-under-defect-e1",
      defectE1Id,
      true
    );
    treeENonCohortIds = [
      defectUnderChildE1Id,
      reqUnderDefectUnderChildE1Id,
      defectE1Id,
      reqUnderDefectE1Id,
    ];

    // Tree F: tree D's shape again, for the restore side.
    rootFId = await createIssue("root-f", null);
    childF1Id = await createIssue("child-f1", rootFId);
    childF2Id = await createIssue("child-f2", rootFId);

    // Soft-delete ONE grandchild of tree A directly, in its own operation,
    // BEFORE any cascade runs.
    await db.issue.update({
      where: { id: grandchildA1bId },
      data: { isDeleted: true },
    });
    preDeletedGrandchildId = grandchildA1bId;

    cascadeDeletedIds = treeAIds.filter((id) => id !== preDeletedGrandchildId);

    // Delete tree E's non-cohort rows in the SAME transaction as its cascade.
    // The stamp trigger uses now(), which is the TRANSACTION timestamp, so all
    // six rows come out carrying one identical deletedAt. Two soft-deletes
    // landing in one transaction is ordinary; the point is that in that state
    // restore's cohort-timestamp predicate stops discriminating, leaving the
    // role predicates as the only thing holding the restore walk inside the
    // requirement tree. The cascade resolves its own candidates through
    // `baseDb` — a connection outside this transaction — so it sees these
    // rows as still live and simply never reaches them, which is the correct
    // behaviour under test in the delete-side entries above.
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "Issue"
        SET "isDeleted" = true
        WHERE id = ANY(${treeENonCohortIds}::int[])
      `;
      await deleteRequirementSubtree(rootEId, projectId, { tx });
    });
  });

  afterAll(async () => {
    await db.issue.deleteMany({ where: { id: { in: allIssueIds } } });
    await db.$executeRaw`DELETE FROM "Projects" WHERE id = ${projectId}`;
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

  it("deleteRequirementSubtree refuses a non-requirement root and touches nothing beneath it", async () => {
    const result = await deleteRequirementSubtree(defectC1Id, projectId);
    expect(result.deletedIds).toEqual([]);
    expect(result.deletedAt).toBeNull();

    const rows = await db.issue.findMany({
      where: {
        id: { in: [defectC1Id, defectGrandchildC1Id, reqUnderDefectC1Id] },
      },
      select: { id: true, isDeleted: true },
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.isDeleted).toBe(false);
    }
  });

  it("deleteRequirementSubtree deletes only requirement rows, stopping at every non-requirement child", async () => {
    const result = await deleteRequirementSubtree(rootCId, projectId);

    // Exactly the two requirement rows connected by requirement-only edges —
    // the same set the delete confirmation counts from the requirements
    // tree's own childrenMap, which is likewise built from requirement rows
    // only. Asserted as an exact set, not a superset: the whole defect is
    // that the cascade reached rows this list does not name.
    expect([...result.deletedIds].sort((a, b) => a - b)).toEqual(
      [rootCId, childC1Id].sort((a, b) => a - b)
    );

    const deleted = await db.issue.findMany({
      where: { id: { in: [rootCId, childC1Id] } },
      select: { id: true, isDeleted: true },
    });
    expect(deleted).toHaveLength(2);
    for (const row of deleted) {
      expect(row.isDeleted).toBe(true);
    }

    // Every row the FK edge reaches but the cascade must not — both
    // non-requirement gateways, the requirement hiding behind each of them,
    // and a defect's own defect child.
    const survivors = await db.issue.findMany({
      where: { id: { in: treeCSurvivorIds } },
      select: { id: true, isDeleted: true, deletedAt: true },
    });
    expect(survivors).toHaveLength(treeCSurvivorIds.length);
    for (const row of survivors) {
      expect({ id: row.id, isDeleted: row.isDeleted }).toEqual({
        id: row.id,
        isDeleted: false,
      });
      expect(row.deletedAt).toBeNull();
    }
  });

  it("deleteRequirementSubtree stops at a non-requirement CHILD of the deleted root", async () => {
    // defectC1 hangs directly off rootC, so a walk whose ANCHOR dropped the
    // role predicate picks it up and, through it, destroys reqUnderDefectC1.
    const rows = await db.issue.findMany({
      where: { id: { in: [defectC1Id, reqUnderDefectC1Id] } },
      select: { id: true, isDeleted: true },
      orderBy: { id: "asc" },
    });
    expect(
      rows.map((row) => ({ id: row.id, isDeleted: row.isDeleted }))
    ).toEqual([
      { id: defectC1Id, isDeleted: false },
      { id: reqUnderDefectC1Id, isDeleted: false },
    ]);
  });

  it("deleteRequirementSubtree stops at a non-requirement GRANDCHILD of the deleted root", async () => {
    // defectUnderChildC1 sits one level below the anchor, so only the
    // RECURSIVE ARM's role predicate keeps the walk from descending into it
    // and destroying reqUnderDefectUnderChildC1 below it.
    const rows = await db.issue.findMany({
      where: {
        id: { in: [defectUnderChildC1Id, reqUnderDefectUnderChildC1Id] },
      },
      select: { id: true, isDeleted: true },
      orderBy: { id: "asc" },
    });
    expect(
      rows.map((row) => ({ id: row.id, isDeleted: row.isDeleted }))
    ).toEqual([
      { id: defectUnderChildC1Id, isDeleted: false },
      { id: reqUnderDefectUnderChildC1Id, isDeleted: false },
    ]);
  });

  it("deleteRequirementSubtree leaves a surviving non-requirement child's parentId edge intact", async () => {
    // The settled policy: survivors are left alone, not re-parented to null.
    // A soft-delete removes no row, so the FK still resolves; nulling the
    // edge would instead be an unrecoverable second mutation, since restore
    // puts back `isDeleted` and never edges.
    const row = await db.issue.findUnique({
      where: { id: defectC1Id },
      select: { parentId: true },
    });
    expect(row?.parentId).toBe(rootCId);
  });

  it("restoreRequirementSubtree restores the requirement cohort without disturbing the survivors", async () => {
    const { restoredIds } = await restoreRequirementSubtree(rootCId, projectId);
    expect([...restoredIds].sort((a, b) => a - b)).toEqual(
      [rootCId, childC1Id].sort((a, b) => a - b)
    );

    const survivors = await db.issue.findMany({
      where: { id: { in: treeCSurvivorIds } },
      select: { id: true, isDeleted: true },
    });
    for (const row of survivors) {
      expect(row.isDeleted).toBe(false);
    }
  });

  it("deleteRequirementSubtree spares a candidate reclassified out of the requirement set after the walk resolved", async () => {
    let deletedIds: number[] = [];

    await db.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "Issue" SET "isRequirement" = false WHERE id = ${childD1Id}
      `;

      // The walk resolves its candidates through `baseDb`, a connection
      // outside this transaction, so it still sees childD1 as a live
      // requirement and still hands it to the bulk statement. Asserted rather
      // than assumed: if this read ever saw the reclassification, childD1
      // would be spared by the CTE and the entry below would prove nothing
      // about the bulk statement's own predicate.
      const asTheWalkSeesIt = await db.issue.findUnique({
        where: { id: childD1Id },
        select: { isRequirement: true, isDeleted: true },
      });
      expect(asTheWalkSeesIt).toEqual({
        isRequirement: true,
        isDeleted: false,
      });

      ({ deletedIds } = await deleteRequirementSubtree(rootDId, projectId, {
        tx,
      }));
    });

    // Reported from the statement's own RETURNING, so it names the rows that
    // were actually flipped — childD1 was a candidate and is absent.
    expect([...deletedIds].sort((a, b) => a - b)).toEqual(
      [rootDId, childD2Id].sort((a, b) => a - b)
    );

    const rows = await db.issue.findMany({
      where: { id: { in: [rootDId, childD1Id, childD2Id] } },
      select: { id: true, isDeleted: true, deletedAt: true },
      orderBy: { id: "asc" },
    });
    expect(
      rows.map((row) => ({ id: row.id, isDeleted: row.isDeleted }))
    ).toEqual([
      { id: rootDId, isDeleted: true },
      { id: childD1Id, isDeleted: false },
      { id: childD2Id, isDeleted: true },
    ]);
    expect(rows.find((row) => row.id === childD1Id)?.deletedAt).toBeNull();
  });

  it("tree E's cascade cohort and the rows deleted beside it share one deletedAt", async () => {
    // The precondition every tree E restore entry below rests on. Without it
    // restore's cohort-timestamp predicate would exclude the non-cohort rows
    // on its own and the role predicates would never be exercised — the
    // assertions would pass for a reason unrelated to what they claim to
    // prove.
    const rows = await db.issue.findMany({
      where: { id: { in: [rootEId, childE1Id, ...treeENonCohortIds] } },
      select: { id: true, isDeleted: true, deletedAt: true },
    });
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect({ id: row.id, isDeleted: row.isDeleted }).toEqual({
        id: row.id,
        isDeleted: true,
      });
    }
    const distinctTimestamps = new Set(
      rows.map((row) => row.deletedAt?.getTime())
    );
    expect(distinctTimestamps.size).toBe(1);
    expect(distinctTimestamps.has(undefined)).toBe(false);
  });

  it("restoreRequirementSubtree refuses a non-requirement root and leaves the requirement beneath it deleted", async () => {
    const { restoredIds } = await restoreRequirementSubtree(
      defectE1Id,
      projectId
    );
    expect(restoredIds).toEqual([]);

    const rows = await db.issue.findMany({
      where: { id: { in: [defectE1Id, reqUnderDefectE1Id] } },
      select: { id: true, isDeleted: true },
      orderBy: { id: "asc" },
    });
    expect(
      rows.map((row) => ({ id: row.id, isDeleted: row.isDeleted }))
    ).toEqual([
      { id: defectE1Id, isDeleted: true },
      { id: reqUnderDefectE1Id, isDeleted: true },
    ]);
  });

  it("restoreRequirementSubtree restores only tree E's requirement cohort", async () => {
    const { restoredIds } = await restoreRequirementSubtree(rootEId, projectId);
    expect([...restoredIds].sort((a, b) => a - b)).toEqual(
      [rootEId, childE1Id].sort((a, b) => a - b)
    );

    const rows = await db.issue.findMany({
      where: { id: { in: [rootEId, childE1Id] } },
      select: { id: true, isDeleted: true },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect({ id: row.id, isDeleted: row.isDeleted }).toEqual({
        id: row.id,
        isDeleted: false,
      });
    }
  });

  it("restoreRequirementSubtree stops at a non-requirement CHILD of the restored root", async () => {
    // defectE1 hangs directly off rootE, so a restore walk whose ANCHOR
    // dropped the role predicate would pick it up — and through it resurrect
    // reqUnderDefectE1, a requirement that no requirements tree ever showed
    // beneath rootE and that this cascade therefore never deleted.
    const rows = await db.issue.findMany({
      where: { id: { in: [defectE1Id, reqUnderDefectE1Id] } },
      select: { id: true, isDeleted: true },
      orderBy: { id: "asc" },
    });
    expect(
      rows.map((row) => ({ id: row.id, isDeleted: row.isDeleted }))
    ).toEqual([
      { id: defectE1Id, isDeleted: true },
      { id: reqUnderDefectE1Id, isDeleted: true },
    ]);
  });

  it("restoreRequirementSubtree stops at a non-requirement GRANDCHILD of the restored root", async () => {
    // defectUnderChildE1 is only reachable one level below the anchor, so it
    // is the RECURSIVE ARM's role predicate — not the anchor's — that keeps
    // the walk from descending into it and resurrecting
    // reqUnderDefectUnderChildE1 below it.
    const rows = await db.issue.findMany({
      where: {
        id: { in: [defectUnderChildE1Id, reqUnderDefectUnderChildE1Id] },
      },
      select: { id: true, isDeleted: true },
      orderBy: { id: "asc" },
    });
    expect(
      rows.map((row) => ({ id: row.id, isDeleted: row.isDeleted }))
    ).toEqual([
      { id: defectUnderChildE1Id, isDeleted: true },
      { id: reqUnderDefectUnderChildE1Id, isDeleted: true },
    ]);
  });

  it("restoreRequirementSubtree spares a candidate reclassified out of the requirement set after the walk resolved", async () => {
    const { deletedIds } = await deleteRequirementSubtree(rootFId, projectId);
    expect([...deletedIds].sort((a, b) => a - b)).toEqual(
      [rootFId, childF1Id, childF2Id].sort((a, b) => a - b)
    );

    let restoredIds: number[] = [];
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "Issue" SET "isRequirement" = false WHERE id = ${childF1Id}
      `;

      // Same interleaving as the delete-side entry: the deleted-side walk
      // reads outside this transaction and still hands childF1 over as a
      // candidate, so only the restore statement's own role predicate can
      // hold it back.
      const asTheWalkSeesIt = await db.issue.findUnique({
        where: { id: childF1Id },
        select: { isRequirement: true, isDeleted: true },
      });
      expect(asTheWalkSeesIt).toEqual({ isRequirement: true, isDeleted: true });

      ({ restoredIds } = await restoreRequirementSubtree(rootFId, projectId, {
        tx,
      }));
    });

    expect([...restoredIds].sort((a, b) => a - b)).toEqual(
      [rootFId, childF2Id].sort((a, b) => a - b)
    );

    const rows = await db.issue.findMany({
      where: { id: { in: [rootFId, childF1Id, childF2Id] } },
      select: { id: true, isDeleted: true },
      orderBy: { id: "asc" },
    });
    expect(
      rows.map((row) => ({ id: row.id, isDeleted: row.isDeleted }))
    ).toEqual([
      { id: rootFId, isDeleted: false },
      { id: childF1Id, isDeleted: true },
      { id: childF2Id, isDeleted: false },
    ]);
  });
});
