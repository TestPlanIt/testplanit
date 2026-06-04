import type { AuditAction, ReviewEntityType } from "@prisma/client";
import { enhance } from "@zenstackhq/runtime";
import { NextRequestHandler } from "@zenstackhq/server/next";
import { AsyncLocalStorage } from "async_hooks";
import { NextRequest, NextResponse } from "next/server";
import { tryFastPathCreate } from "~/lib/access-fast-path";
import {
  authenticateApiTokenForMethod,
  extractBearerToken,
} from "~/lib/api-token-auth";
import { getAuditContext, runWithAuditContext } from "~/lib/auditContext";
import {
  enrichFromApiAuth,
  withAuditContext,
} from "~/lib/auditContextWrappers";
import { getCurrentTenantId } from "~/lib/multiTenantPrisma";
import { prisma } from "~/lib/prisma";
import {
  AUDITED_CONFIG_MODELS,
  calculateDiff,
  captureAuditEvent,
  ENTITY_NAME_FIELDS,
  type AuditEvent,
} from "~/lib/services/auditLog";
import {
  assertReviewGatePasses,
  resolveCreateStateRemap,
} from "~/lib/services/reviewGate";
import {
  assertResultEditWindowOpen,
  isEditWindowExpiredError,
} from "~/lib/services/editWindow";
import { hasMissingRequiredResultField } from "~/lib/services/resultGuards";
import { softDeleteUnexecutedRunCasesForDraftRevert } from "~/lib/services/runCaseEligibility";
import {
  isAlreadyPendingError,
  isReviewGateError,
  ReviewGateError,
} from "~/lib/utils/errors";
import {
  emitCaseCreated,
  emitCaseDeleted,
  emitCaseUpdated,
} from "~/lib/webhooks/event-emitters/caseEvents";
import {
  emitIssueCreated,
  emitIssueDeleted,
  emitIssueUpdated,
} from "~/lib/webhooks/event-emitters/issueEvents";
import {
  emitSessionCreated,
  emitSessionResultAdded,
  emitSessionUpdateEvents,
} from "~/lib/webhooks/event-emitters/sessionEvents";
import {
  emitTestRunCreated,
  emitTestRunResultAdded,
  emitTestRunUpdateEvents,
} from "~/lib/webhooks/event-emitters/testRunEvents";
import { getServerAuthSession } from "~/server/auth";
import { syncIssueToElasticsearch } from "~/services/issueSearch";
import { syncMilestoneToElasticsearch } from "~/services/milestoneSearch";
import { syncProjectToElasticsearch } from "~/services/projectSearch";
import { syncRepositoryCaseToElasticsearch } from "~/services/repositoryCaseSync";
import { syncSessionToElasticsearch } from "~/services/sessionSearch";
import { syncSharedStepToElasticsearch } from "~/services/sharedStepSearch";
import { syncTestRunToElasticsearch } from "~/services/testRunSearch";

// Use AsyncLocalStorage for request-scoped API token auth (thread-safe)
type ApiAuthContext = { userId: string; email?: string; name?: string } | null;
const apiAuthStorage = new AsyncLocalStorage<ApiAuthContext>();

// Helper to get current API auth from AsyncLocalStorage
function getCurrentApiAuth(): ApiAuthContext {
  return apiAuthStorage.getStore() ?? null;
}

// Models that require automatic user injection for create operations
// Maps model name to the field that needs the authenticated user
const AUTO_INJECT_USER_FIELDS: Record<string, string[]> = {
  testRuns: ["createdBy"],
  testRunResults: ["executedBy"],
  repositoryCases: ["creator"],
  repositoryFolders: ["creator"],
  sessions: ["createdBy"],
  attachments: ["createdBy"],
  caseSteps: ["createdBy"],
  jUnitTestSuite: ["createdBy"],
  jUnitTestResult: ["createdBy"],
  issue: ["createdBy"],
};

const WEBHOOK_EMIT_MODELS = new Set([
  "testRuns",
  "sessions",
  "issue",
  "repositoryCases",
  "testRunResults",
  "sessionResults",
]);

// Models whose `stateId` updates are gated by Review & Approval (Plan 01-04).
// When `parsedPath.operation === "update"` AND `requestBody.data.stateId` is
// present for one of these models, the auto-API handler calls
// `assertReviewGatePasses` before invoking the underlying ZenStack handler.
const REVIEW_GATED_MODELS: Record<string, ReviewEntityType> = {
  repositoryCases: "CASE",
  testRuns: "RUN",
  sessions: "SESSION",
};

// Scope each gated model maps to for create-time `resolveCreateStateRemap`
// lookups. Mirrors `REVIEW_GATED_MODELS` but in the WorkflowScope dimension
// so the remap can find the right pool of workflows.
const GATED_MODEL_SCOPE: Record<string, "CASES" | "RUNS" | "SESSIONS"> = {
  repositoryCases: "CASES",
  testRuns: "RUNS",
  sessions: "SESSIONS",
};

function extractEntityIdFromBody(
  body: any,
  operation?: string
): number | string | null {
  if (!body) return null;
  // ZenStack RPC operation shapes:
  //   update / delete:  { where: { id }, data?: { ... } }
  //   upsert:           { where: { id }, create: { ... }, update: { ... } }
  //   updateMany / deleteMany:
  //                     { where: { id: ... }, data?: { ... } } — `where.id`
  //                     may be a value or a Prisma filter (e.g. { in: [...] }).
  //                     We accept the scalar case (single id) and return null
  //                     otherwise so the caller treats the request as un-keyed.
  //   create:           { data: { id?, ... } } — server-generated in practice.
  //
  // CR-03: precedence used to be `body.data.where.id ?? body.where.id
  // ?? body.data.id`, which falls through to the right field for `update`
  // payloads by accident. Make the source explicit per operation so future
  // refactors don't silently regress.
  let candidate: unknown = null;
  switch (operation) {
    case "update":
    case "delete":
    case "upsert":
      candidate = body?.where?.id ?? null;
      break;
    case "updateMany":
    case "deleteMany": {
      // updateMany's `where` may carry a Prisma filter; only accept a
      // scalar id (single-row update) to keep the gate's polymorphic
      // (entityType, entityId) shape well-defined.
      const w = body?.where?.id;
      candidate = typeof w === "number" || typeof w === "string" ? w : null;
      break;
    }
    case "create":
      candidate = body?.data?.id ?? null;
      break;
    default:
      // Back-compat fallback when the caller doesn't know the operation
      // (e.g. webhook pre-snapshot path before this signature change).
      // Probe the same locations the old `??` chain did, in order.
      candidate =
        body?.where?.id ?? body?.data?.where?.id ?? body?.data?.id ?? null;
  }
  if (typeof candidate === "number" || typeof candidate === "string") {
    return candidate;
  }
  return null;
}

// Entity types we want to audit
const AUDITED_ENTITIES = new Set([
  "repositoryCases",
  "testRuns",
  "sessions",
  "sharedStepGroups",
  "issues",
  "milestones",
  "projects",
  "user",
  "userProjectPermission",
  "groupProjectPermission",
  "ssoProvider",
  "allowedEmailDomain",
  "appConfig",
  "userIntegrationAuth",
  "testRunResults",
  "comment",
  "attachment",
  "apiToken",
  // ReviewRequest cancel path flips status to CANCELLED via the auto-API
  // (the only review-state mutation not routed through the dedicated server
  // actions). We audit the cancel here via REVIEW_CANCELLED; the request /
  // decide paths emit REVIEW_REQUESTED / REVIEW_APPROVED / etc. from their
  // own action handlers.
  "reviewRequest",
  // Admin-config catalog + access models. Audited canonically here on the RPC
  // path (the dominant admin mutation path); the lib/prisma.ts `$extends` hooks
  // cover non-RPC paths (workers, custom routes, direct prisma) and are
  // suppressed on this path via suppressEntityAudit to avoid a double, partial
  // (`select:{id:true}`-shaped) generic row. Driven from AUDITED_CONFIG_MODELS.
  ...AUDITED_CONFIG_MODELS.map((c) => c.accessor),
]);

// Derived from AUDITED_CONFIG_MODELS so the shim's entity-type and display-name
// lookups stay in sync with the single source of truth in auditLog.ts.
const CONFIG_ENTITY_TYPE_BY_ACCESSOR: Record<string, string> =
  Object.fromEntries(
    AUDITED_CONFIG_MODELS.map((c) => [c.accessor, c.entityType])
  );
const CONFIG_NAME_FIELD_BY_ACCESSOR: Record<string, string | string[]> =
  Object.fromEntries(
    AUDITED_CONFIG_MODELS.flatMap((c) => {
      const field = ENTITY_NAME_FIELDS[c.entityType];
      return field ? [[c.accessor, field] as const] : [];
    })
  );

// Map ZenStack operations to audit actions
function getAuditAction(operation: string): AuditAction | null {
  switch (operation) {
    case "create":
      return "CREATE";
    case "createMany":
      return "BULK_CREATE";
    case "update":
      return "UPDATE";
    case "updateMany":
      return "BULK_UPDATE";
    case "delete":
      return "DELETE";
    case "deleteMany":
      return "BULK_DELETE";
    case "upsert":
      return "UPDATE"; // Could be CREATE, but we'll use UPDATE as default
    default:
      return null;
  }
}

// Extract entity name from result
function extractEntityName(
  entityType: string,
  result: any
): string | undefined {
  if (!result) return undefined;

  const nameFields: Record<string, string | string[]> = {
    repositoryCases: "name",
    testRuns: "name",
    sessions: "title",
    projects: "name",
    milestones: "name",
    sharedStepGroups: "name",
    issues: "title",
    user: "email",
    ssoProvider: "type",
    allowedEmailDomain: "domain",
    appConfig: "key",
    apiToken: "name",
    ...CONFIG_NAME_FIELD_BY_ACCESSOR,
  };

  const field = nameFields[entityType];
  if (!field) return undefined;

  if (Array.isArray(field)) {
    return field
      .map((f) => result[f])
      .filter(Boolean)
      .join(":");
  }

  const value = result[field];

  // WR-08: ApiToken.name is nullable in the schema. When a token row is
  // saved without a name, audit rows would otherwise record entityName as
  // undefined and become harder to triage. Prefer name -> tokenPrefix ->
  // sentinel so the audit row always carries some human-readable signal.
  if (entityType === "apiToken" && (value === null || value === undefined)) {
    return result.tokenPrefix ?? "(unnamed token)";
  }

  return value;
}

async function getPrisma() {
  const session = await getServerAuthSession();
  let userId = session?.user?.id;
  let userEmail = session?.user?.email ?? undefined;
  let userName = session?.user?.name ?? undefined;

  // If no session, check for API token auth result stored in AsyncLocalStorage
  const currentApiAuth = getCurrentApiAuth();
  if (!userId && currentApiAuth) {
    userId = currentApiAuth.userId;
    userEmail = currentApiAuth.email;
    userName = currentApiAuth.name;
  }

  if (userId) {
    enrichFromApiAuth({
      userId: userId,
      userEmail: userEmail,
      userName: userName,
    });
  }

  let user;
  if (userId) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        user = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            name: true,
            email: true,
            access: true,
            roleId: true, // Required by ZenStack authSelector
            isActive: true,
            isDeleted: true,
            role: {
              select: {
                id: true,
                rolePermissions: true,
              },
            },
            groups: {
              include: {
                group: true,
              },
            },
          },
        });
        break;
      } catch (err) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        } else {
          console.error(
            "[getPrisma] user lookup failed after 3 attempts:",
            err
          );
        }
      }
    }
  }

  // Use prisma from lib/prisma.ts which has audit logging extensions
  return enhance(prisma, { user: user ?? undefined });
}

const baseHandler = NextRequestHandler({ getPrisma, useAppDir: true });

// Parse ZenStack path to extract model and operation
function parseZenStackPath(
  path: string[]
): { model: string; operation: string } | null {
  // ZenStack paths are like: /api/model/{model}/{operation}
  // e.g., ["repositoryCases", "create"] or ["repositoryCases", "findMany"]
  if (path.length >= 2) {
    return { model: path[0], operation: path[1] };
  }
  return null;
}

// Inject user fields into create/upsert request bodies
function injectUserFields(
  model: string,
  operation: string,
  body: any,
  userId: string
): any {
  const fieldsToInject = AUTO_INJECT_USER_FIELDS[model];
  if (!fieldsToInject || fieldsToInject.length === 0) {
    return body;
  }

  // Only inject for create and upsert operations
  if (!["create", "upsert"].includes(operation)) {
    return body;
  }

  // Clone the body to avoid mutating the original
  const newBody = JSON.parse(JSON.stringify(body));

  // For create operations, the data is in body.data
  // For upsert operations, the create data is in body.create
  const dataToModify =
    operation === "create"
      ? newBody.data
      : operation === "upsert"
        ? newBody.create
        : null;

  if (dataToModify) {
    for (const field of fieldsToInject) {
      // Check for both relation syntax (e.g., "creator") and scalar ID field (e.g., "creatorId")
      const scalarIdField = `${field}Id`;
      // Only inject if neither the relation nor scalar ID field is already set
      if (!dataToModify[field] && !dataToModify[scalarIdField]) {
        dataToModify[field] = { connect: { id: userId } };
      }
    }
  }

  return newBody;
}

// Inner handler. Exports below wrap this with `withAuditContext` per HTTP
// verb so each export carries its own ALS frame for audit correlation (D-01).
async function innerHandler(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  // Check for API token authentication if no session
  const session = await getServerAuthSession();
  let apiAuthContext: ApiAuthContext = null;

  if (!session?.user) {
    // Check if there's a Bearer token
    const token = extractBearerToken(req);
    if (token) {
      const apiAuth = await authenticateApiTokenForMethod(req);
      if (!apiAuth.authenticated) {
        // READ_ONLY_TOKEN is a permissions failure (token is valid; the
        // operation is forbidden), not an authentication failure — map to 403.
        const status = apiAuth.errorCode === "READ_ONLY_TOKEN" ? 403 : 401;
        return NextResponse.json(
          { error: apiAuth.error, code: apiAuth.errorCode },
          { status }
        );
      }
      // Build auth context for AsyncLocalStorage
      apiAuthContext = {
        userId: apiAuth.userId!,
      };
      // Look up user info for audit context
      const user = await prisma.user.findUnique({
        where: { id: apiAuth.userId },
        select: { email: true, name: true },
      });
      if (user) {
        apiAuthContext.email = user.email ?? undefined;
        apiAuthContext.name = user.name ?? undefined;
      }
    }
  }

  // Run the handler logic within AsyncLocalStorage context for thread-safe API auth
  return apiAuthStorage.run(apiAuthContext, async () => {
    const params = await context.params;
    const parsedPath = parseZenStackPath(params.path);
    const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);

    // Get the authenticated user ID (from session or API token)
    const authenticatedUserId = session?.user?.id ?? apiAuthContext?.userId;

    // Clone the request body for audit logging and potential modification
    let requestBody: any = null;
    let modifiedReq = req;

    if (isMutation && parsedPath) {
      try {
        const clonedReq = req.clone();
        const text = await clonedReq.text();
        if (text) {
          requestBody = JSON.parse(text);

          // Check if we need to inject user fields for this model/operation
          const needsUserInjection =
            authenticatedUserId &&
            AUTO_INJECT_USER_FIELDS[parsedPath.model] &&
            ["create", "upsert"].includes(parsedPath.operation);

          if (needsUserInjection) {
            const modifiedBody = injectUserFields(
              parsedPath.model,
              parsedPath.operation,
              requestBody,
              authenticatedUserId
            );

            // Create a new request with the modified body
            modifiedReq = new NextRequest(req.url, {
              method: req.method,
              headers: req.headers,
              body: JSON.stringify(modifiedBody),
            });

            // Update requestBody for audit logging
            requestBody = modifiedBody;
          }
        }
      } catch {
        // Ignore body parsing errors
      }
    }

    // Review & Approval create-time remap. For creates on the three gated
    // models (RepositoryCases / TestRuns / Sessions), rewrite a gated/past-
    // gate stateId to the project default state BEFORE the request reaches
    // ZenStack. The schema `@@deny('create', state.requiresReview && ...)`
    // does not navigate the `state` relation reliably on connect-style
    // inputs in ZenStack 2.x, so we enforce strict-transitive create
    // semantics here. Behavior matches `resolveCreateStateRemap` consumers
    // in the worker/import paths: when gating is active and the candidate
    // is at-or-beyond a gate, the create silently lands in the default
    // state. When gating is off (system flag, project flag, or no gated
    // state in scope), the helper returns the candidate unchanged.
    if (
      isMutation &&
      parsedPath &&
      parsedPath.operation === "create" &&
      GATED_MODEL_SCOPE[parsedPath.model] !== undefined
    ) {
      const scope = GATED_MODEL_SCOPE[parsedPath.model];
      const data = requestBody?.data;
      const candidateStateId =
        typeof data?.stateId === "number"
          ? data.stateId
          : typeof data?.state?.connect?.id === "number"
            ? data.state.connect.id
            : null;
      const projectId =
        typeof data?.projectId === "number"
          ? data.projectId
          : typeof data?.project?.connect?.id === "number"
            ? data.project.connect.id
            : null;
      if (
        candidateStateId !== null &&
        projectId !== null &&
        scope !== undefined
      ) {
        const remapped = await resolveCreateStateRemap(
          prisma,
          projectId,
          scope,
          candidateStateId
        );
        if (
          typeof remapped === "number" &&
          remapped !== candidateStateId &&
          requestBody?.data
        ) {
          if (typeof data.stateId === "number") {
            requestBody.data.stateId = remapped;
          }
          if (typeof data.state?.connect?.id === "number") {
            requestBody.data.state.connect.id = remapped;
          }
        }
      }
    }

    // Review & Approval preflight. For state-changing mutations on
    // RepositoryCases / TestRuns / Sessions, call `assertReviewGatePasses`
    // BEFORE the request reaches `tryFastPathCreate` or `baseHandler`. The
    // schema `@@deny('update', future().state.requiresReview)` rule from
    // Plan 01 is the schema-layer backstop; the app preflight is the
    // friendly-error path that produces a structured 403 with the typed code.
    //
    // CR-03: the gate now covers `update`, `upsert`, and `updateMany` payloads
    // that carry a `stateId`. Previously only `update` was checked, so a
    // caller could route a state flip through `upsert` (data lands in
    // `body.update.stateId`) or `updateMany` and bypass the friendly-error
    // path — the schema @@deny still caught it, but the user got a generic
    // policy-denied response instead of the typed REVIEW_REQUIRED envelope.
    if (isMutation && parsedPath) {
      const gatedEntityType = REVIEW_GATED_MODELS[parsedPath.model];
      // For each operation, locate the stateId field per the ZenStack RPC
      // body shape:
      //   update / updateMany: body.data.stateId
      //   upsert:              body.update.stateId (the update-branch payload;
      //                        upsert.create.stateId is a fresh row and is
      //                        gated at row-creation time by FK + workflow
      //                        rules, not by the review gate which targets
      //                        transitions of existing entities)
      const stateIdFromPayload =
        gatedEntityType !== undefined
          ? parsedPath.operation === "update" ||
            parsedPath.operation === "updateMany"
            ? requestBody?.data?.stateId
            : parsedPath.operation === "upsert"
              ? requestBody?.update?.stateId
              : undefined
          : undefined;
      const isGatedUpdate =
        gatedEntityType !== undefined && stateIdFromPayload !== undefined;

      if (isGatedUpdate) {
        const rawEntityId = extractEntityIdFromBody(
          requestBody,
          parsedPath.operation
        );
        const entityIdNum =
          typeof rawEntityId === "number"
            ? rawEntityId
            : typeof rawEntityId === "string" && rawEntityId !== ""
              ? Number(rawEntityId)
              : NaN;
        // CR-03: guard the stateId coercion the same way entityIdNum is
        // guarded a few lines up — accept number/numeric-string only, NaN
        // anything else. Today stateId is always a numeric primary key, but
        // any future nullable-stateId payload (e.g. clearing the field) would
        // otherwise pass NaN into `assertReviewGatePasses`.
        const rawStateId = stateIdFromPayload;
        const toStateIdNum =
          typeof rawStateId === "number"
            ? rawStateId
            : typeof rawStateId === "string" && rawStateId !== ""
              ? Number(rawStateId)
              : NaN;

        if (Number.isFinite(entityIdNum) && Number.isFinite(toStateIdNum)) {
          try {
            // CR-04: the auto-API path cannot share a transaction with
            // ZenStack's internal handler (baseHandler manages its own
            // connection + tx), so it cannot honor the contract that the
            // sibling chokepoint helpers do — namely "gate-read and
            // entity-update commit together, then stamp consumedAt
            // afterward". The previous Serializable wrapper around the
            // read-only gate provided no atomicity with the later
            // baseHandler write: the tx committed immediately after the
            // read, and a concurrent decide/cancel/consume could slip
            // between commit-of-gate-tx and start-of-entity-tx. Serializable
            // also only conflicts with other Serializable transactions, and
            // the decide path runs at default isolation.
            //
            // The right move is to make the gate write-locked: stamp
            // `consumedAt` atomically inside the same tx that did the gate
            // read, BEFORE handing off to ZenStack. Concurrent callers race
            // on `updateMany({ where: { id, consumedAt: null } })` — exactly
            // one wins, the rest get count=0 and surface as REVIEW_REQUIRED.
            // This preserves the one-shot invariant from Phase 1 D-05.
            //
            // Tradeoff documented: a downstream ZenStack failure (FK
            // violation, policy denial, etc.) leaves an orphan
            // `consumedAt`-stamped row. The user retries by requesting a
            // fresh review (the prior request is "consumed but no entity
            // change shipped" — not the same shape as a clean approval,
            // but cleaner than a double-consume). The bulk-edit /
            // submit-result / milestone paths can hold a single tx across
            // gate + entity update + consume and don't pay this cost; the
            // auto-API path explicitly accepts it.
            await prisma.$transaction(
              async (tx) => {
                const gateResult = await assertReviewGatePasses(
                  tx,
                  gatedEntityType,
                  entityIdNum,
                  toStateIdNum
                );
                if (gateResult) {
                  // Strict transitive gates: a single transition can cross
                  // multiple gates (e.g. target 6 with gates at 4 and 5).
                  // Stamp every approval the gate matched in one updateMany
                  // so an interleaved transaction can't slip in and consume
                  // a stale approval the second loop iteration would expect.
                  // If `count` < expected, another caller raced us — surface
                  // REVIEW_REQUIRED so the client sees the typed envelope.
                  const stamp = await tx.reviewRequest.updateMany({
                    where: {
                      id: { in: gateResult.approvedRequestIds },
                      consumedAt: null,
                    },
                    data: { consumedAt: new Date() },
                  });
                  if (stamp.count !== gateResult.approvedRequestIds.length) {
                    throw new ReviewGateError(
                      "REVIEW_REQUIRED",
                      gatedEntityType,
                      entityIdNum,
                      toStateIdNum
                    );
                  }
                }
              },
              { isolationLevel: "Serializable" }
            );
          } catch (err) {
            if (isReviewGateError(err)) {
              return NextResponse.json(
                {
                  error: {
                    code: err.code,
                    entityType: err.entityType,
                    entityId: err.entityId,
                    toStateId: err.toStateId,
                  },
                },
                { status: 403 }
              );
            }
            if (isAlreadyPendingError(err)) {
              return NextResponse.json(
                { error: { code: "PENDING_REVIEW_EXISTS" } },
                { status: 409 }
              );
            }
            throw err;
          }
        }
      }
    }

    // Edit-window guard. Enforce the admin-configured `edit_results_duration`
    // server-side for in-place result edits (and soft-deletes, which arrive as
    // an `isDeleted` update). System admins always pass; for everyone else the
    // edit is rejected once the window has elapsed since the result was
    // recorded. The client (TestResultHistory) hides the Edit button on the
    // same rule, but this chokepoint makes it structural so a direct model-
    // route call cannot bypass it.
    if (
      isMutation &&
      parsedPath &&
      parsedPath.model === "testRunResults" &&
      ["update", "delete"].includes(parsedPath.operation)
    ) {
      const rawResultId = extractEntityIdFromBody(
        requestBody,
        parsedPath.operation
      );
      const resultId =
        typeof rawResultId === "number"
          ? rawResultId
          : typeof rawResultId === "string" && rawResultId !== ""
            ? Number(rawResultId)
            : NaN;
      if (Number.isFinite(resultId) && authenticatedUserId) {
        const actor = await prisma.user.findUnique({
          where: { id: authenticatedUserId },
          select: { access: true },
        });
        try {
          await assertResultEditWindowOpen(prisma, resultId, actor?.access);
        } catch (err) {
          if (isEditWindowExpiredError(err)) {
            return NextResponse.json(
              { error: { code: "EDIT_WINDOW_EXPIRED" } },
              { status: 403 }
            );
          }
          throw err;
        }
      }
    }

    // Required-result-field guard for SessionResults.create. The model handler
    // is the universal chokepoint — `lib/prisma.ts`'s `$extends` middleware is
    // bypassed by ZenStack's `enhance()` (see the repositoryCases ES-sync shim
    // above), so a Prisma-extension hook would silently miss raw POSTs landing
    // here. Reading the supplied `resultFieldValues.create[]` from the
    // request body lets the same `hasMissingRequiredResultField` helper that
    // gates the `/api/test-runs/submit-result` path enforce parity against
    // session results too. SessionResults must be created with the field
    // values nested in the same call; the SessionResultForm UI is the canonical
    // first-party caller and uses that shape.
    if (
      isMutation &&
      parsedPath &&
      parsedPath.model === "sessionResults" &&
      parsedPath.operation === "create"
    ) {
      const data = (requestBody as { data?: Record<string, unknown> } | null)
        ?.data;
      const rawSessionId =
        (data?.sessionId as number | string | undefined) ??
        ((data?.session as { connect?: { id?: number | string } } | undefined)
          ?.connect?.id as number | string | undefined);
      const sessionId =
        typeof rawSessionId === "number"
          ? rawSessionId
          : typeof rawSessionId === "string" && rawSessionId !== ""
            ? Number(rawSessionId)
            : NaN;
      if (Number.isFinite(sessionId)) {
        const session = await prisma.sessions.findUnique({
          where: { id: sessionId },
          select: { templateId: true },
        });
        if (session) {
          const nestedCreate = (
            data?.resultFieldValues as
              | {
                  create?:
                    | Array<Record<string, unknown>>
                    | Record<string, unknown>;
                }
              | undefined
          )?.create;
          const nestedArray = Array.isArray(nestedCreate)
            ? nestedCreate
            : nestedCreate
              ? [nestedCreate]
              : [];
          const suppliedFieldValues = nestedArray
            .map((fv) => {
              const rawFieldId =
                (fv?.fieldId as number | string | undefined) ??
                ((
                  fv?.field as
                    | { connect?: { id?: number | string } }
                    | undefined
                )?.connect?.id as number | string | undefined);
              const fieldId =
                typeof rawFieldId === "number"
                  ? rawFieldId
                  : typeof rawFieldId === "string" && rawFieldId !== ""
                    ? Number(rawFieldId)
                    : NaN;
              return Number.isFinite(fieldId)
                ? { fieldId, value: fv?.value }
                : null;
            })
            .filter(
              (entry): entry is { fieldId: number; value: unknown } =>
                entry !== null
            );
          const missing = await hasMissingRequiredResultField(
            prisma,
            session.templateId,
            suppliedFieldValues
          );
          if (missing) {
            return NextResponse.json(
              {
                error: {
                  code: "REQUIRED_FIELDS_MISSING",
                  message: "A required result field is missing a value",
                },
              },
              { status: 400 }
            );
          }
        }
      }
    }

    // Plan 02-08 webhook-emit shim — pre-mutation snapshot capture.
    // For UPDATE / UPSERT / DELETE on emission-eligible models we need the
    // pre-mutation row state to compute state-transition diffs and pass
    // oldRow into the testRun/session/issue/case emitters. Captured BEFORE
    // the rpcHandler runs so it's not affected by transaction isolation.
    // The post-mutation `lib/prisma.ts` `$extends` middleware emission is
    // suppressed via auditContext.suppressWebhooks (Plan 02-02 D-01a) to
    // prevent double-emission; this shim is the canonical RPC-path emitter.
    //
    // WR-05: hoist the narrowed parsedPath into a single non-nullable local
    // (`webhookMutation`) so we don't rely on `parsedPath!` non-null
    // assertions to keep the compiler quiet. A future refactor that drops
    // the `parsedPath !== null` clause from `isWebhookEmittingMutation`
    // would now surface as a type error instead of silently masking a null
    // deref at runtime.
    let webhookPreSnapshot: any = null;
    const webhookMutation =
      isMutation && parsedPath && WEBHOOK_EMIT_MODELS.has(parsedPath.model)
        ? parsedPath
        : null;
    const isWebhookEmittingMutation = webhookMutation !== null;
    if (
      webhookMutation &&
      ["update", "upsert", "delete"].includes(webhookMutation.operation)
    ) {
      try {
        const whereId = extractEntityIdFromBody(
          requestBody,
          webhookMutation.operation
        );
        if (whereId !== null) {
          webhookPreSnapshot = await (prisma as any)[
            webhookMutation.model
          ].findUnique({ where: { id: whereId } });
        }
      } catch (e) {
        console.error("[Webhooks] Failed to capture pre-snapshot:", e);
      }
    }

    // Audit before-snapshot. For audited update/delete we capture the full
    // pre-mutation row so the audit event can record before/after values.
    // Reuses the webhook snapshot when the model is both webhook-emitting and
    // audited to avoid a second read; uses the request's own `where` so it
    // works for any primary key (id or key).
    let auditPreSnapshot: any = null;
    if (
      isMutation &&
      parsedPath &&
      AUDITED_ENTITIES.has(parsedPath.model) &&
      ["update", "delete"].includes(parsedPath.operation) &&
      requestBody?.where
    ) {
      if (webhookPreSnapshot && webhookMutation?.model === parsedPath.model) {
        auditPreSnapshot = webhookPreSnapshot;
      } else {
        try {
          auditPreSnapshot = await (prisma as any)[parsedPath.model].findUnique(
            { where: requestBody.where }
          );
        } catch (e) {
          console.error("[AuditLog] Failed to capture pre-snapshot:", e);
        }
      }
    }

    // Fast path: bypass ZenStack's policy engine for project-scoped creates
    // where the user's cached access manifest already answers the question.
    // Returns null when the fast path doesn't apply (wrong model/op, missing
    // projectId, etc.), in which case we fall through to the regular handler.
    //
    // Plan 02-08 — wrap the RPC handler call (and the fast-path) in a nested
    // ALS frame that adds suppressWebhooks=true. The lib/prisma.ts $extends
    // middleware emission is unreliable for ZenStack RPC mutations because
    // RPC injects `select: { id: true }` into args, leaving the middleware
    // with a partial row that can't compute the state-changed diff. We
    // suppress that emission here and let the post-rpc shim below emit
    // canonically using the response data + pre-snapshot. The nested frame
    // copies the parent's identity/correlation fields so they remain visible
    // to audit code paths inside the RPC handler.
    const parentAuditCtx = getAuditContext() ?? {};
    // Suppress the lib/prisma.ts `$extends` generic entity-audit emission for
    // models this route audits canonically below (AUDITED_ENTITIES). On the RPC
    // path the `$extends` hook only sees a partial `select:{id:true}` row, so
    // letting it emit would add a second, malformed audit record. Scoped to the
    // audited set so hooked-but-not-shimmed models keep their hook-side audit.
    const auditedByShim =
      isMutation &&
      parsedPath !== null &&
      AUDITED_ENTITIES.has(parsedPath.model);
    let response = await runWithAuditContext(
      {
        ...parentAuditCtx,
        suppressWebhooks: true,
        suppressEntityAudit: auditedByShim,
      },
      async () => {
        let r = await tryFastPathCreate({
          parsedPath,
          requestBody,
          userId: authenticatedUserId ?? null,
        });
        if (!r) {
          r = await baseHandler(modifiedReq, {
            params: Promise.resolve(params),
          });
        }
        return r;
      }
    );

    // Clone the response to add headers (NextResponse is immutable)
    const responseBody = await response.clone().text();

    // Remap certain HTTP status codes to prevent nginx ingress from intercepting
    // API error responses. The ingress controller's `custom-http-errors` setting
    // (403,404,500,502,503,504) replaces JSON response bodies with HTML error pages,
    // which breaks API clients that expect JSON. We remap Prisma/ZenStack error
    // responses to status codes that won't be intercepted while preserving the
    // JSON error body for proper client-side error handling.
    let responseStatus = response.status;
    if (!response.ok && responseBody) {
      try {
        const parsed = JSON.parse(responseBody);
        if (parsed.error) {
          // Prisma P2025 (connected record not found) maps to 404 in ZenStack,
          // but 422 (Unprocessable Entity) is more appropriate and avoids interception
          if (response.status === 404) {
            responseStatus = 422;
          }
          // ZenStack returns 403 for constraint violations (access policy),
          // remap to 422 to preserve the JSON error details
          if (response.status === 403) {
            responseStatus = 422;
          }
        }
      } catch {
        // Response body is not JSON (e.g., actual 404 page), leave status as-is
      }
    }

    const newResponse = new NextResponse(responseBody, {
      status: responseStatus,
      statusText: response.statusText,
      headers: response.headers,
    });

    // Get tenant ID for Elasticsearch index routing in multi-tenant deployments
    const tenantId = getCurrentTenantId();

    // Manually trigger Elasticsearch sync for repositoryCases mutations
    // ZenStack's enhance() doesn't preserve Prisma client extensions
    if (
      response.ok &&
      parsedPath &&
      parsedPath.model === "repositoryCases" &&
      isMutation
    ) {
      try {
        const result = responseBody ? JSON.parse(responseBody) : null;
        const data = result?.data;

        if (data?.id) {
          syncRepositoryCaseToElasticsearch(data.id, tenantId).catch(
            (error: any) => {
              console.error(
                `Failed to sync repository case ${data.id} to Elasticsearch:`,
                error
              );
            }
          );

          if (
            parsedPath.operation === "update" &&
            typeof requestBody?.data?.stateId === "number" &&
            typeof data.projectId === "number" &&
            typeof data.stateId === "number"
          ) {
            softDeleteUnexecutedRunCasesForDraftRevert(prisma, {
              projectId: data.projectId,
              repositoryCaseId: data.id,
              newStateId: data.stateId,
            }).catch((err: any) => {
              console.error(
                `[exclude-not-started] soft-delete failed for case ${data.id}:`,
                err
              );
            });
          }
        }
      } catch (e) {
        console.error(
          "[ZenStack] Error parsing response for Elasticsearch sync:",
          e
        );
      }
    }

    // Manually trigger Elasticsearch sync for testRuns mutations
    if (
      response.ok &&
      parsedPath &&
      parsedPath.model === "testRuns" &&
      isMutation
    ) {
      try {
        const result = responseBody ? JSON.parse(responseBody) : null;
        const data = result?.data;

        if (data?.id) {
          syncTestRunToElasticsearch(data.id, tenantId).catch((error: any) => {
            console.error(
              `Failed to sync test run ${data.id} to Elasticsearch:`,
              error
            );
          });
        }
      } catch (e) {
        console.error(
          "[ZenStack] Error parsing response for Elasticsearch sync:",
          e
        );
      }
    }

    // Manually trigger Elasticsearch sync for sessions mutations
    if (
      response.ok &&
      parsedPath &&
      parsedPath.model === "sessions" &&
      isMutation
    ) {
      try {
        const result = responseBody ? JSON.parse(responseBody) : null;
        const data = result?.data;

        if (data?.id) {
          syncSessionToElasticsearch(data.id, tenantId).catch((error: any) => {
            console.error(
              `Failed to sync session ${data.id} to Elasticsearch:`,
              error
            );
          });
        }
      } catch (e) {
        console.error(
          "[ZenStack] Error parsing response for Elasticsearch sync:",
          e
        );
      }
    }

    // Manually trigger Elasticsearch sync for sharedStepGroups mutations
    if (
      response.ok &&
      parsedPath &&
      parsedPath.model === "sharedStepGroups" &&
      isMutation
    ) {
      try {
        const result = responseBody ? JSON.parse(responseBody) : null;
        const data = result?.data;

        if (data?.id) {
          syncSharedStepToElasticsearch(data.id, tenantId).catch(
            (error: any) => {
              console.error(
                `Failed to sync shared step ${data.id} to Elasticsearch:`,
                error
              );
            }
          );
        }
      } catch (e) {
        console.error(
          "[ZenStack] Error parsing response for Elasticsearch sync:",
          e
        );
      }
    }

    // Manually trigger Elasticsearch sync for issues mutations
    if (
      response.ok &&
      parsedPath &&
      parsedPath.model === "issues" &&
      isMutation
    ) {
      try {
        const result = responseBody ? JSON.parse(responseBody) : null;
        const data = result?.data;

        if (data?.id) {
          syncIssueToElasticsearch(data.id, undefined, tenantId).catch(
            (error: any) => {
              console.error(
                `Failed to sync issue ${data.id} to Elasticsearch:`,
                error
              );
            }
          );
        }
      } catch (e) {
        console.error(
          "[ZenStack] Error parsing response for Elasticsearch sync:",
          e
        );
      }
    }

    // Manually trigger Elasticsearch sync for milestones mutations
    if (
      response.ok &&
      parsedPath &&
      parsedPath.model === "milestones" &&
      isMutation
    ) {
      try {
        const result = responseBody ? JSON.parse(responseBody) : null;
        const data = result?.data;

        if (data?.id) {
          syncMilestoneToElasticsearch(data.id, tenantId).catch(
            (error: any) => {
              console.error(
                `Failed to sync milestone ${data.id} to Elasticsearch:`,
                error
              );
            }
          );
        }
      } catch (e) {
        console.error(
          "[ZenStack] Error parsing response for Elasticsearch sync:",
          e
        );
      }
    }

    // Manually trigger Elasticsearch sync for projects mutations
    if (
      response.ok &&
      parsedPath &&
      parsedPath.model === "projects" &&
      isMutation
    ) {
      try {
        const result = responseBody ? JSON.parse(responseBody) : null;
        const data = result?.data;

        if (data?.id) {
          syncProjectToElasticsearch(data.id, tenantId).catch((error: any) => {
            console.error(
              `Failed to sync project ${data.id} to Elasticsearch:`,
              error
            );
          });
        }
      } catch (e) {
        console.error(
          "[ZenStack] Error parsing response for Elasticsearch sync:",
          e
        );
      }
    }

    // Manually trigger Elasticsearch sync for steps mutations
    // When a step is updated, we need to resync the parent repository case
    if (
      response.ok &&
      parsedPath &&
      parsedPath.model === "steps" &&
      isMutation
    ) {
      try {
        const result = responseBody ? JSON.parse(responseBody) : null;
        const data = result?.data;

        if (data?.repositoryCaseId) {
          syncRepositoryCaseToElasticsearch(
            data.repositoryCaseId,
            tenantId
          ).catch((error: any) => {
            console.error(
              `Failed to sync repository case ${data.repositoryCaseId} after step update to Elasticsearch:`,
              error
            );
          });
        }
      } catch (e) {
        console.error(
          "[ZenStack] Error parsing response for Elasticsearch sync after step update:",
          e
        );
      }
    }

    // Manually trigger Elasticsearch sync for caseFieldValues mutations
    // When a custom field is updated, we need to resync the parent repository case
    if (
      response.ok &&
      parsedPath &&
      parsedPath.model === "caseFieldValues" &&
      isMutation
    ) {
      try {
        const result = responseBody ? JSON.parse(responseBody) : null;
        const data = result?.data;

        if (data?.repositoryCaseId) {
          syncRepositoryCaseToElasticsearch(
            data.repositoryCaseId,
            tenantId
          ).catch((error: any) => {
            console.error(
              `Failed to sync repository case ${data.repositoryCaseId} after custom field update to Elasticsearch:`,
              error
            );
          });
        }
      } catch (e) {
        console.error(
          "[ZenStack] Error parsing response for Elasticsearch sync after custom field update:",
          e
        );
      }
    }

    // webhook-emit shim. Mirrors the ES-sync shim pattern above:
    // ZenStack's enhance() doesn't preserve $extends middleware reliably for
    // RPC mutations because it injects `select: { id: true }` into args and
    // refetches inside the tx see pre-update state. We emit canonically here
    // using the post-mutation refetch + the pre-mutation snapshot captured
    // before rpcHandler ran. The $extends emission was suppressed via
    // auditContext.suppressWebhooks during the rpc call (D-01a) so this is
    // the only emission seam for UI-driven mutations.
    // $extends emission still fires for direct-prisma callers where
    // suppressWebhooks is false.
    if (
      response.ok &&
      isWebhookEmittingMutation &&
      parsedPath &&
      requestBody !== null
    ) {
      try {
        const result = responseBody ? JSON.parse(responseBody) : null;
        const data = result?.data;
        const entityId =
          (typeof data?.id === "number" || typeof data?.id === "string"
            ? data.id
            : null) ??
          extractEntityIdFromBody(requestBody, parsedPath.operation);

        if (entityId !== null) {
          // Refetch the post-mutation row so we have the FULL set of fields
          // the emitters need (the RPC response may have been narrowed via
          // `select: { id: true }`). For deletes we use the pre-snapshot
          // since the row is gone post-commit.
          const postRow =
            parsedPath.operation === "delete"
              ? null
              : await (prisma as any)[parsedPath.model]
                  .findUnique({ where: { id: entityId } })
                  .catch(() => null);

          // Open our own transaction — webhookEvents.emit requires a tx
          // (Plan 02-02). The atomicity compromise vs Plan 02-05's
          // entity+emit-in-one-tx is documented in Plan 02-08 CONTEXT D-01a:
          // the entity write committed first, the outbox row is emitted in
          // a separate tx that runs in the same request lifecycle. Same
          // post-commit pattern the route uses for ES sync + audit log.
          await prisma.$transaction(async (tx) => {
            switch (parsedPath.model) {
              case "testRuns": {
                if (parsedPath.operation === "create" && postRow) {
                  await emitTestRunCreated(postRow, tx);
                } else if (
                  ["update", "upsert"].includes(parsedPath.operation) &&
                  postRow
                ) {
                  await emitTestRunUpdateEvents(
                    webhookPreSnapshot,
                    postRow,
                    tx
                  );
                }
                break;
              }
              case "sessions": {
                if (parsedPath.operation === "create" && postRow) {
                  await emitSessionCreated(postRow, tx);
                } else if (
                  ["update", "upsert"].includes(parsedPath.operation) &&
                  postRow
                ) {
                  await emitSessionUpdateEvents(
                    webhookPreSnapshot,
                    postRow,
                    tx
                  );
                }
                break;
              }
              case "issue": {
                if (parsedPath.operation === "create" && postRow) {
                  await emitIssueCreated(postRow, tx);
                } else if (
                  ["update", "upsert"].includes(parsedPath.operation) &&
                  postRow
                ) {
                  await emitIssueUpdated(webhookPreSnapshot, postRow, tx);
                } else if (
                  parsedPath.operation === "delete" &&
                  webhookPreSnapshot
                ) {
                  await emitIssueDeleted(webhookPreSnapshot, tx);
                }
                break;
              }
              case "repositoryCases": {
                if (parsedPath.operation === "create" && postRow) {
                  await emitCaseCreated(postRow, tx);
                } else if (
                  ["update", "upsert"].includes(parsedPath.operation) &&
                  postRow
                ) {
                  await emitCaseUpdated(webhookPreSnapshot, postRow, tx);
                } else if (
                  parsedPath.operation === "delete" &&
                  webhookPreSnapshot
                ) {
                  await emitCaseDeleted(webhookPreSnapshot, tx);
                }
                break;
              }
              case "testRunResults": {
                if (parsedPath.operation === "create" && postRow) {
                  await emitTestRunResultAdded(postRow, tx);
                }
                break;
              }
              case "sessionResults": {
                if (parsedPath.operation === "create" && postRow) {
                  await emitSessionResultAdded(postRow, tx);
                }
                break;
              }
            }
          });
        }
      } catch (e) {
        // Best-effort, like the ES-sync shims. Logged but never bubbled up
        // since the entity write already committed.
        console.error("[Webhooks] Error emitting outbox event from shim:", e);
      }
    }

    // Prevent caching of API responses - this is critical to avoid stale 410/error responses
    newResponse.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    newResponse.headers.set("Pragma", "no-cache");
    newResponse.headers.set("Expires", "0");

    // Audit logging for successful mutations
    if (
      isMutation &&
      response.ok &&
      parsedPath &&
      AUDITED_ENTITIES.has(parsedPath.model)
    ) {
      const auditAction = getAuditAction(parsedPath.operation);

      if (auditAction) {
        try {
          const result = responseBody ? JSON.parse(responseBody) : null;
          const data = result?.data;

          if (data) {
            const entityId =
              data.id || data.key || `${parsedPath.operation}-${Date.now()}`;
            const entityName = extractEntityName(parsedPath.model, data);
            const projectId = data.projectId;

            // Map model names to proper entity types for display
            const entityTypeMap: Record<string, string> = {
              repositoryCases: "RepositoryCases",
              testRuns: "TestRuns",
              sessions: "Sessions",
              sharedStepGroups: "SharedStepGroup",
              issues: "Issue",
              milestones: "Milestones",
              projects: "Projects",
              user: "User",
              userProjectPermission: "UserProjectPermission",
              groupProjectPermission: "GroupProjectPermission",
              ssoProvider: "SsoProvider",
              allowedEmailDomain: "AllowedEmailDomain",
              appConfig: "AppConfig",
              userIntegrationAuth: "UserIntegrationAuth",
              testRunResults: "TestRunResult",
              comment: "Comment",
              attachment: "Attachment",
              apiToken: "ApiToken",
              reviewRequest: "ReviewRequest",
              ...CONFIG_ENTITY_TYPE_BY_ACCESSOR,
            };

            // Special handling for API token operations - use specific audit actions
            let finalAuditAction = auditAction;
            if (parsedPath.model === "apiToken") {
              if (parsedPath.operation === "create") {
                finalAuditAction = "API_KEY_CREATED";
              } else if (parsedPath.operation === "delete") {
                finalAuditAction = "API_KEY_DELETED";
              } else if (parsedPath.operation === "update") {
                // Check if this is a revocation (isActive changed to false)
                const updateData = requestBody?.data;
                if (updateData?.isActive === false) {
                  finalAuditAction = "API_KEY_REVOKED";
                }
              }
            }

            // ReviewRequest cancel — the only review status mutation routed
            // through the auto-API. The request / decide paths emit their
            // own audit events from the server action and service layer; the
            // cancel path hits this route as a generic ReviewRequest UPDATE,
            // so we promote it to REVIEW_CANCELLED when the payload sets
            // status to CANCELLED. Other ReviewRequest updates fall through
            // to the default UPDATE action — none ship today (status is the
            // only writable field) but the fall-through keeps the rule
            // safe under future schema additions.
            if (
              parsedPath.model === "reviewRequest" &&
              parsedPath.operation === "update" &&
              requestBody?.data?.status === "CANCELLED"
            ) {
              finalAuditAction = "REVIEW_CANCELLED";
            }

            // Before/after capture (best-effort; never breaks the response).
            // For an update, re-read the row (the RPC response is often a
            // partial `{ id }`) and diff it against the pre-snapshot. For a
            // delete, diff the removed row against null. `calculateDiff` masks
            // sensitive fields and skips timestamp churn.
            let auditChanges: AuditEvent["changes"];
            try {
              if (parsedPath.operation === "update" && auditPreSnapshot) {
                const afterRow = requestBody?.where
                  ? await (prisma as any)[parsedPath.model].findUnique({
                      where: requestBody.where,
                    })
                  : null;
                auditChanges = calculateDiff(auditPreSnapshot, afterRow);
              } else if (
                parsedPath.operation === "delete" &&
                auditPreSnapshot
              ) {
                auditChanges = calculateDiff(auditPreSnapshot, null);
              }
            } catch (e) {
              console.error("[AuditLog] Failed to compute before/after:", e);
            }

            const event: AuditEvent = {
              action: finalAuditAction,
              entityType: entityTypeMap[parsedPath.model] || parsedPath.model,
              entityId: String(entityId),
              entityName,
              ...(auditChanges ? { changes: auditChanges } : {}),
              projectId: typeof projectId === "number" ? projectId : undefined,
              metadata: {
                operation: parsedPath.operation,
                ...(auditAction.startsWith("BULK_") && data.count
                  ? { count: data.count }
                  : {}),
                // Add API token specific metadata
                ...(parsedPath.model === "apiToken"
                  ? {
                      tokenPrefix: data.tokenPrefix,
                      tokenOwnerId: data.userId,
                    }
                  : {}),
              },
            };

            // Awaiting ensures the event is enqueued before the response ships,
            // which Next.js would otherwise drop via floating-promise handling.
            await captureAuditEvent(event);
          }
        } catch (e) {
          // Don't let audit logging errors affect the response
          console.error("[AuditLog] Error parsing response for audit:", e);
        }
      }
    }

    return newResponse;
  });
}

export const GET = withAuditContext(innerHandler);
export const POST = withAuditContext(innerHandler);
export const PUT = withAuditContext(innerHandler);
export const PATCH = withAuditContext(innerHandler);
export const DELETE = withAuditContext(innerHandler);
