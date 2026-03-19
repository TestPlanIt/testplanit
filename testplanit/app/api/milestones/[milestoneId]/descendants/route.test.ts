import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/services/milestoneDescendants", () => ({
  getAllDescendantMilestoneIds: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { getAllDescendantMilestoneIds } from "~/lib/services/milestoneDescendants";
import { GET } from "./route";

const createRequest = (milestoneId: string): [NextRequest, { params: Promise<{ milestoneId: string }> }] => {
  const req = new NextRequest(`http://localhost/api/milestones/${milestoneId}/descendants`);
  const params = { params: Promise.resolve({ milestoneId }) };
  return [req, params];
};

const mockSession = {
  user: { id: "user-1", name: "Test User" },
};

describe("GET /api/milestones/[milestoneId]/descendants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    it("returns 401 when unauthenticated", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (getAllDescendantMilestoneIds as any).mockResolvedValue([]);

      const [req, ctx] = createRequest("123");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user", async () => {
      (getServerSession as any).mockResolvedValue({});
      (getAllDescendantMilestoneIds as any).mockResolvedValue([]);

      const [req, ctx] = createRequest("123");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Input validation", () => {
    it("returns 400 for non-numeric milestoneId", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const [req, ctx] = createRequest("not-a-number");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid milestone ID");
    });
  });

  describe("Success", () => {
    it("returns descendant milestone IDs", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (getAllDescendantMilestoneIds as any).mockResolvedValue([2, 3, 4]);

      const [req, ctx] = createRequest("1");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.descendantIds).toEqual([2, 3, 4]);
      expect(getAllDescendantMilestoneIds).toHaveBeenCalledWith(1);
    });

    it("returns empty array when milestone has no descendants", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (getAllDescendantMilestoneIds as any).mockResolvedValue([]);

      const [req, ctx] = createRequest("99");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.descendantIds).toEqual([]);
    });
  });

  describe("Error handling", () => {
    it("returns 500 when service throws", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (getAllDescendantMilestoneIds as any).mockRejectedValue(new Error("DB error"));

      const [req, ctx] = createRequest("1");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch milestone descendants");
    });
  });
});
