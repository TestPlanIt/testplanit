/**
 * Attachment Resolver
 *
 * Resolves attachment paths from test result files to actual filesystem paths.
 * Handles different path formats from various test result formats:
 * - JUnit: Relative paths from [[ATTACHMENT|path]]
 * - NUnit: Fully rooted paths from <attachment><filePath>
 * - MSTest: Constructed paths like <testrun>/In/<executionId>/<path>
 * - Cucumber: File paths or temp files from embedded base64 data
 */

import * as fs from "fs";
import * as path from "path";
import type { AttachmentMapping, ResolvedAttachment, TestRunAttachmentFile } from "../types.js";

/**
 * Common MIME types by extension
 */
const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".html": "text/html",
  ".htm": "text/html",
  ".json": "application/json",
  ".xml": "application/xml",
  ".log": "text/plain",
  ".csv": "text/csv",
  ".zip": "application/zip",
};

/**
 * Get MIME type from file extension
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

/**
 * Resolve an attachment path to an absolute filesystem path
 *
 * @param attachmentPath - The path from the test result file
 * @param baseDir - The base directory for resolving relative paths (typically the XML file directory)
 * @returns The resolved absolute path, or null if it cannot be resolved
 */
function resolveAttachmentPath(
  attachmentPath: string,
  baseDir: string
): string | null {
  if (!attachmentPath) {
    return null;
  }

  // If already absolute, return as-is
  if (path.isAbsolute(attachmentPath)) {
    return attachmentPath;
  }

  // Resolve relative path against base directory
  return path.resolve(baseDir, attachmentPath);
}

/**
 * Resolve all attachments from import mappings to filesystem paths
 *
 * @param mappings - Attachment mappings from the import API response
 * @param xmlFilePaths - Paths to the original XML/JSON test result files (for resolving relative paths)
 * @param attachmentsBaseDir - Optional override base directory for resolving paths
 * @returns Array of resolved attachments with their metadata
 */
export function resolveAttachments(
  mappings: AttachmentMapping[],
  xmlFilePaths: string[],
  attachmentsBaseDir?: string
): ResolvedAttachment[] {
  const resolved: ResolvedAttachment[] = [];

  // Determine the base directory for resolving relative paths
  // If multiple XML files were provided, use the directory of the first one
  // or use the override if provided
  let baseDir: string;
  if (attachmentsBaseDir) {
    baseDir = path.resolve(attachmentsBaseDir);
  } else if (xmlFilePaths.length > 0) {
    baseDir = path.dirname(path.resolve(xmlFilePaths[0]));
  } else {
    baseDir = process.cwd();
  }

  for (const mapping of mappings) {
    for (const attachment of mapping.attachments) {
      const resolvedPath = resolveAttachmentPath(attachment.path, baseDir);

      const info: ResolvedAttachment = {
        name: attachment.name,
        originalPath: attachment.path,
        resolvedPath,
        exists: false,
        junitTestResultId: mapping.junitTestResultId,
      };

      // Check if file exists and get metadata
      if (resolvedPath) {
        try {
          const stats = fs.statSync(resolvedPath);
          if (stats.isFile()) {
            info.exists = true;
            info.size = stats.size;
            info.mimeType = getMimeType(resolvedPath);
          }
        } catch {
          // File doesn't exist or not accessible
          info.exists = false;
        }
      }

      resolved.push(info);
    }
  }

  return resolved;
}

/**
 * Filter attachments to only include those that exist on disk
 *
 * @param attachments - Array of resolved attachments
 * @returns Object with existing and missing attachments
 */
export function filterExistingAttachments(attachments: ResolvedAttachment[]): {
  existing: ResolvedAttachment[];
  missing: ResolvedAttachment[];
} {
  const existing: ResolvedAttachment[] = [];
  const missing: ResolvedAttachment[] = [];

  for (const attachment of attachments) {
    if (attachment.exists && attachment.resolvedPath) {
      existing.push(attachment);
    } else {
      missing.push(attachment);
    }
  }

  return { existing, missing };
}

/**
 * Get a summary of attachments for display
 */
export function getAttachmentSummary(attachments: ResolvedAttachment[]): {
  total: number;
  existing: number;
  missing: number;
  totalSize: number;
} {
  let existing = 0;
  let missing = 0;
  let totalSize = 0;

  for (const attachment of attachments) {
    if (attachment.exists) {
      existing++;
      totalSize += attachment.size || 0;
    } else {
      missing++;
    }
  }

  return {
    total: attachments.length,
    existing,
    missing,
    totalSize,
  };
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } else {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
}

/**
 * Get MIME type from file path (exported for use elsewhere)
 */
export function getMimeTypeForFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

/**
 * Resolve test run attachment file paths to TestRunAttachmentFile objects
 *
 * @param filePaths - Array of file paths (can be globs or direct paths)
 * @returns Object with valid files and missing/invalid paths
 */
export function resolveTestRunAttachmentFiles(
  filePaths: string[]
): {
  files: TestRunAttachmentFile[];
  missing: string[];
  totalSize: number;
} {
  const files: TestRunAttachmentFile[] = [];
  const missing: string[] = [];
  let totalSize = 0;

  for (const filePath of filePaths) {
    const absolutePath = path.resolve(filePath);

    try {
      const stats = fs.statSync(absolutePath);
      if (stats.isFile()) {
        const file: TestRunAttachmentFile = {
          filePath: absolutePath,
          name: path.basename(absolutePath),
          size: stats.size,
          mimeType: getMimeTypeForFile(absolutePath),
        };
        files.push(file);
        totalSize += stats.size;
      } else {
        missing.push(filePath);
      }
    } catch {
      missing.push(filePath);
    }
  }

  return { files, missing, totalSize };
}
