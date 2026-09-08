import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import type { QuickScriptCaseData } from "~/lib/services/quickscript-generation";
import {
  streamQuickScript,
  type QuickScriptGenerationInput,
} from "~/lib/services/quickscript-generation";
import { authOptions } from "~/server/auth";

interface SingleExportBody {
  mode: "single";
  caseId: number;
  projectId: number;
  templateId: number;
  caseData: QuickScriptCaseData;
}

interface BatchExportBody {
  mode: "batch";
  caseIds: number[];
  projectId: number;
  templateId: number;
  cases: QuickScriptCaseData[];
}

type ExportStreamBody = SingleExportBody | BatchExportBody;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as ExportStreamBody;

  const input: QuickScriptGenerationInput =
    body.mode === "single"
      ? {
          projectId: body.projectId,
          templateId: body.templateId,
          cases: [body.caseData],
          userId: session.user.id,
          mode: "single",
        }
      : {
          projectId: body.projectId,
          templateId: body.templateId,
          cases: body.cases,
          userId: session.user.id,
          mode: "batch",
        };

  const encoder = new TextEncoder();
  let controllerClosed = false;

  function send(
    controller: ReadableStreamDefaultController,
    data: object
  ): void {
    if (controllerClosed) return;
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      controllerClosed = true;
    }
  }

  /** Send an SSE comment to keep the connection alive through reverse proxies. */
  function keepAlive(controller: ReadableStreamDefaultController): void {
    if (controllerClosed) return;
    try {
      controller.enqueue(encoder.encode(": keepalive\n\n"));
    } catch {
      controllerClosed = true;
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      // Periodic keepalive comments so reverse proxies don't 504 us while we
      // resolve prompts, fetch code context, and wait for the first LLM token.
      const heartbeat = setInterval(() => keepAlive(controller), 15_000);
      try {
        // Immediate keepalive so the proxy sees bytes right away.
        keepAlive(controller);
        for await (const event of streamQuickScript(input)) {
          send(controller, event);
        }
      } catch (err) {
        console.error("[export/ai-stream] Setup failed:", err);
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
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
