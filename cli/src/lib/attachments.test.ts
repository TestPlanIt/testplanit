import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Mock fs module
vi.mock("fs", () => ({
  statSync: vi.fn(),
}));

// Mock path module partially - keep real implementations for most functions
vi.mock("path", async () => {
  const actual = await vi.importActual<typeof import("path")>("path");
  return {
    ...actual,
    resolve: vi.fn((p: string) => `/resolved${p.startsWith("/") ? "" : "/"}${p}`),
    dirname: vi.fn((p: string) => {
      const parts = p.split("/");
      parts.pop();
      return parts.join("/") || "/";
    }),
    basename: vi.fn((p: string) => p.split("/").pop() || ""),
    extname: actual.extname, // Use real extname for MIME type tests
    isAbsolute: actual.isAbsolute,
  };
});

import {
  resolveAttachments,
  filterExistingAttachments,
  getAttachmentSummary,
  formatFileSize,
  getMimeTypeForFile,
  resolveTestRunAttachmentFiles,
} from "./attachments.js";
import type { AttachmentMapping, ResolvedAttachment } from "../types.js";

describe("Attachments Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getMimeTypeForFile", () => {
    it("returns correct MIME type for common image formats", () => {
      expect(getMimeTypeForFile("screenshot.png")).toBe("image/png");
      expect(getMimeTypeForFile("photo.jpg")).toBe("image/jpeg");
      expect(getMimeTypeForFile("photo.jpeg")).toBe("image/jpeg");
      expect(getMimeTypeForFile("animation.gif")).toBe("image/gif");
      expect(getMimeTypeForFile("image.webp")).toBe("image/webp");
      expect(getMimeTypeForFile("icon.svg")).toBe("image/svg+xml");
    });

    it("returns correct MIME type for video formats", () => {
      expect(getMimeTypeForFile("video.mp4")).toBe("video/mp4");
      expect(getMimeTypeForFile("video.webm")).toBe("video/webm");
      expect(getMimeTypeForFile("video.mov")).toBe("video/quicktime");
      expect(getMimeTypeForFile("video.avi")).toBe("video/x-msvideo");
    });

    it("returns correct MIME type for document formats", () => {
      expect(getMimeTypeForFile("document.pdf")).toBe("application/pdf");
      expect(getMimeTypeForFile("readme.txt")).toBe("text/plain");
      expect(getMimeTypeForFile("readme.md")).toBe("text/markdown");
      expect(getMimeTypeForFile("page.html")).toBe("text/html");
      expect(getMimeTypeForFile("page.htm")).toBe("text/html");
      expect(getMimeTypeForFile("data.json")).toBe("application/json");
      expect(getMimeTypeForFile("data.xml")).toBe("application/xml");
      expect(getMimeTypeForFile("data.csv")).toBe("text/csv");
    });

    it("returns correct MIME type for other formats", () => {
      expect(getMimeTypeForFile("app.log")).toBe("text/plain");
      expect(getMimeTypeForFile("archive.zip")).toBe("application/zip");
    });

    it("returns application/octet-stream for unknown extensions", () => {
      expect(getMimeTypeForFile("file.xyz")).toBe("application/octet-stream");
      expect(getMimeTypeForFile("file.unknown")).toBe("application/octet-stream");
      expect(getMimeTypeForFile("noextension")).toBe("application/octet-stream");
    });

    it("handles uppercase extensions", () => {
      expect(getMimeTypeForFile("screenshot.PNG")).toBe("image/png");
      expect(getMimeTypeForFile("document.PDF")).toBe("application/pdf");
    });

    it("handles paths with directories", () => {
      expect(getMimeTypeForFile("/path/to/screenshot.png")).toBe("image/png");
      expect(getMimeTypeForFile("./relative/path/file.json")).toBe("application/json");
    });
  });

  describe("formatFileSize", () => {
    it("formats bytes", () => {
      expect(formatFileSize(0)).toBe("0 B");
      expect(formatFileSize(100)).toBe("100 B");
      expect(formatFileSize(1023)).toBe("1023 B");
    });

    it("formats kilobytes", () => {
      expect(formatFileSize(1024)).toBe("1.0 KB");
      expect(formatFileSize(1536)).toBe("1.5 KB");
      expect(formatFileSize(10240)).toBe("10.0 KB");
      expect(formatFileSize(1024 * 1024 - 1)).toBe("1024.0 KB");
    });

    it("formats megabytes", () => {
      expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
      expect(formatFileSize(1024 * 1024 * 5.5)).toBe("5.5 MB");
      expect(formatFileSize(1024 * 1024 * 100)).toBe("100.0 MB");
    });

    it("formats gigabytes", () => {
      expect(formatFileSize(1024 * 1024 * 1024)).toBe("1.0 GB");
      expect(formatFileSize(1024 * 1024 * 1024 * 2.5)).toBe("2.5 GB");
    });
  });

  describe("resolveAttachments", () => {
    it("resolves attachments from mappings", () => {
      const mappings: AttachmentMapping[] = [
        {
          suiteName: "Test Suite",
          testName: "Test Case 1",
          className: "com.example.TestClass",
          junitTestResultId: 1,
          attachments: [
            { name: "screenshot.png", path: "screenshots/test1.png" },
          ],
        },
      ];

      // Mock file exists
      (fs.statSync as any).mockReturnValue({
        isFile: () => true,
        size: 1024,
      });

      const result = resolveAttachments(mappings, ["/path/to/results.xml"]);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("screenshot.png");
      expect(result[0].originalPath).toBe("screenshots/test1.png");
      expect(result[0].exists).toBe(true);
      expect(result[0].size).toBe(1024);
      expect(result[0].junitTestResultId).toBe(1);
    });

    it("handles multiple attachments per test", () => {
      const mappings: AttachmentMapping[] = [
        {
          suiteName: "Test Suite",
          testName: "Test Case 1",
          className: "TestClass",
          junitTestResultId: 1,
          attachments: [
            { name: "screenshot1.png", path: "img1.png" },
            { name: "screenshot2.png", path: "img2.png" },
            { name: "video.mp4", path: "video.mp4" },
          ],
        },
      ];

      (fs.statSync as any).mockReturnValue({
        isFile: () => true,
        size: 500,
      });

      const result = resolveAttachments(mappings, ["/path/to/results.xml"]);

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe("screenshot1.png");
      expect(result[1].name).toBe("screenshot2.png");
      expect(result[2].name).toBe("video.mp4");
    });

    it("marks missing files as not existing", () => {
      const mappings: AttachmentMapping[] = [
        {
          suiteName: "Test Suite",
          testName: "Test Case 1",
          className: "TestClass",
          junitTestResultId: 1,
          attachments: [{ name: "missing.png", path: "missing.png" }],
        },
      ];

      (fs.statSync as any).mockImplementation(() => {
        throw new Error("ENOENT: no such file or directory");
      });

      const result = resolveAttachments(mappings, ["/path/to/results.xml"]);

      expect(result).toHaveLength(1);
      expect(result[0].exists).toBe(false);
      expect(result[0].size).toBeUndefined();
    });

    it("uses custom attachments base directory when provided", () => {
      const mappings: AttachmentMapping[] = [
        {
          suiteName: "Test Suite",
          testName: "Test Case 1",
          className: "TestClass",
          junitTestResultId: 1,
          attachments: [{ name: "file.png", path: "file.png" }],
        },
      ];

      (fs.statSync as any).mockReturnValue({
        isFile: () => true,
        size: 100,
      });

      const result = resolveAttachments(
        mappings,
        ["/path/to/results.xml"],
        "/custom/base/dir"
      );

      expect(result).toHaveLength(1);
      expect(result[0].exists).toBe(true);
    });

    it("returns empty array for empty mappings", () => {
      const result = resolveAttachments([], ["/path/to/results.xml"]);

      expect(result).toHaveLength(0);
    });

    it("handles directories (non-files) as not existing", () => {
      const mappings: AttachmentMapping[] = [
        {
          suiteName: "Test Suite",
          testName: "Test Case 1",
          className: "TestClass",
          junitTestResultId: 1,
          attachments: [{ name: "folder", path: "folder" }],
        },
      ];

      (fs.statSync as any).mockReturnValue({
        isFile: () => false, // It's a directory
        size: 4096,
      });

      const result = resolveAttachments(mappings, ["/path/to/results.xml"]);

      expect(result).toHaveLength(1);
      expect(result[0].exists).toBe(false);
    });
  });

  describe("filterExistingAttachments", () => {
    it("separates existing and missing attachments", () => {
      const attachments: ResolvedAttachment[] = [
        {
          name: "exists1.png",
          originalPath: "exists1.png",
          resolvedPath: "/path/exists1.png",
          exists: true,
          size: 1000,
          mimeType: "image/png",
          junitTestResultId: 1,
        },
        {
          name: "missing.png",
          originalPath: "missing.png",
          resolvedPath: "/path/missing.png",
          exists: false,
          junitTestResultId: 2,
        },
        {
          name: "exists2.jpg",
          originalPath: "exists2.jpg",
          resolvedPath: "/path/exists2.jpg",
          exists: true,
          size: 2000,
          mimeType: "image/jpeg",
          junitTestResultId: 3,
        },
      ];

      const { existing, missing } = filterExistingAttachments(attachments);

      expect(existing).toHaveLength(2);
      expect(missing).toHaveLength(1);
      expect(existing[0].name).toBe("exists1.png");
      expect(existing[1].name).toBe("exists2.jpg");
      expect(missing[0].name).toBe("missing.png");
    });

    it("returns empty arrays for empty input", () => {
      const { existing, missing } = filterExistingAttachments([]);

      expect(existing).toHaveLength(0);
      expect(missing).toHaveLength(0);
    });

    it("filters out attachments without resolved path", () => {
      const attachments: ResolvedAttachment[] = [
        {
          name: "no-path.png",
          originalPath: "",
          resolvedPath: null,
          exists: false,
          junitTestResultId: 1,
        },
      ];

      const { existing, missing } = filterExistingAttachments(attachments);

      expect(existing).toHaveLength(0);
      expect(missing).toHaveLength(1);
    });
  });

  describe("getAttachmentSummary", () => {
    it("calculates summary correctly", () => {
      const attachments: ResolvedAttachment[] = [
        {
          name: "file1.png",
          originalPath: "file1.png",
          resolvedPath: "/path/file1.png",
          exists: true,
          size: 1000,
          junitTestResultId: 1,
        },
        {
          name: "file2.png",
          originalPath: "file2.png",
          resolvedPath: "/path/file2.png",
          exists: true,
          size: 2000,
          junitTestResultId: 2,
        },
        {
          name: "missing.png",
          originalPath: "missing.png",
          resolvedPath: "/path/missing.png",
          exists: false,
          junitTestResultId: 3,
        },
      ];

      const summary = getAttachmentSummary(attachments);

      expect(summary.total).toBe(3);
      expect(summary.existing).toBe(2);
      expect(summary.missing).toBe(1);
      expect(summary.totalSize).toBe(3000);
    });

    it("returns zeros for empty input", () => {
      const summary = getAttachmentSummary([]);

      expect(summary.total).toBe(0);
      expect(summary.existing).toBe(0);
      expect(summary.missing).toBe(0);
      expect(summary.totalSize).toBe(0);
    });

    it("handles attachments without size", () => {
      const attachments: ResolvedAttachment[] = [
        {
          name: "file.png",
          originalPath: "file.png",
          resolvedPath: "/path/file.png",
          exists: true,
          // size is undefined
          junitTestResultId: 1,
        },
      ];

      const summary = getAttachmentSummary(attachments);

      expect(summary.total).toBe(1);
      expect(summary.existing).toBe(1);
      expect(summary.totalSize).toBe(0);
    });
  });

  describe("resolveTestRunAttachmentFiles", () => {
    it("resolves valid file paths", () => {
      (fs.statSync as any).mockReturnValue({
        isFile: () => true,
        size: 1024,
      });

      const result = resolveTestRunAttachmentFiles(["test-plan.pdf", "report.html"]);

      expect(result.files).toHaveLength(2);
      expect(result.missing).toHaveLength(0);
      expect(result.totalSize).toBe(2048);

      expect(result.files[0].name).toBe("test-plan.pdf");
      expect(result.files[0].mimeType).toBe("application/pdf");
      expect(result.files[0].size).toBe(1024);

      expect(result.files[1].name).toBe("report.html");
      expect(result.files[1].mimeType).toBe("text/html");
    });

    it("tracks missing files", () => {
      (fs.statSync as any).mockImplementation(() => {
        throw new Error("ENOENT: no such file or directory");
      });

      const result = resolveTestRunAttachmentFiles(["missing1.pdf", "missing2.pdf"]);

      expect(result.files).toHaveLength(0);
      expect(result.missing).toHaveLength(2);
      expect(result.missing).toContain("missing1.pdf");
      expect(result.missing).toContain("missing2.pdf");
      expect(result.totalSize).toBe(0);
    });

    it("handles mixed existing and missing files", () => {
      (fs.statSync as any).mockImplementation((path: string) => {
        if (path.includes("exists")) {
          return { isFile: () => true, size: 500 };
        }
        throw new Error("ENOENT");
      });

      const result = resolveTestRunAttachmentFiles([
        "exists.pdf",
        "missing.pdf",
        "also-exists.png",
      ]);

      expect(result.files).toHaveLength(2);
      expect(result.missing).toHaveLength(1);
      expect(result.missing[0]).toBe("missing.pdf");
      expect(result.totalSize).toBe(1000);
    });

    it("treats directories as missing", () => {
      (fs.statSync as any).mockReturnValue({
        isFile: () => false, // It's a directory
        size: 4096,
      });

      const result = resolveTestRunAttachmentFiles(["some-directory"]);

      expect(result.files).toHaveLength(0);
      expect(result.missing).toHaveLength(1);
    });

    it("returns empty results for empty input", () => {
      const result = resolveTestRunAttachmentFiles([]);

      expect(result.files).toHaveLength(0);
      expect(result.missing).toHaveLength(0);
      expect(result.totalSize).toBe(0);
    });

    it("determines correct MIME types for various file types", () => {
      (fs.statSync as any).mockReturnValue({
        isFile: () => true,
        size: 100,
      });

      const result = resolveTestRunAttachmentFiles([
        "image.png",
        "video.mp4",
        "document.pdf",
        "data.json",
        "unknown.xyz",
      ]);

      expect(result.files[0].mimeType).toBe("image/png");
      expect(result.files[1].mimeType).toBe("video/mp4");
      expect(result.files[2].mimeType).toBe("application/pdf");
      expect(result.files[3].mimeType).toBe("application/json");
      expect(result.files[4].mimeType).toBe("application/octet-stream");
    });
  });
});
