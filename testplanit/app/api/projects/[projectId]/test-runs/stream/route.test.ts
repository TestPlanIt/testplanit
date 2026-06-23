import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/zenstack", () => ({ getAuthDb: vi.fn() }));

vi.mock("~/lib/multiTenantPrisma", () => ({
  getCurrentTenantId: vi.fn().mockReturnValue("acme"),
}));

vi.mock("~/lib/valkey", () => ({
  createSubscriberClient: vi.fn(),
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    projects: { findFirst: vi.fn() },
  },
}));

import { getAuthDb } from "~/lib/zenstack";
import { getServerSession } from "next-auth";
import { prisma } from "~/lib/prisma";
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

describe("GET /api/projects/[projectId]/test-runs/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("400s on a non-numeric project id", async () => {
    const res = await GET(req("/api/projects/abc/test-runs/stream"), {
      params: Promise.resolve({ projectId: "abc" }),
    });
    expect(res.status).toBe(400);
  });

  it("400s on a non-positive project id", async () => {
    const res = await GET(req("/api/projects/0/test-runs/stream"), {
      params: Promise.resolve({ projectId: "0" }),
    });
    expect(res.status).toBe(400);
  });

  it("401s when there is no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await GET(req("/api/projects/293/test-runs/stream"), {
      params: Promise.resolve({ projectId: "293" }),
    });
    expect(res.status).toBe(401);
  });

  it("401s when the user record cannot be found", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const res = await GET(req("/api/projects/293/test-runs/stream"), {
      params: Promise.resolve({ projectId: "293" }),
    });
    expect(res.status).toBe(401);
  });

  it("404s when the user has no access to the project (policy-enforced)", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      access: null,
    } as never);
    // Non-admin → goes through getAuthDb() → ZenStack policy filters out the
    // project. findFirst returns null so we 404 (not 403) to avoid
    // leaking existence.
    vi.mocked(getAuthDb).mockReturnValue({
      projects: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never);
    const res = await GET(req("/api/projects/293/test-runs/stream"), {
      params: Promise.resolve({ projectId: "293" }),
    });
    expect(res.status).toBe(404);
  });

  it("503s when valkey is not configured", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin-1" },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "admin-1",
      access: "ADMIN",
    } as never);
    vi.mocked(prisma.projects.findFirst).mockResolvedValue({
      id: 293,
    } as never);
    vi.mocked(createSubscriberClient).mockReturnValue(null);
    const res = await GET(req("/api/projects/293/test-runs/stream"), {
      params: Promise.resolve({ projectId: "293" }),
    });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("subscribes to the per-project channel and emits a sync checkpoint", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin-1" },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "admin-1",
      access: "ADMIN",
    } as never);
    vi.mocked(prisma.projects.findFirst).mockResolvedValue({
      id: 293,
    } as never);
    const subscriber = makeSubscriberMock();
    vi.mocked(createSubscriberClient).mockReturnValue(subscriber as never);

    const res = await GET(req("/api/projects/293/test-runs/stream"), {
      params: Promise.resolve({ projectId: "293" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(subscriber.subscribe).toHaveBeenCalledWith(
      "live:tenant:acme:project:293:testruns"
    );
    expect(text).toContain('data: {"event":"sync"}');
    reader.releaseLock();
    await res.body!.cancel();
  });

  it("relays publisher messages verbatim as SSE data lines", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin-1" },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "admin-1",
      access: "ADMIN",
    } as never);
    vi.mocked(prisma.projects.findFirst).mockResolvedValue({
      id: 293,
    } as never);
    const subscriber = makeSubscriberMock();
    vi.mocked(createSubscriberClient).mockReturnValue(subscriber as never);

    const res = await GET(req("/api/projects/293/test-runs/stream"), {
      params: Promise.resolve({ projectId: "293" }),
    });
    const reader = res.body!.getReader();
    await reader.read(); // sync
    // Publisher fires for run 18 in this project
    subscriber.emitMessage(
      "live:tenant:acme:project:293:testruns",
      '{"event":"test_run.result_added","runId":18,"projectId":293,"targetId":7891}'
    );
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toBe(
      'data: {"event":"test_run.result_added","runId":18,"projectId":293,"targetId":7891}\n\n'
    );
    reader.releaseLock();
    await res.body!.cancel();
  });

  it("does not collide with the per-run channel — a project-id == run-id pair still subscribes to the project channel", async () => {
    // Regression guard: if testRunProjectChannel and testRunChannel had
    // matching key shapes (both `:testrun:`), a project with id 42 and a
    // run with id 42 would share a channel and one consumer would receive
    // the other's wake-ups. Confirms the per-project endpoint subscribes
    // to the disambiguated `:project:*:testruns` key.
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin-1" },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "admin-1",
      access: "ADMIN",
    } as never);
    vi.mocked(prisma.projects.findFirst).mockResolvedValue({
      id: 42,
    } as never);
    const subscriber = makeSubscriberMock();
    vi.mocked(createSubscriberClient).mockReturnValue(subscriber as never);

    const res = await GET(req("/api/projects/42/test-runs/stream"), {
      params: Promise.resolve({ projectId: "42" }),
    });
    const reader = res.body!.getReader();
    await reader.read(); // sync
    expect(subscriber.subscribe).toHaveBeenCalledWith(
      "live:tenant:acme:project:42:testruns"
    );
    expect(subscriber.subscribe).not.toHaveBeenCalledWith(
      "live:tenant:acme:testrun:42"
    );
    reader.releaseLock();
    await res.body!.cancel();
  });
});
