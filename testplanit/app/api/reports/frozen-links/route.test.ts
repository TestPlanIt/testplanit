import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

const { mockShareLinkCreate } = vi.hoisted(() => ({
  mockShareLinkCreate: vi.fn(),
}));

vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => ({
    shareLink: { create: mockShareLinkCreate },
  })),
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    reportSnapshot: { create: vi.fn() },
    shareLink: { update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("~/lib/services/areaPermission", () => ({
  userHasAreaPermission: vi.fn(),
}));

vi.mock("~/lib/config/reportTypes", () => ({
  getProjectReportTypes: vi.fn(() => [
    {
      id: "test-execution",
      label: "Test Execution",
      endpoint: "/api/report-builder/test-execution",
    },
  ]),
  getCrossProjectReportTypes: vi.fn(() => []),
}));

vi.mock("bcrypt", () => ({
  default: { hash: vi.fn(async () => "hashed-password") },
}));

import { getServerSession } from "next-auth";
import { baseDb } from "~/lib/db";
import { userHasAreaPermission } from "~/lib/services/areaPermission";
import { POST } from "./route";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const reportConfig = {
  reportType: "test-execution",
  dimensions: ["testCase"],
  metrics: ["count"],
};

function createRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/reports/frozen-links", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function mockReportRun(rowCount: number) {
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    testCase: `Case ${i}`,
    count: i,
  }));
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        dimensions: [{ id: "testCase", label: "Test Case" }],
        metrics: [{ id: "count", label: "Count" }],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: rows,
        allResults: rows,
        totalCount: rowCount,
      }),
    });
}

describe("POST /api/reports/frozen-links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    (getServerSession as any).mockResolvedValue({
      user: { id: "user-1", name: "Jane", email: "jane@example.com" },
    });
    (userHasAreaPermission as any).mockResolvedValue(true);
    mockShareLinkCreate.mockImplementation(async ({ data }: any) => ({
      id: "link-1",
      createdAt: new Date("2026-09-23T00:00:00.000Z"),
      viewCount: 0,
      ...data,
    }));
    (baseDb.reportSnapshot.create as any).mockImplementation(
      async ({ data }: any) => ({
        id: "snap-1",
        capturedAt: new Date("2026-09-23T00:00:00.000Z"),
        ...data,
      })
    );
  });

  afterEach(() => {
    delete process.env.REPORT_SNAPSHOT_MAX_ROWS;
  });

  it("returns 401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const response = await POST(
      createRequest({ entityType: "REPORT", reportConfig, projectId: 10 })
    );
    expect(response.status).toBe(401);
  });

  it("rejects an unknown report type", async () => {
    const response = await POST(
      createRequest({
        entityType: "REPORT",
        reportConfig: { reportType: "nope" },
        projectId: 10,
      })
    );
    expect(response.status).toBe(400);
  });

  it("returns 403 without Reporting add/edit on the project", async () => {
    (userHasAreaPermission as any).mockResolvedValue(false);
    const response = await POST(
      createRequest({ entityType: "REPORT", reportConfig, projectId: 10 })
    );
    expect(response.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockShareLinkCreate).not.toHaveBeenCalled();
  });

  it("runs the report with the caller's credentials and stores the output", async () => {
    mockReportRun(3);
    const response = await POST(
      createRequest(
        {
          entityType: "REPORT",
          reportConfig,
          projectId: 10,
          mode: "PUBLIC",
          title: "Sprint 12",
        },
        { cookie: "next-auth.session-token=abc" }
      )
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    const reportInit = mockFetch.mock.calls[1][1];
    expect(reportInit.headers.cookie).toBe("next-auth.session-token=abc");
    expect(reportInit.headers).not.toHaveProperty("x-shared-report-bypass");

    expect(mockShareLinkCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "REPORT",
        projectId: 10,
        mode: "PUBLIC",
        createdById: "user-1",
        title: "Sprint 12",
      }),
    });
    const snapshotData = (baseDb.reportSnapshot.create as any).mock.calls[0][0]
      .data;
    expect(snapshotData).toMatchObject({
      shareLinkId: "link-1",
      rowCount: 3,
      totalRowCount: 3,
      truncated: false,
      capturedById: "user-1",
    });
    expect(snapshotData.payload.results).toHaveLength(3);
    expect(data.viewCount).toBe(0);
    expect(data.frozen).toMatchObject({
      capturedByName: "Jane",
      truncated: false,
    });
    expect(baseDb.auditLog.create).toHaveBeenCalled();
  });

  it("asks for confirmation when the report exceeds the row cap, creating nothing", async () => {
    process.env.REPORT_SNAPSHOT_MAX_ROWS = "2";
    mockReportRun(5);
    const response = await POST(
      createRequest({ entityType: "REPORT", reportConfig, projectId: 10 })
    );
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data).toMatchObject({
      code: "SNAPSHOT_TRUNCATION_REQUIRED",
      totalRowCount: 5,
      maxRows: 2,
    });
    expect(mockShareLinkCreate).not.toHaveBeenCalled();
    expect(baseDb.reportSnapshot.create).not.toHaveBeenCalled();
  });

  it("stores a truncated copy once the caller allows it", async () => {
    process.env.REPORT_SNAPSHOT_MAX_ROWS = "2";
    mockReportRun(5);
    const response = await POST(
      createRequest({
        entityType: "REPORT",
        reportConfig,
        projectId: 10,
        allowTruncate: true,
      })
    );

    expect(response.status).toBe(201);
    const snapshotData = (baseDb.reportSnapshot.create as any).mock.calls[0][0]
      .data;
    expect(snapshotData).toMatchObject({
      rowCount: 2,
      totalRowCount: 5,
      truncated: true,
    });
    expect(snapshotData.payload.results).toHaveLength(2);
  });

  it("stores a saved report privately with its project inside the config", async () => {
    mockReportRun(1);
    const response = await POST(
      createRequest({
        entityType: "SAVED_REPORT",
        reportConfig,
        projectId: 10,
        mode: "PUBLIC",
        notifyOnView: true,
        title: "Mine",
      })
    );

    expect(response.status).toBe(201);
    const data = mockShareLinkCreate.mock.calls[0][0].data;
    expect(data.entityType).toBe("SAVED_REPORT");
    expect(data).not.toHaveProperty("projectId");
    expect(data.entityConfig.projectId).toBe(10);
    expect(data.mode).toBe("AUTHENTICATED");
    expect(data.notifyOnView).toBe(false);
  });

  it("requires a password for a password-protected share", async () => {
    const response = await POST(
      createRequest({
        entityType: "REPORT",
        reportConfig,
        projectId: 10,
        mode: "PASSWORD_PROTECTED",
      })
    );
    expect(response.status).toBe(400);
  });

  it("passes a failed report run through without creating a link", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: "Forbidden" }),
    });
    const response = await POST(
      createRequest({ entityType: "REPORT", reportConfig, projectId: 10 })
    );
    expect(response.status).toBe(403);
    expect(mockShareLinkCreate).not.toHaveBeenCalled();
  });

  it("retires the link when the snapshot cannot be stored", async () => {
    mockReportRun(1);
    (baseDb.reportSnapshot.create as any).mockRejectedValueOnce(
      new Error("db down")
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(
      createRequest({ entityType: "REPORT", reportConfig, projectId: 10 })
    );

    expect(response.status).toBe(500);
    expect(baseDb.shareLink.update).toHaveBeenCalledWith({
      where: { id: "link-1" },
      data: expect.objectContaining({ isDeleted: true, isRevoked: true }),
    });
  });
});
