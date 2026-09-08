import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/zenstack", () => ({ getAuthDb: vi.fn() }));

vi.mock("~/lib/multiTenantDb", () => ({
  getCurrentTenantId: vi.fn().mockReturnValue("acme"),
}));

vi.mock("~/lib/valkey", () => ({
  createSubscriberClient: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    user: { findUnique: vi.fn() },
    testRuns: { findFirst: vi.fn() },
  },
}));

import { getAuthDb } from "~/lib/zenstack";
import { getServerSession } from "next-auth";
import { baseDb } from "~/lib/db";
import { createSubscriberClient } from "~/lib/valkey";
import { GET } from "./route";

function req(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost"));
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

describe("GET /api/test-runs/[id]/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("400s on a non-numeric run id", async () => {
    const res = await GET(req("/api/test-runs/abc/stream"), {
      params: Promise.resolve({ testRunId: "abc" }),
    });
    expect(res.status).toBe(400);
  });

  it("400s on a non-positive run id", async () => {
    const res = await GET(req("/api/test-runs/0/stream"), {
      params: Promise.resolve({ testRunId: "0" }),
    });
    expect(res.status).toBe(400);
  });

  it("401s when there is no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await GET(req("/api/test-runs/42/stream"), {
      params: Promise.resolve({ testRunId: "42" }),
    });
    expect(res.status).toBe(401);
  });

  it("401s when the user record cannot be found", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(baseDb.user.findUnique).mockResolvedValue(null);
    const res = await GET(req("/api/test-runs/42/stream"), {
      params: Promise.resolve({ testRunId: "42" }),
    });
    expect(res.status).toBe(401);
  });

  it("404s when the user has no access to the test run", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(baseDb.user.findUnique).mockResolvedValue({
      id: "user-1",
      access: null,
    } as never);
    vi.mocked(getAuthDb).mockReturnValue({
      testRuns: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never);
    const res = await GET(req("/api/test-runs/42/stream"), {
      params: Promise.resolve({ testRunId: "42" }),
    });
    expect(res.status).toBe(404);
  });

  it("503s when valkey is not configured", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin-1" },
    } as never);
    vi.mocked(baseDb.user.findUnique).mockResolvedValue({
      id: "admin-1",
      access: "ADMIN",
    } as never);
    vi.mocked(baseDb.testRuns.findFirst).mockResolvedValue({ id: 42 } as never);
    vi.mocked(createSubscriberClient).mockReturnValue(null);
    const res = await GET(req("/api/test-runs/42/stream"), {
      params: Promise.resolve({ testRunId: "42" }),
    });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("subscribes to the testRun channel and emits a sync checkpoint", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin-1" },
    } as never);
    vi.mocked(baseDb.user.findUnique).mockResolvedValue({
      id: "admin-1",
      access: "ADMIN",
    } as never);
    vi.mocked(baseDb.testRuns.findFirst).mockResolvedValue({ id: 42 } as never);
    const subscriber = makeSubscriberMock();
    vi.mocked(createSubscriberClient).mockReturnValue(subscriber as never);

    const res = await GET(req("/api/test-runs/42/stream"), {
      params: Promise.resolve({ testRunId: "42" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    // Read the first message off the stream
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(subscriber.subscribe).toHaveBeenCalledWith(
      "live:tenant:acme:testrun:42"
    );
    expect(text).toContain('data: {"event":"sync"}');
    reader.releaseLock();
    await res.body!.cancel();
  });

  it("relays publisher messages verbatim as SSE data lines", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin-1" },
    } as never);
    vi.mocked(baseDb.user.findUnique).mockResolvedValue({
      id: "admin-1",
      access: "ADMIN",
    } as never);
    vi.mocked(baseDb.testRuns.findFirst).mockResolvedValue({ id: 42 } as never);
    const subscriber = makeSubscriberMock();
    vi.mocked(createSubscriberClient).mockReturnValue(subscriber as never);

    const res = await GET(req("/api/test-runs/42/stream"), {
      params: Promise.resolve({ testRunId: "42" }),
    });
    const reader = res.body!.getReader();
    await reader.read(); // sync
    // Now publisher fires
    subscriber.emitMessage(
      "live:tenant:acme:testrun:42",
      '{"event":"test_run.result_added","runId":42,"targetId":7891}'
    );
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toBe(
      'data: {"event":"test_run.result_added","runId":42,"targetId":7891}\n\n'
    );
    reader.releaseLock();
    await res.body!.cancel();
  });
});
