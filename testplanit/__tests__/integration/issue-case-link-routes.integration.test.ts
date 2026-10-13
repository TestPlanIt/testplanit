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
import {
  isRequirementLocked,
  LOCKED_ISSUE_FIELDS,
} from "~/lib/services/linkedIssueUpsert";

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

    // m:n proof fixtures (Task 2): one case linked to two requirements,
    // and one requirement linked to two cases — kept independent of the
    // task-1 entities above so neither scenario's assertions depend on
    // the other's leftover link state.
    let reqM1Id: number;
    let reqM2Id: number;
    let caseM1Id: number;
    let reqM3Id: number;
    let caseM2Id: number;
    let caseM3Id: number;

    // Lock-safety fixture (Task 2): a synced+locked requirement bound to
    // a real Integration row, plus a case to link it to.
    let integrationId: number;
    let parentCandidateId: number;
    let lockedReqId: number;
    let caseLockId: number;

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

      async function createRequirement(
        name: string,
        extra: Record<string, unknown> = {}
      ): Promise<number> {
        const created = await db.issue.create({
          data: {
            name: `${STAMP}-${name}`,
            title: `${STAMP}-${name}`,
            createdById: adminUserId,
            projectId,
            isRequirement: true,
            ...extra,
          },
          select: { id: true },
        });
        allIssueIds.push(created.id);
        return created.id;
      }

      requirementId = await createRequirement("requirement-1");
      caseAId = await createCase("case-a");
      caseBId = await createCase("case-b");

      // m:n fixtures.
      reqM1Id = await createRequirement("m-req-1");
      reqM2Id = await createRequirement("m-req-2");
      caseM1Id = await createCase("m-case-1");
      reqM3Id = await createRequirement("m-req-3");
      caseM2Id = await createCase("m-case-2");
      caseM3Id = await createCase("m-case-3");

      // Lock-safety fixture: a real Integration row, a native parent
      // candidate, and a synced+locked requirement whose five
      // LOCKED_ISSUE_FIELDS all carry real, distinguishable values (not
      // just null defaults) so an unintended overwrite is observable.
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

      parentCandidateId = await createRequirement("parent-candidate");
      lockedReqId = await createRequirement("locked-requirement", {
        integrationId,
        description: `${STAMP}-locked-description`,
        status: `${STAMP}-locked-status`,
        priority: "high",
        parentId: parentCandidateId,
      });
      caseLockId = await createCase("case-lock");
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
      await db.integration.delete({ where: { id: integrationId } });
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

    it("one test case can be linked to two different requirements simultaneously", async () => {
      const linkToReq1 = await linkPost(
        linkRequest({ entityType: "testCase", entityId: caseM1Id }),
        { params: Promise.resolve({ issueId: String(reqM1Id) }) }
      );
      expect(linkToReq1.status).toBe(200);

      const linkToReq2 = await linkPost(
        linkRequest({ entityType: "testCase", entityId: caseM1Id }),
        { params: Promise.resolve({ issueId: String(reqM2Id) }) }
      );
      expect(linkToReq2.status).toBe(200);

      const [joinReq1, joinReq2] = await Promise.all([
        db.repositoryCaseIssue.findUnique({
          where: { caseId_issueId: { caseId: caseM1Id, issueId: reqM1Id } },
        }),
        db.repositoryCaseIssue.findUnique({
          where: { caseId_issueId: { caseId: caseM1Id, issueId: reqM2Id } },
        }),
      ]);
      expect(joinReq1).not.toBeNull();
      expect(joinReq2).not.toBeNull();

      const unlinkReq1 = await unlinkPost(
        linkRequest({ entityType: "testCase", entityId: caseM1Id }),
        { params: Promise.resolve({ issueId: String(reqM1Id) }) }
      );
      expect(unlinkReq1.status).toBe(200);

      const [afterUnlinkReq1, afterUnlinkReq2] = await Promise.all([
        db.repositoryCaseIssue.findUnique({
          where: { caseId_issueId: { caseId: caseM1Id, issueId: reqM1Id } },
        }),
        db.repositoryCaseIssue.findUnique({
          where: { caseId_issueId: { caseId: caseM1Id, issueId: reqM2Id } },
        }),
      ]);
      expect(afterUnlinkReq1).toBeNull();
      expect(afterUnlinkReq2).not.toBeNull();
    });

    it("one requirement can be linked to two different test cases simultaneously", async () => {
      const linkCaseM2 = await linkPost(
        linkRequest({ entityType: "testCase", entityId: caseM2Id }),
        { params: Promise.resolve({ issueId: String(reqM3Id) }) }
      );
      expect(linkCaseM2.status).toBe(200);

      const linkCaseM3 = await linkPost(
        linkRequest({ entityType: "testCase", entityId: caseM3Id }),
        { params: Promise.resolve({ issueId: String(reqM3Id) }) }
      );
      expect(linkCaseM3.status).toBe(200);

      const [joinCaseM2, joinCaseM3] = await Promise.all([
        db.repositoryCaseIssue.findUnique({
          where: { caseId_issueId: { caseId: caseM2Id, issueId: reqM3Id } },
        }),
        db.repositoryCaseIssue.findUnique({
          where: { caseId_issueId: { caseId: caseM3Id, issueId: reqM3Id } },
        }),
      ]);
      expect(joinCaseM2).not.toBeNull();
      expect(joinCaseM3).not.toBeNull();

      const unlinkCaseM2 = await unlinkPost(
        linkRequest({ entityType: "testCase", entityId: caseM2Id }),
        { params: Promise.resolve({ issueId: String(reqM3Id) }) }
      );
      expect(unlinkCaseM2.status).toBe(200);

      const [afterUnlinkCaseM2, afterUnlinkCaseM3] = await Promise.all([
        db.repositoryCaseIssue.findUnique({
          where: { caseId_issueId: { caseId: caseM2Id, issueId: reqM3Id } },
        }),
        db.repositoryCaseIssue.findUnique({
          where: { caseId_issueId: { caseId: caseM3Id, issueId: reqM3Id } },
        }),
      ]);
      expect(afterUnlinkCaseM2).toBeNull();
      expect(afterUnlinkCaseM3).not.toBeNull();
    });

    it("linking does not mutate any LOCKED_ISSUE_FIELDS value on a synced, locked requirement", async () => {
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
      // Fixture-drift guard: if a future change to this file (or to the
      // schema defaults) accidentally produces an unlocked row, fail
      // loudly here instead of the field-equality assertions below
      // silently passing on an unlocked row for the wrong reason.
      expect(isRequirementLocked(before)).toBe(true);

      const linkRes = await linkPost(
        linkRequest({ entityType: "testCase", entityId: caseLockId }),
        { params: Promise.resolve({ issueId: String(lockedReqId) }) }
      );
      expect(linkRes.status).toBe(200);

      const join = await db.repositoryCaseIssue.findUnique({
        where: {
          caseId_issueId: { caseId: caseLockId, issueId: lockedReqId },
        },
      });
      expect(join).not.toBeNull();

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
          `LOCKED_ISSUE_FIELDS value "${field}" changed after linking a locked requirement`
        ).toBe(before![field]);
      }
    });
  }
);
