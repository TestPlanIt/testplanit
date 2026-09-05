import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import {
  authenticateApiTokenForMethod,
  extractBearerToken,
} from "~/lib/api-token-auth";
import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { updateAuditContext } from "~/lib/auditContext";
import {
  enrichFromApiAuth,
  withAuditContext,
} from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { buildProjectAccessWhere } from "~/lib/project-access";
import { createTestCaseVersionInTransaction } from "~/lib/services/testCaseVersionService";
import { authOptions } from "~/server/auth";

/**
 * Centralized endpoint for creating test case versions.
 * This ensures consistent version creation across all parts of the application:
 * - Manual case creation/editing
 * - Bulk edits
 * - Imports (CSV/XML/JSON)
 * - External integrations (Testmo, etc.)
 * - LLM-generated cases
 * - API / MCP clients (Bearer token, `mode:write`)
 *
 * IMPORTANT: This endpoint creates a version snapshot of the test case's CURRENT state.
 * The caller is responsible for updating RepositoryCases.currentVersion BEFORE calling this endpoint,
 * OR for asking this endpoint to do it by passing `bumpVersion: true`.
 * The version number will match the test case's currentVersion field.
 *
 * Workflow:
 * 1. Update RepositoryCases (including incrementing currentVersion if editing)
 * 2. Call this endpoint to create a version snapshot matching that currentVersion
 *
 * The snapshot itself is built by `createTestCaseVersionInTransaction` — the same
 * helper every server-side writer uses — so a version written through this route
 * carries the same fields (attachments, parameters) as one written by an import
 * or a bulk edit.
 */

const createVersionSchema = z.object({
  // Optional: explicit version number (for imports that want to preserve versions)
  // If not provided, will use the test case's currentVersion
  version: z.number().int().positive().optional(),

  // Increment RepositoryCases.currentVersion first, then snapshot at the new
  // number — both inside one transaction. Lets a client that just edited a
  // case record the edit without a separate write and without racing another
  // writer between the two statements. Mutually exclusive with `version`.
  bumpVersion: z.boolean().optional(),

  // Copy the case's CaseFieldValues onto the version as CaseFieldVersionValues.
  // The in-app save path writes those rows itself after this call, so this
  // stays opt-in; API clients that don't should set it, otherwise the version
  // renders as though every custom field were empty.
  copyFieldValues: z.boolean().optional(),

  // Optional: override creator metadata (for imports)
  creatorId: z.string().optional(),
  creatorName: z.string().optional(),
  createdAt: z.string().datetime().optional(),

  // Optional: data to override in the version
  // If not provided, will copy from current test case
  overrides: z
    .object({
      name: z.string().min(1).optional(),
      stateId: z.number().int().optional(),
      stateName: z.string().optional(),
      automated: z.boolean().optional(),
      estimate: z.number().int().nullable().optional(),
      forecastManual: z.number().int().nullable().optional(),
      forecastAutomated: z.number().nullable().optional(),
      steps: z.any().optional(), // JSON field
      tags: z.array(z.string()).optional(), // Array of tag names
      issues: z
        .array(
          z.object({
            id: z.number().int(),
            name: z.string(),
            externalId: z.string().nullish(),
          })
        )
        .optional(),
      attachments: z.any().optional(), // JSON field
      links: z.any().optional(), // JSON field
      isArchived: z.boolean().optional(),
      order: z.number().int().optional(),
    })
    .optional(),
});

type _CreateVersionRequest = z.infer<typeof createVersionSchema>;

export const POST = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ caseId: string }> }
  ) => {
    try {
      // ── Authentication (session, else API token) ──────────────────────────
      // Same ladder as the bulk-create sibling: a browser session first, then
      // a Bearer token whose `mode:read` scope is enforced against this write
      // method. Without the token branch an API client could change a case
      // (through /api/model) but never record the version for it — see #598.
      const session = await getServerSession(authOptions);
      let userId: string | undefined = session?.user?.id;
      let userName: string | undefined = session?.user?.name ?? undefined;
      let userEmail: string | undefined = session?.user?.email ?? undefined;
      let userAccess: string | null | undefined = session?.user?.access;

      if (userId) {
        updateAuditContext({ userId });
      } else {
        const token = extractBearerToken(request);
        if (!token) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const apiAuth = await authenticateApiTokenForMethod(request);
        if (!apiAuth.authenticated) {
          const status = apiAuth.errorCode === "READ_ONLY_TOKEN" ? 403 : 401;
          return NextResponse.json(
            { error: apiAuth.error, code: apiAuth.errorCode },
            { status }
          );
        }
        userId = apiAuth.userId;
        userAccess = apiAuth.access;
        userName = apiAuth.userName;
        userEmail = apiAuth.userEmail;
        enrichFromApiAuth({
          userId: userId!,
          userEmail,
          userName,
          scopes: apiAuth.scopes,
        });
      }

      if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { caseId: caseIdParam } = await params;
      const caseId = parseInt(caseIdParam);
      if (isNaN(caseId)) {
        return NextResponse.json({ error: "Invalid case ID" }, { status: 400 });
      }

      const body = await request.json();
      const validatedData = createVersionSchema.parse(body);

      if (validatedData.bumpVersion && validatedData.version !== undefined) {
        return NextResponse.json(
          {
            error:
              "Pass either `version` or `bumpVersion`, not both — `bumpVersion` derives the number from the case.",
          },
          { status: 400 }
        );
      }

      const testCase = await baseDb.repositoryCases.findUnique({
        where: { id: caseId },
        select: { id: true, projectId: true },
      });

      if (!testCase) {
        return NextResponse.json(
          { error: "Test case not found" },
          { status: 404 }
        );
      }

      // ── Project access (identical policy to the bulk-create sibling) ──────
      const project = await baseDb.projects.findFirst({
        where: buildProjectAccessWhere(
          testCase.projectId,
          userId,
          userAccess === "ADMIN",
          userAccess === "PROJECTADMIN"
        ),
        select: { id: true },
      });
      if (!project) {
        return NextResponse.json(
          { error: "Test case not found" },
          { status: 404 }
        );
      }

      const result = await auditedTransaction(async (tx) => {
        // `bumpVersion` moves the case forward first so the snapshot the
        // helper writes matches the case's new currentVersion. Reading the
        // incremented value back from the update keeps two concurrent bumps
        // from landing on the same number.
        let versionNumber = validatedData.version;
        if (validatedData.bumpVersion) {
          const bumped = await tx.repositoryCases.update({
            where: { id: caseId },
            data: { currentVersion: { increment: 1 } },
            select: { currentVersion: true },
          });
          versionNumber = bumped.currentVersion;
        }

        // `creatorName` is @length(1) on the model, so an anonymous-ish actor
        // (a token whose user has no name and no email) must fall through to
        // the helper's own default — the case's creator — rather than write "".
        const creatorName =
          validatedData.creatorName || userName || userEmail || undefined;

        return createTestCaseVersionInTransaction(tx, caseId, {
          ...(versionNumber !== undefined ? { version: versionNumber } : {}),
          creatorId: validatedData.creatorId ?? userId,
          ...(creatorName !== undefined ? { creatorName } : {}),
          createdAt: validatedData.createdAt
            ? new Date(validatedData.createdAt)
            : new Date(),
          copyFieldValues: validatedData.copyFieldValues ?? false,
          overrides: validatedData.overrides,
        });
      });

      return NextResponse.json({
        success: true,
        version: result,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: "Invalid request data", details: error.issues },
          { status: 400 }
        );
      }

      console.error("Error creating test case version:", error);
      return NextResponse.json(
        {
          error: "Failed to create test case version",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 }
      );
    }
  }
);
