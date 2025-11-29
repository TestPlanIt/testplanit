import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { elasticsearchSyncMiddleware } from "./prisma-middleware";
import * as repositoryCaseSync from "../services/repositoryCaseSync";
import * as elasticsearchIndexing from "../services/elasticsearchIndexing";

// Mock the sync functions
vi.mock("../services/repositoryCaseSync", () => ({
  syncRepositoryCaseToElasticsearch: vi.fn(),
}));

vi.mock("../services/elasticsearchIndexing", () => ({
  deleteRepositoryCase: vi.fn(),
}));

describe("elasticsearchSyncMiddleware", () => {
  const mockNext = vi.fn();
  let middleware: any;

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = elasticsearchSyncMiddleware();
    // Set up default mock return values
    vi.mocked(repositoryCaseSync.syncRepositoryCaseToElasticsearch).mockResolvedValue(true);
    vi.mocked(elasticsearchIndexing.deleteRepositoryCase).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("RepositoryCases operations", () => {
    it("should sync repository case to Elasticsearch on create", async () => {
      const params = {
        model: "RepositoryCases",
        action: "create",
      };
      const result = { id: 123 };
      mockNext.mockResolvedValue(result);

      await middleware(params, mockNext);

      expect(mockNext).toHaveBeenCalledWith(params);
      expect(repositoryCaseSync.syncRepositoryCaseToElasticsearch).toHaveBeenCalledWith(123);
    });

    it("should sync repository case to Elasticsearch on update", async () => {
      const params = {
        model: "RepositoryCases",
        action: "update",
      };
      const result = { id: 456 };
      mockNext.mockResolvedValue(result);

      await middleware(params, mockNext);

      expect(mockNext).toHaveBeenCalledWith(params);
      expect(repositoryCaseSync.syncRepositoryCaseToElasticsearch).toHaveBeenCalledWith(456);
    });

    it("should sync repository case to Elasticsearch on upsert", async () => {
      const params = {
        model: "RepositoryCases",
        action: "upsert",
      };
      const result = { id: 789 };
      mockNext.mockResolvedValue(result);

      await middleware(params, mockNext);

      expect(mockNext).toHaveBeenCalledWith(params);
      expect(repositoryCaseSync.syncRepositoryCaseToElasticsearch).toHaveBeenCalledWith(789);
    });

    it("should sync repository case to Elasticsearch on delete", async () => {
      const params = {
        model: "RepositoryCases",
        action: "delete",
      };
      const result = { id: 999 };
      mockNext.mockResolvedValue(result);

      await middleware(params, mockNext);

      expect(mockNext).toHaveBeenCalledWith(params);
      expect(repositoryCaseSync.syncRepositoryCaseToElasticsearch).toHaveBeenCalledWith(999);
    });

    it("should handle sync errors gracefully", async () => {
      const params = {
        model: "RepositoryCases",
        action: "create",
      };
      const result = { id: 123 };
      mockNext.mockResolvedValue(result);
      
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(repositoryCaseSync.syncRepositoryCaseToElasticsearch).mockRejectedValue(new Error("Sync failed"));

      await middleware(params, mockNext);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to sync repository case 123 to Elasticsearch:",
        expect.any(Error)
      );
    });

    it("should handle missing case ID gracefully", async () => {
      const params = {
        model: "RepositoryCases",
        action: "create",
      };
      const result = {}; // No ID
      mockNext.mockResolvedValue(result);

      await middleware(params, mockNext);

      expect(repositoryCaseSync.syncRepositoryCaseToElasticsearch).not.toHaveBeenCalled();
    });

    it("should log bulk operations", async () => {
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      
      const params = {
        model: "RepositoryCases",
        action: "createMany",
      };
      mockNext.mockResolvedValue({});

      await middleware(params, mockNext);

      expect(consoleLogSpy).toHaveBeenCalledWith("Bulk create detected - manual sync required");
    });
  });

  describe("Steps operations", () => {
    it("should sync parent repository case when step is created", async () => {
      const params = {
        model: "Steps",
        action: "create",
        args: { where: { testCaseId: 100 } },
      };
      const result = { testCaseId: 100 };
      mockNext.mockResolvedValue(result);

      await middleware(params, mockNext);

      expect(repositoryCaseSync.syncRepositoryCaseToElasticsearch).toHaveBeenCalledWith(100);
    });

    it("should sync parent repository case when step is updated", async () => {
      const params = {
        model: "Steps",
        action: "update",
      };
      const result = { testCaseId: 200 };
      mockNext.mockResolvedValue(result);

      await middleware(params, mockNext);

      expect(repositoryCaseSync.syncRepositoryCaseToElasticsearch).toHaveBeenCalledWith(200);
    });

    it("should sync parent repository case when step is deleted", async () => {
      const params = {
        model: "Steps",
        action: "delete",
      };
      const result = { testCaseId: 300 };
      mockNext.mockResolvedValue(result);

      await middleware(params, mockNext);

      expect(repositoryCaseSync.syncRepositoryCaseToElasticsearch).toHaveBeenCalledWith(300);
    });

    it("should handle step errors gracefully", async () => {
      const params = {
        model: "Steps",
        action: "create",
      };
      const result = { testCaseId: 123 };
      mockNext.mockResolvedValue(result);
      
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(repositoryCaseSync.syncRepositoryCaseToElasticsearch).mockRejectedValue(new Error("Sync failed"));

      await middleware(params, mockNext);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to sync repository case 123 after step change:",
        expect.any(Error)
      );
    });
  });

  describe("Tags operations", () => {
    it("should sync repository cases when tags are connected", async () => {
      const params = {
        model: "Tags",
        action: "update",
        args: {
          data: {
            repositoryCases: {
              connect: [{ id: 111 }, { id: 222 }],
            },
          },
        },
      };
      mockNext.mockResolvedValue({});

      await middleware(params, mockNext);

      expect(repositoryCaseSync.syncRepositoryCaseToElasticsearch).toHaveBeenCalledWith(111);
      expect(repositoryCaseSync.syncRepositoryCaseToElasticsearch).toHaveBeenCalledWith(222);
    });

    it("should sync repository cases when tags are disconnected", async () => {
      const params = {
        model: "Tags",
        action: "update",
        args: {
          data: {
            repositoryCases: {
              disconnect: { id: 333 },
            },
          },
        },
      };
      mockNext.mockResolvedValue({});

      await middleware(params, mockNext);

      expect(repositoryCaseSync.syncRepositoryCaseToElasticsearch).toHaveBeenCalledWith(333);
    });

    it("should handle tag errors gracefully", async () => {
      const params = {
        model: "Tags",
        action: "update",
        args: {
          data: {
            repositoryCases: {
              connect: { id: 444 },
            },
          },
        },
      };
      mockNext.mockResolvedValue({});
      
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(repositoryCaseSync.syncRepositoryCaseToElasticsearch).mockRejectedValue(new Error("Sync failed"));

      await middleware(params, mockNext);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to sync repository case 444 after tag change:",
        expect.any(Error)
      );
    });
  });

  describe("CaseFieldValues operations", () => {
    it("should sync repository case when custom field is created", async () => {
      const params = {
        model: "CaseFieldValues",
        action: "create",
      };
      const result = { caseId: 555 };
      mockNext.mockResolvedValue(result);

      await middleware(params, mockNext);

      expect(repositoryCaseSync.syncRepositoryCaseToElasticsearch).toHaveBeenCalledWith(555);
    });

    it("should sync repository case when custom field is updated", async () => {
      const params = {
        model: "CaseFieldValues",
        action: "update",
        args: { where: { caseId: 666 } },
      };
      const result = { caseId: 666 };
      mockNext.mockResolvedValue(result);

      await middleware(params, mockNext);

      expect(repositoryCaseSync.syncRepositoryCaseToElasticsearch).toHaveBeenCalledWith(666);
    });

    it("should sync repository case when custom field is deleted", async () => {
      const params = {
        model: "CaseFieldValues",
        action: "delete",
      };
      const result = { caseId: 777 };
      mockNext.mockResolvedValue(result);

      await middleware(params, mockNext);

      expect(repositoryCaseSync.syncRepositoryCaseToElasticsearch).toHaveBeenCalledWith(777);
    });

    it("should handle custom field errors gracefully", async () => {
      const params = {
        model: "CaseFieldValues",
        action: "create",
      };
      const result = { caseId: 888 };
      mockNext.mockResolvedValue(result);
      
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(repositoryCaseSync.syncRepositoryCaseToElasticsearch).mockRejectedValue(new Error("Sync failed"));

      await middleware(params, mockNext);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to sync repository case 888 after custom field change:",
        expect.any(Error)
      );
    });
  });

  describe("Other models", () => {
    it("should pass through operations for other models", async () => {
      const params = {
        model: "User",
        action: "create",
      };
      const result = { id: 999 };
      mockNext.mockResolvedValue(result);

      await middleware(params, mockNext);

      expect(mockNext).toHaveBeenCalledWith(params);
      expect(repositoryCaseSync.syncRepositoryCaseToElasticsearch).not.toHaveBeenCalled();
      expect(elasticsearchIndexing.deleteRepositoryCase).not.toHaveBeenCalled();
    });
  });
});