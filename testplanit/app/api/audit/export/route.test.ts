import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Proves that the wrapped POST /api/audit/export handler emits an
// audit row whose actor context is fully populated: ipAddress/userAgent/
// requestId come from `withAuditContext` extracting
// them from req.headers, while userId/userEmail/userName come from the
// mocked session-callback effect.
//
// The helper `expectAuditRowComplete` asserts all six
// non-null fields.

// Shared captured-row ref — mutated by the auditDataExport mock.
const captured = vi.hoisted(() => ({
  row: null as null | {
    userId: string | null;
    userEmail: string | null;
    userName: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    requestId: string | null;
    metadata: unknown;
    action: string;
    entityType: string;
    entityId: string;
  },
}));

// Prevent the real Valkey connection from auditLog.ts's getAuditLogQueue
// (it opens a Valkey client on module load in some paths). Hermetic.
vi.mock("~/lib/valkey", () => ({ default: null }));
vi.mock("~/lib/queues", () => ({
  getAuditLogQueue: vi.fn(() => null),
}));

// Mock getServerAuthSession. We layer in the NextAuth session-callback
// effect (Plan 01 Task 3) by having the mock call updateAuditContext
// from inside the wrapped request scope — the real session callback
// does exactly this. Using an import() inside the mock factory avoids
// hoisting ordering issues.
vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(async () => {
    const { updateAuditContext: upd } = await import("~/lib/auditContext");
    upd({
      userId: "user-abc",
      userEmail: "alice@example.com",
      userName: "Alice",
    });
    return {
      user: { id: "user-abc", email: "alice@example.com", name: "Alice" },
    };
  }),
}));

// Mock `auditDataExport` directly: capturing at this layer is more
// reliable than mocking only `captureAuditEvent` (which auditDataExport
// calls internally via an intra-module binding that isn't patched by
// the ESM mock). We still read ALS via the real getAuditContext so the
// captured row reflects the data flowing through Plan 01 Task 2's
// withAuditContext frame.
vi.mock("~/lib/services/auditLog", async () => {
  const actual = await vi.importActual<
    typeof import("~/lib/services/auditLog")
  >("~/lib/services/auditLog");
  return {
    ...actual,
    auditDataExport: vi.fn(
      async (
        exportType: string,
        entityType: string,
        filters?: Record<string, unknown>
      ) => {
        const { getAuditContext } = await import("~/lib/auditContext");
        const ctx = getAuditContext();
        captured.row = {
          userId: ctx?.userId ?? null,
          userEmail: ctx?.userEmail ?? null,
          userName: ctx?.userName ?? null,
          ipAddress: ctx?.ipAddress ?? null,
          userAgent: ctx?.userAgent ?? null,
          requestId: ctx?.requestId ?? null,
          metadata: { exportType, filters },
          action: "DATA_EXPORTED",
          entityType,
          entityId: exportType,
        };
      }
    ),
  };
});

import { SYSTEM_ACTOR_ID } from "~/lib/auditContext";
import { expectAuditRowComplete } from "~/lib/testing/auditAssertions";
import { POST } from "./route";

describe("POST /api/audit/export — CTX-01", () => {
  beforeEach(() => {
    captured.row = null;
    // NOTE: do NOT vi.clearAllMocks() here — it would wipe the
    // implementation of getServerAuthSession set in the vi.mock factory
    // above (vitest's clearAllMocks leaves return values intact but
    // clears call history; still, we keep things explicit).
  });

  it("emitted audit row has all 6 actor fields populated", async () => {
    const request = new NextRequest("http://localhost/api/audit/export", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "10.0.0.1",
        "user-agent": "UA-test/1.0",
      },
      body: JSON.stringify({
        exportType: "csv",
        entityType: "TestCase",
        recordCount: 42,
        filters: { projectId: 1 },
        projectId: 1,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(captured.row).not.toBeNull();
    // Sanity: not the system sentinel
    expect(captured.row!.userId).not.toBe(SYSTEM_ACTOR_ID);
    // The D-17 enforcement — all 6 actor fields non-null.
    expectAuditRowComplete(captured.row!);
  });
});
