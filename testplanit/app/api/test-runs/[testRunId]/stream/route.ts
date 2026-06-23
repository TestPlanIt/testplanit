/**
 * Server-Sent Events stream for live updates on a single test run.
 *
 * Replaces the 30s polling in `components/TestRunCasesSummary.tsx` and
 * powers active execution status badges in the case list. Modeled on
 * `/api/notifications/stream` — the pub/sub layer is untrusted plumbing
 * (Architectural Directive 2) and the consumer's authorization is the
 * `useFindManyTestRunResults` / summary refetch path triggered by the
 * wake-up.
 *
 * Subscribers receive one event per change:
 *
 *     data: {"event":"test_run.result_added","runId":42,"targetId":7891}
 *     data: {"event":"test_run.state_changed","runId":42}
 *     data: {"event":"test_run.completed","runId":42}
 *
 * Plus a `data: {"event":"sync"}` checkpoint right after the subscribe
 * completes so clients know they're now live.
 */

import { getAuthDb } from "~/lib/zenstack";
import IORedis from "ioredis";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { testRunChannel } from "~/lib/live/channels";
import { getCurrentTenantId } from "~/lib/multiTenantPrisma";
import { prisma } from "~/lib/prisma";
import { createSubscriberClient } from "~/lib/valkey";
import { authOptions } from "~/server/auth";

// Long-lived stream + IORedis pub/sub require the Node.js runtime; opt out
// of every Next.js prerender path.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ testRunId: string }> }
) {
  const { testRunId } = await params;
  const runId = Number.parseInt(testRunId, 10);
  if (!Number.isInteger(runId) || runId <= 0) {
    return NextResponse.json({ error: "Invalid test run id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Project-access gate (single read through the enhanced client so the
  // ZenStack policy applies — admins get cross-project, everyone else is
  // checked against project membership). If the user can't read the run,
  // they shouldn't be told it exists, so we 404 (not 403) on miss.
  const userRecord = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: { include: { rolePermissions: true } } },
  });
  if (!userRecord) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }
  const reader =
    userRecord.access === "ADMIN"
      ? (prisma as unknown as typeof prisma)
      : (getAuthDb(userRecord) as unknown as typeof prisma);
  const accessibleRun = await reader.testRuns.findFirst({
    where: { id: runId, isDeleted: false },
    select: { id: true },
  });
  if (!accessibleRun) {
    return NextResponse.json({ error: "Test run not found" }, { status: 404 });
  }

  const tenantId = getCurrentTenantId() ?? "default";
  const channel = testRunChannel(tenantId, runId);

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
        write(encoder.encode(`data: ${message}\n\n`));
        lastEventAt = Date.now();
      });

      try {
        await subscriber.subscribe(channel);
      } catch (subErr) {
        console.warn(`[sse/test-run] subscribe failed`, {
          channel,
          runId,
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
      // window has opened (D-11 / sync checkpoint).
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
