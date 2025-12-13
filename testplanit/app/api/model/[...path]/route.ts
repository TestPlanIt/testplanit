import { enhance } from "@zenstackhq/runtime";
import { NextRequestHandler } from "@zenstackhq/server/next";
import { getServerAuthSession } from "~/server/auth";
import { authenticateApiToken, extractBearerToken } from "~/lib/api-token-auth";
import { prisma } from "~/lib/prisma";
import {
  setAuditContext,
  getAuditContext,
  extractIpAddress,
} from "~/lib/auditContext";
import { captureAuditEvent, type AuditEvent } from "~/lib/services/auditLog";
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import type { AuditAction } from "@prisma/client";

// Store API token auth result in async local storage for getPrisma
let currentApiAuth: { userId: string; email?: string; name?: string } | null = null;

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
};

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

  // If no session, check for API token auth result stored from handler
  if (!userId && currentApiAuth) {
    userId = currentApiAuth.userId;
    userEmail = currentApiAuth.email;
    userName = currentApiAuth.name;
  }

  // Set audit context for this request
  const headersList = await headers();
  setAuditContext({
    userId: userId,
    userEmail: userEmail,
    userName: userName,
    ipAddress: extractIpAddress(headersList as unknown as Headers),
    userAgent: headersList.get("user-agent") || undefined,
  });

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

// Wrapper to add cache-control headers, API token auth, and audit logging
async function handler(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  // Check for API token authentication if no session
  const session = await getServerAuthSession();
  if (!session?.user) {
    // Check if there's a Bearer token
    const token = extractBearerToken(req);
    if (token) {
      const apiAuth = await authenticateApiToken(req);
      if (!apiAuth.authenticated) {
        return NextResponse.json(
          { error: apiAuth.error, code: apiAuth.errorCode },
          { status: 401 }
        );
      }
      // Store auth info for getPrisma to use
      currentApiAuth = {
        userId: apiAuth.userId!,
      };
      // Look up user info for audit context
      const user = await prisma.user.findUnique({
        where: { id: apiAuth.userId },
        select: { email: true, name: true },
      });
      if (user) {
        currentApiAuth.email = user.email ?? undefined;
        currentApiAuth.name = user.name ?? undefined;
      }
    }
  }

  try {
    const params = await context.params;
    const parsedPath = parseZenStackPath(params.path);
    const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);

    // Get the authenticated user ID (from session or API token)
    const authenticatedUserId = session?.user?.id ?? currentApiAuth?.userId;

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
      } catch (e) {
        // Ignore body parsing errors
      }
    }

    const response = await baseHandler(modifiedReq, { params: Promise.resolve(params) });

    // Clone the response to add headers (NextResponse is immutable)
    const responseBody = await response.clone().text();
    const newResponse = new NextResponse(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });

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

            // Capture audit event asynchronously (don't block response)
            captureAuditEvent(event).catch((error) => {
              console.error("[AuditLog] Failed to capture audit event:", error);
            });
          }
        } catch (e) {
          // Don't let audit logging errors affect the response
          console.error("[AuditLog] Error parsing response for audit:", e);
        }
      }
    }

    return newResponse;
  } finally {
    // Clear the API auth context
    currentApiAuth = null;
  }
}

export {
  handler as DELETE,
  handler as GET,
  handler as PATCH,
  handler as POST,
  handler as PUT,
};
