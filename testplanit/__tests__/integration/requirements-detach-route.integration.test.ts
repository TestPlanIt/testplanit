// Live-DB integration proof for the detach route
// (app/api/projects/[projectId]/requirements/[issueId]/detach/route.ts,
// landing in 25-05). Proves detach's requirementDetachedAt write flips the
// locked-field predicate (isRequirementLocked / LOCKED_ISSUE_FIELDS) so a
// previously-locked field becomes writable through the enhanced client —
// state that can only be observed against a real access-policy-enforcing
// client, not a mock. Also proves PROV-03's parity claim explicitly: a
// detached row and a natively-created row accept the SAME payload object
// (one shared reference, not two lookalike literals), compared column by
// column rather than by "no error was thrown."
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirements-detach-route.integration.test.ts

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
const STAMP = `dt-${Date.now()}`;

// Session is the ONLY thing mocked below getServerSession — getEnhancedDb,
// the enhanced ZenStack client, the real @@allow/@@deny policy engine, and
// Postgres are all real.
const sessionRef: {
  current: { user: { id: string; access: string } } | null;
} = { current: null };

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => sessionRef.current),
}));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

import { getEnhancedDb } from "~/lib/auth/utils";

import { POST as detachPost } from "~/app/api/projects/[projectId]/requirements/[issueId]/detach/route";

function postRequest(): NextRequest {
  return new NextRequest("http://localhost/api/projects/requirements/op", {
    method: "POST",
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

const lockedFieldsSelect = Object.fromEntries(
  LOCKED_ISSUE_FIELDS.map((field) => [field, true])
) as Record<(typeof LOCKED_ISSUE_FIELDS)[number], true>;

describeIntegration("requirements detach route (live DB)", () => {
  let adminUserId: string;
  let projectId: number;
  let integrationId: number;

  // Dedicated to test 1 (detach itself, checked in isolation).
  let detachTargetId: number;
  // Dedicated to tests 2/3/4: rejected while locked, detached, then reused
  // as "the just-detached requirement" for the PROV-03 parity proof.
  let lockRejectId: number;
  // Native (never synced) row for the parity proof.
  let nativeReqId: number;
  // A valid same-project parentId target for the parity payload's
  // parentId field, distinct from every row above so no self-parent/cycle
  // is possible.
  let parityParentId: number;
  // Dedicated to test 5, deliberately never detached, so it stays a valid
  // "synced, non-detached" fixture for the whole suite.
  let noteTargetId: number;

  const allIssueIds: number[] = [];

  // Shared across tests 2 and 3: the identical locked-field write that is
  // rejected before detach must be the one that succeeds after.
  const lockedFieldPayload = { title: `${STAMP}-locked-write-attempt` };

  beforeAll(async () => {
    // Refuse to run against anything but a scratch database — the
    // worktree .env DATABASE_URL resolves to `ew`, and this suite writes
    // real rows through the enhanced client.
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
        name: `Requirement Detach Route Admin ${STAMP}`,
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

    detachTargetId = await createRequirement("detach-target", {
      integrationId,
      externalId: `${STAMP}-ext-detach-target`,
    });
    lockRejectId = await createRequirement("lock-reject", {
      integrationId,
      externalId: `${STAMP}-ext-lock-reject`,
    });
    noteTargetId = await createRequirement("note-target", {
      integrationId,
      externalId: `${STAMP}-ext-note-target`,
    });
    nativeReqId = await createRequirement("native");
    parityParentId = await createRequirement("parity-parent");
  });

  afterAll(async () => {
    await db.issue.deleteMany({ where: { id: { in: allIssueIds } } });
    await db.integration.delete({ where: { id: integrationId } });
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

  it("sets requirementDetachedAt on a synced requirement and leaves integrationId intact", async () => {
    const before = await db.issue.findUnique({
      where: { id: detachTargetId },
      select: { integrationId: true, requirementDetachedAt: true },
    });
    expect(before?.integrationId).toBe(integrationId);
    expect(before?.requirementDetachedAt).toBeNull();

    const res = await detachPost(
      postRequest(),
      routeParams(projectId, detachTargetId)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.requirementDetachedAt).toBe("string");

    const after = await db.issue.findUnique({
      where: { id: detachTargetId },
      select: { integrationId: true, requirementDetachedAt: true },
    });
    expect(after?.integrationId).toBe(integrationId);
    expect(after?.requirementDetachedAt).not.toBeNull();
  });

  it("a synced, non-detached requirement rejects a locked-field update through the enhanced client", async () => {
    const before = await db.issue.findUnique({
      where: { id: lockRejectId },
      select: {
        ...lockedFieldsSelect,
        isRequirement: true,
        integrationId: true,
        requirementDetachedAt: true,
      },
    });
    expect(before).not.toBeNull();
    // Fixture-drift guard: if this row is not actually locked, fail loudly
    // here instead of the rejection assertion below silently passing for
    // the wrong reason.
    expect(isRequirementLocked(before)).toBe(true);

    const edb = await getEnhancedDb(sessionRef.current as never);
    // Determined empirically (matching issue-requirement-lock.test.ts's
    // already-proven idiom): the field-level @deny rejection is a single
    // implicit-autocommit statement, not a shared explicit transaction a
    // trigger RAISE could abort, so no SAVEPOINT/ROLLBACK TO SAVEPOINT is
    // needed around this assertion or the re-read that follows it.
    await expect(
      edb.issue.update({
        where: { id: lockRejectId },
        data: lockedFieldPayload,
      })
    ).rejects.toThrow();

    const after = await db.issue.findUnique({
      where: { id: lockRejectId },
      select: { title: true },
    });
    expect(after?.title).toBe(before!.title);
  });

  it("the same requirement accepts the identical locked-field update after detach", async () => {
    const detachRes = await detachPost(
      postRequest(),
      routeParams(projectId, lockRejectId)
    );
    expect(detachRes.status).toBe(200);

    const afterDetach = await db.issue.findUnique({
      where: { id: lockRejectId },
      select: {
        isRequirement: true,
        integrationId: true,
        requirementDetachedAt: true,
      },
    });
    expect(isRequirementLocked(afterDetach)).toBe(false);

    const edb = await getEnhancedDb(sessionRef.current as never);
    const updated = await edb.issue.update({
      where: { id: lockRejectId },
      data: lockedFieldPayload,
      select: { title: true },
    });
    expect(updated.title).toBe(lockedFieldPayload.title);
  });

  it("a detached requirement and a natively-created requirement accept the byte-identical update payload", async () => {
    // Constructed ONCE. The same object reference is passed as `data` to
    // both calls below — the whole point of PROV-03 is that one payload,
    // unmodified, works on both kinds of row.
    const parityPayload = {
      title: `${STAMP}-parity-title`,
      description: `${STAMP}-parity-description`,
      status: `${STAMP}-parity-status`,
      priority: "low",
      parentId: parityParentId,
    };

    const edb = await getEnhancedDb(sessionRef.current as never);

    const detachedResult = await edb.issue.update({
      where: { id: lockRejectId }, // detached by the previous test
      data: parityPayload,
      select: lockedFieldsSelect,
    });
    const nativeResult = await edb.issue.update({
      where: { id: nativeReqId },
      data: parityPayload,
      select: lockedFieldsSelect,
    });

    for (const field of LOCKED_ISSUE_FIELDS) {
      expect(
        detachedResult[field],
        `detached row's "${field}" does not match the shared payload`
      ).toBe(parityPayload[field as keyof typeof parityPayload]);
      expect(
        nativeResult[field],
        `native row's "${field}" does not match the shared payload`
      ).toBe(parityPayload[field as keyof typeof parityPayload]);
      expect(
        detachedResult[field],
        `detached and native rows disagree on "${field}"`
      ).toBe(nativeResult[field]);
    }

    const [detachedLockState, nativeLockState] = await Promise.all([
      db.issue.findUnique({
        where: { id: lockRejectId },
        select: {
          isRequirement: true,
          integrationId: true,
          requirementDetachedAt: true,
        },
      }),
      db.issue.findUnique({
        where: { id: nativeReqId },
        select: {
          isRequirement: true,
          integrationId: true,
          requirementDetachedAt: true,
        },
      }),
    ]);
    expect(isRequirementLocked(detachedLockState)).toBe(false);
    expect(isRequirementLocked(nativeLockState)).toBe(false);
  });

  it("note stays writable on a synced, non-detached requirement", async () => {
    const before = await db.issue.findUnique({
      where: { id: noteTargetId },
      select: {
        isRequirement: true,
        integrationId: true,
        requirementDetachedAt: true,
      },
    });
    // Fixture-drift guard, mirroring the earlier lock-rejection test.
    expect(isRequirementLocked(before)).toBe(true);

    const edb = await getEnhancedDb(sessionRef.current as never);
    const updated = await edb.issue.update({
      where: { id: noteTargetId },
      data: { note: { text: `${STAMP}-note` } },
      select: { note: true },
    });
    expect(updated.note).toEqual({ text: `${STAMP}-note` });
  });
});
