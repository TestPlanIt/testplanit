import IORedis from "ioredis";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import os from "os";

import { getEnhancedDb } from "~/lib/auth/utils";
import { getCurrentTenantId } from "~/lib/multiTenantPrisma";
import { createSubscriberClient } from "~/lib/valkey";
import { projectIssueUpdateChannel } from "~/lib/webhooks/issueUpdateChannels";
import { authOptions } from "~/server/auth";

// SSE issue-updates transport — same constraints as the notifications
// route: long-lived stream + IORedis pub/sub require the Node.js
// runtime, never Edge, and must opt out of any Next.js prerendering.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Env-driven config — separate caps from notifications so a misbehaving
// issues-stream pod can't starve the notifications transport.
const PER_TENANT_CAP = Number(process.env.SSE_ISSUES_PER_TENANT_CAP ?? "1000");
const PER_USER_CAP = Number(process.env.SSE_ISSUES_PER_USER_CAP ?? "8");
const HEARTBEAT_MS = 25_000;
const METRICS_INTERVAL_MS = 30_000;

interface ActiveConnection {
  tenantId: string;
  userId: string;
  projectId: number;
  cleanup: () => Promise<void>;
  writeShutdown: () => void;
  openedAt: number;
}
const tenantCounts: Map<string, number> = new Map();
const userConnections: Map<string, ActiveConnection[]> = new Map();
const allConnections: Set<ActiveConnection> = new Set();

let signalsRegistered = false;
let metricsTimer: NodeJS.Timeout | null = null;

function registerOnce() {
  if (signalsRegistered) return;
  signalsRegistered = true;

  const onShutdown = async () => {
    for (const conn of allConnections) {
      try {
        conn.writeShutdown();
      } catch {
        /* swallow — controller may already be closed */
      }
    }
    await Promise.allSettled([...allConnections].map((c) => c.cleanup()));
    if (metricsTimer) {
      clearInterval(metricsTimer);
      metricsTimer = null;
    }
  };
  process.on("SIGTERM", onShutdown);
  process.on("SIGINT", onShutdown);

  metricsTimer = setInterval(() => {
    for (const [tenantId, count] of tenantCounts) {
      if (count <= 0) continue;
      console.log(
        JSON.stringify({
          metric: "sse.issues.connections.active",
          tenantId,
          count,
          podId: os.hostname(),
          ts: new Date().toISOString(),
        })
      );
    }
  }, METRICS_INTERVAL_MS);
  metricsTimer.unref?.();
}

export async function GET(req: NextRequest) {
  registerOnce();

  // 1. Auth gate.
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  // 2. Project param. The channel is project-scoped; clients pass
  //    `?projectId=<int>`.
  const rawProjectId = req.nextUrl.searchParams.get("projectId");
  const projectId = rawProjectId ? parseInt(rawProjectId, 10) : NaN;
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return NextResponse.json(
      { error: "projectId query param required (positive integer)" },
      { status: 400 }
    );
  }

  // 3. Project access gate. Re-fetch through the ZenStack-enhanced
  //    client so the project's `@@allow('read', ...)` policy decides
  //    whether this user can subscribe. If the policy returns null,
  //    the user has no access — same response as if the project
  //    didn't exist (do not leak existence).
  const db = await getEnhancedDb(session);
  const project = await db.projects.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 4. Tenant resolution. Same fallback as the notifications route so
  //    single-tenant deploys (no INSTANCE_TENANT_ID) match the
  //    publisher's "default" tenantId.
  const tenantId = getCurrentTenantId() ?? "default";

  // 5. Per-tenant cap — circuit breaker before any IORedis subscribe.
  const tenantCount = tenantCounts.get(tenantId) ?? 0;
  if (tenantCount >= PER_TENANT_CAP) {
    return new NextResponse(null, {
      status: 503,
      headers: { "Retry-After": "30" },
    });
  }

  // 6. Per-user LRU cap — accept new + close oldest. Caps are higher
  //    than notifications (8 vs 4) because a user may have multiple
  //    project tabs open simultaneously.
  const userKey = `${tenantId}:${userId}`;
  const list = userConnections.get(userKey) ?? [];
  if (list.length >= PER_USER_CAP) {
    const oldest = list.shift();
    if (oldest) {
      await oldest.cleanup().catch(() => undefined);
    }
  }

  // 7. Per-connection subscriber client.
  const subscriber: IORedis | null = createSubscriberClient();
  if (!subscriber) {
    return new NextResponse(null, {
      status: 503,
      headers: { "Retry-After": "30" },
    });
  }

  const encoder = new TextEncoder();
  let controllerClosed = false;
  let lastEventAt = Date.now();
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let connection!: ActiveConnection;

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
      function writeShutdown() {
        write(encoder.encode(`event: shutdown\ndata: {}\n\n`));
      }

      // Publisher writes a JSON envelope `{event, issueId, projectId}`;
      // we relay the bytes verbatim. Authorization is NOT enforced
      // here — it fires at the React Query / ZenStack hook layer when
      // the client refetches the issue (Architectural Directive 2 —
      // pub/sub is untrusted plumbing).
      subscriber.on("message", (_channel, message) => {
        if (controllerClosed) return;
        write(encoder.encode(`data: ${message}\n\n`));
        lastEventAt = Date.now();
      });

      try {
        await subscriber.subscribe(
          projectIssueUpdateChannel(tenantId, projectId)
        );
      } catch (subErr) {
        console.warn(`[sse/issues] subscribe failed`, {
          tenantId,
          userId,
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

      // First byte after subscribe — sync checkpoint; the client uses
      // this to coalesce its initial query refetch with the stream
      // becoming ready (avoids missing events fired between page-load
      // and EventSource.onopen).
      sendEvent({ event: "sync" });

      heartbeatInterval = setInterval(() => {
        if (Date.now() - lastEventAt >= HEARTBEAT_MS) {
          sendComment(": ping");
        }
      }, HEARTBEAT_MS);

      connection = {
        tenantId,
        userId,
        projectId,
        openedAt: Date.now(),
        writeShutdown,
        cleanup: async () => {
          controllerClosed = true;
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }
          try {
            await subscriber.unsubscribe();
          } catch {
            /* swallow */
          }
          try {
            await subscriber.quit();
          } catch {
            /* swallow */
          }
          tenantCounts.set(
            tenantId,
            Math.max(0, (tenantCounts.get(tenantId) ?? 1) - 1)
          );
          const userList = userConnections.get(userKey);
          if (userList) {
            const idx = userList.indexOf(connection);
            if (idx >= 0) userList.splice(idx, 1);
            if (userList.length === 0) userConnections.delete(userKey);
          }
          allConnections.delete(connection);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        },
      };

      tenantCounts.set(tenantId, (tenantCounts.get(tenantId) ?? 0) + 1);
      const updatedList = userConnections.get(userKey) ?? [];
      updatedList.push(connection);
      userConnections.set(userKey, updatedList);
      allConnections.add(connection);
    },

    async cancel() {
      if (connection) {
        await connection.cleanup().catch(() => undefined);
      }
    },
  });

  req.signal.addEventListener("abort", () => {
    if (connection) {
      void connection.cleanup().catch(() => undefined);
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
