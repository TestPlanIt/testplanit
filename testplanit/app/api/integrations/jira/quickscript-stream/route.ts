import { NextRequest, NextResponse } from "next/server";
import { baseDb } from "@/lib/db";
import {
  FORGE_CORS_HEADERS,
  forgeUserHasProjectAccess,
  verifyForgeStreamToken,
} from "@/lib/services/forge-jira-auth";
import { casesBelongToProject } from "@/lib/services/jira-panel-quickscript";
import {
  fetchQuickScriptCases,
  getQuickScriptReadiness,
  resolveQuickScriptTemplate,
  streamQuickScript,
} from "@/lib/services/quickscript-generation";

/**
 * Token-authenticated streaming QuickScript generation for the Jira panel. The
 * browser calls this directly (bypassing Forge's 25s function limit). Auth is
 * the short-lived token minted by `quickscript-token` (bound to
 * user/integration/project/issue). The script is streamed as `chunk`/`done`/
 * `fallback`/`error` SSE events — the same contract the in-app modal consumes.
 */
export async function POST(req: NextRequest) {
  const payload = verifyForgeStreamToken(req.headers.get("X-Forge-Token"));
  if (!payload) {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401, headers: FORGE_CORS_HEADERS }
    );
  }

  const user = await baseDb.user.findFirst({
    where: { id: payload.userId, isActive: true, isDeleted: false },
    select: { id: true, name: true, email: true, access: true },
  });
  if (!user || !(await forgeUserHasProjectAccess(user, payload.projectId))) {
    return NextResponse.json(
      { error: "Access denied" },
      { status: 403, headers: FORGE_CORS_HEADERS }
    );
  }

  let body: { templateId?: number; caseIds?: number[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400, headers: FORGE_CORS_HEADERS }
    );
  }

  const { templateId, caseIds } = body;
  if (!Array.isArray(caseIds) || caseIds.length === 0) {
    return NextResponse.json(
      { error: "caseIds is required" },
      { status: 400, headers: FORGE_CORS_HEADERS }
    );
  }

  const { projectId } = payload;
  const encoder = new TextEncoder();
  let controllerClosed = false;

  const send = (
    controller: ReadableStreamDefaultController,
    data: object
  ): void => {
    if (controllerClosed) return;
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      controllerClosed = true;
    }
  };
  const keepAlive = (controller: ReadableStreamDefaultController): void => {
    if (controllerClosed) return;
    try {
      controller.enqueue(encoder.encode(": keepalive\n\n"));
    } catch {
      controllerClosed = true;
    }
  };

  const stream = new ReadableStream({
    async start(controller) {
      const heartbeat = setInterval(() => keepAlive(controller), 15_000);
      try {
        keepAlive(controller);

        const readiness = await getQuickScriptReadiness(projectId);
        if (!readiness.quickScriptEnabled) {
          send(controller, {
            type: "error",
            message: "QuickScript is not enabled for this project",
          });
          return;
        }

        if (!(await casesBelongToProject(caseIds, projectId))) {
          send(controller, {
            type: "error",
            message: "One or more cases are not available in this project",
          });
          return;
        }

        const template = await resolveQuickScriptTemplate(
          projectId,
          templateId
        );
        if (!template) {
          send(controller, {
            type: "error",
            message: templateId
              ? "Template is not available for this project"
              : "No export template is available for this project",
          });
          return;
        }

        const cases = await fetchQuickScriptCases(projectId, caseIds);
        if (cases.length === 0) {
          send(controller, {
            type: "error",
            message: "No matching test cases found",
          });
          return;
        }

        for await (const event of streamQuickScript({
          projectId,
          templateId: template.id,
          cases,
          userId: user.id,
          mode: cases.length === 1 ? "single" : "batch",
        })) {
          send(controller, event);
        }
      } catch (err) {
        send(controller, {
          type: "error",
          message: err instanceof Error ? err.message : "Internal server error",
        });
      } finally {
        clearInterval(heartbeat);
        if (!controllerClosed) {
          controllerClosed = true;
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...FORGE_CORS_HEADERS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: FORGE_CORS_HEADERS });
}
