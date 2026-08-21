// Live-DB integration proof for the delete-subtree and restore routes
// (app/api/projects/[projectId]/requirements/[issueId]/delete-subtree/route.ts
// and .../restore/route.ts, landing in 25-05). Proves the routes actually
// call deleteRequirementSubtree/restoreRequirementSubtree end-to-end
// (auth, scoping, response shape) — the services themselves are already
// proven in __tests__/integration/requirement-subtree-delete.integration.test.ts.
//
// Fixture shape (Tree A / Tree B / pre-deleted descendant) is reused
// verbatim from that file: it already builds exactly the tree HIER-04
// needs and explains why. This file proves the same policy one layer up,
// through the route.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirements-delete-subtree-route.integration.test.ts

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `ds-${Date.now()}`;

// Session is the ONLY thing mocked below getServerSession — getEnhancedDb,
// the enhanced ZenStack client, the real @@allow/@@deny policy engine, and
// Postgres are all real (these two routes never touch getEnhancedDb, but
// the mocking convention is kept identical to the sibling detach/reparent
// suites for consistency).
const sessionRef: {
  current: { user: { id: string; access: string } } | null;
} = { current: null };

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => sessionRef.current),
}));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

import { POST as deleteSubtreePost } from "~/app/api/projects/[projectId]/requirements/[issueId]/delete-subtree/route";
import { POST as restorePost } from "~/app/api/projects/[projectId]/requirements/[issueId]/restore/route";

function postRequest(): NextRequest {
  return new NextRequest(
    "http://localhost/api/projects/requirements/op",
    { method: "POST" }
  );
}

function routeParams(projectId: number, issueId: number) {
  return {
    params: Promise.resolve({
      projectId: String(projectId),
      issueId: String(issueId),
    }),
  };
}

describeIntegration(
  "requirements delete-subtree and restore routes (live DB)",
  () => {
    let adminUserId: string;
    let projectId: number;

    // Tree A: rootA -> childA1, childA2; childA1 -> grandchildA1a, grandchildA1b.
    let rootAId: number;
    let childA1Id: number;
    let childA2Id: number;
    let grandchildA1aId: number;
    let grandchildA1bId: number;

    // Tree B: independent second root with one child, same project — proves
    // the cascade does not spill outside its own tree.
    let rootBId: number;
    let childB1Id: number;

    // A defect-typed Issue in the same project — the route must refuse to
    // cascade it (404), never a 200 that silently deletes a defect.
    let defectId: number;

    const allIssueIds: number[] = [];
    const treeBIds: number[] = [];
    // The subset of tree A the cascade itself flips false->true — excludes
    // the grandchild that was already deleted beforehand.
    let cascadeDeletedIds: number[];

    beforeAll(async () => {
      // Refuse to run against anything but a scratch database — the
      // worktree .env DATABASE_URL resolves to `ew`, and this suite runs a
      // bulk soft-delete through the real route.
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
          name: `Requirement Delete-Subtree Route Admin ${STAMP}`,
          authMethod: "INTERNAL",
          access: "ADMIN",
          accessSource: "MANUAL",
          roleId: role.id,
          password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
        },
        select: { id: true },
      });
      adminUserId = admin.id;
      sessionRef.current = { user: { id: adminUserId, access: "ADMIN" } };

      const project = await db.projects.create({
        data: { name: `${STAMP}-project`, createdBy: adminUserId },
        select: { id: true },
      });
      projectId = project.id;

      async function createIssue(
        name: string,
        parentId: number | null,
        extra: Record<string, unknown> = {}
      ): Promise<number> {
        const issue = await db.issue.create({
          data: {
            name: `${STAMP}-${name}`,
            title: `${STAMP}-${name}`,
            createdById: adminUserId,
            projectId,
            parentId,
            isRequirement: true,
            ...extra,
          },
          select: { id: true },
        });
        allIssueIds.push(issue.id);
        return issue.id;
      }

      // Tree A.
      rootAId = await createIssue("root-a", null);
      childA1Id = await createIssue("child-a1", rootAId);
      childA2Id = await createIssue("child-a2", rootAId);
      grandchildA1aId = await createIssue("grandchild-a1a", childA1Id);
      grandchildA1bId = await createIssue("grandchild-a1b", childA1Id);
      const treeAIds = [
        rootAId,
        childA1Id,
        childA2Id,
        grandchildA1aId,
        grandchildA1bId,
      ];

      // Tree B: independent second root, one child, same project.
      rootBId = await createIssue("root-b", null);
      childB1Id = await createIssue("child-b1", rootBId);
      treeBIds.push(rootBId, childB1Id);

      // Soft-delete ONE grandchild of tree A directly, BEFORE any cascade
      // runs — the row a naive "restore everything in the subtree"
      // implementation would wrongly resurrect.
      await db.issue.update({
        where: { id: grandchildA1bId },
        data: { isDeleted: true },
      });

      cascadeDeletedIds = treeAIds.filter((id) => id !== grandchildA1bId);

      // A defect-typed Issue, same project, for the 404 case.
      defectId = await createIssue("defect", null, { isRequirement: false });
    });

    afterAll(async () => {
      await db.issue.deleteMany({ where: { id: { in: allIssueIds } } });
      await db.projects.delete({ where: { id: projectId } });
      await db.user.delete({ where: { id: adminUserId } });

      const remainingIssues = await db.issue.count({
        where: { name: { startsWith: STAMP } },
      });
      const remainingProjects = await db.projects.count({
        where: { name: { startsWith: STAMP } },
      });
      console.log(
        `post-teardown stamp check (${STAMP}): issues=${remainingIssues}, projects=${remainingProjects}`
      );
      expect(remainingIssues).toBe(0);
      expect(remainingProjects).toBe(0);

      await db.$disconnect();
    });

    it("soft-deletes the addressed requirement and every live descendant in one call", async () => {
      const res = await deleteSubtreePost(
        postRequest(),
        routeParams(projectId, rootAId)
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deletedIds).toHaveLength(cascadeDeletedIds.length);
      for (const id of cascadeDeletedIds) {
        expect(body.deletedIds).toContain(id);
      }

      for (const id of cascadeDeletedIds) {
        const row = await db.issue.findUnique({
          where: { id },
          select: { isDeleted: true },
        });
        expect(row?.isDeleted, `issue ${id} was not soft-deleted`).toBe(true);
      }
    });

    it("does not touch an independent second root tree in the same project", async () => {
      for (const id of treeBIds) {
        const row = await db.issue.findUnique({
          where: { id },
          select: { isDeleted: true },
        });
        expect(row?.isDeleted, `issue ${id} in tree B was touched`).toBe(
          false
        );
      }
    });

    it("restore returns exactly the cohort the matching cascade delete touched", async () => {
      const res = await restorePost(
        postRequest(),
        routeParams(projectId, rootAId)
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.restoredIds).toHaveLength(cascadeDeletedIds.length);
      for (const id of cascadeDeletedIds) {
        expect(body.restoredIds).toContain(id);
      }

      for (const id of cascadeDeletedIds) {
        const row = await db.issue.findUnique({
          where: { id },
          select: { isDeleted: true },
        });
        expect(row?.isDeleted, `issue ${id} was not restored`).toBe(false);
      }
    });

    it("restore does not resurrect a descendant that was already soft-deleted before the cascade ran", async () => {
      const row = await db.issue.findUnique({
        where: { id: grandchildA1bId },
        select: { isDeleted: true },
      });
      expect(row?.isDeleted).toBe(true);
    });

    it("refuses a delete addressed at a defect-typed issue rather than cascading it", async () => {
      const res = await deleteSubtreePost(
        postRequest(),
        routeParams(projectId, defectId)
      );
      expect(res.status).toBe(404);

      const row = await db.issue.findUnique({
        where: { id: defectId },
        select: { isDeleted: true },
      });
      expect(row?.isDeleted).toBe(false);
    });
  }
);
