import type { AuditAction } from "@prisma/client";
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
import { captureAuditEvent, type AuditEvent } from "~/lib/services/auditLog";
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

function extractEntityIdFromBody(body: any): number | string | null {
  if (!body) return null;
  const candidate =
    body?.data?.where?.id ?? body?.where?.id ?? body?.data?.id ?? null;
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
  "testRunResult",
  "comment",
  "attachment",
  "apiToken",
]);

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
  };

  const field = nameFields[entityType];
  if (!field) return undefined;

  if (Array.isArray(field)) {
    return field
      .map((f) => result[f])
      .filter(Boolean)
      .join(":");
  }

  return result[field];
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

    // Plan 02-08 webhook-emit shim — pre-mutation snapshot capture.
    // For UPDATE / UPSERT / DELETE on emission-eligible models we need the
    // pre-mutation row state to compute state-transition diffs and pass
    // oldRow into the testRun/session/issue/case emitters. Captured BEFORE
    // the rpcHandler runs so it's not affected by transaction isolation.
    // The post-mutation `lib/prisma.ts` `$extends` middleware emission is
    // suppressed via auditContext.suppressWebhooks (Plan 02-02 D-01a) to
    // prevent double-emission; this shim is the canonical RPC-path emitter.
    let webhookPreSnapshot: any = null;
    const isWebhookEmittingMutation =
      isMutation &&
      parsedPath !== null &&
      WEBHOOK_EMIT_MODELS.has(parsedPath.model);
    if (
      isWebhookEmittingMutation &&
      ["update", "upsert", "delete"].includes(parsedPath!.operation)
    ) {
      try {
        const whereId = extractEntityIdFromBody(requestBody);
        if (whereId !== null) {
          webhookPreSnapshot = await (prisma as any)[
            parsedPath!.model
          ].findUnique({ where: { id: whereId } });
        }
      } catch (e) {
        console.error("[Webhooks] Failed to capture pre-snapshot:", e);
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
    let response = await runWithAuditContext(
      { ...parentAuditCtx, suppressWebhooks: true },
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
            : null) ?? extractEntityIdFromBody(requestBody);

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
              testRunResult: "TestRunResult",
              comment: "Comment",
              attachment: "Attachment",
              apiToken: "ApiToken",
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

            const event: AuditEvent = {
              action: finalAuditAction,
              entityType: entityTypeMap[parsedPath.model] || parsedPath.model,
              entityId: String(entityId),
              entityName,
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
