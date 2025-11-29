import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ENTITY_MAPPINGS,
  ENTITY_INDICES,
  createEntityIndex,
  createAllEntityIndices,
  transformCustomFieldValue,
} from "./unifiedElasticsearchService";
import { SearchableEntityType } from "../types/search";
import { getElasticsearchClient } from "./elasticsearchService";

// Mock dependencies
vi.mock("./elasticsearchService", () => ({
  getElasticsearchClient: vi.fn(),
}));

// Mock the dynamic import of @prisma/client
vi.mock("@prisma/client", async () => {
  const mockPrismaClient = {
    appConfig: {
      findUnique: vi.fn().mockResolvedValue(null), // Default to null for replica settings
    },
    $disconnect: vi.fn(),
  };
  
  return {
    PrismaClient: vi.fn(() => mockPrismaClient),
  };
});

describe("unifiedElasticsearchService", () => {
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      indices: {
        exists: vi.fn(),
        create: vi.fn(),
      },
    };
    vi.mocked(getElasticsearchClient).mockReturnValue(mockClient);
  });

  describe("ENTITY_MAPPINGS", () => {
    it("should have correct repository case mapping with shared step fields", () => {
      const mapping = ENTITY_MAPPINGS[SearchableEntityType.REPOSITORY_CASE];

      expect(mapping).toBeDefined();
      expect(mapping.properties.steps).toEqual({
        type: "nested",
        properties: {
          id: { type: "integer" },
          order: { type: "integer" },
          step: { type: "text" },
          expectedResult: { type: "text" },
          isSharedStep: { type: "boolean" },
          sharedStepGroupId: { type: "integer" },
          sharedStepGroupName: { type: "text" },
        },
      });
    });

    it("should have consistent field types across services", () => {
      const mapping = ENTITY_MAPPINGS[SearchableEntityType.REPOSITORY_CASE];

      // Check that folderPath is keyword (not text)
      expect(mapping.properties.folderPath).toEqual({ type: "keyword" });

      // Check that name has standard analyzer
      expect(mapping.properties.name).toMatchObject({
        type: "text",
        analyzer: "standard",
      });
    });

    it("should have mappings for all entity types", () => {
      const entityTypes = Object.values(SearchableEntityType);

      entityTypes.forEach((type) => {
        if (type !== SearchableEntityType.SESSION) {
          // SESSION uses a different index
          expect(ENTITY_MAPPINGS[type]).toBeDefined();
          expect(ENTITY_MAPPINGS[type].properties).toBeDefined();
        }
      });
    });
  });

  describe("ENTITY_INDICES", () => {
    it("should have index names for all entity types", () => {
      const entityTypes = Object.values(SearchableEntityType);

      entityTypes.forEach((type) => {
        expect(ENTITY_INDICES[type]).toBeDefined();
        expect(ENTITY_INDICES[type]).toMatch(/^testplanit-/);
      });
    });

    it("should use correct index name for repository cases", () => {
      expect(ENTITY_INDICES[SearchableEntityType.REPOSITORY_CASE]).toBe(
        "testplanit-repository-cases"
      );
    });
  });

  describe("createEntityIndex", () => {
    it("should return false if client is not available", async () => {
      vi.mocked(getElasticsearchClient).mockReturnValue(null);

      const result = await createEntityIndex(
        SearchableEntityType.REPOSITORY_CASE
      );

      expect(result).toBe(false);
      expect(mockClient.indices.exists).not.toHaveBeenCalled();
    });

    it("should create index if it does not exist", async () => {
      mockClient.indices.exists.mockResolvedValue(false);
      mockClient.indices.create.mockResolvedValue({});

      const result = await createEntityIndex(
        SearchableEntityType.REPOSITORY_CASE
      );

      expect(result).toBe(true);
      expect(mockClient.indices.exists).toHaveBeenCalledWith({
        index: "testplanit-repository-cases",
      });
      expect(mockClient.indices.create).toHaveBeenCalledWith({
        index: "testplanit-repository-cases",
        mappings: ENTITY_MAPPINGS[SearchableEntityType.REPOSITORY_CASE],
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0, // Default from mocked getElasticsearchSettings
          analysis: {
            analyzer: {
              standard: {
                type: "standard",
                stopwords: "_english_",
              },
            },
          },
        },
      });
    });

    it("should return true if index already exists", async () => {
      mockClient.indices.exists.mockResolvedValue(true);

      const result = await createEntityIndex(
        SearchableEntityType.REPOSITORY_CASE
      );

      expect(result).toBe(true);
      expect(mockClient.indices.exists).toHaveBeenCalled();
      expect(mockClient.indices.create).not.toHaveBeenCalled();
    });

    it("should handle errors gracefully", async () => {
      mockClient.indices.exists.mockRejectedValue(
        new Error("Connection failed")
      );

      const result = await createEntityIndex(
        SearchableEntityType.REPOSITORY_CASE
      );

      expect(result).toBe(false);
    });
  });

  describe("createAllEntityIndices", () => {
    it("should create indices for all entity types", async () => {
      mockClient.indices.exists.mockResolvedValue(false);
      mockClient.indices.create.mockResolvedValue({});

      await createAllEntityIndices();

      const entityTypes = Object.values(SearchableEntityType);

      // Should check existence for each entity type
      expect(mockClient.indices.exists).toHaveBeenCalledTimes(
        entityTypes.length
      );

      // Should create index for each entity type (except those that already exist)
      expect(mockClient.indices.create).toHaveBeenCalledTimes(
        entityTypes.length
      );
    });

    it("should continue creating indices even if one fails", async () => {
      mockClient.indices.exists.mockResolvedValue(false);
      mockClient.indices.create
        .mockResolvedValueOnce({}) // First success
        .mockRejectedValueOnce(new Error("Failed")) // Second fails
        .mockResolvedValue({}); // Rest succeed

      await createAllEntityIndices();

      const entityTypes = Object.values(SearchableEntityType);
      expect(mockClient.indices.create).toHaveBeenCalledTimes(
        entityTypes.length
      );
    });
  });

  describe("transformCustomFieldValue", () => {
    it("should transform checkbox values", () => {
      const result = transformCustomFieldValue("Checkbox", true);

      expect(result).toEqual({
        valueBoolean: true,
        value: "true",
      });

      const result2 = transformCustomFieldValue("Checkbox", "false");

      // Boolean("false") is true because it's a non-empty string
      expect(result2).toEqual({
        valueBoolean: true,
        value: "false",
      });

      // Test with actual false value
      const result3 = transformCustomFieldValue("Checkbox", false);

      expect(result3).toEqual({
        valueBoolean: false,
        value: "false",
      });
    });

    it("should transform date values", () => {
      const dateString = "2024-01-15";
      const result = transformCustomFieldValue("Date", dateString);

      expect(result).toEqual({
        valueDate: "2024-01-15T00:00:00.000Z",
        value: "2024-01-15T00:00:00.000Z",
      });
    });

    it("should handle invalid dates", () => {
      const result = transformCustomFieldValue("Date", "invalid-date");

      expect(result).toEqual({});
    });

    it("should transform number values", () => {
      const result = transformCustomFieldValue("Number", "42");

      expect(result).toEqual({
        valueNumeric: 42,
        value: "42",
      });

      const result2 = transformCustomFieldValue("Number", 3.14);

      expect(result2).toEqual({
        valueNumeric: 3.14,
        value: "3.14",
      });
    });

    it("should transform link values", () => {
      const result = transformCustomFieldValue("Link", "https://example.com");

      expect(result).toEqual({
        valueKeyword: "https://example.com",
        value: "https://example.com",
      });
    });

    it("should transform text values", () => {
      const result = transformCustomFieldValue("Text", "Some text value");

      expect(result).toEqual({
        value: "Some text value",
      });
    });

    it("should handle array values for multi-select", () => {
      const result = transformCustomFieldValue("Multi-Select", [1, 2, 3]);

      expect(result).toEqual({
        valueArray: ["1", "2", "3"],
        value: "1 2 3",
      });
    });

    it("should handle object values", () => {
      const obj = { key: "value", nested: { prop: 123 } };
      const result = transformCustomFieldValue("CustomObject", obj);

      expect(result).toEqual({
        value: "[object Object]",
      });
    });

    it("should handle unknown field types", () => {
      const result = transformCustomFieldValue("UnknownType", "some value");

      expect(result).toEqual({
        value: "some value",
      });
    });

    it("should handle null values", () => {
      const result = transformCustomFieldValue("Text", null);

      expect(result).toEqual({
        value: "null",
      });
    });

    it("should handle undefined values", () => {
      const result = transformCustomFieldValue("Text", undefined);

      expect(result).toEqual({
        value: "undefined",
      });
    });
  });
});
