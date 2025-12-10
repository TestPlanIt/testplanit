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
  name: string;
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
  name: string;
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
