import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/server/db", () => ({
  db: {
    projects: {
      findFirst: vi.fn(),
    },
  },
}));

import { getServerSession } from "next-auth/next";
import { db } from "~/server/db";

import { POST } from "./route";

const createMockRequest = (body: any): NextRequest => {
  return {
    json: async () => body,
  } as unknown as NextRequest;
};

describe("Admin Validate Project Name Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    it("returns 401 when unauthenticated (no session)", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const request = createMockRequest({ name: "My Project" });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when user is not ADMIN", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "user-1", access: "USER" },
      });

      const request = createMockRequest({ name: "My Project" });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    it("returns 400 when name is missing", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });

      const request = createMockRequest({});
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Project name is required");
    });

    it("returns 400 when name is not a string", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });

      const request = createMockRequest({ name: 123 });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Project name is required");
    });
  });

  describe("POST - validate project name uniqueness", () => {
    it("returns isUnique: true when name is available", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (db.projects.findFirst as any).mockResolvedValue(null);

      const request = createMockRequest({ name: "Unique Project Name" });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isUnique).toBe(true);
      expect(data.message).toContain("available");
    });

    it("returns isUnique: false when name already exists (active project)", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (db.projects.findFirst as any).mockResolvedValue({
        id: 10,
        name: "Existing Project",
        isDeleted: false,
      });

      const request = createMockRequest({ name: "Existing Project" });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isUnique).toBe(false);
      expect(data.message).toContain("already exists");
      expect(data.conflictingProject.isDeleted).toBe(false);
    });

    it("returns isUnique: false with deleted message when name was used by deleted project", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (db.projects.findFirst as any).mockResolvedValue({
        id: 5,
        name: "Old Deleted Project",
        isDeleted: true,
      });

      const request = createMockRequest({ name: "Old Deleted Project" });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isUnique).toBe(false);
      expect(data.message).toContain("deleted project");
      expect(data.conflictingProject.isDeleted).toBe(true);
    });

    it("passes excludeId to query when provided (for edit mode)", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (db.projects.findFirst as any).mockResolvedValue(null);

      const request = createMockRequest({ name: "My Project", excludeId: 99 });
      await POST(request);

      expect(db.projects.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            NOT: { id: 99 },
          }),
        })
      );
    });

    it("does case-insensitive name comparison", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (db.projects.findFirst as any).mockResolvedValue(null);

      const request = createMockRequest({ name: "My Project" });
      await POST(request);

      expect(db.projects.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            name: expect.objectContaining({ mode: "insensitive" }),
          }),
        })
      );
    });

    it("returns conflictingProject details when name conflicts", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (db.projects.findFirst as any).mockResolvedValue({
        id: 7,
        name: "Conflict Project",
        isDeleted: false,
      });

      const request = createMockRequest({ name: "Conflict Project" });
      const response = await POST(request);
      const data = await response.json();

      expect(data.conflictingProject).toEqual({
        id: 7,
        name: "Conflict Project",
        isDeleted: false,
      });
    });

    it("returns 500 when database query fails", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (db.projects.findFirst as any).mockRejectedValue(new Error("DB error"));

      const request = createMockRequest({ name: "Some Project" });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Failed to validate project name");
    });
  });
});
