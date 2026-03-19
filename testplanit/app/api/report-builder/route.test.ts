import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock prisma before importing route handler
vi.mock("@/lib/prisma", () => ({
  prisma: {
    status: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    testRuns: { findMany: vi.fn() },
    testRunCases: { findMany: vi.fn() },
    testRunResults: { findMany: vi.fn(), groupBy: vi.fn() },
    milestones: { findMany: vi.fn() },
  },
}));

vi.mock("~/lib/schemas/reportRequestSchema", async (importOriginal) => {
  const original = await importOriginal<typeof import("~/lib/schemas/reportRequestSchema")>();
  return original;
});

import { prisma } from "@/lib/prisma";
import { GET, POST } from "./route";

const createPOSTRequest = (body: Record<string, unknown>): NextRequest => {
  return new NextRequest("http://localhost/api/report-builder", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
};

const createGETRequest = (params?: Record<string, string>): NextRequest => {
  const url = new URL("http://localhost/api/report-builder");
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url.toString());
};

describe("GET /api/report-builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.status.findMany as any).mockResolvedValue([]);
    (prisma.user.findMany as any).mockResolvedValue([]);
    (prisma.testRuns.findMany as any).mockResolvedValue([]);
    (prisma.testRunCases.findMany as any).mockResolvedValue([]);
    (prisma.testRunResults.findMany as any).mockResolvedValue([]);
    (prisma.milestones.findMany as any).mockResolvedValue([]);
  });

  it("returns dimensions and metrics metadata", async () => {
    const response = await GET(createGETRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty("dimensions");
    expect(data).toHaveProperty("metrics");
    expect(Array.isArray(data.dimensions)).toBe(true);
    expect(Array.isArray(data.metrics)).toBe(true);
  });

  it("returns dimension objects with id and label fields", async () => {
    const response = await GET(createGETRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    for (const dim of data.dimensions) {
      expect(dim).toHaveProperty("id");
      expect(dim).toHaveProperty("label");
    }
  });

  it("returns metric objects with id and label fields", async () => {
    const response = await GET(createGETRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    for (const metric of data.metrics) {
      expect(metric).toHaveProperty("id");
      expect(metric).toHaveProperty("label");
    }
  });

  it("returns dimension values when projectId is provided", async () => {
    (prisma.status.findMany as any).mockResolvedValue([
      { id: 1, name: "Passed", color: { value: "#22c55e" } },
    ]);

    const response = await GET(createGETRequest({ projectId: "1" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    const statusDim = data.dimensions.find((d: any) => d.id === "status");
    expect(statusDim).toBeDefined();
    expect(statusDim.values).toHaveLength(1);
    expect(statusDim.values[0].name).toBe("Passed");
  });

  it("handles errors from dimension value fetching gracefully", async () => {
    (prisma.status.findMany as any).mockRejectedValue(new Error("DB error"));

    const response = await GET(createGETRequest({ projectId: "1" }));
    const data = await response.json();

    // Should not crash — dimension with error falls back to empty values
    expect(response.status).toBe(200);
    const statusDim = data.dimensions.find((d: any) => d.id === "status");
    expect(statusDim.values).toEqual([]);
  });
});

describe("POST /api/report-builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.status.findMany as any).mockResolvedValue([
      { id: 1, name: "Passed", color: { value: "#22c55e" } },
    ]);
    (prisma.testRunResults.findMany as any).mockResolvedValue([
      {
        statusId: 1,
        status: { name: "Passed", color: { value: "#22c55e" } },
        testResultCount: 5,
      },
    ]);
    (prisma.testRunResults.groupBy as any).mockResolvedValue([
      { statusId: 1, _count: { id: 5 } },
    ]);
  });

  describe("Input validation", () => {
    it("returns 400 when projectId is missing", async () => {
      const response = await POST(
        createPOSTRequest({
          dimensions: ["status"],
          metrics: ["testResultCount"],
        })
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });

    it("returns 400 when dimensions array is empty", async () => {
      const response = await POST(
        createPOSTRequest({
          projectId: 1,
          dimensions: [],
          metrics: ["testResultCount"],
        })
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });

    it("returns 400 when metrics array is empty", async () => {
      const response = await POST(
        createPOSTRequest({
          projectId: 1,
          dimensions: ["status"],
          metrics: [],
        })
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });

    it("returns 400 for unsupported dimension", async () => {
      const response = await POST(
        createPOSTRequest({
          projectId: 1,
          dimensions: ["invalidDimension"],
          metrics: ["testResultCount"],
        })
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("invalidDimension");
    });

    it("returns 400 for unsupported metric", async () => {
      const response = await POST(
        createPOSTRequest({
          projectId: 1,
          dimensions: ["status"],
          metrics: ["invalidMetric"],
        })
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("invalidMetric");
    });
  });

  describe("Successful report generation", () => {
    it("returns results array for valid status dimension request", async () => {
      const response = await POST(
        createPOSTRequest({
          projectId: 1,
          dimensions: ["status"],
          metrics: ["testResultCount"],
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("results");
      expect(Array.isArray(data.results)).toBe(true);
    });

    it("returns empty results array when no data found", async () => {
      (prisma.status.findMany as any).mockResolvedValue([]);
      (prisma.testRunResults.findMany as any).mockResolvedValue([]);

      const response = await POST(
        createPOSTRequest({
          projectId: 1,
          dimensions: ["status"],
          metrics: ["testResultCount"],
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.results).toEqual([]);
    });
  });
});
