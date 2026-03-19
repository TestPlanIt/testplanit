import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    shareLink: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("~/lib/config/reportTypes", () => ({
  getProjectReportTypes: vi.fn(),
  getCrossProjectReportTypes: vi.fn(),
}));

import { getServerSession } from "next-auth/next";
import { getCrossProjectReportTypes, getProjectReportTypes } from "~/lib/config/reportTypes";
import { prisma } from "~/lib/prisma";
import { GET } from "./route";

const createRequest = (
  shareKey: string,
  query: Record<string, string> = {}
): [NextRequest, { params: Promise<{ shareKey: string }> }] => {
  const url = new URL(`http://localhost/api/share/${shareKey}/report`);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const req = new NextRequest(url.toString());
  const params = { params: Promise.resolve({ shareKey }) };
  return [req, params];
};

const mockReportTypes = [
  {
    id: "test-execution",
    label: "Test Execution",
    description: "...",
    endpoint: "/api/report-builder/test-execution",
  },
];

const mockShareLink = {
  id: 1,
  shareKey: "abc123",
  entityType: "REPORT",
  entityId: null,
  entityConfig: {
    reportType: "test-execution",
    dimensions: ["testCase"],
    metrics: ["count"],
  },
  mode: "PUBLIC",
  isRevoked: false,
  expiresAt: null,
  projectId: 10,
  project: {
    id: 10,
    name: "My Project",
    createdBy: "user-1",
    userPermissions: [],
  },
};

const mockMetadataResponse = {
  dimensions: [{ id: "testCase", label: "Test Case" }],
  metrics: [{ id: "count", label: "Count" }],
};

const mockReportResponse = {
  results: [{ testCase: "Login Test", count: 5 }],
  allResults: [{ testCase: "Login Test", count: 5 }],
  totalCount: 1,
  page: 1,
  pageSize: "All",
};

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("GET /api/share/[shareKey]/report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    (getProjectReportTypes as any).mockReturnValue(mockReportTypes);
    (getCrossProjectReportTypes as any).mockReturnValue([]);
  });

  describe("Share link validation", () => {
    it("returns 404 for non-existent shareKey", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (prisma.shareLink.findUnique as any).mockResolvedValue(null);

      const [req, ctx] = createRequest("nonexistent");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain("not found");
    });

    it("returns 403 for revoked share link", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (prisma.shareLink.findUnique as any).mockResolvedValue({
        ...mockShareLink,
        isRevoked: true,
      });

      const [req, ctx] = createRequest("abc123");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain("revoked");
    });

    it("returns 403 for expired share link", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (prisma.shareLink.findUnique as any).mockResolvedValue({
        ...mockShareLink,
        expiresAt: new Date("2020-01-01"),
      });

      const [req, ctx] = createRequest("abc123");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain("expired");
    });
  });

  describe("Access control", () => {
    it("allows PUBLIC mode without authentication", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (prisma.shareLink.findUnique as any).mockResolvedValue(mockShareLink);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockMetadataResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockReportResponse,
        });

      const [req, ctx] = createRequest("abc123");
      const response = await GET(req, ctx);

      expect(response.status).toBe(200);
    });

    it("returns 401 for AUTHENTICATED mode without session", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (prisma.shareLink.findUnique as any).mockResolvedValue({
        ...mockShareLink,
        mode: "AUTHENTICATED",
      });

      const [req, ctx] = createRequest("abc123");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Authentication required");
    });

    it("returns 403 for AUTHENTICATED mode when user lacks project access", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "other-user", access: "USER" },
      });
      (prisma.shareLink.findUnique as any).mockResolvedValue({
        ...mockShareLink,
        mode: "AUTHENTICATED",
        project: {
          ...mockShareLink.project,
          createdBy: "user-1",
          userPermissions: [],
        },
      });

      const [req, ctx] = createRequest("abc123");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");
    });

    it("allows AUTHENTICATED mode for admin user", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin", access: "ADMIN" },
      });
      (prisma.shareLink.findUnique as any).mockResolvedValue({
        ...mockShareLink,
        mode: "AUTHENTICATED",
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockMetadataResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockReportResponse,
        });

      const [req, ctx] = createRequest("abc123");
      const response = await GET(req, ctx);

      expect(response.status).toBe(200);
    });

    it("returns 401 for PASSWORD_PROTECTED mode without valid token", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (prisma.shareLink.findUnique as any).mockResolvedValue({
        ...mockShareLink,
        mode: "PASSWORD_PROTECTED",
      });

      const [req, ctx] = createRequest("abc123"); // no token
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toContain("token");
    });

    it("allows PASSWORD_PROTECTED mode with valid token in query", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (prisma.shareLink.findUnique as any).mockResolvedValue({
        ...mockShareLink,
        mode: "PASSWORD_PROTECTED",
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockMetadataResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockReportResponse,
        });

      const [req, ctx] = createRequest("abc123", { token: "abc123" });
      const response = await GET(req, ctx);

      expect(response.status).toBe(200);
    });
  });

  describe("Report entity validation", () => {
    it("returns 400 for non-REPORT entity type", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (prisma.shareLink.findUnique as any).mockResolvedValue({
        ...mockShareLink,
        entityType: "TEST_PLAN",
      });

      const [req, ctx] = createRequest("abc123");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Only report shares");
    });

    it("returns 400 when entityConfig is null", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (prisma.shareLink.findUnique as any).mockResolvedValue({
        ...mockShareLink,
        entityConfig: null,
      });

      const [req, ctx] = createRequest("abc123");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid report configuration");
    });

    it("returns 400 for unsupported report type", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (prisma.shareLink.findUnique as any).mockResolvedValue({
        ...mockShareLink,
        entityConfig: { reportType: "unknown-report-type" },
      });

      const [req, ctx] = createRequest("abc123");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Unsupported report type");
    });
  });

  describe("Report data fetching", () => {
    it("returns report data with dimensions and metrics for dynamic report", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (prisma.shareLink.findUnique as any).mockResolvedValue(mockShareLink);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockMetadataResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockReportResponse,
        });

      const [req, ctx] = createRequest("abc123");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("results");
      expect(data).toHaveProperty("chartData");
      expect(data).toHaveProperty("dimensions");
      expect(data).toHaveProperty("metrics");
      expect(data).toHaveProperty("pagination");
      expect(data.dimensions[0]).toEqual({ value: "testCase", label: "Test Case" });
      expect(data.metrics[0]).toEqual({ value: "count", label: "Count" });
    });

    it("returns report data with empty dimensions/metrics for pre-built report", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (prisma.shareLink.findUnique as any).mockResolvedValue({
        ...mockShareLink,
        entityConfig: {
          reportType: "test-execution",
          dimensions: [],
          metrics: [],
        },
      });

      const preBuiltData = { data: [{ testCase: "Login", result: "pass" }] };
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockMetadataResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => preBuiltData,
        });

      const [req, ctx] = createRequest("abc123");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.results).toEqual(preBuiltData.data);
      expect(data.dimensions).toEqual([]);
      expect(data.metrics).toEqual([]);
    });

    it("propagates error from report metadata fetch failure", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (prisma.shareLink.findUnique as any).mockResolvedValue(mockShareLink);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: "Not authorized" }),
      });

      const [req, ctx] = createRequest("abc123");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Not authorized");
    });

    it("adds x-shared-report-bypass header to internal fetch calls", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (prisma.shareLink.findUnique as any).mockResolvedValue(mockShareLink);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockMetadataResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockReportResponse,
        });

      const [req, ctx] = createRequest("abc123");
      await GET(req, ctx);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-shared-report-bypass": "true",
          }),
        })
      );
    });
  });

  describe("Error handling", () => {
    it("returns 500 when database throws", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (prisma.shareLink.findUnique as any).mockRejectedValue(new Error("DB error"));

      const [req, ctx] = createRequest("abc123");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Failed to load report data");
    });
  });
});
