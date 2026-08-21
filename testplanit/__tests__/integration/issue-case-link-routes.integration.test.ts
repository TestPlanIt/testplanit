// Live-DB regression proof for LINK-01/02 against the already-shipped
// generic link/unlink routes (app/api/issues/[issueId]/link and
// .../unlink), exercised with entityType: "testCase" against a
// requirement-typed issue. These routes need zero code changes for this
// phase (25-CONTEXT.md, "Existing routes that need ZERO changes") — this
// file exists to prove that claim rather than merely assert it, and to
// catch a future regression that narrows the routes to defect-typed
// issues only.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/issue-case-link-routes.integration.test.ts

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `lnk-${Date.now()}`;

// Session is the ONLY thing mocked below getServerSession — getEnhancedDb,
// the enhanced ZenStack client, the real @@allow/@@deny policy engine, and
// Postgres are all real. The fixture admin user is also the fixture
// project's creator, so RepositoryCaseIssue's
// `case.project.creator.id == auth().id` create/update/delete predicate is
// satisfied through the real policy path rather than bypassed.
const sessionRef: {
  current: { user: { id: string; access: string } } | null;
} = { current: null };

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => sessionRef.current),
}));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

import { POST as linkPost } from "~/app/api/issues/[issueId]/link/route";
import { POST as unlinkPost } from "~/app/api/issues/[issueId]/unlink/route";

function linkRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/issues/link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describeIntegration(
  "issue-case link/unlink routes for requirements (live DB)",
  () => {
    let adminUserId: string;
    let projectId: number;
    let repositoryId: number;
    let folderId: number;
    let requirementId: number;
    let caseAId: number;
    let caseBId: number;

    const allIssueIds: number[] = [];
    const allCaseIds: number[] = [];

    beforeAll(async () => {
      // Refuse to run against anything but a scratch database — the
      // worktree .env DATABASE_URL resolves to `ew`, and this suite writes
      // real join rows through the enhanced client.
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
          name: `Issue Case Link Admin ${STAMP}`,
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

      const repository = await db.repositories.create({
        data: { projectId },
        select: { id: true },
      });
      repositoryId = repository.id;

      const folder = await db.repositoryFolders.create({
        data: {
          name: `${STAMP}-folder`,
          repositoryId,
          projectId,
          creatorId: adminUserId,
        },
        select: { id: true },
      });
      folderId = folder.id;

      const template = await db.templates.findFirst({ select: { id: true } });
      if (!template)
        throw new Error("Test prerequisite: no Templates row available");
      const state = await db.workflows.findFirst({ select: { id: true } });
      if (!state)
        throw new Error("Test prerequisite: no Workflows row available");

      async function createCase(name: string): Promise<number> {
        const created = await db.repositoryCases.create({
          data: {
            projectId,
            repositoryId,
            folderId,
            templateId: template!.id,
            name: `${STAMP}-${name}`,
            stateId: state!.id,
            creatorId: adminUserId,
          },
          select: { id: true },
        });
        allCaseIds.push(created.id);
        return created.id;
      }

      async function createRequirement(name: string): Promise<number> {
        const created = await db.issue.create({
          data: {
            name: `${STAMP}-${name}`,
            title: `${STAMP}-${name}`,
            createdById: adminUserId,
            projectId,
            isRequirement: true,
          },
          select: { id: true },
        });
        allIssueIds.push(created.id);
        return created.id;
      }

      requirementId = await createRequirement("requirement-1");
      caseAId = await createCase("case-a");
      caseBId = await createCase("case-b");
    });

    afterAll(async () => {
      await db.repositoryCaseIssue.deleteMany({
        where: {
          OR: [
            { issueId: { in: allIssueIds } },
            { caseId: { in: allCaseIds } },
          ],
        },
      });
      await db.repositoryCases.deleteMany({
        where: { id: { in: allCaseIds } },
      });
      await db.issue.deleteMany({ where: { id: { in: allIssueIds } } });
      await db.repositoryFolders.delete({ where: { id: folderId } });
      await db.repositories.delete({ where: { id: repositoryId } });
      await db.projects.delete({ where: { id: projectId } });
      await db.user.delete({ where: { id: adminUserId } });

      const remainingIssues = await db.issue.count({
        where: { name: { startsWith: STAMP } },
      });
      const remainingCases = await db.repositoryCases.count({
        where: { name: { startsWith: STAMP } },
      });
      const remainingProjects = await db.projects.count({
        where: { name: { startsWith: STAMP } },
      });
      // eslint-disable-next-line no-console
      console.log(
        `post-teardown stamp check (${STAMP}): issues=${remainingIssues}, cases=${remainingCases}, projects=${remainingProjects}`
      );
      expect(remainingIssues).toBe(0);
      expect(remainingCases).toBe(0);
      expect(remainingProjects).toBe(0);

      await db.$disconnect();
    });

    it("POST /api/issues/[issueId]/link with entityType testCase creates the RepositoryCaseIssue join row for a requirement-typed issue", async () => {
      const res = await linkPost(
        linkRequest({ entityType: "testCase", entityId: caseAId }),
        { params: Promise.resolve({ issueId: String(requirementId) }) }
      );
      expect(res.status).toBe(200);

      const join = await db.repositoryCaseIssue.findUnique({
        where: {
          caseId_issueId: { caseId: caseAId, issueId: requirementId },
        },
      });
      expect(join).not.toBeNull();
    });

    it("POST /api/issues/[issueId]/unlink with entityType testCase removes the join row", async () => {
      const res = await unlinkPost(
        linkRequest({ entityType: "testCase", entityId: caseAId }),
        { params: Promise.resolve({ issueId: String(requirementId) }) }
      );
      expect(res.status).toBe(200);

      const join = await db.repositoryCaseIssue.findUnique({
        where: {
          caseId_issueId: { caseId: caseAId, issueId: requirementId },
        },
      });
      expect(join).toBeNull();
    });

    it("unlinking a link that does not exist succeeds as a no-op", async () => {
      const before = await db.repositoryCaseIssue.count({
        where: { issueId: requirementId },
      });
      expect(before).toBe(0);

      const res = await unlinkPost(
        linkRequest({ entityType: "testCase", entityId: caseBId }),
        { params: Promise.resolve({ issueId: String(requirementId) }) }
      );
      expect(res.status).toBe(200);

      const after = await db.repositoryCaseIssue.count({
        where: { issueId: requirementId },
      });
      expect(after).toBe(before);
    });

    it.todo(
      "one test case can be linked to two different requirements simultaneously"
    );
    it.todo(
      "one requirement can be linked to two different test cases simultaneously"
    );
    it.todo(
      "linking does not mutate any LOCKED_ISSUE_FIELDS value on a synced, locked requirement"
    );
  }
);
