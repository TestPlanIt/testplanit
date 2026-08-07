/**
 * Server-Sent Events stream for live updates on EVERY milestone in a
 * single project. One EventSource per project, regardless of how many
 * milestones are being tracked/synced.
 *
 * Backs the milestones list page and the import picker (D-15: all
 * milestone list/picker surfaces share this one project-scoped stream).
 * Without this the list page would open one EventSource per milestone
 * card; with the browser's HTTP/1.1 6-connection-per-origin cap, a
 * project with many milestones starves the page document and child
 * requests of connection slots and the page hangs — the exact failure
 * the Test Runs pattern was built to solve (D-14 hard constraint).
 *
 * The per-milestone endpoint at `/api/milestones/[milestoneId]/stream`
 * still exists for the detail page (1 page -> 1 EventSource -> no fan-in
 * complexity). Publishers fan out each wake-up to both channels so
 * either consumer pattern works.
 *
 * Modeled on `/api/projects/[projectId]/test-runs/stream` — the pub/sub
 * layer is untrusted plumbing (Architectural Directive 2) and
 * authorization happens on the consumer's refetch path, not here.
 * Project membership IS gated server-side at subscribe time so a
 * cross-project subscribe attempt 404s instead of leaking wake-ups for
 * milestones the user can't see.
 */

import { getAuthDb } from "~/lib/zenstack";
import IORedis from "ioredis";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { milestoneProjectChannel } from "~/lib/live/channels";
import { getCurrentTenantId } from "~/lib/multiTenantDb";
import { baseDb } from "~/lib/db";
import { createSubscriberClient } from "~/lib/valkey";
import { authOptions } from "~/server/auth";

const HEARTBEAT_MS = 25_000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId: projectIdParam } = await params;
  const projectId = Number.parseInt(projectIdParam, 10);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Project-access gate (single read through the enhanced client so the
  // ZenStack policy applies — admins get cross-project, everyone else is
  // checked against project membership). If the user can't read the
  // project, they shouldn't be told it exists, so we 404 (not 403).
  const userRecord = await baseDb.user.findUnique({
    where: { id: session.user.id },
    include: { role: { include: { rolePermissions: true } } },
  });
  if (!userRecord) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }
  const reader =
    userRecord.access === "ADMIN"
      ? (baseDb as unknown as typeof baseDb)
      : ((await getAuthDb(userRecord)) as unknown as typeof baseDb);
  const accessibleProject = await reader.projects.findFirst({
    where: { id: projectId, isDeleted: false },
    select: { id: true },
  });
  if (!accessibleProject) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const tenantId = getCurrentTenantId() ?? "default";
  const channel = milestoneProjectChannel(tenantId, projectId);

  const subscriber: IORedis | null = createSubscriberClient();
  if (!subscriber) {
    // No Valkey wired (e.g. local dev with SKIP_VALKEY_CONNECTION). Fail
    // closed with a Retry-After so the EventSource client backs off
    // rather than hot-looping.
    return new NextResponse(null, {
      status: 503,
      headers: { "Retry-After": "30" },
    });
  }

  const encoder = new TextEncoder();
  let controllerClosed = false;
  let lastEventAt = Date.now();
  let heartbeatInterval: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      function write(bytes: Uint8Array) {
        if (controllerClosed) return;
        try {
          controller.enqueue(bytes);
        } catch {
          controllerClosed = true;
        }
      }
      function sendEvent(payload: object) {
        write(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        lastEventAt = Date.now();
      }
      function sendComment(line: string) {
        write(encoder.encode(`${line}\n\n`));
      }

      subscriber.on("message", (_channel, message) => {
        if (controllerClosed) return;
        // Publisher already serializes the payload as JSON; relay verbatim.
        // The payload contains milestoneId so the client can route the
        // wake-up to the right query invalidations.
        write(encoder.encode(`data: ${message}\n\n`));
        lastEventAt = Date.now();
      });

      try {
        await subscriber.subscribe(channel);
      } catch (subErr) {
        console.warn(`[sse/project-milestones] subscribe failed`, {
          channel,
          projectId,
          error: subErr instanceof Error ? subErr.message : String(subErr),
        });
        try {
          await subscriber.quit();
        } catch {
          /* swallow */
        }
        controllerClosed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        return;
      }

      // First byte after subscribe completes so clients know the live
      // window has opened.
      sendEvent({ event: "sync" });

      // Gated heartbeat — proxies (nginx default 60s, load balancers
      // similar) kill idle connections, so we keep one open with a tiny
      // SSE comment if no real event has flowed in the last 25s.
      heartbeatInterval = setInterval(() => {
        if (Date.now() - lastEventAt >= HEARTBEAT_MS) {
          sendComment(": ping");
        }
      }, HEARTBEAT_MS);
    },

    async cancel() {
      await cleanup();
    },
  });

  async function cleanup() {
    controllerClosed = true;
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    try {
      await subscriber?.unsubscribe();
    } catch {
      /* swallow */
    }
    try {
      await subscriber?.quit();
    } catch {
      /* swallow */
    }
  }

  req.signal.addEventListener("abort", () => {
    void cleanup();
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tells nginx not to buffer the response (it would defeat SSE).
      "X-Accel-Buffering": "no",
    },
  });
}
