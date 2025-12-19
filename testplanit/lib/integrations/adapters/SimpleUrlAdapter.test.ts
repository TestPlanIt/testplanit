import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock prisma
const mockCount = vi.fn();
const mockFindMany = vi.fn();

vi.mock("@/lib/prismaBase", () => ({
  prisma: {
    issue: {
      count: (...args: any[]) => mockCount(...args),
      findMany: (...args: any[]) => mockFindMany(...args),
    },
  },
}));

import { SimpleUrlAdapter } from "./SimpleUrlAdapter";

describe("SimpleUrlAdapter", () => {
  let adapter: SimpleUrlAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new SimpleUrlAdapter({
      integrationId: 1,
      baseUrl: "https://issues.example.com/browse/{issueId}",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getCapabilities", () => {
    it("should return correct capabilities", () => {
      const capabilities = adapter.getCapabilities();

      expect(capabilities).toEqual({
        createIssue: false,
        updateIssue: false,
        linkIssue: true,
        syncIssue: false,
        searchIssues: true,
        webhooks: false,
        customFields: false,
        attachments: false,
      });
    });
  });

  describe("createIssue", () => {
    it("should throw error as not supported", async () => {
      await expect(
        adapter.createIssue({
          title: "Test Issue",
          description: "Test",
        })
      ).rejects.toThrow(
        "Creating issues is not supported by Simple URL integration"
      );
    });
  });

  describe("updateIssue", () => {
    it("should throw error as not supported", async () => {
      await expect(
        adapter.updateIssue("ISSUE-123", { title: "Updated" })
      ).rejects.toThrow(
        "Updating issues is not supported by Simple URL integration"
      );
    });
  });

  describe("getIssue", () => {
    it("should return mock issue with generated URL", async () => {
      const result = await adapter.getIssue("ISSUE-123");

      expect(result).toEqual({
        id: "ISSUE-123",
        key: "ISSUE-123",
        title: "Issue ISSUE-123",
        description: "Issue linked via Simple URL integration",
        status: "Unknown",
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        url: "https://issues.example.com/browse/ISSUE-123",
      });
    });

    it("should replace issueId placeholder in URL", async () => {
      const result = await adapter.getIssue("ABC-456");

      expect(result.url).toBe("https://issues.example.com/browse/ABC-456");
    });

    it("should throw error when baseUrl not configured", async () => {
      const adapterWithoutUrl = new SimpleUrlAdapter({
        integrationId: 1,
      });

      await expect(adapterWithoutUrl.getIssue("ISSUE-123")).rejects.toThrow(
        "Base URL not configured"
      );
    });
  });

  describe("searchIssues", () => {
    beforeEach(() => {
      mockCount.mockResolvedValue(2);
      mockFindMany.mockResolvedValue([
        {
          id: 1,
          name: "Issue 1",
          title: "Test Issue 1",
          description: "Description 1",
          status: "Open",
          priority: "High",
          externalId: "EXT-1",
          externalKey: "KEY-1",
          externalUrl: "https://external.com/1",
          externalStatus: "Open",
          createdAt: new Date("2024-01-15"),
        },
        {
          id: 2,
          name: "Issue 2",
          title: "Test Issue 2",
          description: null,
          status: null,
          priority: null,
          externalId: null,
          externalKey: null,
          externalUrl: null,
          externalStatus: null,
          createdAt: new Date("2024-01-16"),
        },
      ]);
    });

    it("should search issues in database", async () => {
      const result = await adapter.searchIssues({ query: "test", limit: 10 });

      expect(result.issues.length).toBe(2);
      expect(result.total).toBe(2);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            integrationId: 1,
            isDeleted: false,
          }),
          take: 10,
        })
      );
    });

    it("should add OR filter when query is provided", async () => {
      await adapter.searchIssues({ query: "test", limit: 10 });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { name: { contains: "test", mode: "insensitive" } },
              { title: { contains: "test", mode: "insensitive" } },
              { description: { contains: "test", mode: "insensitive" } },
              { externalId: { contains: "test", mode: "insensitive" } },
              { externalKey: { contains: "test", mode: "insensitive" } },
            ],
          }),
        })
      );
    });

    it("should not add OR filter for empty query", async () => {
      await adapter.searchIssues({ query: "", limit: 10 });

      const callArg = mockFindMany.mock.calls[0][0];
      expect(callArg.where.OR).toBeUndefined();
    });

    it("should not add OR filter for whitespace query", async () => {
      await adapter.searchIssues({ query: "   ", limit: 10 });

      const callArg = mockFindMany.mock.calls[0][0];
      expect(callArg.where.OR).toBeUndefined();
    });

    it("should calculate hasMore correctly", async () => {
      mockCount.mockResolvedValue(15);
      mockFindMany.mockResolvedValue(
        Array(10).fill({
          id: 1,
          name: "Issue",
          title: "Test",
          createdAt: new Date(),
        })
      );

      const result = await adapter.searchIssues({ limit: 10 });

      expect(result.hasMore).toBe(true);
    });

    it("should use existing externalUrl when available", async () => {
      const result = await adapter.searchIssues({ limit: 10 });

      expect(result.issues[0].url).toBe("https://external.com/1");
    });

    it("should generate URL when externalUrl not available", async () => {
      mockFindMany.mockResolvedValue([
        {
          id: 1,
          name: "Issue 1",
          title: "Test Issue",
          externalId: "EXT-1",
          externalKey: null,
          externalUrl: null,
          createdAt: new Date(),
        },
      ]);

      const result = await adapter.searchIssues({ limit: 10 });

      expect(result.issues[0].url).toBe(
        "https://issues.example.com/browse/EXT-1"
      );
    });

    it("should throw error when baseUrl not configured", async () => {
      const adapterWithoutUrl = new SimpleUrlAdapter({
        integrationId: 1,
      });

      await expect(
        adapterWithoutUrl.searchIssues({ limit: 10 })
      ).rejects.toThrow("Base URL not configured");
    });

    it("should throw error when integrationId not configured", async () => {
      const adapterWithoutId = new SimpleUrlAdapter({
        baseUrl: "https://example.com/{issueId}",
      });

      await expect(adapterWithoutId.searchIssues({ limit: 10 })).rejects.toThrow(
        "Integration ID not configured"
      );
    });
  });

  describe("linkToTestCase", () => {
    it("should validate URL can be generated", async () => {
      await expect(
        adapter.linkToTestCase("ISSUE-123", "test-case-1")
      ).resolves.not.toThrow();
    });

    it("should throw error when baseUrl not configured", async () => {
      const adapterWithoutUrl = new SimpleUrlAdapter({
        integrationId: 1,
      });

      await expect(
        adapterWithoutUrl.linkToTestCase("ISSUE-123", "test-case-1")
      ).rejects.toThrow("Base URL not configured");
    });

    it("should throw error for invalid URL pattern", async () => {
      const adapterWithBadUrl = new SimpleUrlAdapter({
        integrationId: 1,
        baseUrl: "not-a-valid-url/{issueId}",
      });

      await expect(
        adapterWithBadUrl.linkToTestCase("ISSUE-123", "test-case-1")
      ).rejects.toThrow("Invalid URL generated");
    });
  });

  describe("validateConfiguration", () => {
    it("should return valid for correct configuration", async () => {
      const result = await adapter.validateConfiguration();

      expect(result).toEqual({
        valid: true,
        errors: undefined,
      });
    });

    it("should return error when baseUrl is missing", async () => {
      const adapterWithoutUrl = new SimpleUrlAdapter({
        integrationId: 1,
      });

      const result = await adapterWithoutUrl.validateConfiguration();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Base URL is required");
    });

    it("should return error when placeholder is missing", async () => {
      const adapterWithBadPattern = new SimpleUrlAdapter({
        integrationId: 1,
        baseUrl: "https://example.com/issues/123",
      });

      const result = await adapterWithBadPattern.validateConfiguration();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Base URL must contain {issueId} placeholder"
      );
    });

    it("should return error for invalid URL format", async () => {
      const adapterWithBadUrl = new SimpleUrlAdapter({
        integrationId: 1,
        baseUrl: "not-a-valid-url/{issueId}",
      });

      const result = await adapterWithBadUrl.validateConfiguration();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Base URL pattern is not a valid URL format"
      );
    });

    it("should accept quoted placeholder format", async () => {
      const adapterWithQuotedPlaceholder = new SimpleUrlAdapter({
        integrationId: 1,
        baseUrl: "https://example.com/issues/'{issueId}'",
      });

      const result = await adapterWithQuotedPlaceholder.validateConfiguration();

      expect(result.valid).toBe(true);
    });
  });
});
