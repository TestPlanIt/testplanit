import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The cap is read once at module load; pin it before the route is imported.
vi.hoisted(() => {
  process.env.SSE_PER_USER_CAP = "2";
});

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/multiTenantDb", () => ({
  getCurrentTenantId: vi.fn().mockReturnValue("acme"),
}));
vi.mock("~/lib/valkey", () => ({
  createSubscriberClient: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { createSubscriberClient } from "~/lib/valkey";
import { GET } from "./route";

function req(init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(
    new URL("/api/notifications/stream", "http://localhost"),
    init
  );
}

function makeSubscriberMock() {
  const messageHandlers: Array<(...args: unknown[]) => void> = [];
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === "message") messageHandlers.push(handler);
    }),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    emitMessage: (channel: string, message: string) => {
      for (const h of messageHandlers) h(channel, message);
    },
  };
}

const decoder = new TextDecoder();

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const { value, done } = await reader.read();
  return { text: value ? decoder.decode(value) : "", done };
}

// Each test opens streams for its own user id so the module-level per-user
// registry never carries state across tests.
let userSeq = 0;
function signIn() {
  const userId = `user-${++userSeq}`;
  vi.mocked(getServerSession).mockResolvedValue({
    user: { id: userId },
  } as never);
  return userId;
}

async function openStream() {
  const subscriber = makeSubscriberMock();
  vi.mocked(createSubscriberClient).mockReturnValue(subscriber as never);
  const controller = new AbortController();
  const res = await GET(req({ signal: controller.signal }));
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  expect((await readChunk(reader)).text).toContain('data: {"event":"sync"}');
  return { res, reader, subscriber, controller };
}

describe("GET /api/notifications/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401s when there is no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("503s with Retry-After when valkey is not configured", async () => {
    signIn();
    vi.mocked(createSubscriberClient).mockReturnValue(null);
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("subscribes to the user + broadcast channels and emits a sync checkpoint", async () => {
    const userId = signIn();
    const { res, reader, subscriber } = await openStream();
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(subscriber.subscribe).toHaveBeenCalledWith(
      `notifications:tenant:acme:user:${userId}`,
      "notifications:tenant:acme:broadcast"
    );
    reader.releaseLock();
    await res.body!.cancel();
  });

  it("over the per-user cap, writes `superseded` to the oldest stream before closing it", async () => {
    signIn();
    const first = await openStream();
    const second = await openStream();
    const third = await openStream();

    // The evicted (oldest) stream sees the named event, then end-of-stream —
    // the client closes on it instead of auto-reconnecting.
    expect((await readChunk(first.reader)).text).toBe(
      "event: superseded\ndata: {}\n\n"
    );
    expect((await readChunk(first.reader)).done).toBe(true);
    expect(first.subscriber.unsubscribe).toHaveBeenCalledTimes(1);
    expect(first.subscriber.quit).toHaveBeenCalledTimes(1);

    // The survivors are untouched.
    expect(second.subscriber.quit).not.toHaveBeenCalled();
    expect(third.subscriber.quit).not.toHaveBeenCalled();

    for (const s of [second, third]) {
      s.reader.releaseLock();
      await s.res.body!.cancel();
    }
  });

  it("releases an evicted connection's subscriber exactly once even if its request later aborts", async () => {
    signIn();
    const first = await openStream();
    const second = await openStream();
    const third = await openStream();
    await readChunk(first.reader); // superseded
    expect(first.subscriber.quit).toHaveBeenCalledTimes(1);

    first.controller.abort();
    await new Promise((r) => setTimeout(r, 0));
    expect(first.subscriber.quit).toHaveBeenCalledTimes(1);

    for (const s of [second, third]) {
      s.reader.releaseLock();
      await s.res.body!.cancel();
    }
  });
});
