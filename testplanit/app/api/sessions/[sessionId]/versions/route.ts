import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { authenticateRequest } from "~/lib/api-token-auth";
import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { updateAuditContext } from "~/lib/auditContext";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { buildProjectAccessWhere } from "~/lib/project-access";
import { userCanAddEditArea } from "~/lib/services/projectPermissions";
import { createSessionVersionInTransaction } from "~/lib/services/sessionVersionService";
import { authOptions } from "~/server/auth";
import { ApplicationArea } from "~/zenstack/models";

const createVersionSchema = z.object({
  // Increment Sessions.currentVersion and snapshot at the new number, in one
  // transaction. Omit it to snapshot the current version (a new session).
  bumpVersion: z.boolean().optional(),
});

/**
 * POST /api/sessions/[sessionId]/versions
 *
 * Record a SessionVersions snapshot of the session as it now stands. The web
 * UI writes these from the browser on create, edit and complete; this lets
 * API clients (the MCP server) leave the same history. Accepts a browser
 * session or an API token, and requires add/edit on sessions.
 */
export const POST = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
  ) => {
    try {
      const auth = await authenticateRequest(
        request,
        await getServerSession(authOptions)
      );
      if (!auth.authenticated) {
        return NextResponse.json(
          { error: auth.error, code: auth.errorCode },
          { status: auth.status }
        );
      }
      const userId = auth.user.userId;
      updateAuditContext({ userId });

      const { sessionId: param } = await params;
      const sessionId = Number.parseInt(param, 10);
      if (Number.isNaN(sessionId)) {
        return NextResponse.json(
          { error: "Invalid session ID" },
          { status: 400 }
        );
      }

      const body = await request.json().catch(() => ({}));
      const input = createVersionSchema.parse(body ?? {});

      const target = await baseDb.sessions.findFirst({
        where: { id: sessionId, isDeleted: false },
        select: { projectId: true },
      });
      const visible =
        target &&
        (await baseDb.projects.findFirst({
          where: buildProjectAccessWhere(
            target.projectId,
            userId,
            auth.user.access === "ADMIN",
            auth.user.access === "PROJECTADMIN"
          ),
          select: { id: true },
        }));
      if (!target || !visible) {
        return NextResponse.json(
          { error: "Session not found" },
          { status: 404 }
        );
      }
      if (
        !(await userCanAddEditArea(
          userId,
          target.projectId,
          ApplicationArea.Sessions,
          auth.user.access
        ))
      ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const actor = await baseDb.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      });
      const version = await auditedTransaction((tx) =>
        createSessionVersionInTransaction(tx, sessionId, {
          bumpVersion: input.bumpVersion,
          actor: { id: userId, name: actor?.name || actor?.email },
        })
      );

      return NextResponse.json({ success: true, version });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: "Invalid request data", details: error.issues },
          { status: 400 }
        );
      }
      console.error("Error creating session version:", error);
      return NextResponse.json(
        { error: "Failed to create session version" },
        { status: 500 }
      );
    }
  }
);
