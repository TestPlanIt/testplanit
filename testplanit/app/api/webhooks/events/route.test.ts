import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/api-token-auth", () => ({ authenticateRequest: vi.fn() }));

import { authenticateRequest } from "~/lib/api-token-auth";
import { GET } from "./route";

function req(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost"));
}

const ADMIN_USER = { userId: "admin-1", access: "ADMIN" } as const;

describe("GET /api/webhooks/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires auth", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: false,
      error: "Unauthorized",
      status: 401,
    });
    const res = await GET(req("/api/webhooks/events"));
    expect(res.status).toBe(401);
  });

  it("returns the full catalog with a generatedAt and count", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      user: ADMIN_USER,
    });
    const res = await GET(req("/api/webhooks/events"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      generatedAt: string;
      count: number;
      events: Array<{ name: string; category: string }>;
    };
    expect(typeof body.generatedAt).toBe("string");
    expect(body.count).toBe(body.events.length);
    expect(
      body.events.find((e) => e.name === "test_run.completed")
    ).toBeDefined();
    expect(body.events.find((e) => e.name === "issue.created")).toBeDefined();
  });

  it("filters by category when supplied", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      user: ADMIN_USER,
    });
    const res = await GET(req("/api/webhooks/events?category=test-run"));
    const body = (await res.json()) as {
      events: Array<{ category: string }>;
    };
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.events.every((e) => e.category === "test-run")).toBe(true);
  });

  it("returns an empty events array for an unknown category", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      user: ADMIN_USER,
    });
    const res = await GET(req("/api/webhooks/events?category=does-not-exist"));
    const body = (await res.json()) as { events: unknown[]; count: number };
    expect(body.events).toEqual([]);
    expect(body.count).toBe(0);
  });
});
