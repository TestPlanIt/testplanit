// @vitest-environment node
/**
 * Live-DB integration coverage for the requestReview canApprove gate.
 *
 * The wrapped requestReview server action calls assertAssigneeCanApprove
 * after the feature-flag checks and before the $transaction. These tests
 * seed real (project, role, permission, user) rows in PostgreSQL and
 * assert that the action returns { error: 'INELIGIBLE_ASSIGNEE' } for
 * canApprove-false targets and proceeds for canApprove-true targets.
 *
 * Side effects after the eligibility gate (notifications, webhooks, audit)
 * are mocked so the test stays bounded to the eligibility surface.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ApplicationArea } from "@prisma/client";

// --- Side-effect mocks (everything past the eligibility gate) -------------
const headersMocks = vi.hoisted(() => ({
  current: new Map<string, string>([["user-agent", "vitest-canapprove/1.0"]]),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (key: string) => headersMocks.current.get(key.toLowerCase()) ?? null,
  })),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("~/lib/services/auditLog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/services/auditLog")>();
  return {
    ...actual,
    captureAuditEvent: vi.fn(async () => {}),
  };
});
vi.mock("~/lib/services/reviewFeatureFlag", () => ({
  isReviewFeatureSystemEnabled: vi.fn(async () => true),
}));
vi.mock("~/lib/services/notificationService", () => ({
  NotificationService: {
    resolveRoleHolderUserIds: vi.fn(async () => []),
    createReviewRequestNotification: vi.fn(async () => {}),
  },
}));
vi.mock("~/lib/services/commentService", () => ({
  CommentService: {
    createCommentMentions: vi.fn(async () => {}),
    processMentions: vi.fn(async () => {}),
  },
}));
vi.mock("~/lib/webhooks/event-emitters/reviewEvents", () => ({
  emitReviewRequestedEvent: vi.fn(async () => {}),
  emitReviewCompletedEvent: vi.fn(async () => {}),
}));

// Session mock — updated per-test so requesterUserId rotates.
const sessionMock = vi.fn();
vi.mock("~/server/auth", () => ({
  getServerAuthSession: () => sessionMock(),
}));

// next-intl getTranslations stub — requestReview uses it to format the
// default-comment fallback when commentText is empty.
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

// Imports MUST come after vi.mock so the wrapped action picks up the stubs.
import { prisma } from "~/lib/prisma";
import { requestReview } from "./reviews";

const TEST_RUN_ID = `p7-canapprove-${Date.now()}-${Math.floor(
  Math.random() * 1_000_000
)}`;

let projectId: number;
let repositoryId: number;
let repositoryFolderId: number;
let templateId: number;
let fromStateId: number;
let toStateId: number;
let approverRoleId: number;
let nonApproverRoleId: number;
let requesterUserId: string;
let approverUserId: string;
let nonApproverUserId: string;
const createdCaseIds: number[] = [];
const createdReviewRequestIds: string[] = [];

const REVIEW_FEATURE_KEY = "review_feature_enabled";
let priorReviewFeatureValue: unknown = undefined;
let priorReviewFeatureExisted = false;

async function ensureRoleCanApprove(
  roleId: number,
  area: ApplicationArea,
  canApprove: boolean
): Promise<void> {
  await prisma.rolePermission.upsert({
    where: { roleId_area: { roleId, area } },
    update: { canApprove },
    create: { roleId, area, canApprove },
  });
}

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

  // Two fresh roles — one carries canApprove on TestCaseRepository, one
  // does not. Roles are global so we mint new ones to keep the test
  // isolated from seeded role baselines.
  const approverRole = await prisma.roles.create({
    data: { name: `approver-${TEST_RUN_ID}` },
  });
  approverRoleId = approverRole.id;
  const nonApproverRole = await prisma.roles.create({
    data: { name: `nonapprover-${TEST_RUN_ID}` },
  });
  nonApproverRoleId = nonApproverRole.id;

  await ensureRoleCanApprove(
    approverRoleId,
    ApplicationArea.TestCaseRepository,
    true
  );
  await ensureRoleCanApprove(
    nonApproverRoleId,
    ApplicationArea.TestCaseRepository,
    false
  );

  const requester = await prisma.user.create({
    data: {
      name: `requester-${TEST_RUN_ID}`,
      email: `requester-${TEST_RUN_ID}@example.invalid`,
      access: "NONE",
      roleId: nonApproverRoleId,
      isApi: true,
    },
  });
  requesterUserId = requester.id;

  const approver = await prisma.user.create({
    data: {
      name: `approver-user-${TEST_RUN_ID}`,
      email: `approver-${TEST_RUN_ID}@example.invalid`,
      access: "NONE",
      roleId: approverRoleId,
      isApi: true,
    },
  });
  approverUserId = approver.id;

  const nonApprover = await prisma.user.create({
    data: {
      name: `nonapprover-user-${TEST_RUN_ID}`,
      email: `nonapprover-${TEST_RUN_ID}@example.invalid`,
      access: "NONE",
      roleId: nonApproverRoleId,
      isApi: true,
    },
  });
  nonApproverUserId = nonApprover.id;

  const project = await prisma.projects.create({
    data: {
      name: `proj-${TEST_RUN_ID}`,
      createdBy: requester.id,
      reviewWorkflowEnabled: true,
    },
  });
  projectId = project.id;

  // Per-project SPECIFIC_ROLE grants so resolveEffectiveProjectRoleId can
  // resolve the user's effective role on the project.
  await prisma.userProjectPermission.create({
    data: {
      userId: approverUserId,
      projectId,
      accessType: "SPECIFIC_ROLE",
      roleId: approverRoleId,
    },
  });
  await prisma.userProjectPermission.create({
    data: {
      userId: nonApproverUserId,
      projectId,
      accessType: "SPECIFIC_ROLE",
      roleId: nonApproverRoleId,
    },
  });
  await prisma.userProjectPermission.create({
    data: {
      userId: requesterUserId,
      projectId,
      accessType: "SPECIFIC_ROLE",
      roleId: nonApproverRoleId,
    },
  });

  const workflows = await prisma.workflows.findMany({
    where: { isDeleted: false, isEnabled: true },
    take: 2,
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (workflows.length < 2) {
    throw new Error("Need >= 2 workflows seeded; run pnpm prisma db seed");
  }
  fromStateId = workflows[0].id;
  toStateId = workflows[1].id;

  const template = await prisma.templates.findFirst({
    where: { isEnabled: true, isDeleted: false },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (!template) throw new Error("Need >= 1 template seeded");
  templateId = template.id;

  const repo = await prisma.repositories.create({
    data: { projectId, isActive: true, isArchived: false },
  });
  repositoryId = repo.id;
  const folder = await prisma.repositoryFolders.create({
    data: {
      projectId,
      repositoryId,
      name: `folder-${TEST_RUN_ID}`,
      creatorId: requesterUserId,
    },
  });
  repositoryFolderId = folder.id;
}, 60_000);

afterAll(async () => {
  try {
    await prisma.comment.updateMany({
      where: { reviewRequestId: { in: createdReviewRequestIds } },
      data: { isDeleted: true },
    });
  } catch {}
  for (const id of createdReviewRequestIds) {
    try {
      await prisma.reviewRequest.update({
        where: { id },
        data: { isDeleted: true },
      });
    } catch {}
  }
  for (const id of createdCaseIds) {
    try {
      await prisma.repositoryCases.update({
        where: { id },
        data: { isDeleted: true },
      });
    } catch {}
  }
  if (repositoryFolderId) {
    try {
      await prisma.repositoryFolders.update({
        where: { id: repositoryFolderId },
        data: { isDeleted: true },
      });
    } catch {}
  }
  if (repositoryId) {
    try {
      await prisma.repositories.update({
        where: { id: repositoryId },
        data: { isDeleted: true },
      });
    } catch {}
  }
  if (projectId) {
    try {
      await prisma.userProjectPermission.deleteMany({ where: { projectId } });
    } catch {}
    try {
      await prisma.projects.update({
        where: { id: projectId },
        data: { isDeleted: true },
      });
    } catch {}
  }
  for (const userId of [requesterUserId, approverUserId, nonApproverUserId]) {
    if (!userId) continue;
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { isDeleted: true, isActive: false },
      });
    } catch {}
  }
  for (const roleId of [approverRoleId, nonApproverRoleId]) {
    if (!roleId) continue;
    try {
      await prisma.rolePermission.deleteMany({ where: { roleId } });
    } catch {}
    try {
      await prisma.roles.update({
        where: { id: roleId },
        data: { isDeleted: true },
      });
    } catch {}
  }

  try {
    if (priorReviewFeatureExisted) {
      await prisma.appConfig.update({
        where: { key: REVIEW_FEATURE_KEY },
        data: { value: priorReviewFeatureValue as never },
      });
    } else {
      await prisma.appConfig.delete({ where: { key: REVIEW_FEATURE_KEY } });
    }
  } catch {}

  await prisma.$disconnect();
}, 30_000);

async function freshCase(): Promise<number> {
  const caseRow = await prisma.repositoryCases.create({
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
  createdCaseIds.push(caseRow.id);
  return caseRow.id;
}

function setRequester(userId: string) {
  sessionMock.mockReturnValue(
    Promise.resolve({
      user: { id: userId, name: "tester", access: "USER" },
    })
  );
}

beforeEach(() => {
  sessionMock.mockReset();
  setRequester(requesterUserId);
});

describe("requestReview canApprove gate", () => {
  it("Test 1: role-assignee whose role has canApprove=true on TestCaseRepository is accepted", async () => {
    const caseId = await freshCase();
    const result = await requestReview({
      projectId,
      entityType: "CASE",
      entityId: caseId,
      fromStateId,
      toStateId,
      assigneeUserId: null,
      assigneeRoleId: approverRoleId,
      commentText: "please review",
    });
    expect(result.success).toBe(true);
    if (result.success) createdReviewRequestIds.push(result.reviewRequestId);
  });

  it("Test 2: role-assignee whose role has canApprove=false is rejected with INELIGIBLE_ASSIGNEE", async () => {
    const caseId = await freshCase();
    const result = await requestReview({
      projectId,
      entityType: "CASE",
      entityId: caseId,
      fromStateId,
      toStateId,
      assigneeUserId: null,
      assigneeRoleId: nonApproverRoleId,
      commentText: "please review",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("INELIGIBLE_ASSIGNEE");

    const after = await prisma.reviewRequest.findFirst({
      where: { entityType: "CASE", entityId: caseId },
    });
    expect(after).toBeNull();
  });

  it("Test 3: user-assignee whose effective role has canApprove=true is accepted", async () => {
    const caseId = await freshCase();
    const result = await requestReview({
      projectId,
      entityType: "CASE",
      entityId: caseId,
      fromStateId,
      toStateId,
      assigneeUserId: approverUserId,
      assigneeRoleId: null,
      commentText: "please review",
    });
    expect(result.success).toBe(true);
    if (result.success) createdReviewRequestIds.push(result.reviewRequestId);
  });

  it("Test 4: user-assignee whose effective role has canApprove=false is rejected", async () => {
    const caseId = await freshCase();
    const result = await requestReview({
      projectId,
      entityType: "CASE",
      entityId: caseId,
      fromStateId,
      toStateId,
      assigneeUserId: nonApproverUserId,
      assigneeRoleId: null,
      commentText: "please review",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("INELIGIBLE_ASSIGNEE");
  });

  it("Test 5: self-assignment is naturally blocked when the requester's effective role lacks canApprove (no separate guard needed)", async () => {
    setRequester(requesterUserId);
    const caseId = await freshCase();
    const result = await requestReview({
      projectId,
      entityType: "CASE",
      entityId: caseId,
      fromStateId,
      toStateId,
      assigneeUserId: requesterUserId,
      assigneeRoleId: null,
      commentText: "self assigning",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("INELIGIBLE_ASSIGNEE");
  });
});
