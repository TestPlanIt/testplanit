import { describe, it, expect, vi } from "vitest";
import { DuplicateScanService } from "./duplicateScanService";
import type { CaseSearchInput } from "./duplicateScanService";

// Mock ES client
function makeMockEsClient(hits: any[] = []) {
  return {
    search: vi.fn().mockResolvedValue({
      hits: {
        hits,
        total: { value: hits.length, relation: "eq" },
      },
      took: 5,
    }),
  };
}

function makeHit(overrides: Partial<{
  _score: number;
  id: number;
  name: string;
  projectId: number;
  tags: Array<{ name: string }>;
  customFields: Array<{ fieldName: string; value?: any }>;
  steps: Array<{ step: string; expectedResult: string }>;
}> = {}) {
  return {
    _score: overrides._score ?? 5.0,
    _source: {
      id: overrides.id ?? 100,
      name: overrides.name ?? "Login test case",
      projectId: overrides.projectId ?? 1,
      tags: overrides.tags ?? [],
      customFields: overrides.customFields ?? [],
      steps: overrides.steps ?? [],
    },
  };
}

const mockPrisma = {} as any;

describe("DuplicateScanService", () => {
  describe("findSimilarCases", () => {
    it("returns empty array when ES client is null", async () => {
      const service = new DuplicateScanService(mockPrisma, null);
      const input: CaseSearchInput = { id: 1, name: "Login test" };
      const result = await service.findSimilarCases(input, 1);
      expect(result).toEqual([]);
    });

    it("sends more_like_this query with projectId filter", async () => {
      const esClient = makeMockEsClient([]);
      const service = new DuplicateScanService(mockPrisma, esClient as any);
      const input: CaseSearchInput = { id: 1, name: "Login test" };

      await service.findSimilarCases(input, 42);

      expect(esClient.search).toHaveBeenCalledOnce();
      const callArg = esClient.search.mock.calls[0][0];
      expect(callArg.query.bool.filter).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ term: { projectId: 42 } }),
        ])
      );
    });

    it("sends query with isDeleted:false filter", async () => {
      const esClient = makeMockEsClient([]);
      const service = new DuplicateScanService(mockPrisma, esClient as any);
      const input: CaseSearchInput = { id: 1, name: "Login test" };

      await service.findSimilarCases(input, 1);

      const callArg = esClient.search.mock.calls[0][0];
      expect(callArg.query.bool.filter).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ term: { isDeleted: false } }),
        ])
      );
    });

    it("sends more_like_this query in must clause", async () => {
      const esClient = makeMockEsClient([]);
      const service = new DuplicateScanService(mockPrisma, esClient as any);
      const input: CaseSearchInput = { id: 1, name: "Login test" };

      await service.findSimilarCases(input, 1);

      const callArg = esClient.search.mock.calls[0][0];
      const mustClause = callArg.query.bool.must;
      expect(mustClause).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ more_like_this: expect.any(Object) }),
        ])
      );
    });

    it("excludes the source case itself from results", async () => {
      const esClient = makeMockEsClient([makeHit({ id: 1, _score: 9.0 })]);
      const service = new DuplicateScanService(mockPrisma, esClient as any);
      const input: CaseSearchInput = { id: 1, name: "Login test" };

      const result = await service.findSimilarCases(input, 1);
      expect(result).toEqual([]);
    });

    it("returns pairs with canonical ordering (caseAId < caseBId)", async () => {
      // source id = 200, candidate id = 100 => should produce caseAId=100, caseBId=200
      const esClient = makeMockEsClient([
        makeHit({ id: 100, name: "Login test case", _score: 9.0 }),
      ]);
      const service = new DuplicateScanService(mockPrisma, esClient as any);
      const input: CaseSearchInput = { id: 200, name: "Login test case" };

      const result = await service.findSimilarCases(input, 1);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].caseAId).toBe(100);
      expect(result[0].caseBId).toBe(200);
    });

    it("also orders canonically when candidate id > source id", async () => {
      // source id = 50, candidate id = 200 => caseAId=50, caseBId=200
      const esClient = makeMockEsClient([
        makeHit({ id: 200, name: "Login test case", _score: 9.0 }),
      ]);
      const service = new DuplicateScanService(mockPrisma, esClient as any);
      const input: CaseSearchInput = { id: 50, name: "Login test case" };

      const result = await service.findSimilarCases(input, 1);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].caseAId).toBe(50);
      expect(result[0].caseBId).toBe(200);
    });

    it("filters out pairs with combined score below 0.55 (below LOW threshold)", async () => {
      // Name "abc" vs "xyz" has very low JW similarity
      // With low ES score (0.1 normalized) and no tags/fields, combined should be below threshold
      const esClient = makeMockEsClient([
        makeHit({ id: 99, name: "xyz completely different case", _score: 0.1 }),
      ]);
      const service = new DuplicateScanService(mockPrisma, esClient as any);
      const input: CaseSearchInput = { id: 1, name: "abc nothing in common" };

      const result = await service.findSimilarCases(input, 1);
      expect(result).toEqual([]);
    });

    it("returns HIGH confidence for very similar cases", async () => {
      // Very similar name + high ES score
      const esClient = makeMockEsClient([
        makeHit({ id: 100, name: "Login with valid credentials", _score: 10.0 }),
      ]);
      const service = new DuplicateScanService(mockPrisma, esClient as any);
      const input: CaseSearchInput = { id: 1, name: "Login with valid credentials" };

      const result = await service.findSimilarCases(input, 1);
      expect(result.length).toBe(1);
      expect(result[0].confidence).toBe("HIGH");
    });

    it("includes 'name' in matchedFields when name passes dual gate (Levenshtein + token Jaccard)", async () => {
      // "Login with valid credentials" vs "Login with valid credential" — Levenshtein ~0.97, Jaccard 3/4=0.75 → fails Jaccard
      // Use identical names to guarantee both gates pass
      const esClient = makeMockEsClient([
        makeHit({ id: 100, name: "Login with valid credentials", _score: 5.0 }),
      ]);
      const service = new DuplicateScanService(mockPrisma, esClient as any);
      const input: CaseSearchInput = { id: 1, name: "Login with valid credentials" };

      const result = await service.findSimilarCases(input, 1);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].matchedFields).toContain("name");
    });

    it("includes 'tags' in matchedFields when Jaccard overlap > 0", async () => {
      const esClient = makeMockEsClient([
        makeHit({
          id: 100,
          name: "Login test case",
          _score: 8.0,
          tags: [{ name: "auth" }, { name: "smoke" }],
        }),
      ]);
      const service = new DuplicateScanService(mockPrisma, esClient as any);
      const input: CaseSearchInput = {
        id: 1,
        name: "Login test case",
        tags: [{ name: "auth" }],
      };

      const result = await service.findSimilarCases(input, 1);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].matchedFields).toContain("tags");
    });

    it("includes 'fields' in matchedFields when field value overlap > 0", async () => {
      const esClient = makeMockEsClient([
        makeHit({
          id: 100,
          name: "Login test case",
          _score: 8.0,
          customFields: [{ fieldName: "Priority", value: "High" }],
        }),
      ]);
      const service = new DuplicateScanService(mockPrisma, esClient as any);
      const input: CaseSearchInput = {
        id: 1,
        name: "Login test case",
        customFieldValues: [{ fieldName: "Priority", value: "High" }],
      };

      const result = await service.findSimilarCases(input, 1);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].matchedFields).toContain("fields");
    });

    it("normalizes ES _score to 0-1 range using MAX_ES_SCORE", async () => {
      // An ES score of 10 should produce stepsScore=1.0 (capped)
      // Score > 10 should also cap at 1.0
      const esClient = makeMockEsClient([
        makeHit({ id: 100, name: "Login test", _score: 20.0 }), // exceeds MAX_ES_SCORE
      ]);
      const service = new DuplicateScanService(mockPrisma, esClient as any);
      const input: CaseSearchInput = { id: 1, name: "Login test" };

      const result = await service.findSimilarCases(input, 1);
      // Combined score should not exceed 1.0
      if (result.length > 0) {
        expect(result[0].score).toBeLessThanOrEqual(1.0);
      }
    });

    it("returns all qualifying pairs without an artificial cap", async () => {
      // Create 120 hits — all should be returned if they pass the name gate
      const hits = Array.from({ length: 120 }, (_, i) => ({
        _score: 6.0 + Math.random(),
        _source: {
          id: 1000 + i,
          name: "Login test case",
          projectId: 1,
          tags: [],
          customFields: [],
          steps: [],
        },
      }));

      const esClient = makeMockEsClient(hits);
      const service = new DuplicateScanService(mockPrisma, esClient as any);
      const input: CaseSearchInput = { id: 1, name: "Login test case" };

      const result = await service.findSimilarCases(input, 1);
      // All 120 hits have identical names so they all pass the name gate
      expect(result.length).toBe(120);
    });

    it("returns pairs sorted by score descending", async () => {
      const esClient = makeMockEsClient([
        makeHit({ id: 101, name: "Login with valid credentials", _score: 2.0 }),
        makeHit({ id: 102, name: "Login with valid credentials", _score: 9.0 }),
        makeHit({ id: 103, name: "Login with valid credentials", _score: 5.0 }),
      ]);
      const service = new DuplicateScanService(mockPrisma, esClient as any);
      const input: CaseSearchInput = { id: 1, name: "Login with valid credentials" };

      const result = await service.findSimilarCases(input, 1);
      // Sort should be descending
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
      }
    });

    it("uses the correct index name with tenantId", async () => {
      const esClient = makeMockEsClient([]);
      const service = new DuplicateScanService(mockPrisma, esClient as any);
      const input: CaseSearchInput = { id: 1, name: "Login test" };

      await service.findSimilarCases(input, 1, "tenant123");

      const callArg = esClient.search.mock.calls[0][0];
      expect(callArg.index).toBe("testplanit-tenant123-repository-cases");
    });

    it("uses default index name when tenantId is not provided", async () => {
      const esClient = makeMockEsClient([]);
      const service = new DuplicateScanService(mockPrisma, esClient as any);
      const input: CaseSearchInput = { id: 1, name: "Login test" };

      await service.findSimilarCases(input, 1);

      const callArg = esClient.search.mock.calls[0][0];
      expect(callArg.index).toBe("testplanit-repository-cases");
    });

    it("returns SimilarCasePair with all required fields", async () => {
      const esClient = makeMockEsClient([
        makeHit({ id: 100, name: "Login test case", _score: 9.0 }),
      ]);
      const service = new DuplicateScanService(mockPrisma, esClient as any);
      const input: CaseSearchInput = { id: 1, name: "Login test case" };

      const result = await service.findSimilarCases(input, 1);
      expect(result.length).toBeGreaterThan(0);

      const pair = result[0];
      expect(pair).toHaveProperty("caseAId");
      expect(pair).toHaveProperty("caseBId");
      expect(pair).toHaveProperty("score");
      expect(pair).toHaveProperty("confidence");
      expect(pair).toHaveProperty("matchedFields");
      expect(typeof pair.score).toBe("number");
      expect(["HIGH", "MEDIUM", "LOW"]).toContain(pair.confidence);
      expect(Array.isArray(pair.matchedFields)).toBe(true);
    });
  });
});
