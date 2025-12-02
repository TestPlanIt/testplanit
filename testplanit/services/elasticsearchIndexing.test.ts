import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  indexRepositoryCase,
  bulkIndexRepositoryCases,
  deleteRepositoryCase,
} from "./elasticsearchIndexing";
import { getElasticsearchClient } from "./elasticsearchService";
import type { RepositoryCaseDocument } from "./elasticsearchService";

// Mock Elasticsearch
vi.mock("./elasticsearchService", () => ({
  getElasticsearchClient: vi.fn(),
  REPOSITORY_CASE_INDEX: "test-repository-cases",
  getRepositoryCaseIndexName: vi.fn(() => "test-repository-cases"),
}));

describe("elasticsearchIndexing", () => {
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      index: vi.fn(),
      bulk: vi.fn(),
      delete: vi.fn(),
    };
    vi.mocked(getElasticsearchClient).mockReturnValue(mockClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("indexRepositoryCase", () => {
    const mockCaseDocument: RepositoryCaseDocument = {
      id: 1,
      projectId: 100,
      projectName: "Test Project",
      repositoryId: 200,
      folderId: 300,
      folderPath: "/Test/Path",
      templateId: 400,
      templateName: "Test Template",
      name: "Test Case",
      className: "TestClass",
      source: "MANUAL",
      stateId: 500,
      stateName: "Active",
      estimate: 30,
      forecastManual: 25,
      forecastAutomated: 15.5,
      automated: true,
      isArchived: false,
      isDeleted: false,
      createdAt: new Date("2024-01-01"),
      creatorId: "user-123",
      creatorName: "Test User",
      tags: [{ id: 1, name: "smoke" }],
      customFields: [
        {
          fieldId: 1,
          fieldName: "Priority",
          fieldType: "select",
          value: "High",
        },
      ],
      steps: [
        {
          id: 1,
          order: 0,
          step: "Click login button",
          expectedResult: "Login page appears",
          isSharedStep: false,
        },
        {
          id: 2,
          order: 1,
          step: "Enter credentials",
          expectedResult: "Credentials accepted",
          isSharedStep: true,
          sharedStepGroupId: 10,
          sharedStepGroupName: "Login Steps",
        },
      ],
    };

    it("should return false if client is not available", async () => {
      vi.mocked(getElasticsearchClient).mockReturnValue(null);

      const result = await indexRepositoryCase(mockCaseDocument);

      expect(result).toBe(false);
      expect(mockClient.index).not.toHaveBeenCalled();
    });

    it("should successfully index a repository case", async () => {
      mockClient.index.mockResolvedValue({ _id: "1" });

      const result = await indexRepositoryCase(mockCaseDocument);

      expect(result).toBe(true);
      expect(mockClient.index).toHaveBeenCalledWith({
        index: "test-repository-cases",
        id: "1",
        document: expect.objectContaining({
          ...mockCaseDocument,
          searchableContent: expect.any(String),
        }),
      });
    });

    it("should build searchable content from all relevant fields", async () => {
      mockClient.index.mockResolvedValue({ _id: "1" });

      await indexRepositoryCase(mockCaseDocument);

      const indexCall = mockClient.index.mock.calls[0][0];
      const searchableContent = indexCall.document.searchableContent;

      // Should include name
      expect(searchableContent).toContain("Test Case");
      
      // Should include className
      expect(searchableContent).toContain("TestClass");
      
      // Should include tags
      expect(searchableContent).toContain("smoke");
      
      // Should include step content
      expect(searchableContent).toContain("Click login button");
      expect(searchableContent).toContain("Login page appears");
      expect(searchableContent).toContain("Enter credentials");
      expect(searchableContent).toContain("Credentials accepted");
      
      // Should include shared step group name
      expect(searchableContent).toContain("Login Steps");
      
      // Should include custom field values
      expect(searchableContent).toContain("High");
    });

    it("should handle missing optional fields gracefully", async () => {
      const minimalCase: RepositoryCaseDocument = {
        ...mockCaseDocument,
        className: null,
        tags: undefined,
        customFields: undefined,
        steps: undefined,
      };

      mockClient.index.mockResolvedValue({ _id: "1" });

      const result = await indexRepositoryCase(minimalCase);

      expect(result).toBe(true);
      expect(mockClient.index).toHaveBeenCalled();
      
      const indexCall = mockClient.index.mock.calls[0][0];
      const searchableContent = indexCall.document.searchableContent;
      
      // Should still contain the name
      expect(searchableContent).toContain("Test Case");
      
      // Should not fail on missing fields
      expect(searchableContent).toBeDefined();
    });

    it("should return false on indexing error", async () => {
      mockClient.index.mockRejectedValue(new Error("Elasticsearch error"));

      const result = await indexRepositoryCase(mockCaseDocument);

      expect(result).toBe(false);
    });

    it("should not include shared step group name for non-shared steps", async () => {
      const caseWithOnlyDirectSteps: RepositoryCaseDocument = {
        ...mockCaseDocument,
        steps: [
          {
            id: 1,
            order: 0,
            step: "Direct step",
            expectedResult: "Direct result",
            isSharedStep: false,
          },
        ],
      };

      mockClient.index.mockResolvedValue({ _id: "1" });

      await indexRepositoryCase(caseWithOnlyDirectSteps);

      const indexCall = mockClient.index.mock.calls[0][0];
      const searchableContent = indexCall.document.searchableContent;

      expect(searchableContent).toContain("Direct step");
      expect(searchableContent).toContain("Direct result");
      expect(searchableContent).not.toContain("Login Steps");
    });
  });

  describe("bulkIndexRepositoryCases", () => {
    const mockCases: RepositoryCaseDocument[] = [
      {
        id: 1,
        projectId: 100,
        projectName: "Test Project",
        repositoryId: 200,
        folderId: 300,
        folderPath: "/Test/Path",
        templateId: 400,
        templateName: "Test Template",
        name: "Test Case 1",
        source: "MANUAL",
        stateId: 500,
        stateName: "Active",
        automated: false,
        isArchived: false,
        isDeleted: false,
        createdAt: new Date("2024-01-01"),
        creatorId: "user-123",
        creatorName: "Test User",
      },
      {
        id: 2,
        projectId: 100,
        projectName: "Test Project",
        repositoryId: 200,
        folderId: 300,
        folderPath: "/Test/Path",
        templateId: 400,
        templateName: "Test Template",
        name: "Test Case 2",
        source: "MANUAL",
        stateId: 500,
        stateName: "Active",
        automated: false,
        isArchived: false,
        isDeleted: false,
        createdAt: new Date("2024-01-01"),
        creatorId: "user-123",
        creatorName: "Test User",
      },
    ];

    it("should return false if client is not available", async () => {
      vi.mocked(getElasticsearchClient).mockReturnValue(null);

      const result = await bulkIndexRepositoryCases(mockCases);

      expect(result).toBe(false);
      expect(mockClient.bulk).not.toHaveBeenCalled();
    });

    it("should return false for empty array", async () => {
      const result = await bulkIndexRepositoryCases([]);

      expect(result).toBe(false);
      expect(mockClient.bulk).not.toHaveBeenCalled();
    });

    it("should successfully bulk index repository cases", async () => {
      mockClient.bulk.mockResolvedValue({
        errors: false,
        items: [
          { index: { _id: "1", status: 200 } },
          { index: { _id: "2", status: 200 } },
        ],
      });

      const result = await bulkIndexRepositoryCases(mockCases);

      expect(result).toBe(true);
      expect(mockClient.bulk).toHaveBeenCalledWith({
        operations: expect.arrayContaining([
          { index: { _index: "test-repository-cases", _id: "1" } },
          expect.objectContaining({ id: 1, searchableContent: expect.any(String) }),
          { index: { _index: "test-repository-cases", _id: "2" } },
          expect.objectContaining({ id: 2, searchableContent: expect.any(String) }),
        ]),
        refresh: true,
      });
    });

    it("should handle bulk indexing errors correctly", async () => {
      mockClient.bulk.mockResolvedValue({
        errors: true,
        items: [
          { index: { _id: "1", status: 200 } },
          {
            index: {
              _id: "2",
              status: 400,
              error: {
                type: "document_parsing_exception",
                reason: "Failed to parse",
              },
            },
          },
        ],
      });

      const result = await bulkIndexRepositoryCases(mockCases);

      expect(result).toBe(false);
    });

    it("should return false on bulk operation error", async () => {
      mockClient.bulk.mockRejectedValue(new Error("Bulk operation failed"));

      const result = await bulkIndexRepositoryCases(mockCases);

      expect(result).toBe(false);
    });
  });

  describe("deleteRepositoryCase", () => {
    it("should return false if client is not available", async () => {
      vi.mocked(getElasticsearchClient).mockReturnValue(null);

      const result = await deleteRepositoryCase(1);

      expect(result).toBe(false);
      expect(mockClient.delete).not.toHaveBeenCalled();
    });

    it("should successfully delete a repository case", async () => {
      mockClient.delete.mockResolvedValue({ _id: "1" });

      const result = await deleteRepositoryCase(1);

      expect(result).toBe(true);
      expect(mockClient.delete).toHaveBeenCalledWith({
        index: "test-repository-cases",
        id: "1",
      });
    });

    it("should return true for 404 errors (already deleted)", async () => {
      const error = new Error("Not found");
      (error as any).statusCode = 404;
      mockClient.delete.mockRejectedValue(error);

      const result = await deleteRepositoryCase(1);

      expect(result).toBe(true);
    });

    it("should return false for other errors", async () => {
      mockClient.delete.mockRejectedValue(new Error("Connection error"));

      const result = await deleteRepositoryCase(1);

      expect(result).toBe(false);
    });
  });
});