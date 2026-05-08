import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/prisma", () => ({
  prisma: {
    user: {
      update: vi.fn(),
    },
  },
}));

import { getAuditContext, type AuditContext } from "~/lib/auditContext";
import { prisma } from "~/lib/prisma";
import { POST } from "./route";

describe("withAuditContext wrapper on test-helpers/verify-email POST", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalE2EProd = process.env.E2E_PROD;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.E2E_PROD = "on";
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete (process.env as any).NODE_ENV;
    } else {
      (process.env as any).NODE_ENV = originalNodeEnv;
    }
    if (originalE2EProd === undefined) {
      delete process.env.E2E_PROD;
    } else {
      process.env.E2E_PROD = originalE2EProd;
    }
  });

  it("seeds ALS with request headers inside the handler", async () => {
    let capturedCtx: AuditContext | undefined;
    (prisma.user.update as any).mockImplementation(() => {
      capturedCtx = getAuditContext();
      return Promise.resolve({ id: "user-123" });
    });

    const req = new NextRequest(
      "http://localhost/api/test-helpers/verify-email",
      {
        method: "POST",
        body: JSON.stringify({ userId: "user-123" }),
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "203.0.113.42, 10.0.0.1",
          "user-agent": "vitest-verify-email",
        },
      }
    );

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(capturedCtx).toBeDefined();
    expect(capturedCtx?.ipAddress).toBe("203.0.113.42");
    expect(capturedCtx?.userAgent).toBe("vitest-verify-email");
    expect(capturedCtx?.requestId).toMatch(/^req_\d+_[a-z0-9]+$/);
  });

  it("returns 403 when not in E2E test environment", async () => {
    delete process.env.E2E_PROD;
    (process.env as any).NODE_ENV = "production";

    const req = new NextRequest(
      "http://localhost/api/test-helpers/verify-email",
      {
        method: "POST",
        body: JSON.stringify({ userId: "user-123" }),
        headers: { "Content-Type": "application/json" },
      }
    );

    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
