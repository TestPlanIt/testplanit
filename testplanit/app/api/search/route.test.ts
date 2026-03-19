import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/services/elasticsearchService", () => ({
  getElasticsearchClient: vi.fn(),
}));

vi.mock("~/lib/multiTenantPrisma", () => ({
  getCurrentTenantId: vi.fn(),
}));

vi.mock("~/services/unifiedElasticsearchService", () => ({
  getIndicesForEntityTypes: vi.fn(),
}));

vi.mock("~/lib/services/searchQueryBuilder", () => ({
  buildElasticsearchQuery: vi.fn(),
  buildSearchAggregations: vi.fn(),
  buildSort: vi.fn(),
  getEntityTypeCounts: vi.fn(),
  getEntityTypeFromIndex: vi.fn(),
  processFacets: vi.fn(),
}));

import { getServerSession } from "next-auth/next";
import { getCurrentTenantId } from "~/lib/multiTenantPrisma";
import {
  buildElasticsearchQuery,
  buildSearchAggregations,
  buildSort,
  getEntityTypeCounts,
  getEntityTypeFromIndex,
  processFacets,
} from "~/lib/services/searchQueryBuilder";
import { getElasticsearchClient } from "~/services/elasticsearchService";
import { getIndicesForEntityTypes } from "~/services/unifiedElasticsearchService";

import { POST } from "./route";

const createMockRequest = (body: any): NextRequest => {
  return {
    json: async () => body,
  } as unknown as NextRequest;
};

const mockUser = {
  id: "user-123",
  name: "Test User",
  email: "test@example.com",
};

const defaultSearchOptions = {
  filters: {
    entityTypes: ["repositoryCases"],
    query: "my test",
  },
  pagination: { page: 1, size: 10 },
  highlight: true,
};

describe("Search Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getCurrentTenantId as any).mockReturnValue(null);
    (getIndicesForEntityTypes as any).mockReturnValue(["testplanit-repository-cases"]);
    (buildElasticsearchQuery as any).mockResolvedValue({ match_all: {} });
    (buildSort as any).mockReturnValue([]);
    (buildSearchAggregations as any).mockReturnValue({});
    (getEntityTypeFromIndex as any).mockReturnValue("repositoryCases");
    (processFacets as any).mockReturnValue({});
    (getEntityTypeCounts as any).mockResolvedValue({ repositoryCases: 5 });
  });

  describe("Authentication", () => {
    it("returns 401 when unauthenticated", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const request = createMockRequest(defaultSearchOptions);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user", async () => {
      (getServerSession as any).mockResolvedValue({});

      const request = createMockRequest(defaultSearchOptions);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Elasticsearch availability", () => {
    it("returns 503 when Elasticsearch client is null", async () => {
      (getServerSession as any).mockResolvedValue({ user: mockUser });
      (getElasticsearchClient as any).mockReturnValue(null);

      const request = createMockRequest(defaultSearchOptions);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.error).toContain("Search service unavailable");
    });
  });

  describe("POST - successful search", () => {
    const setupEsClient = (overrides: Partial<any> = {}) => {
      const mockEsClient = {
        indices: {
          exists: vi.fn().mockResolvedValue(true),
        },
        search: vi.fn().mockResolvedValue({
          hits: {
            total: { value: 1 },
            hits: [
              {
                _index: "testplanit-repository-cases",
                _source: { id: "case-1", name: "Test Case" },
                _score: 1.5,
                highlight: { name: ["<mark>test</mark>"] },
              },
            ],
          },
          aggregations: {},
          took: 5,
        }),
        ...overrides,
      };
      (getElasticsearchClient as any).mockReturnValue(mockEsClient);
      return mockEsClient;
    };

    it("returns UnifiedSearchResult shape with hits, total, facets, took", async () => {
      (getServerSession as any).mockResolvedValue({ user: mockUser });
      setupEsClient();

      const request = createMockRequest(defaultSearchOptions);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("total");
      expect(data).toHaveProperty("hits");
      expect(data).toHaveProperty("facets");
      expect(data).toHaveProperty("took");
      expect(Array.isArray(data.hits)).toBe(true);
    });

    it("maps hit to SearchHit with id, entityType, score, source, highlights", async () => {
      (getServerSession as any).mockResolvedValue({ user: mockUser });
      setupEsClient();

      const request = createMockRequest(defaultSearchOptions);
      const response = await POST(request);
      const data = await response.json();

      expect(data.hits).toHaveLength(1);
      const hit = data.hits[0];
      expect(hit.id).toBe("case-1");
      expect(hit.entityType).toBe("repositoryCases");
      expect(hit.score).toBe(1.5);
      expect(hit.source).toEqual({ id: "case-1", name: "Test Case" });
    });

    it("returns empty result when no indices exist", async () => {
      (getServerSession as any).mockResolvedValue({ user: mockUser });
      const mockEsClient = {
        indices: {
          exists: vi.fn().mockResolvedValue(false),
        },
        search: vi.fn(),
      };
      (getElasticsearchClient as any).mockReturnValue(mockEsClient);

      const request = createMockRequest(defaultSearchOptions);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.total).toBe(0);
      expect(data.hits).toEqual([]);
      expect(mockEsClient.search).not.toHaveBeenCalled();
    });

    it("uses tenantId when determining indices", async () => {
      (getServerSession as any).mockResolvedValue({ user: mockUser });
      (getCurrentTenantId as any).mockReturnValue("tenant-abc");
      setupEsClient();

      const request = createMockRequest(defaultSearchOptions);
      await POST(request);

      expect(getIndicesForEntityTypes).toHaveBeenCalledWith(
        defaultSearchOptions.filters.entityTypes,
        "tenant-abc"
      );
    });

    it("passes user to buildElasticsearchQuery for access filtering", async () => {
      (getServerSession as any).mockResolvedValue({ user: mockUser });
      setupEsClient();

      const request = createMockRequest(defaultSearchOptions);
      await POST(request);

      expect(buildElasticsearchQuery).toHaveBeenCalledWith(
        defaultSearchOptions.filters,
        mockUser
      );
    });

    it("returns empty result when search throws (graceful degradation)", async () => {
      (getServerSession as any).mockResolvedValue({ user: mockUser });
      const mockEsClient = {
        indices: {
          exists: vi.fn().mockResolvedValue(true),
        },
        search: vi.fn().mockRejectedValue(new Error("ES query failed")),
      };
      (getElasticsearchClient as any).mockReturnValue(mockEsClient);

      const request = createMockRequest(defaultSearchOptions);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.total).toBe(0);
      expect(data.hits).toEqual([]);
      expect(data.error).toBe("Search failed");
    });

    it("builds aggregations when facets provided in request", async () => {
      (getServerSession as any).mockResolvedValue({ user: mockUser });
      setupEsClient();

      const searchOptionsWithFacets = {
        ...defaultSearchOptions,
        facets: [{ field: "status", size: 10 }],
      };

      const request = createMockRequest(searchOptionsWithFacets);
      await POST(request);

      expect(buildSearchAggregations).toHaveBeenCalledWith(
        searchOptionsWithFacets.facets,
        searchOptionsWithFacets.filters.entityTypes
      );
    });

    it("does not call buildSearchAggregations when facets not provided", async () => {
      (getServerSession as any).mockResolvedValue({ user: mockUser });
      setupEsClient();

      const searchOptionsNoFacets = { ...defaultSearchOptions };
      delete (searchOptionsNoFacets as any).facets;

      const request = createMockRequest(searchOptionsNoFacets);
      await POST(request);

      expect(buildSearchAggregations).not.toHaveBeenCalled();
    });

    it("extracts highlights from inner_hits steps", async () => {
      (getServerSession as any).mockResolvedValue({ user: mockUser });
      const mockEsClient = {
        indices: { exists: vi.fn().mockResolvedValue(true) },
        search: vi.fn().mockResolvedValue({
          hits: {
            total: { value: 1 },
            hits: [
              {
                _index: "testplanit-repository-cases",
                _source: { id: "case-2" },
                _score: 1.0,
                highlight: {},
                inner_hits: {
                  steps: {
                    hits: {
                      hits: [
                        {
                          highlight: {
                            "steps.step": ["<mark>click</mark>"],
                            "steps.expectedResult": ["<mark>success</mark>"],
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
          aggregations: {},
          took: 3,
        }),
      };
      (getElasticsearchClient as any).mockReturnValue(mockEsClient);

      const request = createMockRequest(defaultSearchOptions);
      const response = await POST(request);
      const data = await response.json();

      expect(data.hits[0].highlights["steps.step"]).toEqual(["<mark>click</mark>"]);
      expect(data.hits[0].highlights["steps.expectedResult"]).toEqual(["<mark>success</mark>"]);
    });
  });
});
