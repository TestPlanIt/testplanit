import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchRepositoryCases } from "./repositoryCaseSearch";
import { getElasticsearchClient } from "./elasticsearchService";

// Mock Elasticsearch
vi.mock("./elasticsearchService", () => ({
  getElasticsearchClient: vi.fn(),
  getRepositoryCaseIndexName: vi.fn(() => "test-repository-cases"),
}));

describe("repositoryCaseSearch", () => {
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      search: vi.fn(),
    };
    vi.mocked(getElasticsearchClient).mockReturnValue(mockClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("searchRepositoryCases", () => {
    it("should return null if client is not available", async () => {
      vi.mocked(getElasticsearchClient).mockReturnValue(null);

      const result = await searchRepositoryCases({});

      expect(result).toBeNull();
      expect(mockClient.search).not.toHaveBeenCalled();
    });

    it("should always filter out soft-deleted cases", async () => {
      mockClient.search.mockResolvedValue({
        hits: {
          hits: [],
          total: { value: 0 },
        },
        took: 10,
      });

      await searchRepositoryCases({
        query: "test",
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            bool: expect.objectContaining({
              filter: expect.arrayContaining([
                { term: { isDeleted: false } },
              ]),
            }),
          }),
        })
      );
    });

    it("should filter by isArchived when specified", async () => {
      mockClient.search.mockResolvedValue({
        hits: {
          hits: [],
          total: { value: 0 },
        },
        took: 10,
      });

      await searchRepositoryCases({
        filters: {
          isArchived: false,
        },
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            bool: expect.objectContaining({
              filter: expect.arrayContaining([
                { term: { isArchived: false } },
                { term: { isDeleted: false } },
              ]),
            }),
          }),
        })
      );
    });

    it("should include isDeleted filter even with no other filters", async () => {
      mockClient.search.mockResolvedValue({
        hits: {
          hits: [],
          total: { value: 0 },
        },
        took: 10,
      });

      await searchRepositoryCases({});

      const searchCall = mockClient.search.mock.calls[0][0];
      const filters = searchCall.query.bool.filter;

      expect(filters).toContainEqual({ term: { isDeleted: false } });
    });

    it("should return search results with proper structure", async () => {
      const mockHit = {
        _id: "123",
        _score: 1.5,
        _source: {
          id: 123,
          name: "Test Case",
          projectId: 1,
          isDeleted: false,
        },
      };

      mockClient.search.mockResolvedValue({
        hits: {
          hits: [mockHit],
          total: { value: 1 },
        },
        took: 15,
      });

      const result = await searchRepositoryCases({
        query: "test",
      });

      expect(result).toEqual({
        total: 1,
        hits: [
          {
            id: 123,
            score: 1.5,
            source: mockHit._source,
            highlights: undefined,
          },
        ],
        facets: undefined,
        took: 15,
      });
    });

    it("should handle Elasticsearch errors gracefully", async () => {
      mockClient.search.mockRejectedValue(new Error("Connection error"));

      const result = await searchRepositoryCases({
        query: "test",
      });

      expect(result).toBeNull();
    });

    it("should apply multiple filters including isDeleted", async () => {
      mockClient.search.mockResolvedValue({
        hits: {
          hits: [],
          total: { value: 0 },
        },
        took: 10,
      });

      await searchRepositoryCases({
        filters: {
          projectIds: [1, 2],
          automated: true,
          isArchived: false,
        },
      });

      const searchCall = mockClient.search.mock.calls[0][0];
      const filters = searchCall.query.bool.filter;

      expect(filters).toContainEqual({ terms: { projectId: [1, 2] } });
      expect(filters).toContainEqual({ term: { automated: true } });
      expect(filters).toContainEqual({ term: { isArchived: false } });
      expect(filters).toContainEqual({ term: { isDeleted: false } });
    });
  });
});
