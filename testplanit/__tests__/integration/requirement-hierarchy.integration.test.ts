// Live-DB integration proof for requirementHierarchy's ancestor-map and
// subtree recursive CTEs (HIER-01). buildIssueAncestorMap/getIssueSubtreeIds
// execute WITH RECURSIVE SQL inside Postgres, so unlike the pure guard
// functions in requirementHierarchy.test.ts (mockable against a fake
// $queryRaw), these can only be proven against a real database — a mocked
// client can't validate real recursive-query correctness on a multi-root,
// depth>5 tree with soft-deleted branches and cross-project isolation.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirement-hierarchy.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import {
  buildIssueAncestorMap,
  getIssueSubtreeIds,
} from "~/lib/services/requirementHierarchy";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `rh-${Date.now()}`;

describeIntegration("requirement hierarchy CTEs (live DB)", () => {
  let adminUserId: string;
  let projectOneId: number;
  let projectTwoId: number;

  // Tree A: linear chain of six nodes, depth 6 (a6 has 5 ancestors above it).
  let rootAId: number;
  let a2Id: number;
  let a3Id: number;
  let a4Id: number;
  let a5Id: number;
  let a6Id: number;

  // Tree B: independent second root with two children, same project.
  let rootBId: number;
  let b1Id: number;
  let b2Id: number;

  // Soft-deleted branch under A, with a live child of its own — the
  // fixture that catches a CTE that filters only at the anchor.
  let deletedNodeId: number;
  let deletedChildId: number;

  // Project two: a single unrelated node.
  let projectTwoNodeId: number;

  const allIssueIds: number[] = [];

  beforeAll(async () => {
    // Refuse to run against anything but a scratch database — the worktree
    // .env DATABASE_URL resolves to `ew`, and this suite creates/deletes
    // fixture rows.
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

    // ADMIN-tier acting user: the model-level allow for ADMIN means any
    // hierarchy shape observed below comes from the CTE, not from a
    // missing row-level grant.
    const admin = await db.user.create({
      data: {
        email: `${STAMP}-admin@example.com`,
        name: `Requirement Hierarchy Admin ${STAMP}`,
        authMethod: "INTERNAL",
        access: "ADMIN",
        accessSource: "MANUAL",
        roleId: role.id,
        password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
      },
      select: { id: true },
    });
    adminUserId = admin.id;

    const projectOne = await db.projects.create({
      data: { name: `${STAMP}-project-one`, createdBy: adminUserId },
      select: { id: true },
    });
    projectOneId = projectOne.id;

    const projectTwo = await db.projects.create({
      data: { name: `${STAMP}-project-two`, createdBy: adminUserId },
      select: { id: true },
    });
    projectTwoId = projectTwo.id;

    async function createIssue(
      name: string,
      projectId: number,
      parentId: number | null
    ) {
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

    // Tree A: rootA -> a2 -> a3 -> a4 -> a5 -> a6 (depth 6; a6 has 5 ancestors).
    rootAId = await createIssue("root-a", projectOneId, null);
    a2Id = await createIssue("a2", projectOneId, rootAId);
    a3Id = await createIssue("a3", projectOneId, a2Id);
    a4Id = await createIssue("a4", projectOneId, a3Id);
    a5Id = await createIssue("a5", projectOneId, a4Id);
    a6Id = await createIssue("a6", projectOneId, a5Id);

    // Tree B: independent second root, two children, same project.
    rootBId = await createIssue("root-b", projectOneId, null);
    b1Id = await createIssue("b1", projectOneId, rootBId);
    b2Id = await createIssue("b2", projectOneId, rootBId);

    // Soft-deleted branch under A, with a live child of its own.
    deletedNodeId = await createIssue("deleted-node", projectOneId, rootAId);
    deletedChildId = await createIssue(
      "deleted-child",
      projectOneId,
      deletedNodeId
    );
    await db.issue.update({
      where: { id: deletedNodeId },
      data: { isDeleted: true },
    });

    // Project two: single unrelated node.
    projectTwoNodeId = await createIssue("p2-node", projectTwoId, null);
  });

  afterAll(async () => {
    await db.issue.deleteMany({ where: { id: { in: allIssueIds } } });
    await db.projects.delete({ where: { id: projectOneId } });
    await db.projects.delete({ where: { id: projectTwoId } });
    await db.user.delete({ where: { id: adminUserId } });
    await db.$disconnect();
  });

  it("buildIssueAncestorMap returns the full root-ward chain for every node in a depth-6 tree", async () => {
    const ancestors = await buildIssueAncestorMap(db, projectOneId);
    expect(ancestors.get(a6Id)).toEqual([
      a6Id,
      a5Id,
      a4Id,
      a3Id,
      a2Id,
      rootAId,
    ]);
  });

  it("buildIssueAncestorMap keeps two independent root trees in the same project separate", async () => {
    const ancestors = await buildIssueAncestorMap(db, projectOneId);
    const treeAIds = new Set([rootAId, a2Id, a3Id, a4Id, a5Id, a6Id]);
    const treeBIds = new Set([rootBId, b1Id, b2Id]);

    for (const id of treeAIds) {
      const chain = ancestors.get(id) ?? [];
      expect(chain.some((ancestorId) => treeBIds.has(ancestorId))).toBe(false);
    }
    for (const id of treeBIds) {
      const chain = ancestors.get(id) ?? [];
      expect(chain.some((ancestorId) => treeAIds.has(ancestorId))).toBe(false);
    }
  });

  it("getIssueSubtreeIds returns every descendant of a root and excludes the sibling tree", async () => {
    const subtree = await getIssueSubtreeIds(rootAId, projectOneId, db);
    expect(new Set(subtree)).toEqual(new Set([a2Id, a3Id, a4Id, a5Id, a6Id]));
    expect(subtree).not.toContain(rootBId);
    expect(subtree).not.toContain(b1Id);
    expect(subtree).not.toContain(b2Id);
  });

  it("getIssueSubtreeIds excludes soft-deleted nodes and their descendants", async () => {
    const subtree = await getIssueSubtreeIds(rootAId, projectOneId, db);
    expect(subtree).not.toContain(deletedNodeId);
    expect(subtree).not.toContain(deletedChildId);
  });

  it("getIssueSubtreeIds is scoped to a single project and never crosses into another project", async () => {
    const crossProjectSubtree = await getIssueSubtreeIds(
      rootAId,
      projectTwoId,
      db
    );
    expect(crossProjectSubtree).toEqual([]);

    const sameProjectSubtree = await getIssueSubtreeIds(
      rootAId,
      projectOneId,
      db
    );
    expect(sameProjectSubtree).not.toContain(projectTwoNodeId);
  });
});
