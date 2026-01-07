/**
 * CLI Types
 */

export interface CLIConfig {
  url?: string;
  token?: string;
}

/**
 * Supported test result formats
 */
export type TestResultFormat =
  | "junit"
  | "testng"
  | "xunit"
  | "nunit"
  | "mstest"
  | "mocha"
  | "cucumber"
  | "auto";

export const TEST_RESULT_FORMATS: Record<Exclude<TestResultFormat, "auto">, { label: string; extensions: string[] }> = {
  junit: { label: "JUnit XML", extensions: [".xml"] },
  testng: { label: "TestNG XML", extensions: [".xml"] },
  xunit: { label: "xUnit XML", extensions: [".xml"] },
  nunit: { label: "NUnit XML", extensions: [".xml"] },
  mstest: { label: "MSTest TRX", extensions: [".trx", ".xml"] },
  mocha: { label: "Mocha JSON", extensions: [".json"] },
  cucumber: { label: "Cucumber JSON", extensions: [".json"] },
};

/**
 * Import options - IDs are resolved before being passed to the API
 */
export interface ImportOptions {
  projectId: number;
  name?: string;  // Optional when appending to existing test run
  format?: TestResultFormat;
  stateId?: number;
  configId?: number;
  milestoneId?: number;
  parentFolderId?: number;
  tagIds?: number[];
  testRunId?: number;
}

/**
 * Raw import options from CLI - may contain names instead of IDs
 */
export interface RawImportOptions {
  projectId: number;
  name?: string;  // Optional when appending to existing test run
  format?: TestResultFormat;
  state?: string;      // ID or name
  config?: string;     // ID or name
  milestone?: string;  // ID or name
  folder?: string;     // ID or name
  tags?: string;       // Comma-separated IDs or names
  testRun?: string;    // ID or name
}

export interface SSEProgressEvent {
  progress?: number;
  status?: string;
  error?: string;
  complete?: boolean;
  testRunId?: number;
}

export interface APIError {
  error: string;
  code?: string;
  details?: unknown;
}

/**
 * Lookup API types
 */
export type LookupType = "project" | "state" | "config" | "milestone" | "tag" | "folder" | "testRun";

export interface LookupRequest {
  projectId?: number; // Not required for project, config, or tag lookups
  type: LookupType;
  name: string;
  createIfMissing?: boolean;
}

export interface LookupResponse {
  id: number;
  name: string;
  created?: boolean;
}

/**
 * Attachment mapping from import API response
 */
export interface AttachmentMapping {
  suiteName: string;
  testName: string;
  className: string;
  junitTestResultId: number;
  attachments: Array<{ name: string; path: string }>;
}

/**
 * Extended SSE progress event with attachment mappings
 */
export interface ImportSSEProgressEvent extends SSEProgressEvent {
  attachmentMappings?: AttachmentMapping[];
}

/**
 * Resolved attachment info for upload
 */
export interface ResolvedAttachment {
  /** Original filename from test results */
  name: string;
  /** Original path from test results (may be relative) */
  originalPath: string;
  /** Resolved absolute path on filesystem */
  resolvedPath: string | null;
  /** Whether the file exists on disk */
  exists: boolean;
  /** File size in bytes (if exists) */
  size?: number;
  /** MIME type (if determined) */
  mimeType?: string;
  /** JUnit test result ID to link the attachment to */
  junitTestResultId: number;
}

/**
 * Result of uploading a single attachment
 */
export interface AttachmentUploadResult {
  fileName: string;
  success: boolean;
  error?: string;
  attachmentId?: number;
  url?: string;
}

/**
 * Bulk attachment upload response
 */
export interface BulkAttachmentUploadResponse {
  summary: {
    total: number;
    success: number;
    failed: number;
  };
  results: AttachmentUploadResult[];
}

/**
 * Import result with optional attachment mappings
 */
export interface ImportResult {
  testRunId: number;
  attachmentMappings?: AttachmentMapping[];
}

/**
 * Test run attachment file info (for uploading artifacts to test runs)
 */
export interface TestRunAttachmentFile {
  /** Absolute path to the file */
  filePath: string;
  /** File name */
  name: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  mimeType: string;
}

/**
 * Test run attachment upload response (same structure as bulk response)
 */
export type TestRunAttachmentUploadResponse = BulkAttachmentUploadResponse;
