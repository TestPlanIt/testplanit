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

    // Clone the request body for audit logging (only for mutations)
    let requestBody: any = null;
    if (isMutation && parsedPath && AUDITED_ENTITIES.has(parsedPath.model)) {
      try {
        const clonedReq = req.clone();
        const text = await clonedReq.text();
        if (text) {
          requestBody = JSON.parse(text);
        }
      } catch (e) {
        // Ignore body parsing errors
      }
    }

    const response = await baseHandler(req, { params: Promise.resolve(params) });

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
            };

            const event: AuditEvent = {
              action: auditAction,
              entityType: entityTypeMap[parsedPath.model] || parsedPath.model,
              entityId: String(entityId),
              entityName,
              projectId: typeof projectId === "number" ? projectId : undefined,
              metadata: {
                operation: parsedPath.operation,
                ...(auditAction.startsWith("BULK_") && data.count
                  ? { count: data.count }
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
