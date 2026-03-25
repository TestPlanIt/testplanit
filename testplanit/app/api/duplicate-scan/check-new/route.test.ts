import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Stable mock refs via vi.hoisted() ───────────────────────────────────────

const {
  mockGetServerSession,
  mockGetCurrentTenantId,
  mockGetElasticsearchClient,
  mockFindSimilarCases,
  mockFindMany,
  mockUpsert,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetCurrentTenantId: vi.fn(),
  mockGetElasticsearchClient: vi.fn(),
  mockFindSimilarCases: vi.fn(),
  mockFindMany: vi.fn(),
  mockUpsert: vi.fn(),
}));

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/multiTenantPrisma", () => ({
  getCurrentTenantId: () => mockGetCurrentTenantId(),
}));

vi.mock("~/services/elasticsearchService", () => ({
  getElasticsearchClient: () => mockGetElasticsearchClient(),
}));

vi.mock("~/lib/services/duplicateScanService", () => ({
  DuplicateScanService: class {
    findSimilarCases = (...args: any[]) => mockFindSimilarCases(...args);
  },
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    repositoryCases: {
      findMany: (...args: any[]) => mockFindMany(...args),
    },
    duplicateScanResult: {
      upsert: (...args: any[]) => mockUpsert(...args),
    },
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/duplicate-scan/check-new", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makePair(caseBId: number, score = 0.85) {
  return {
    caseAId: 0,
    caseBId,
    score,
    confidence: score >= 0.9 ? "HIGH" : score >= 0.8 ? "MEDIUM" : "LOW",
    matchedFields: ["name"],
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/duplicate-scan/check-new", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockGetCurrentTenantId.mockReturnValue("tenant-1");
    mockGetElasticsearchClient.mockReturnValue({ search: vi.fn() });
    mockFindSimilarCases.mockResolvedValue([]);
    mockFindMany.mockResolvedValue([]);
    mockUpsert.mockResolvedValue({});
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ projectId: 1, name: "Test" }));
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 for invalid request body", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ projectId: "not-a-number" }));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid request");
  });

  it("returns empty cases when ES client is not available", async () => {
    mockGetElasticsearchClient.mockReturnValue(null);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ projectId: 1, name: "Test" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.cases).toEqual([]);
  });

  it("returns empty cases when no similar cases found", async () => {
    mockFindSimilarCases.mockResolvedValue([]);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ projectId: 1, name: "Unique Test" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.cases).toEqual([]);
  });

  it("returns top 3 candidates with names, scores, and matchedFields", async () => {
    mockFindSimilarCases.mockResolvedValue([
      makePair(10, 0.95),
      makePair(20, 0.88),
      makePair(30, 0.82),
      makePair(40, 0.75), // 4th — should be excluded
    ]);
    mockFindMany.mockResolvedValue([
      { id: 10, name: "Login Test" },
      { id: 20, name: "Auth Test" },
      { id: 30, name: "Sign In Test" },
    ]);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ projectId: 1, name: "Login Test Variant" }));
    const data = await res.json();

    expect(data.cases).toHaveLength(3);
    expect(data.cases[0]).toMatchObject({ id: 10, name: "Login Test", score: 0.95, confidence: "HIGH" });
    expect(data.cases[1]).toMatchObject({ id: 20, name: "Auth Test", score: 0.88, confidence: "MEDIUM" });
    expect(data.cases[2]).toMatchObject({ id: 30, name: "Sign In Test", score: 0.82, confidence: "MEDIUM" });
  });

  describe("persistence of DuplicateScanResult records", () => {
    it("does NOT create DuplicateScanResult records when caseId is not provided", async () => {
      mockFindSimilarCases.mockResolvedValue([makePair(10, 0.9)]);
      mockFindMany.mockResolvedValue([{ id: 10, name: "Login Test" }]);

      const { POST } = await import("./route");
      await POST(makeRequest({ projectId: 1, name: "Login Test Variant" }));

      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it("creates DuplicateScanResult records when caseId is provided", async () => {
      mockFindSimilarCases.mockResolvedValue([
        makePair(10, 0.92),
        makePair(20, 0.85),
      ]);
      mockFindMany.mockResolvedValue([
        { id: 10, name: "Login Test" },
        { id: 20, name: "Auth Test" },
      ]);

      const { POST } = await import("./route");
      const res = await POST(makeRequest({
        projectId: 5,
        caseId: 99,
        name: "Login Test Variant",
      }));
      const data = await res.json();

      // Should still return the cases
      expect(data.cases).toHaveLength(2);

      // Should have persisted 2 DuplicateScanResult records
      expect(mockUpsert).toHaveBeenCalledTimes(2);
    });

    it("uses canonical ordering (lowId, highId) for caseAId and caseBId", async () => {
      // caseId=99, candidateId=10 → lowId=10, highId=99
      mockFindSimilarCases.mockResolvedValue([makePair(10, 0.9)]);
      mockFindMany.mockResolvedValue([{ id: 10, name: "Login Test" }]);

      const { POST } = await import("./route");
      await POST(makeRequest({ projectId: 5, caseId: 99, name: "Test" }));

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            caseAId_caseBId_scanJobId: {
              caseAId: 10,
              caseBId: 99,
              scanJobId: "creation-check",
            },
          },
          create: expect.objectContaining({
            projectId: 5,
            caseAId: 10,
            caseBId: 99,
            score: 0.9,
            matchedFields: ["name"],
            detectionMethod: "creation-check",
            scanJobId: "creation-check",
          }),
          update: expect.objectContaining({
            score: 0.9,
            matchedFields: ["name"],
            isDeleted: false,
            status: "PENDING",
          }),
        })
      );
    });

    it("uses canonical ordering when caseId is lower than candidateId", async () => {
      // caseId=5, candidateId=100 → lowId=5, highId=100
      mockFindSimilarCases.mockResolvedValue([makePair(100, 0.88)]);
      mockFindMany.mockResolvedValue([{ id: 100, name: "Some Test" }]);

      const { POST } = await import("./route");
      await POST(makeRequest({ projectId: 1, caseId: 5, name: "Test" }));

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            caseAId_caseBId_scanJobId: {
              caseAId: 5,
              caseBId: 100,
              scanJobId: "creation-check",
            },
          },
        })
      );
    });

    it("still returns cases even if persistence fails", async () => {
      mockFindSimilarCases.mockResolvedValue([makePair(10, 0.9)]);
      mockFindMany.mockResolvedValue([{ id: 10, name: "Login Test" }]);
      mockUpsert.mockRejectedValue(new Error("DB connection failed"));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { POST } = await import("./route");
      const res = await POST(makeRequest({
        projectId: 1,
        caseId: 50,
        name: "Login Test Variant",
      }));
      const data = await res.json();

      // Cases should still be returned despite persistence failure
      expect(res.status).toBe(200);
      expect(data.cases).toHaveLength(1);
      expect(data.cases[0]).toMatchObject({ id: 10, name: "Login Test" });

      // Error should be logged
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to persist creation-check results:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it("persists each candidate with its own score from the similarity engine", async () => {
      mockFindSimilarCases.mockResolvedValue([
        makePair(10, 0.95),
        makePair(20, 0.82),
        makePair(30, 0.71),
      ]);
      mockFindMany.mockResolvedValue([
        { id: 10, name: "A" },
        { id: 20, name: "B" },
        { id: 30, name: "C" },
      ]);

      const { POST } = await import("./route");
      await POST(makeRequest({ projectId: 1, caseId: 50, name: "Test" }));

      expect(mockUpsert).toHaveBeenCalledTimes(3);

      // Verify each call has the correct score
      const scores = mockUpsert.mock.calls.map(
        (call: any[]) => call[0].create.score
      );
      expect(scores).toEqual([0.95, 0.82, 0.71]);
    });
  });
});
