import type { APIRequestContext } from "@playwright/test";

/**
 * Helpers shared by review-approval E2E specs. Kept local rather than added to
 * api.fixture.ts because these are review-specific and the spec authors want
 * the cleanup paths obvious next to the test that produced them.
 */

export type ReviewableEntityType = "CASE" | "RUN" | "SESSION";

export async function setWorkflowRequiresReview(
  request: APIRequestContext,
  baseURL: string,
  workflowId: number,
  requiresReview: boolean
): Promise<void> {
  const res = await request.patch(`${baseURL}/api/model/workflows/update`, {
    data: {
      where: { id: workflowId },
      data: { requiresReview },
    },
  });
  if (!res.ok()) {
    throw new Error(
      `Failed to set requiresReview=${requiresReview} on workflow ${workflowId}: ${await res.text()}`
    );
  }
}

export async function setProjectReviewWorkflowEnabled(
  request: APIRequestContext,
  baseURL: string,
  projectId: number,
  enabled: boolean
): Promise<void> {
  const res = await request.patch(`${baseURL}/api/model/projects/update`, {
    data: {
      where: { id: projectId },
      data: { reviewWorkflowEnabled: enabled },
    },
  });
  if (!res.ok()) {
    throw new Error(
      `Failed to set reviewWorkflowEnabled=${enabled} on project ${projectId}: ${await res.text()}`
    );
  }
}

export async function setSystemReviewFeatureEnabled(
  request: APIRequestContext,
  baseURL: string,
  enabled: boolean
): Promise<{ created: boolean; previous: boolean | null }> {
  // Look up the existing AppConfig row (key = review_feature_enabled).
  const findRes = await request.get(
    `${baseURL}/api/model/appConfig/findFirst`,
    {
      params: {
        q: JSON.stringify({
          where: { key: "review_feature_enabled" },
          select: { id: true, value: true },
        }),
      },
    }
  );
  let previous: boolean | null = null;
  let created = false;
  if (findRes.ok()) {
    const data = await findRes.json();
    const row = data?.data;
    if (row) {
      previous = row.value === "true";
      await request.patch(`${baseURL}/api/model/appConfig/update`, {
        data: {
          where: { id: row.id },
          data: { value: enabled ? "true" : "false" },
        },
      });
      return { created, previous };
    }
  }
  // No row — create one. Default-on semantics mean absence == enabled.
  created = true;
  await request.post(`${baseURL}/api/model/appConfig/create`, {
    data: {
      data: {
        key: "review_feature_enabled",
        value: enabled ? "true" : "false",
      },
    },
  });
  return { created, previous };
}

/**
 * Seeded workflow names per scope (mirrors prisma/seed.ts). Filtering the
 * picker to these names ensures `ids[0]` / `ids[1]` always reference the
 * known-good seeded states with stable `order` relationships — without it,
 * a parallel test that creates its own workflow (or mutates an existing
 * one's order) pollutes the project-assignment pool and breaks the
 * "currentStateOrder < gatedOrder" invariant the case-page review
 * predicate depends on.
 */
const SEEDED_WORKFLOW_NAMES: Record<"CASES" | "RUNS" | "SESSIONS", string[]> = {
  CASES: ["Draft", "Under Review", "Rejected", "Active", "Done", "Archived"],
  RUNS: ["New", "In Progress", "Under Review", "Done", "Rejected"],
  SESSIONS: ["New", "In Progress", "Under Review", "Done", "Rejected"],
};

export async function getProjectWorkflowIds(
  request: APIRequestContext,
  baseURL: string,
  projectId: number,
  scope: "CASES" | "RUNS" | "SESSIONS",
  take: number
): Promise<number[]> {
  const res = await request.get(`${baseURL}/api/model/workflows/findMany`, {
    params: {
      q: JSON.stringify({
        where: {
          isDeleted: false,
          isEnabled: true,
          scope,
          name: { in: SEEDED_WORKFLOW_NAMES[scope] },
          projects: { some: { projectId } },
        },
        orderBy: { order: "asc" },
        take,
      }),
    },
  });
  if (!res.ok()) {
    throw new Error(`Failed to fetch workflows: ${await res.text()}`);
  }
  const data = await res.json();
  return (data.data ?? []).map((w: { id: number }) => w.id);
}

export async function createReviewRequest(
  request: APIRequestContext,
  baseURL: string,
  input: {
    projectId: number;
    entityType: ReviewableEntityType;
    entityId: number;
    fromStateId: number;
    toStateId: number;
    requestedByUserId: string;
    assigneeUserId?: string;
    assigneeRoleId?: number;
  }
): Promise<string> {
  const data: Record<string, unknown> = {
    projectId: input.projectId,
    entityType: input.entityType,
    entityId: input.entityId,
    fromStateId: input.fromStateId,
    toStateId: input.toStateId,
    requestedByUserId: input.requestedByUserId,
    status: "PENDING",
  };
  if (input.assigneeUserId) data.assigneeUserId = input.assigneeUserId;
  if (input.assigneeRoleId) data.assigneeRoleId = input.assigneeRoleId;

  const res = await request.post(`${baseURL}/api/model/reviewRequest/create`, {
    data: { data },
  });
  if (!res.ok()) {
    throw new Error(`Failed to create ReviewRequest: ${await res.text()}`);
  }
  const result = await res.json();
  return result.data.id as string;
}

export async function decideReviewRequest(
  request: APIRequestContext,
  baseURL: string,
  reviewRequestId: string,
  decision: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED",
  comment?: string
): Promise<Response | { status: number; body: any }> {
  const res = await request.post(
    `${baseURL}/api/reviews/${reviewRequestId}/decide`,
    {
      data: { decision, comment: comment ?? "" },
    }
  );
  return { status: res.status(), body: await res.json().catch(() => null) };
}

export async function deleteReviewRequest(
  request: APIRequestContext,
  baseURL: string,
  reviewRequestId: string
): Promise<void> {
  await request
    .patch(`${baseURL}/api/model/reviewRequest/update`, {
      data: {
        where: { id: reviewRequestId },
        data: { isDeleted: true },
      },
    })
    .catch(() => {});
}
