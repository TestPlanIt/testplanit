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

/**
 * Create a fresh project-scoped workflow with `requiresReview: true` and
 * assign it to the project. Use this in place of toggling requiresReview on
 * a shared seeded workflow — every review spec was racing the same
 * Workflows.requiresReview column otherwise (it's global, not per-project),
 * so concurrent specs flipped it on and off under each other and only the
 * winner ever saw the gated option render in the UI.
 *
 * The created workflow's `order` is bumped past every seeded order in its
 * scope so the case-page predicate (`order > currentStateOrder`) treats it
 * as a forward transition from any seeded starting state.
 *
 * Cleanup: call `softDeleteWorkflow` in the spec's afterEach so we don't
 * accumulate per-test workflows across the run.
 */
export async function createGatedTestWorkflow(
  request: APIRequestContext,
  baseURL: string,
  projectId: number,
  scope: "CASES" | "RUNS" | "SESSIONS",
  opts: {
    requiresReview?: boolean;
    workflowType?: "NOT_STARTED" | "IN_PROGRESS" | "DONE";
    /**
     * Offset added to the reference workflow's `order`. Tests that need
     * multiple gated workflows with a strict ordering (e.g., bulk-edit
     * transitive gating) pass increasing offsets so gateA.order < gateB.order.
     * Defaults to 1000 which puts the new row past every seeded order.
     */
    orderOffset?: number;
  } = {}
): Promise<{ id: number; name: string; order: number }> {
  // Borrow icon + color from the seeded "Under Review" workflow in this scope
  // so the new row matches existing visual treatment. Fall back to the first
  // non-deleted workflow if "Under Review" isn't present in this scope.
  const refRes = await request.get(`${baseURL}/api/model/workflows/findFirst`, {
    params: {
      q: JSON.stringify({
        where: {
          scope,
          isDeleted: false,
          OR: [{ name: "Under Review" }, { isDefault: true }],
        },
        orderBy: { id: "asc" },
        select: { iconId: true, colorId: true, order: true },
      }),
    },
  });
  const ref = (await refRes.json())?.data as {
    iconId: number;
    colorId: number;
    order: number;
  } | null;
  if (!ref) {
    throw new Error(
      `No reference workflow found for scope ${scope} — seed missing?`
    );
  }

  const uniqueName = `E2E-Gated-${scope}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const newOrder = ref.order + (opts.orderOffset ?? 1000);
  const createRes = await request.post(
    `${baseURL}/api/model/workflows/create`,
    {
      data: {
        data: {
          name: uniqueName,
          order: newOrder,
          iconId: ref.iconId,
          colorId: ref.colorId,
          isEnabled: true,
          isDefault: false,
          scope,
          workflowType: opts.workflowType ?? "IN_PROGRESS",
          requiresReview: opts.requiresReview ?? true,
        },
      },
    }
  );
  if (!createRes.ok()) {
    throw new Error(
      `Failed to create gated workflow: ${await createRes.text()}`
    );
  }
  const workflowId = ((await createRes.json())?.data?.id as number) ?? 0;
  if (!workflowId) {
    throw new Error(`Gated workflow create returned no id`);
  }

  const assignRes = await request.post(
    `${baseURL}/api/model/projectWorkflowAssignment/create`,
    {
      data: { data: { workflowId, projectId } },
    }
  );
  if (!assignRes.ok()) {
    throw new Error(
      `Failed to assign gated workflow ${workflowId} to project ${projectId}: ${await assignRes.text()}`
    );
  }

  return { id: workflowId, name: uniqueName, order: newOrder };
}

export async function softDeleteWorkflow(
  request: APIRequestContext,
  baseURL: string,
  workflowId: number
): Promise<void> {
  await request
    .patch(`${baseURL}/api/model/workflows/update`, {
      data: { where: { id: workflowId }, data: { isDeleted: true } },
    })
    .catch(() => {});
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
