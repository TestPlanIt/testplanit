import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/services/milestoneDescendants", () => ({
  getAllDescendantMilestoneIds: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  db: {
    testRuns: {
      findMany: vi.fn(),
    },
  },
}));

import { getAllDescendantMilestoneIds } from "~/lib/services/milestoneDescendants";
import { db } from "~/server/db";
import { GET } from "./route";

const createRequest = (
  milestoneId: string
): [NextRequest, { params: Promise<{ milestoneId: string }> }] => {
  const req = new NextRequest(
    `http://localhost/api/milestones/${milestoneId}/forecast`
  );
  const params = { params: Promise.resolve({ milestoneId }) };
  return [req, params];
};

describe("GET /api/milestones/[milestoneId]/forecast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Input validation", () => {
    it("returns 400 for non-numeric milestoneId", async () => {
      const [req, ctx] = createRequest("not-a-number");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid milestoneId");
    });
  });

  describe("Success - no test runs", () => {
    it("returns zero estimates when no test runs exist", async () => {
      (getAllDescendantMilestoneIds as any).mockResolvedValue([]);
      (db.testRuns.findMany as any).mockResolvedValue([]);

      const [req, ctx] = createRequest("1");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.manualEstimate).toBe(0);
      expect(data.mixedEstimate).toBe(0);
      expect(data.automatedEstimate).toBe(0);
      expect(data.areAllCasesAutomated).toBe(false);
    });

    it("returns zero estimates when test runs array is empty", async () => {
      (getAllDescendantMilestoneIds as any).mockResolvedValue([2, 3]);
      (db.testRuns.findMany as any).mockResolvedValue([]);

      const [req, ctx] = createRequest("1");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.manualEstimate).toBe(0);
      expect(data.areAllCasesAutomated).toBe(false);
    });
  });

  describe("Success - with test runs", () => {
    it("sums manual and automated estimates from test runs", async () => {
      (getAllDescendantMilestoneIds as any).mockResolvedValue([]);
      (db.testRuns.findMany as any).mockResolvedValue([
        { forecastManual: 100, forecastAutomated: 50 },
        { forecastManual: 200, forecastAutomated: 75 },
      ]);

      const [req, ctx] = createRequest("1");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.manualEstimate).toBe(300);
      expect(data.automatedEstimate).toBe(125);
      expect(data.mixedEstimate).toBe(425);
      expect(data.areAllCasesAutomated).toBe(false);
    });

    it("handles null forecast values gracefully", async () => {
      (getAllDescendantMilestoneIds as any).mockResolvedValue([]);
      (db.testRuns.findMany as any).mockResolvedValue([
        { forecastManual: null, forecastAutomated: null },
        { forecastManual: 150, forecastAutomated: null },
      ]);

      const [req, ctx] = createRequest("1");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.manualEstimate).toBe(150);
      expect(data.automatedEstimate).toBe(0);
      expect(data.mixedEstimate).toBe(150);
    });

    it("sets areAllCasesAutomated=true when manual=0 and automated>0", async () => {
      (getAllDescendantMilestoneIds as any).mockResolvedValue([]);
      (db.testRuns.findMany as any).mockResolvedValue([
        { forecastManual: 0, forecastAutomated: 300 },
      ]);

      const [req, ctx] = createRequest("1");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.areAllCasesAutomated).toBe(true);
    });

    it("sets areAllCasesAutomated=false when both are 0", async () => {
      (getAllDescendantMilestoneIds as any).mockResolvedValue([]);
      (db.testRuns.findMany as any).mockResolvedValue([
        { forecastManual: 0, forecastAutomated: 0 },
      ]);

      const [req, ctx] = createRequest("1");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.areAllCasesAutomated).toBe(false);
    });

    it("queries milestoneId and all descendants", async () => {
      (getAllDescendantMilestoneIds as any).mockResolvedValue([10, 11]);
      (db.testRuns.findMany as any).mockResolvedValue([]);

      const [req, ctx] = createRequest("5");
      await GET(req, ctx);

      expect(getAllDescendantMilestoneIds).toHaveBeenCalledWith(5);
      expect(db.testRuns.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            milestoneId: { in: [5, 10, 11] },
            isDeleted: false,
          }),
        })
      );
    });
  });

  describe("Error handling", () => {
    it("returns 500 when db throws", async () => {
      (getAllDescendantMilestoneIds as any).mockResolvedValue([]);
      (db.testRuns.findMany as any).mockRejectedValue(new Error("DB error"));

      const [req, ctx] = createRequest("1");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Internal server error");
    });
  });
});
