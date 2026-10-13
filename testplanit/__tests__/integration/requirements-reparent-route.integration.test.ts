// Live-DB integration proof for the reparent route
// (app/api/projects/[projectId]/requirements/[issueId]/reparent/route.ts,
// landing in 25-05). Proves assertValidReparent's cycle/same-project rules
// are actually enforced server-side, before any parentId write — not just
// asserted against a mocked query client.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirements-reparent-route.integration.test.ts

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `rp-${Date.now()}`;

// Session is the ONLY thing mocked below getServerSession — getEnhancedDb,
// the enhanced ZenStack client, the real @@allow/@@deny policy engine, the
// Phase 21 cycle-guard trigger, and Postgres are all real.
const sessionRef: {
  current: { user: { id: string; access: string } } | null;
} = { current: null };

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => sessionRef.current),
}));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

import { POST as reparentPost } from "~/app/api/projects/[projectId]/requirements/[issueId]/reparent/route";

function reparentRequest(parentId: number | null): NextRequest {
  return new NextRequest("http://localhost/api/projects/requirements/op", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parentId }),
  });
}

function routeParams(projectId: number, issueId: number) {
  return {
    params: Promise.resolve({
      projectId: String(projectId),
      issueId: String(issueId),
    }),
  };
}

describeIntegration("requirements reparent route (live DB)", () => {
  let adminUserId: string;
  let projectAId: number;
  let projectBId: number;

  // Project A: depth-3 chain (chainRoot -> chainMid -> chainLeaf) plus an
  // independent second root used for the legitimate-move test.
  let chainRootId: number;
  let chainMidId: number;
  let chainLeafId: number;
  let altRootId: number;
  let defectId: number;

  // Project B: one requirement to serve as the invalid cross-project
  // parent target.
  let crossProjectTargetId: number;

  const allIssueIds: number[] = [];

  beforeAll(async () => {
    // Refuse to run against anything but a scratch database — the
    // worktree .env DATABASE_URL resolves to `ew`, and this suite writes
    // real parentId values through the enhanced client.
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
        name: `Requirement Reparent Route Admin ${STAMP}`,
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

    const projectA = await db.projects.create({
      data: { name: `${STAMP}-project-a`, createdBy: adminUserId },
      select: { id: true },
    });
    projectAId = projectA.id;

    const projectB = await db.projects.create({
      data: { name: `${STAMP}-project-b`, createdBy: adminUserId },
      select: { id: true },
    });
    projectBId = projectB.id;

    async function createIssue(
      projectId: number,
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

    // Project A: depth-3 chain.
    chainRootId = await createIssue(projectAId, "chain-root", null);
    chainMidId = await createIssue(projectAId, "chain-mid", chainRootId);
    chainLeafId = await createIssue(projectAId, "chain-leaf", chainMidId);

    // Independent second root, same project — the legitimate-move target.
    altRootId = await createIssue(projectAId, "alt-root", null);

    // Defect-typed issue, project A.
    defectId = await createIssue(projectAId, "defect", null, {
      isRequirement: false,
    });

    // Project B: cross-project parent target.
    crossProjectTargetId = await createIssue(
      projectBId,
      "cross-project-target",
      null
    );
  });

  afterAll(async () => {
    await db.issue.deleteMany({ where: { id: { in: allIssueIds } } });
    await db.projects.delete({ where: { id: projectAId } });
    await db.projects.delete({ where: { id: projectBId } });
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

  it("rejects a reparent that would create a cycle, server-side, before any parentId write", async () => {
    const res = await reparentPost(
      reparentRequest(chainLeafId),
      routeParams(projectAId, chainRootId)
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(
      `Reparenting Issue ${chainRootId} under ${chainLeafId} would create a cycle`
    );

    const row = await db.issue.findUnique({
      where: { id: chainRootId },
      select: { parentId: true },
    });
    expect(row?.parentId).toBeNull();
  });

  it("rejects a reparent whose new parent belongs to a different project", async () => {
    const res = await reparentPost(
      reparentRequest(crossProjectTargetId),
      routeParams(projectAId, chainMidId)
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(
      `Issue ${chainMidId} and new parent ${crossProjectTargetId} must belong to the same project`
    );

    const row = await db.issue.findUnique({
      where: { id: chainMidId },
      select: { parentId: true },
    });
    expect(row?.parentId).toBe(chainRootId);
  });

  it("accepts a legitimate same-project, non-cyclic reparent and persists the new parentId", async () => {
    const res = await reparentPost(
      reparentRequest(chainRootId),
      routeParams(projectAId, altRootId)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.parentId).toBe(chainRootId);

    const row = await db.issue.findUnique({
      where: { id: altRootId },
      select: { parentId: true },
    });
    expect(row?.parentId).toBe(chainRootId);
  });

  it("leaves parentId unchanged in the database after a rejected reparent", async () => {
    // Distinct, freshly-queried re-read of both earlier rejections' target
    // rows — kept as its own assertion (not folded into the cycle/
    // cross-project tests above) so "the route returned 400" and "the
    // route never wrote" are two separately-proven facts.
    const cycleRow = await db.issue.findUnique({
      where: { id: chainRootId },
      select: { parentId: true },
    });
    expect(cycleRow?.parentId).toBeNull();

    const crossProjectRow = await db.issue.findUnique({
      where: { id: chainMidId },
      select: { parentId: true },
    });
    expect(crossProjectRow?.parentId).toBe(chainRootId);
  });

  it("refuses a reparent addressed at a defect-typed issue", async () => {
    const res = await reparentPost(
      reparentRequest(null),
      routeParams(projectAId, defectId)
    );
    expect(res.status).toBe(404);

    const row = await db.issue.findUnique({
      where: { id: defectId },
      select: { parentId: true },
    });
    expect(row?.parentId).toBeNull();
  });
});
