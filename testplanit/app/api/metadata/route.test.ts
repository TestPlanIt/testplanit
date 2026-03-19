import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnhancedDb } = vi.hoisted(() => ({
  mockEnhancedDb: {
    testRuns: { findUnique: vi.fn() },
    repositoryCases: { findUnique: vi.fn() },
    sessions: { findUnique: vi.fn() },
    projects: { findUnique: vi.fn() },
    milestones: { findUnique: vi.fn() },
  },
}));

vi.mock("~/server/db", () => ({
  db: {},
}));

vi.mock("@zenstackhq/runtime", () => ({
  enhance: vi.fn(() => mockEnhancedDb),
}));

import { GET } from "./route";

function createRequest(searchParams: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/metadata");
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }
  return { url: url.toString() } as unknown as NextRequest;
}

describe("GET /api/metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Validation", () => {
    it("returns 400 when type parameter is missing", async () => {
      const request = createRequest({ id: "1" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing type or id parameter");
    });

    it("returns 400 when id parameter is missing", async () => {
      const request = createRequest({ type: "test-run" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing type or id parameter");
    });

    it("returns 400 when both type and id are missing", async () => {
      const request = createRequest({});
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing type or id parameter");
    });

    it("returns 400 when id is not numeric", async () => {
      const request = createRequest({ type: "test-run", id: "abc" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid id");
    });

    it("returns 400 for unknown type", async () => {
      const request = createRequest({ type: "unknown-type", id: "1" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Unknown type");
    });
  });

  describe("test-run type", () => {
    it("returns title and description for a valid test run", async () => {
      mockEnhancedDb.testRuns.findUnique.mockResolvedValue({
        name: "Sprint 12 Regression",
        isDeleted: false,
        project: { name: "My Project" },
        _count: { testCases: 42 },
      });

      const request = createRequest({ type: "test-run", id: "1" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.title).toContain("Sprint 12 Regression");
      expect(data.title).toContain("My Project");
      expect(data.description).toContain("42");
      expect(data.description).toContain("My Project");
    });

    it("returns generic fallback for deleted test run", async () => {
      mockEnhancedDb.testRuns.findUnique.mockResolvedValue({
        name: "Old Run",
        isDeleted: true,
        project: { name: "My Project" },
        _count: { testCases: 5 },
      });

      const request = createRequest({ type: "test-run", id: "99" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.title).toBe("Test Run");
      expect(data.description).toBe("");
    });

    it("returns generic fallback for non-existent test run", async () => {
      mockEnhancedDb.testRuns.findUnique.mockResolvedValue(null);

      const request = createRequest({ type: "test-run", id: "9999" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.title).toBe("Test Run");
      expect(data.description).toBe("");
    });
  });

  describe("test-case type", () => {
    it("returns title with repository ID for a valid test case", async () => {
      mockEnhancedDb.repositoryCases.findUnique.mockResolvedValue({
        name: "Login validation",
        repositoryId: 1234,
        isDeleted: false,
        project: { name: "Auth Project" },
      });

      const request = createRequest({ type: "test-case", id: "1" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.title).toContain("C1234");
      expect(data.title).toContain("Login validation");
      expect(data.title).toContain("Auth Project");
    });

    it("returns generic fallback for deleted test case", async () => {
      mockEnhancedDb.repositoryCases.findUnique.mockResolvedValue({
        name: "Old Case",
        repositoryId: 1,
        isDeleted: true,
        project: { name: "Some Project" },
      });

      const request = createRequest({ type: "test-case", id: "1" });
      const response = await GET(request);
      const data = await response.json();

      expect(data.title).toBe("Test Case");
      expect(data.description).toBe("");
    });
  });

  describe("session type", () => {
    it("returns title and description for a valid session", async () => {
      mockEnhancedDb.sessions.findUnique.mockResolvedValue({
        name: "Exploratory Session Alpha",
        isDeleted: false,
        project: { name: "Q4 Project" },
      });

      const request = createRequest({ type: "session", id: "5" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.title).toContain("Exploratory Session Alpha");
      expect(data.title).toContain("Q4 Project");
      expect(data.description).toContain("Q4 Project");
    });

    it("returns generic fallback for deleted session", async () => {
      mockEnhancedDb.sessions.findUnique.mockResolvedValue({
        name: "Old Session",
        isDeleted: true,
        project: { name: "Old Project" },
      });

      const request = createRequest({ type: "session", id: "5" });
      const response = await GET(request);
      const data = await response.json();

      expect(data.title).toBe("Exploratory Session");
      expect(data.description).toBe("");
    });
  });

  describe("project type", () => {
    it("returns project name and counts for a valid project", async () => {
      mockEnhancedDb.projects.findUnique.mockResolvedValue({
        name: "Core Platform",
        isDeleted: false,
        _count: { repositoryCases: 150, testRuns: 30 },
      });

      const request = createRequest({ type: "project", id: "10" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.title).toBe("Core Platform");
      expect(data.description).toContain("150");
      expect(data.description).toContain("30");
    });

    it("returns generic fallback for deleted project", async () => {
      mockEnhancedDb.projects.findUnique.mockResolvedValue({
        name: "Old Project",
        isDeleted: true,
        _count: { repositoryCases: 0, testRuns: 0 },
      });

      const request = createRequest({ type: "project", id: "10" });
      const response = await GET(request);
      const data = await response.json();

      expect(data.title).toBe("Project");
      expect(data.description).toBe("");
    });
  });

  describe("milestone type", () => {
    it("returns milestone title and project for a valid milestone", async () => {
      mockEnhancedDb.milestones.findUnique.mockResolvedValue({
        name: "v2.0 Launch",
        isDeleted: false,
        project: { name: "Release Project" },
      });

      const request = createRequest({ type: "milestone", id: "7" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.title).toContain("v2.0 Launch");
      expect(data.title).toContain("Release Project");
      expect(data.description).toContain("Release Project");
    });

    it("returns generic fallback for deleted milestone", async () => {
      mockEnhancedDb.milestones.findUnique.mockResolvedValue({
        name: "Old Milestone",
        isDeleted: true,
        project: { name: "Old Project" },
      });

      const request = createRequest({ type: "milestone", id: "7" });
      const response = await GET(request);
      const data = await response.json();

      expect(data.title).toBe("Milestone");
      expect(data.description).toBe("");
    });
  });

  describe("Error handling", () => {
    it("returns generic TestPlanIt fallback when prisma throws", async () => {
      mockEnhancedDb.testRuns.findUnique.mockRejectedValue(new Error("DB error"));

      const request = createRequest({ type: "test-run", id: "1" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.title).toBe("TestPlanIt");
      expect(data.description).toBe("");
    });
  });
});
