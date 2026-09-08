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
  uploadAttachmentsBulk,
  uploadTestRunAttachments,
} from "./api.js";
import type { ResolvedAttachment, TestRunAttachmentFile } from "../types.js";

// Mock the config module
vi.mock("./config.js", () => ({
  getUrl: vi.fn(),
  getToken: vi.fn(),
}));

import { getUrl, getToken } from "./config.js";

// Mock fs module for importTestResults and attachment uploads
vi.mock("fs", () => {
  const { EventEmitter } = require("events");
  return {
    createReadStream: vi.fn(() => {
      const stream = new EventEmitter();
      stream.pipe = vi.fn().mockReturnThis();
      stream.pause = vi.fn().mockReturnThis();
      stream.resume = vi.fn().mockReturnThis();
      stream.destroy = vi.fn().mockReturnThis();
      // Simulate end of stream
      setTimeout(() => stream.emit("end"), 0);
      return stream;
    }),
    readFileSync: vi.fn(() => Buffer.from("mock file content")),
  };
});

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

    // Note: Tests for HTTP responses, SSE stream parsing, and form data
    // require actual file streams with buffering (form-data library).
    // These would be better suited as integration tests.
  });

  describe("uploadAttachmentsBulk", () => {
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

      const attachments: ResolvedAttachment[] = [
        {
          name: "test.png",
          originalPath: "test.png",
          resolvedPath: "/path/test.png",
          exists: true,
          size: 1000,
          mimeType: "image/png",
          junitTestResultId: 1,
        },
      ];

      await expect(uploadAttachmentsBulk(attachments)).rejects.toThrow(
        "TestPlanIt URL is not configured"
      );
    });

    it("throws error when token is not configured", async () => {
      (getToken as any).mockReturnValue(undefined);

      const attachments: ResolvedAttachment[] = [
        {
          name: "test.png",
          originalPath: "test.png",
          resolvedPath: "/path/test.png",
          exists: true,
          size: 1000,
          mimeType: "image/png",
          junitTestResultId: 1,
        },
      ];

      await expect(uploadAttachmentsBulk(attachments)).rejects.toThrow(
        "API token is not configured"
      );
    });

    it("returns empty result for empty attachments", async () => {
      const result = await uploadAttachmentsBulk([]);

      expect(result).toEqual({
        summary: { total: 0, success: 0, failed: 0 },
        results: [],
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("filters out non-existing attachments", async () => {
      const attachments: ResolvedAttachment[] = [
        {
          name: "missing.png",
          originalPath: "missing.png",
          resolvedPath: "/path/missing.png",
          exists: false,
          junitTestResultId: 1,
        },
      ];

      const result = await uploadAttachmentsBulk(attachments);

      expect(result).toEqual({
        summary: { total: 0, success: 0, failed: 0 },
        results: [],
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("makes correct API request for existing attachments", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            summary: { total: 1, success: 1, failed: 0 },
            results: [{ fileName: "1_test.png", success: true, attachmentId: 123 }],
          }),
      });

      const attachments: ResolvedAttachment[] = [
        {
          name: "test.png",
          originalPath: "test.png",
          resolvedPath: "/path/test.png",
          exists: true,
          size: 1000,
          mimeType: "image/png",
          junitTestResultId: 1,
        },
      ];

      const result = await uploadAttachmentsBulk(attachments);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://testplanit.example.com/api/junit/attachments/bulk",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer tpi_test_token",
          }),
        })
      );
      expect(result.summary.success).toBe(1);
    });

    it("throws error on HTTP error response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.resolve({ error: "Upload failed" }),
      });

      const attachments: ResolvedAttachment[] = [
        {
          name: "test.png",
          originalPath: "test.png",
          resolvedPath: "/path/test.png",
          exists: true,
          size: 1000,
          mimeType: "image/png",
          junitTestResultId: 1,
        },
      ];

      await expect(uploadAttachmentsBulk(attachments)).rejects.toThrow(
        "Upload failed"
      );
    });
  });

  describe("uploadTestRunAttachments", () => {
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

      const attachments: TestRunAttachmentFile[] = [
        {
          filePath: "/path/test-plan.pdf",
          name: "test-plan.pdf",
          size: 1000,
          mimeType: "application/pdf",
        },
      ];

      await expect(uploadTestRunAttachments(123, attachments)).rejects.toThrow(
        "TestPlanIt URL is not configured"
      );
    });

    it("throws error when token is not configured", async () => {
      (getToken as any).mockReturnValue(undefined);

      const attachments: TestRunAttachmentFile[] = [
        {
          filePath: "/path/test-plan.pdf",
          name: "test-plan.pdf",
          size: 1000,
          mimeType: "application/pdf",
        },
      ];

      await expect(uploadTestRunAttachments(123, attachments)).rejects.toThrow(
        "API token is not configured"
      );
    });

    it("returns empty result for empty attachments", async () => {
      const result = await uploadTestRunAttachments(123, []);

      expect(result).toEqual({
        summary: { total: 0, success: 0, failed: 0 },
        results: [],
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("makes correct API request", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            summary: { total: 1, success: 1, failed: 0 },
            results: [{ fileName: "test-plan.pdf", success: true, attachmentId: 456 }],
          }),
      });

      const attachments: TestRunAttachmentFile[] = [
        {
          filePath: "/path/test-plan.pdf",
          name: "test-plan.pdf",
          size: 1000,
          mimeType: "application/pdf",
        },
      ];

      const result = await uploadTestRunAttachments(123, attachments);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://testplanit.example.com/api/test-runs/attachments",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer tpi_test_token",
          }),
        })
      );
      expect(result.summary.success).toBe(1);
    });

    it("throws error on HTTP error response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        json: () => Promise.resolve({ error: "Access denied" }),
      });

      const attachments: TestRunAttachmentFile[] = [
        {
          filePath: "/path/test-plan.pdf",
          name: "test-plan.pdf",
          size: 1000,
          mimeType: "application/pdf",
        },
      ];

      await expect(uploadTestRunAttachments(123, attachments)).rejects.toThrow(
        "Access denied"
      );
    });

    it("handles HTTP error with error code", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: () => Promise.resolve({ error: "Invalid test run", code: "INVALID_TEST_RUN" }),
      });

      const attachments: TestRunAttachmentFile[] = [
        {
          filePath: "/path/test-plan.pdf",
          name: "test-plan.pdf",
          size: 1000,
          mimeType: "application/pdf",
        },
      ];

      await expect(uploadTestRunAttachments(123, attachments)).rejects.toThrow(
        "Invalid test run (INVALID_TEST_RUN)"
      );
    });

    it("handles HTTP error with non-JSON response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        json: () => Promise.reject(new Error("Invalid JSON")),
      });

      const attachments: TestRunAttachmentFile[] = [
        {
          filePath: "/path/test-plan.pdf",
          name: "test-plan.pdf",
          size: 1000,
          mimeType: "application/pdf",
        },
      ];

      await expect(uploadTestRunAttachments(123, attachments)).rejects.toThrow(
        "HTTP 502: Bad Gateway"
      );
    });
  });
});
