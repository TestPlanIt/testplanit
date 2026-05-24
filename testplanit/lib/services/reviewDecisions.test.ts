// @vitest-environment node
/**
 * Phase 2 — Live-DB integration tests for decideReviewRequest.
 *
 * Closes Phase 1 CR-02 / deferred item #2 with belt-and-suspenders:
 *
 *   (1) App-layer: decideReviewRequest performs an effective-project-role
 *       eligibility check BEFORE mutating the ReviewRequest row, throwing
 *       IneligibleReviewerError when the caller is neither the direct user
 *       assignee nor a holder of the assigned role nor a system ADMIN.
 *
 *   (2) Schema-layer: the ReviewRequest @@allow('update', ...) role-assignee
 *       branch — rewritten per CR-02 to drop the `this.` prefix and pull
 *       the GLOBAL_ROLE auth().roleId comparison outside the ?[...] filter —
 *       is exercised against the live policy engine via getEnhancedDb(...).
 *
 * Both layers must independently authorize the role-holder decide path. If
 * the schema policy is misshapen, app code still authorizes; if the app
 * check has a hole, the policy still denies.
 *
 * Test-selector substrings:
 *   - "direct user-assignee"
 *   - "role-holder via SPECIFIC_ROLE"
 *   - "ineligible user"
 *   - "feature flag off"
 *
 * Run:
 *   cd testplanit && pnpm test --run lib/services/reviewDecisions.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "next-auth";
import type { ReviewRequest } from "@prisma/client";

import { prisma } from "~/lib/prisma";
import { isIneligibleReviewerError } from "~/lib/utils/errors";
import { decideReviewRequest } from "./reviewDecisions";

const TEST_RUN_ID = `phase2-decide-${Date.now()}-${Math.floor(
  Math.random() * 1_000_000
)}`;

// Real entity rows are required because the paired-Comment write inside
// decideReviewRequest FKs back to RepositoryCases. The shared Repository +
// Folder + Template come from beforeAll; each seedPendingRequest call
// creates its own fresh RepositoryCases row so the partial unique index
// `review_request_one_pending_per_entity` (WHERE status = 'PENDING' AND
// isDeleted = false) doesn't collide across tests.
let repositoryId: number;
let repositoryFolderId: number;
let templateId: number;
const createdCaseIds: number[] = [];

let projectId: number;
let requesterUserId: string;
let directAssigneeUserId: string;
let roleHolderUserId: string;
let ineligibleUserId: string;
let adminUserId: string;
let assignedRoleId: number;
let otherRoleId: number;
let fromStateId: number;
let toStateId: number;

const createdReviewRequestIds: string[] = [];

// AppConfig review_feature_enabled key — opt-in default-off means every test in
// this file would otherwise short-circuit with FeatureDisabledError. We capture
// the prior row (if any) so afterAll can restore exact state for the next test
// run that may not want the flag forced on.
const REVIEW_FEATURE_KEY = "review_feature_enabled";
let priorReviewFeatureValue: unknown = undefined;
let priorReviewFeatureExisted = false;

beforeAll(async () => {
  const existing = await prisma.appConfig.findUnique({
    where: { key: REVIEW_FEATURE_KEY },
    select: { value: true },
  });
  if (existing) {
    priorReviewFeatureExisted = true;
    priorReviewFeatureValue = existing.value;
  }
  await prisma.appConfig.upsert({
    where: { key: REVIEW_FEATURE_KEY },
    create: { key: REVIEW_FEATURE_KEY, value: true },
    update: { value: true },
  });

  // Reuse seeded Roles. We need at least TWO roles so the role-holder branch
  // can prove "user holds role X" while the ineligible user holds role Y.
  const roles = await prisma.roles.findMany({
    where: { isDeleted: false },
    take: 2,
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (roles.length < 2) {
    throw new Error(
      "Need at least two Roles seeded for decideReviewRequest test suite (run `pnpm prisma db seed`)."
    );
  }
  assignedRoleId = roles[0].id;
  otherRoleId = roles[1].id;

  // Requester (NONE access; trivially passes Project read because they own
  // the project; cannot self-approve per @@validate).
  const requester = await prisma.user.create({
    data: {
      name: `requester-${TEST_RUN_ID}`,
      email: `requester-${TEST_RUN_ID}@example.invalid`,
      access: "NONE",
      roleId: assignedRoleId,
      isApi: true,
    },
  });
  requesterUserId = requester.id;

  // Direct user-assignee (NONE access; will satisfy the direct-user branch).
  const directAssignee = await prisma.user.create({
    data: {
      name: `direct-${TEST_RUN_ID}`,
      email: `direct-${TEST_RUN_ID}@example.invalid`,
      access: "NONE",
      roleId: otherRoleId,
      isApi: true,
    },
  });
  directAssigneeUserId = directAssignee.id;

  // Role-holder (NONE access; holds the assigned role on the project via a
  // SPECIFIC_ROLE UserProjectPermission row). This is the CR-02 path.
  const roleHolder = await prisma.user.create({
    data: {
      name: `roleholder-${TEST_RUN_ID}`,
      email: `roleholder-${TEST_RUN_ID}@example.invalid`,
      access: "NONE",
      roleId: otherRoleId, // global roleId is unrelated; SPECIFIC_ROLE permission carries the assignment
      isApi: true,
    },
  });
  roleHolderUserId = roleHolder.id;

  // Ineligible user (NONE access; not assigned, doesn't hold the role, not admin).
  const ineligible = await prisma.user.create({
    data: {
      name: `ineligible-${TEST_RUN_ID}`,
      email: `ineligible-${TEST_RUN_ID}@example.invalid`,
      access: "NONE",
      roleId: otherRoleId,
      isApi: true,
    },
  });
  ineligibleUserId = ineligible.id;

  // Admin (system ADMIN — eligibility check honors the admin override).
  const admin = await prisma.user.create({
    data: {
      name: `admin-${TEST_RUN_ID}`,
      email: `admin-${TEST_RUN_ID}@example.invalid`,
      access: "ADMIN",
      roleId: otherRoleId,
      isApi: true,
    },
  });
  adminUserId = admin.id;

  // Project owned by the requester. `reviewWorkflowEnabled` is set
  // explicitly to true so decideReviewRequest does NOT short-circuit on
  // the per-project feature flag. The schema default is false (opt-in
  // posture) so the field must be set explicitly here for the gate-on
  // tests to exercise the real path.
  const project = await prisma.projects.create({
    data: {
      name: `proj-${TEST_RUN_ID}`,
      createdBy: requester.id,
      reviewWorkflowEnabled: true,
    },
  });
  projectId = project.id;

  // Grant the role-holder SPECIFIC_ROLE permission for the assigned role on
  // this project — the canonical CR-02 fixture shape.
  await prisma.userProjectPermission.create({
    data: {
      userId: roleHolderUserId,
      projectId,
      accessType: "SPECIFIC_ROLE",
      roleId: assignedRoleId,
    },
  });

  // The ineligible user gets a NO_ACCESS permission so the test can prove
  // the eligibility check rejects them even though they have a project row.
  await prisma.userProjectPermission.create({
    data: {
      userId: ineligibleUserId,
      projectId,
      accessType: "NO_ACCESS",
    },
  });

  // Reuse two seeded Workflows for from/to states. requiresReview can stay
  // at its default (false) — decideReviewRequest does not look at the
  // workflow's requiresReview flag, only the ReviewRequest row.
  const workflows = await prisma.workflows.findMany({
    where: { isDeleted: false, isEnabled: true },
    take: 2,
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (workflows.length < 2) {
    throw new Error(
      "Need at least two Workflows rows for decideReviewRequest tests; run `pnpm prisma db seed`."
    );
  }
  fromStateId = workflows[0].id;
  toStateId = workflows[1].id;

  // Pick any seeded Template — Templates are global (not project-scoped) so we
  // can reuse one for the test case row. RepositoryCases.templateId is
  // required.
  const template = await prisma.templates.findFirst({
    where: { isEnabled: true, isDeleted: false },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (!template) {
    throw new Error(
      "Need at least one enabled Templates row for decideReviewRequest tests; run `pnpm prisma db seed`."
    );
  }
  templateId = template.id;

  // Repositories + RepositoryFolders are project-scoped, so we seed our own
  // under the test project. The Comment FK on RepositoryCases requires a
  // real case row — the paired-Comment write inside decideReviewRequest
  // writes `repositoryCaseId: entityId`, which previously used synthetic
  // entityIds that no longer satisfy the FK constraint.
  const repository = await prisma.repositories.create({
    data: {
      projectId,
      isActive: true,
      isArchived: false,
    },
  });
  repositoryId = repository.id;

  const folder = await prisma.repositoryFolders.create({
    data: {
      projectId,
      repositoryId,
      name: `folder-${TEST_RUN_ID}`,
      creatorId: requesterUserId,
    },
  });
  repositoryFolderId = folder.id;
}, 30_000);

afterAll(async () => {
  // Comments + ReviewRequests both reference each other (Comment.reviewRequestId
  // SetNull on delete; ReviewRequest has back-relation). Soft-delete the
  // Comments first so they detach cleanly when the project cascade fires later.
  try {
    await prisma.comment.updateMany({
      where: { reviewRequestId: { in: createdReviewRequestIds } },
      data: { isDeleted: true },
    });
  } catch {
    /* ignore */
  }

  for (const id of createdReviewRequestIds) {
    try {
      await prisma.reviewRequest.update({
        where: { id },
        data: { isDeleted: true },
      });
    } catch {
      /* ignore */
    }
  }

  // Soft-delete every per-test case row, plus the seeded folder/repository
  // (project soft-delete doesn't cascade because cascade only fires on
  // hard delete).
  for (const id of createdCaseIds) {
    try {
      await prisma.repositoryCases.update({
        where: { id },
        data: { isDeleted: true },
      });
    } catch {
      /* ignore */
    }
  }
  if (repositoryFolderId) {
    try {
      await prisma.repositoryFolders.update({
        where: { id: repositoryFolderId },
        data: { isDeleted: true },
      });
    } catch {
      /* ignore */
    }
  }
  if (repositoryId) {
    try {
      await prisma.repositories.update({
        where: { id: repositoryId },
        data: { isDeleted: true },
      });
    } catch {
      /* ignore */
    }
  }

  if (projectId) {
    try {
      await prisma.userProjectPermission.deleteMany({
        where: { projectId },
      });
    } catch {
      /* ignore */
    }
    try {
      await prisma.projects.update({
        where: { id: projectId },
        data: { isDeleted: true },
      });
    } catch {
      /* ignore */
    }
  }

  for (const userId of [
    requesterUserId,
    directAssigneeUserId,
    roleHolderUserId,
    ineligibleUserId,
    adminUserId,
  ]) {
    if (!userId) continue;
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { isDeleted: true, isActive: false },
      });
    } catch {
      /* ignore */
    }
  }

  // Restore the original AppConfig row (or delete it if we created it).
  try {
    if (priorReviewFeatureExisted) {
      await prisma.appConfig.update({
        where: { key: REVIEW_FEATURE_KEY },
        data: { value: priorReviewFeatureValue as never },
      });
    } else {
      await prisma.appConfig.delete({
        where: { key: REVIEW_FEATURE_KEY },
      });
    }
  } catch {
    /* ignore */
  }

  await prisma.$disconnect();
}, 30_000);

function sessionFor(userId: string, access: string = "NONE"): Session {
  return {
    user: { id: userId, access },
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  } as unknown as Session;
}

async function seedPendingRequest(opts: {
  assigneeUserId?: string | null;
  assigneeRoleId?: number | null;
}): Promise<string> {
  // Mint a fresh RepositoryCases per call. The partial unique index
  // `review_request_one_pending_per_entity` (WHERE status = 'PENDING' AND
  // isDeleted = false) collides if two helpers seed PENDING rows against
  // the same (entityType, entityId), so per-call isolation is the
  // cheapest fix.
  const repoCase = await prisma.repositoryCases.create({
    data: {
      projectId,
      repositoryId,
      folderId: repositoryFolderId,
      templateId,
      name: `case-${TEST_RUN_ID}-${createdCaseIds.length + 1}`,
      stateId: fromStateId,
      creatorId: requesterUserId,
    },
  });
  createdCaseIds.push(repoCase.id);

  const created = await prisma.reviewRequest.create({
    data: {
      projectId,
      entityType: "CASE",
      entityId: repoCase.id,
      requestedByUserId: requesterUserId,
      assigneeUserId: opts.assigneeUserId ?? null,
      assigneeRoleId: opts.assigneeRoleId ?? null,
      fromStateId,
      toStateId,
      status: "PENDING",
    },
  });
  createdReviewRequestIds.push(created.id);
  return created.id;
}

describe("decideReviewRequest — direct user-assignee path", () => {
  it("direct user-assignee can transition PENDING -> APPROVED with an optional comment", async () => {
    const requestId = await seedPendingRequest({
      assigneeUserId: directAssigneeUserId,
    });

    const result = await decideReviewRequest(
      sessionFor(directAssigneeUserId),
      requestId,
      "APPROVED",
      "lgtm"
    );

    expect(result.status).toBe("APPROVED");
    expect(result.decisionComment).toBe("lgtm");
    expect(result.decidedByUserId).toBe(directAssigneeUserId);
    expect(result.decidedAt).not.toBeNull();
  });
});

describe("decideReviewRequest — role-holder via SPECIFIC_ROLE permission (CR-02)", () => {
  it("role-holder can transition PENDING -> CHANGES_REQUESTED with required comment", async () => {
    const requestId = await seedPendingRequest({
      assigneeRoleId: assignedRoleId,
    });

    const result = await decideReviewRequest(
      sessionFor(roleHolderUserId),
      requestId,
      "CHANGES_REQUESTED",
      "please tighten the assertion"
    );

    expect(result.status).toBe("CHANGES_REQUESTED");
    expect(result.decisionComment).toBe("please tighten the assertion");
    expect(result.decidedByUserId).toBe(roleHolderUserId);
    expect(result.decidedAt).not.toBeNull();
  });
});

describe("decideReviewRequest — ineligible user is rejected before any mutation", () => {
  it("ineligible user throws IneligibleReviewerError and the request stays PENDING", async () => {
    const requestId = await seedPendingRequest({
      assigneeUserId: directAssigneeUserId,
    });

    let caught: unknown;
    try {
      await decideReviewRequest(
        sessionFor(ineligibleUserId),
        requestId,
        "REJECTED",
        "noisy reject"
      );
    } catch (err) {
      caught = err;
    }

    expect(isIneligibleReviewerError(caught)).toBe(true);

    // Row was NOT mutated.
    const after = await prisma.reviewRequest.findUnique({
      where: { id: requestId },
      select: { status: true, decisionComment: true, decidedByUserId: true },
    });
    expect(after?.status).toBe("PENDING");
    expect(after?.decisionComment).toBeNull();
    expect(after?.decidedByUserId).toBeNull();
  });
});

describe("decideReviewRequest — all three DecideOutcome values", () => {
  it("APPROVED outcome is written atomically with decidedBy + decidedAt", async () => {
    const requestId = await seedPendingRequest({
      assigneeUserId: directAssigneeUserId,
    });

    const result = await decideReviewRequest(
      sessionFor(directAssigneeUserId),
      requestId,
      "APPROVED"
    );

    expect(result.status).toBe("APPROVED");
    expect(result.decisionComment).toBeNull();
    expect(result.decidedByUserId).toBe(directAssigneeUserId);
    expect(result.decidedAt).toBeInstanceOf(Date);
  });

  it("CHANGES_REQUESTED outcome is written atomically", async () => {
    const requestId = await seedPendingRequest({
      assigneeUserId: directAssigneeUserId,
    });

    const result = await decideReviewRequest(
      sessionFor(directAssigneeUserId),
      requestId,
      "CHANGES_REQUESTED",
      "needs more detail"
    );

    expect(result.status).toBe("CHANGES_REQUESTED");
    expect(result.decisionComment).toBe("needs more detail");
  });

  it("REJECTED outcome is written atomically", async () => {
    const requestId = await seedPendingRequest({
      assigneeUserId: directAssigneeUserId,
    });

    const result = await decideReviewRequest(
      sessionFor(directAssigneeUserId),
      requestId,
      "REJECTED",
      "out of scope"
    );

    expect(result.status).toBe("REJECTED");
    expect(result.decisionComment).toBe("out of scope");
  });
});

describe("decideReviewRequest — already-decided + not-found surfaces", () => {
  it("re-deciding an APPROVED row throws 'Review request already decided'", async () => {
    const requestId = await seedPendingRequest({
      assigneeUserId: directAssigneeUserId,
    });

    await decideReviewRequest(
      sessionFor(directAssigneeUserId),
      requestId,
      "APPROVED"
    );

    await expect(
      decideReviewRequest(
        sessionFor(directAssigneeUserId),
        requestId,
        "REJECTED",
        "second attempt"
      )
    ).rejects.toThrow(/already decided/i);
  });

  it("missing review request id throws a not-found error", async () => {
    await expect(
      decideReviewRequest(
        sessionFor(directAssigneeUserId),
        "non-existent-id-xyz",
        "APPROVED"
      )
    ).rejects.toThrow();
  });
});

describe("decideReviewRequest — admin override", () => {
  it("system ADMIN can decide even when not the direct assignee or role-holder", async () => {
    const requestId = await seedPendingRequest({
      assigneeUserId: directAssigneeUserId,
    });

    const result = await decideReviewRequest(
      sessionFor(adminUserId, "ADMIN"),
      requestId,
      "APPROVED",
      "admin override"
    );

    expect(result.status).toBe("APPROVED");
    expect(result.decidedByUserId).toBe(adminUserId);
  });
});

describe("decideReviewRequest — concurrent decides (CR-01 regression)", () => {
  it("two concurrent decide calls on the same PENDING row cannot both commit", async () => {
    const requestId = await seedPendingRequest({
      assigneeUserId: directAssigneeUserId,
    });

    // Fire both decides concurrently. With the CR-01 fix the precheck +
    // update collapse into a single atomic statement
    // (`updateMany({ where: { id, status: 'PENDING' } })`), so exactly one
    // call must win and the loser must throw "Review request already decided".
    // Before the fix, both calls could pass the load-time PENDING check and
    // both commit, clobbering each other.
    const results = await Promise.allSettled([
      decideReviewRequest(
        sessionFor(directAssigneeUserId),
        requestId,
        "APPROVED",
        "race-A"
      ),
      decideReviewRequest(
        sessionFor(adminUserId, "ADMIN"),
        requestId,
        "REJECTED",
        "race-B"
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejectedReason).toBeInstanceOf(Error);
    expect((rejectedReason as Error).message.toLowerCase()).toMatch(
      /already decided/
    );

    // DB final state matches whichever decide won — exactly one decision
    // was applied, no clobbering.
    const after = await prisma.reviewRequest.findUnique({
      where: { id: requestId },
      select: {
        status: true,
        decisionComment: true,
        decidedByUserId: true,
      },
    });
    expect(after?.status).not.toBe("PENDING");
    // The winner is whichever call resolved; verify its comment landed.
    const winner = (fulfilled[0] as PromiseFulfilledResult<ReviewRequest>)
      .value;
    expect(after?.status).toBe(winner.status);
    expect(after?.decisionComment).toBe(winner.decisionComment);
    expect(after?.decidedByUserId).toBe(winner.decidedByUserId);
  });
});
