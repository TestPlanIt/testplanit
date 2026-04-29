import IORedis from "ioredis";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import os from "os";
import { getCurrentTenantId } from "~/lib/multiTenantPrisma";
import {
  tenantBroadcastChannel,
  userChannel,
} from "~/lib/notifications/channels";
import { createSubscriberClient } from "~/lib/valkey";
import { authOptions } from "~/server/auth";

// SSE notifications transport — long-lived stream + IORedis pub/sub require the
// Node.js runtime, never Edge, and must opt out of any Next.js prerendering.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- env-driven config (D-17 / LIM-01 / LIM-02) ----
const PER_TENANT_CAP = Number(process.env.SSE_PER_TENANT_CAP ?? "1000");
const PER_USER_CAP = Number(process.env.SSE_PER_USER_CAP ?? "4");
const HEARTBEAT_MS = 25_000;
const METRICS_INTERVAL_MS = 30_000;

// ---- module-scoped registries (D-16/17/18/19/20) ----
interface ActiveConnection {
  tenantId: string;
  userId: string;
  cleanup: () => Promise<void>;
  writeShutdown: () => void;
  openedAt: number;
}
const tenantCounts: Map<string, number> = new Map();
const userConnections: Map<string, ActiveConnection[]> = new Map();
const allConnections: Set<ActiveConnection> = new Set();

// ---- one-time process-level setup ----
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
          metric: "sse.connections.active",
          tenantId,
          count,
          podId: os.hostname(),
          ts: new Date().toISOString(),
        })
      );
    }
  }, METRICS_INTERVAL_MS);
  // Allow Node to exit despite the interval if everything else is gone.
  metricsTimer.unref?.();
}

export async function GET(req: NextRequest) {
  registerOnce();

  // ---- auth gate (SSE-02 / CR-02) — fires BEFORE any IORedis client is created ----
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  // ---- tenant gate (CR-01 / Architectural Directive 1) ----
  const tenantId = getCurrentTenantId();
  if (!tenantId) {
    return NextResponse.json(
      { error: "Tenant context not configured" },
      { status: 500 }
    );
  }

  // ---- per-tenant cap (LIM-02 / D-18) — circuit breaker, no IORedis subscribe ----
  const tenantCount = tenantCounts.get(tenantId) ?? 0;
  if (tenantCount >= PER_TENANT_CAP) {
    return new NextResponse(null, {
      status: 503,
      headers: { "Retry-After": "30" },
    });
  }

  // ---- per-user LRU cap (LIM-01 / D-18) — fairness mechanism, accept new + close oldest ----
  const userKey = `${tenantId}:${userId}`;
  const list = userConnections.get(userKey) ?? [];
  if (list.length >= PER_USER_CAP) {
    const oldest = list.shift();
    if (oldest) {
      // cleanup() decrements counters and removes from registries
      await oldest.cleanup().catch(() => undefined);
    }
  }

  // ---- create per-connection subscriber (DEP-01 / Architectural Directive 4) ----
  const subscriber: IORedis | null = createSubscriberClient();
  if (!subscriber) {
    // Same code path on every deployment — when Valkey is not configured
    // for this pod, fail closed so the EventSource client retries.
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

      // The publisher already encodes `{id, event}` JSON (Wave 1 publish-site
      // contract — SSE-03). We relay the message verbatim inside a `data:`
      // SSE line; the consumer's authorization is enforced separately by the
      // bell's `useFindManyNotification` → `getEnhancedDb` re-read path
      // (Architectural Directive 2 — pub/sub layer is untrusted plumbing).
      subscriber.on("message", (_channel, message) => {
        if (controllerClosed) return;
        write(encoder.encode(`data: ${message}\n\n`));
        lastEventAt = Date.now();
      });

      try {
        await subscriber.subscribe(
          userChannel(tenantId, userId),
          tenantBroadcastChannel(tenantId)
        );
      } catch (subErr) {
        console.warn(`[sse/notifications] subscribe failed`, {
          tenantId,
          userId,
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

      // First byte after subscribe completes (D-11 — sync checkpoint).
      sendEvent({ event: "sync" });

      // Gated heartbeat (D-12 / SSE-04) — fires only if no real event in last 25s.
      heartbeatInterval = setInterval(() => {
        if (Date.now() - lastEventAt >= HEARTBEAT_MS) {
          sendComment(": ping");
        }
      }, HEARTBEAT_MS);

      connection = {
        tenantId,
        userId,
        openedAt: Date.now(),
        writeShutdown,
        cleanup: async () => {
          if (controllerClosed) {
            // Ensure registries are still cleaned up exactly once even if
            // the controller closed earlier (e.g. enqueue threw).
          }
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
      // Reader cancelled (e.g. via AbortController). Drive cleanup once.
      if (connection) {
        await connection.cleanup().catch(() => undefined);
      }
    },
  });

  // Request-abort handler (SSE-05 / D-21).
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
