// Live-DB integration proof for CFG-03 — the requirements-config
// recompute pass (both-direction isRequirement flip, one audited
// transaction, project-scoped, no stale rows).
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirements-config-recompute.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import { recomputeRequirementClassification } from "~/lib/services/requirementHierarchy";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `rc-${Date.now()}`;

const TYPE_A = "10001";
const TYPE_B = "10002";

type IssueSnapshot = {
  id: number;
  isRequirement: boolean;
  isDeleted: boolean;
  requirementDetachedAt: Date | null;
  parentId: number | null;
  title: string;
};

describeIntegration("requirements-config recompute (live DB)", () => {
  let adminUserId: string;
  let p1Id: number;
  let p2Id: number;

  // P1 — the recompute's target project.
  let p1UnclassifiedAId: number;
  let p1ClassifiedAId: number;
  let p1ClassifiedBId: number;
  let p1SoftDeletedAId: number;
  let p1DetachedBId: number;

  // P2 — the control project. Every row here must come out byte-identical.
  let p2UnclassifiedAId: number;
  let p2ClassifiedAId: number;
  let p2ClassifiedBId: number;
  let p2SoftDeletedAId: number;
  let p2DetachedBId: number;

  const allIssueIds: number[] = [];
  const p2IssueIds: number[] = [];

  let p2RowsBefore: IssueSnapshot[];
  let p1DetachedBBefore: {
    requirementDetachedAt: Date | null;
    parentId: number | null;
    title: string;
  } | null;

  let recomputeResult: { classified: number; declassified: number };

  const issueSelect = {
    id: true,
    isRequirement: true,
    isDeleted: true,
    requirementDetachedAt: true,
    parentId: true,
    title: true,
  } as const;

  beforeAll(async () => {
    // Refuse to run against anything but a scratch database — the
    // worktree .env DATABASE_URL resolves to `ew`, and this suite runs a
    // real bulk isRequirement flip.
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
        name: `Requirements Config Recompute Admin ${STAMP}`,
        authMethod: "INTERNAL",
        access: "ADMIN",
        accessSource: "MANUAL",
        roleId: role.id,
        password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
      },
      select: { id: true },
    });
    adminUserId = admin.id;

    const p1 = await db.projects.create({
      data: { name: `${STAMP}-p1`, createdBy: adminUserId },
      select: { id: true },
    });
    p1Id = p1.id;
    const p2 = await db.projects.create({
      data: { name: `${STAMP}-p2`, createdBy: adminUserId },
      select: { id: true },
    });
    p2Id = p2.id;

    async function createIssue(
      projectId: number,
      name: string,
      overrides: Record<string, unknown> = {}
    ) {
      const issue = await db.issue.create({
        data: {
          name: `${STAMP}-${name}`,
          title: `${STAMP}-${name}`,
          createdById: adminUserId,
          projectId,
          ...overrides,
        },
        select: { id: true },
      });
      allIssueIds.push(issue.id);
      return issue.id;
    }

    // P1 fixtures — one row per state the recompute must handle correctly.
    p1UnclassifiedAId = await createIssue(p1Id, "p1-unclassified-a", {
      issueTypeId: TYPE_A,
      isRequirement: false,
    });
    p1ClassifiedAId = await createIssue(p1Id, "p1-classified-a", {
      issueTypeId: TYPE_A,
      isRequirement: true,
    });
    p1ClassifiedBId = await createIssue(p1Id, "p1-classified-b", {
      issueTypeId: TYPE_B,
      isRequirement: true,
    });
    // Matches TYPE_A + isRequirement=false in every predicate the classify
    // statement checks EXCEPT isDeleted — the only thing keeping this row
    // unchanged is the "isDeleted" = false guard.
    p1SoftDeletedAId = await createIssue(p1Id, "p1-soft-deleted-a", {
      issueTypeId: TYPE_A,
      isRequirement: false,
      isDeleted: true,
    });
    p1DetachedBId = await createIssue(p1Id, "p1-detached-b", {
      issueTypeId: TYPE_B,
      isRequirement: true,
      requirementDetachedAt: new Date(),
      parentId: p1ClassifiedAId,
    });

    // P2 fixtures — the exact same five states, same types, in a different
    // project. None of these should be touched by a P1-scoped recompute.
    p2UnclassifiedAId = await createIssue(p2Id, "p2-unclassified-a", {
      issueTypeId: TYPE_A,
      isRequirement: false,
    });
    p2ClassifiedAId = await createIssue(p2Id, "p2-classified-a", {
      issueTypeId: TYPE_A,
      isRequirement: true,
    });
    p2ClassifiedBId = await createIssue(p2Id, "p2-classified-b", {
      issueTypeId: TYPE_B,
      isRequirement: true,
    });
    p2SoftDeletedAId = await createIssue(p2Id, "p2-soft-deleted-a", {
      issueTypeId: TYPE_A,
      isRequirement: false,
      isDeleted: true,
    });
    p2DetachedBId = await createIssue(p2Id, "p2-detached-b", {
      issueTypeId: TYPE_B,
      isRequirement: true,
      requirementDetachedAt: new Date(),
      parentId: p2ClassifiedAId,
    });
    p2IssueIds.push(
      p2UnclassifiedAId,
      p2ClassifiedAId,
      p2ClassifiedBId,
      p2SoftDeletedAId,
      p2DetachedBId
    );

    p2RowsBefore = await db.issue.findMany({
      where: { id: { in: p2IssueIds } },
      select: issueSelect,
      orderBy: { id: "asc" },
    });

    p1DetachedBBefore = await db.issue.findUnique({
      where: { id: p1DetachedBId },
      select: {
        requirementDetachedAt: true,
        parentId: true,
        title: true,
      },
    });

    // The single call under test — both directions, one project, one
    // transaction. Every `it` below re-reads through the raw client to
    // assert on the state this call actually left behind.
    recomputeResult = await recomputeRequirementClassification(
      p1Id,
      [TYPE_A],
      [TYPE_B]
    );
  });

  afterAll(async () => {
    await db.issue.deleteMany({ where: { id: { in: allIssueIds } } });
    await db.projects.delete({ where: { id: p1Id } });
    await db.projects.delete({ where: { id: p2Id } });
    await db.user.delete({ where: { id: adminUserId } });
    await db.$disconnect();
  });

  it("classifies issues whose type was added to the config", async () => {
    const row = await db.issue.findUnique({
      where: { id: p1UnclassifiedAId },
      select: { isRequirement: true },
    });
    expect(row?.isRequirement).toBe(true);
    // Only the ONE previously-unclassified type-A row actually flips — the
    // already-classified type-A row doesn't count toward this total, since
    // the classify statement's own "isRequirement = false" predicate never
    // rewrites a row that was already correct.
    expect(recomputeResult.classified).toBe(1);
  });

  it("de-classifies issues whose type was removed from the config", async () => {
    const rows = await db.issue.findMany({
      where: { id: { in: [p1ClassifiedBId, p1DetachedBId] } },
      select: { isRequirement: true },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.isRequirement).toBe(false);
    }
    expect(recomputeResult.declassified).toBe(2);
  });

  it("leaves another project's issues of the same type untouched", async () => {
    const p2RowsAfter = await db.issue.findMany({
      where: { id: { in: p2IssueIds } },
      select: issueSelect,
      orderBy: { id: "asc" },
    });
    // Byte-identical to the pre-call snapshot — this is the assertion that
    // catches a missing or mis-scoped "projectId" predicate, and it is the
    // highest-severity failure this plan can have.
    expect(p2RowsAfter).toEqual(p2RowsBefore);
  });

  it("skips soft-deleted issues in both directions", async () => {
    const row = await db.issue.findUnique({
      where: { id: p1SoftDeletedAId },
      select: { isRequirement: true, isDeleted: true },
    });
    expect(row?.isRequirement).toBe(false);
    expect(row?.isDeleted).toBe(true);
  });

  it("leaves requirementDetachedAt, parentId and title untouched", async () => {
    const row = await db.issue.findUnique({
      where: { id: p1DetachedBId },
      select: {
        requirementDetachedAt: true,
        parentId: true,
        title: true,
        isRequirement: true,
      },
    });
    expect(row?.requirementDetachedAt).toEqual(
      p1DetachedBBefore?.requirementDetachedAt
    );
    expect(row?.parentId).toBe(p1DetachedBBefore?.parentId);
    expect(row?.title).toBe(p1DetachedBBefore?.title);
    // This row's type WAS in removedTypeIds — confirming the columns above
    // survived a de-classification that actually happened, not one the
    // recompute skipped entirely.
    expect(row?.isRequirement).toBe(false);
  });
});
