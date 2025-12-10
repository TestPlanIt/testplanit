import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseTagsString,
  isNumericId,
  parseIdOrName,
  resolveToId,
  resolveProjectId,
  resolveTags,
  lookup,
  importTestResults,
} from "./api.js";

// Mock the config module
vi.mock("./config.js", () => ({
  getUrl: vi.fn(),
  getToken: vi.fn(),
}));

import { getUrl, getToken } from "./config.js";

// Mock fs module for importTestResults
vi.mock("fs", () => ({
  createReadStream: vi.fn(() => ({
    pipe: vi.fn(),
  })),
}));

// Mock path module
vi.mock("path", () => ({
  resolve: vi.fn((p) => `/absolute${p}`),
  basename: vi.fn((p) => p.split("/").pop()),
}));

describe("API Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseTagsString", () => {
    it("parses simple comma-separated values", () => {
      expect(parseTagsString("1,2,3")).toEqual(["1", "2", "3"]);
    });

    it("parses single value", () => {
      expect(parseTagsString("single")).toEqual(["single"]);
    });

    it("parses double-quoted values with commas", () => {
      expect(parseTagsString('"tag one","tag two"')).toEqual([
        "tag one",
        "tag two",
      ]);
    });

    it("parses single-quoted values with commas", () => {
      expect(parseTagsString("'tag one','tag two'")).toEqual([
        "tag one",
        "tag two",
      ]);
    });

    it("parses mixed IDs and quoted names", () => {
      expect(parseTagsString('1,"my tag",3')).toEqual(["1", "my tag", "3"]);
    });

    it("parses values with extra whitespace", () => {
      expect(parseTagsString("  tag1  ,  tag2  ,  tag3  ")).toEqual([
        "tag1",
        "tag2",
        "tag3",
      ]);
    });

    it("handles empty string", () => {
      expect(parseTagsString("")).toEqual([]);
    });

    it("handles only whitespace", () => {
      expect(parseTagsString("   ")).toEqual([]);
    });

    it("handles unclosed quotes gracefully", () => {
      // The parser should handle unclosed quotes without breaking
      const result = parseTagsString('"unclosed tag');
      expect(result).toEqual(["unclosed tag"]);
    });

    it("handles mixed quote styles", () => {
      expect(parseTagsString('"double","single\'s quote"')).toEqual([
        "double",
        "single's quote",
      ]);
    });

    it("handles empty values between commas", () => {
      expect(parseTagsString("a,,b")).toEqual(["a", "b"]);
    });

    it("handles trailing comma", () => {
      expect(parseTagsString("a,b,")).toEqual(["a", "b"]);
    });

    it("handles leading comma", () => {
      expect(parseTagsString(",a,b")).toEqual(["a", "b"]);
    });
  });

  describe("isNumericId", () => {
    it("returns true for numeric strings", () => {
      expect(isNumericId("123")).toBe(true);
      expect(isNumericId("0")).toBe(true);
      expect(isNumericId("999999")).toBe(true);
    });

    it("returns true for numeric strings with whitespace", () => {
      expect(isNumericId("  123  ")).toBe(true);
      expect(isNumericId("\t456\n")).toBe(true);
    });

    it("returns false for non-numeric strings", () => {
      expect(isNumericId("abc")).toBe(false);
      expect(isNumericId("12abc")).toBe(false);
      expect(isNumericId("abc12")).toBe(false);
      expect(isNumericId("12.34")).toBe(false);
      expect(isNumericId("-5")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isNumericId("")).toBe(false);
    });
  });

  describe("parseIdOrName", () => {
    it("returns numeric ID for numeric strings", () => {
      expect(parseIdOrName("123")).toBe(123);
      expect(parseIdOrName("  456  ")).toBe(456);
    });

    it("returns null for non-numeric strings", () => {
      expect(parseIdOrName("project name")).toBeNull();
      expect(parseIdOrName("my-tag")).toBeNull();
    });

    it("handles zero", () => {
      expect(parseIdOrName("0")).toBe(0);
    });

    it("handles large numbers", () => {
      expect(parseIdOrName("999999999")).toBe(999999999);
    });
  });

  describe("lookup", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal("fetch", mockFetch);
      (getUrl as any).mockReturnValue("https://testplanit.example.com");
      (getToken as any).mockReturnValue("tpi_test_token");
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("throws error when URL is not configured", async () => {
      (getUrl as any).mockReturnValue(undefined);

      await expect(lookup(1, "state", "Active")).rejects.toThrow(
        "TestPlanIt URL is not configured"
      );
    });

    it("throws error when token is not configured", async () => {
      (getToken as any).mockReturnValue(undefined);

      await expect(lookup(1, "state", "Active")).rejects.toThrow(
        "API token is not configured"
      );
    });

    it("makes correct API request", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 5, name: "Active" }),
      });

      await lookup(1, "state", "Active");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://testplanit.example.com/api/cli/lookup",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer tpi_test_token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "state",
            name: "Active",
            createIfMissing: false,
            projectId: 1,
          }),
        }
      );
    });

    it("sends createIfMissing when true", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 1, name: "new-tag", created: true }),
      });

      await lookup(1, "tag", "new-tag", true);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            type: "tag",
            name: "new-tag",
            createIfMissing: true,
            projectId: 1,
          }),
        })
      );
    });

    it("omits projectId for project lookup", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 1, name: "My Project" }),
      });

      await lookup(undefined, "project", "My Project");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            type: "project",
            name: "My Project",
            createIfMissing: false,
          }),
        })
      );
    });

    it("returns lookup response on success", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 42, name: "Found Item" }),
      });

      const result = await lookup(1, "milestone", "Found Item");

      expect(result).toEqual({ id: 42, name: "Found Item" });
    });

    it("throws error on HTTP error with error body", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: () => Promise.resolve({ error: "Milestone not found" }),
      });

      await expect(lookup(1, "milestone", "Missing")).rejects.toThrow(
        "Milestone not found"
      );
    });

    it("throws error on HTTP error with non-JSON response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.reject(new Error("Invalid JSON")),
      });

      await expect(lookup(1, "state", "Broken")).rejects.toThrow(
        "HTTP 500: Internal Server Error"
      );
    });
  });

  describe("resolveToId", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal("fetch", mockFetch);
      (getUrl as any).mockReturnValue("https://testplanit.example.com");
      (getToken as any).mockReturnValue("tpi_test_token");
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("returns numeric ID directly without API call", async () => {
      const result = await resolveToId(1, "state", "42");

      expect(result).toBe(42);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("looks up name via API", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 99, name: "Resolved Name" }),
      });

      const result = await resolveToId(1, "milestone", "Resolved Name");

      expect(result).toBe(99);
      expect(mockFetch).toHaveBeenCalled();
    });

    it("passes createIfMissing to lookup", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 7, name: "new-tag", created: true }),
      });

      await resolveToId(1, "tag", "new-tag", true);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"createIfMissing":true'),
        })
      );
    });
  });

  describe("resolveProjectId", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal("fetch", mockFetch);
      (getUrl as any).mockReturnValue("https://testplanit.example.com");
      (getToken as any).mockReturnValue("tpi_test_token");
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("returns numeric ID directly", async () => {
      const result = await resolveProjectId("123");

      expect(result).toBe(123);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("looks up project by name", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 5, name: "My Project" }),
      });

      const result = await resolveProjectId("My Project");

      expect(result).toBe(5);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            type: "project",
            name: "My Project",
            createIfMissing: false,
          }),
        })
      );
    });
  });

  describe("resolveTags", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal("fetch", mockFetch);
      (getUrl as any).mockReturnValue("https://testplanit.example.com");
      (getToken as any).mockReturnValue("tpi_test_token");
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("returns numeric IDs directly", async () => {
      const result = await resolveTags(1, "1,2,3");

      expect(result).toEqual([1, 2, 3]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("looks up tag names", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 10, name: "tag-a" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 20, name: "tag-b" }),
        });

      const result = await resolveTags(1, "tag-a,tag-b");

      expect(result).toEqual([10, 20]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("mixes numeric IDs and name lookups", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 30, name: "my-tag" }),
      });

      const result = await resolveTags(1, '5,"my-tag",10');

      expect(result).toEqual([5, 30, 10]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("creates tags if missing", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ id: 100, name: "new-tag", created: true }),
      });

      await resolveTags(1, "new-tag");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"createIfMissing":true'),
        })
      );
    });
  });

  describe("importTestResults", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal("fetch", mockFetch);
      (getUrl as any).mockReturnValue("https://testplanit.example.com");
      (getToken as any).mockReturnValue("tpi_test_token");
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("throws error when URL is not configured", async () => {
      (getUrl as any).mockReturnValue(undefined);

      await expect(
        importTestResults(
          ["test.xml"],
          { projectId: 1, name: "Test Run" },
          undefined
        )
      ).rejects.toThrow("TestPlanIt URL is not configured");
    });

    it("throws error when token is not configured", async () => {
      (getToken as any).mockReturnValue(undefined);

      await expect(
        importTestResults(
          ["test.xml"],
          { projectId: 1, name: "Test Run" },
          undefined
        )
      ).rejects.toThrow("API token is not configured");
    });

    it("throws error on HTTP error response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: () => Promise.resolve({ error: "Invalid token", code: "INVALID_TOKEN" }),
      });

      await expect(
        importTestResults(
          ["test.xml"],
          { projectId: 1, name: "Test Run" },
          undefined
        )
      ).rejects.toThrow("Invalid token (INVALID_TOKEN)");
    });

    it("throws error when no response body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: null,
      });

      await expect(
        importTestResults(
          ["test.xml"],
          { projectId: 1, name: "Test Run" },
          undefined
        )
      ).rejects.toThrow("No response body");
    });

    it("parses SSE stream and returns testRunId", async () => {
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(
              'data: {"progress":50,"status":"Processing..."}\n\n'
            ),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(
              'data: {"complete":true,"testRunId":123}\n\n'
            ),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      });

      const progressEvents: any[] = [];
      const result = await importTestResults(
        ["test.xml"],
        { projectId: 1, name: "Test Run" },
        (event) => progressEvents.push(event)
      );

      expect(result).toEqual({ testRunId: 123 });
      expect(progressEvents).toHaveLength(2);
      expect(progressEvents[0]).toEqual({
        progress: 50,
        status: "Processing...",
      });
      expect(progressEvents[1]).toEqual({ complete: true, testRunId: 123 });
    });

    it("throws error when SSE stream contains error", async () => {
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(
              'data: {"error":"Import failed"}\n\n'
            ),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      });

      await expect(
        importTestResults(
          ["test.xml"],
          { projectId: 1, name: "Test Run" },
          undefined
        )
      ).rejects.toThrow("Import failed");
    });

    it("throws error when no testRunId returned", async () => {
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(
              'data: {"complete":true}\n\n'
            ),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      });

      await expect(
        importTestResults(
          ["test.xml"],
          { projectId: 1, name: "Test Run" },
          undefined
        )
      ).rejects.toThrow("Import completed but no test run ID was returned");
    });

    it("ignores malformed JSON in SSE stream", async () => {
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(
              "data: {malformed json}\n\n"
            ),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(
              'data: {"complete":true,"testRunId":456}\n\n'
            ),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      });

      const result = await importTestResults(
        ["test.xml"],
        { projectId: 1, name: "Test Run" },
        undefined
      );

      expect(result).toEqual({ testRunId: 456 });
    });

    it("includes optional parameters in form data", async () => {
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(
              'data: {"complete":true,"testRunId":789}\n\n'
            ),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      });

      await importTestResults(
        ["test.xml"],
        {
          projectId: 1,
          name: "Test Run",
          format: "junit",
          stateId: 5,
          configId: 10,
          milestoneId: 15,
          parentFolderId: 20,
          testRunId: 25,
          tagIds: [1, 2, 3],
        },
        undefined
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://testplanit.example.com/api/test-results/import",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer tpi_test_token",
          }),
        })
      );
    });
  });
});
