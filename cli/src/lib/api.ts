/**
 * API Client
 *
 * Handles communication with the TestPlanIt API including
 * multipart file uploads and SSE stream parsing.
 */

import FormData from "form-data";
import * as fs from "fs";
import * as path from "path";
import { getUrl, getToken } from "./config.js";
import type {
  ImportOptions,
  SSEProgressEvent,
  APIError,
  LookupType,
  LookupResponse,
} from "../types.js";

/**
 * Format a network error into a helpful message with context
 */
function formatNetworkError(error: unknown, url: string, operation: string): Error {
  const baseUrl = new URL(url).origin;

  if (error instanceof TypeError) {
    const message = error.message.toLowerCase();

    if (message.includes("fetch failed") || message.includes("econnrefused")) {
      return new Error(
        `Failed to connect to TestPlanIt server at ${baseUrl}\n` +
        `  → Is the server running?\n` +
        `  → Check your URL with: testplanit config`
      );
    }

    if (message.includes("enotfound") || message.includes("getaddrinfo")) {
      return new Error(
        `Could not resolve hostname for ${baseUrl}\n` +
        `  → Check that the URL is correct\n` +
        `  → Verify your network connection`
      );
    }

    if (message.includes("etimedout") || message.includes("timeout")) {
      return new Error(
        `Request timed out while ${operation}\n` +
        `  → The server at ${baseUrl} may be slow or unresponsive\n` +
        `  → Check your network connection`
      );
    }

    if (message.includes("econnreset") || message.includes("socket hang up")) {
      return new Error(
        `Connection was reset while ${operation}\n` +
        `  → The server at ${baseUrl} closed the connection unexpectedly\n` +
        `  → Try again, or check server logs`
      );
    }

    if (message.includes("cert") || message.includes("ssl") || message.includes("tls")) {
      return new Error(
        `SSL/TLS certificate error connecting to ${baseUrl}\n` +
        `  → The server's certificate may be invalid or self-signed\n` +
        `  → Check your TESTPLANIT_URL configuration`
      );
    }
  }

  // For other errors, include the original message with context
  const originalMessage = error instanceof Error ? error.message : String(error);
  return new Error(
    `Network error while ${operation}: ${originalMessage}\n` +
    `  → Server: ${baseUrl}`
  );
}

/**
 * Import test result files to TestPlanIt
 *
 * Supports multiple formats: JUnit, TestNG, xUnit, NUnit, MSTest, Mocha, Cucumber
 *
 * @param files - Array of file paths to import
 * @param options - Import options (projectId, name, format, etc.)
 * @param onProgress - Callback for progress updates
 * @returns Promise that resolves when import is complete
 */
export async function importTestResults(
  files: string[],
  options: ImportOptions,
  onProgress?: (event: SSEProgressEvent) => void
): Promise<{ testRunId: number }> {
  const url = getUrl();
  const token = getToken();

  if (!url) {
    throw new Error("TestPlanIt URL is not configured");
  }

  if (!token) {
    throw new Error("API token is not configured");
  }

  // Build the form data
  const form = new FormData();
  form.append("projectId", options.projectId.toString());
  form.append("format", options.format || "auto");

  // Name is optional when appending to an existing test run
  if (options.name) {
    form.append("name", options.name);
  }

  if (options.stateId !== undefined) {
    form.append("stateId", options.stateId.toString());
  }

  if (options.configId !== undefined) {
    form.append("configId", options.configId.toString());
  }

  if (options.milestoneId !== undefined) {
    form.append("milestoneId", options.milestoneId.toString());
  }

  if (options.parentFolderId !== undefined) {
    form.append("parentFolderId", options.parentFolderId.toString());
  }

  if (options.testRunId !== undefined) {
    form.append("testRunId", options.testRunId.toString());
  }

  if (options.tagIds && options.tagIds.length > 0) {
    for (const tagId of options.tagIds) {
      form.append("tagIds", tagId.toString());
    }
  }

  // Add files (read as buffers for compatibility with form.getBuffer())
  for (const filePath of files) {
    const absolutePath = path.resolve(filePath);
    const fileName = path.basename(absolutePath);
    const fileBuffer = fs.readFileSync(absolutePath);
    form.append("files", fileBuffer, { filename: fileName });
  }

  // Use the multi-format import endpoint
  const apiUrl = new URL("/api/test-results/import", url).toString();

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...form.getHeaders(),
      },
      body: new Uint8Array(form.getBuffer()),
    });
  } catch (error) {
    throw formatNetworkError(error, apiUrl, "importing test results");
  }

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const errorBody = (await response.json()) as APIError;
      if (errorBody.error) {
        errorMessage = errorBody.error;
        if (errorBody.code) {
          errorMessage += ` (${errorBody.code})`;
        }
      }
    } catch {
      // Ignore JSON parse errors
    }
    throw new Error(errorMessage);
  }

  // Parse SSE stream
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let testRunId: number | undefined;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events from buffer
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.substring(6)) as SSEProgressEvent;

          if (data.error) {
            throw new Error(data.error);
          }

          if (onProgress) {
            onProgress(data);
          }

          if (data.complete && data.testRunId !== undefined) {
            testRunId = data.testRunId;
          }
        } catch (e) {
          if (e instanceof SyntaxError) {
            // Ignore JSON parse errors (might be partial data)
          } else {
            throw e;
          }
        }
      }
    }
  }

  if (testRunId === undefined) {
    throw new Error("Import completed but no test run ID was returned");
  }

  return { testRunId };
}

/**
 * Look up an entity by name and get its ID
 *
 * @param projectId - Project ID for context (not required for project, config, or tag lookups)
 * @param type - Type of entity to look up
 * @param name - Name to look up
 * @param createIfMissing - If true, create the entity if it doesn't exist (only for tags)
 * @returns The lookup response with the ID
 */
export async function lookup(
  projectId: number | undefined,
  type: LookupType,
  name: string,
  createIfMissing: boolean = false
): Promise<LookupResponse> {
  const url = getUrl();
  const token = getToken();

  if (!url) {
    throw new Error("TestPlanIt URL is not configured");
  }

  if (!token) {
    throw new Error("API token is not configured");
  }

  const apiUrl = new URL("/api/cli/lookup", url).toString();

  const requestBody: Record<string, unknown> = {
    type,
    name,
    createIfMissing,
  };

  if (projectId !== undefined) {
    requestBody.projectId = projectId;
  }

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    throw formatNetworkError(error, apiUrl, `looking up ${type} "${name}"`);
  }

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const errorBody = (await response.json()) as APIError;
      if (errorBody.error) {
        errorMessage = errorBody.error;
      }
    } catch {
      // Ignore JSON parse errors
    }
    throw new Error(errorMessage);
  }

  return (await response.json()) as LookupResponse;
}

/**
 * Check if a string is a numeric ID
 */
export function isNumericId(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

/**
 * Parse a value that could be either an ID or a name
 * Returns the numeric ID if it's a number, otherwise returns null
 */
export function parseIdOrName(value: string): number | null {
  const trimmed = value.trim();
  if (isNumericId(trimmed)) {
    return parseInt(trimmed, 10);
  }
  return null;
}

/**
 * Resolve a value to an ID by looking it up if necessary
 *
 * @param projectId - Project ID for context (not required for project, config, or tag lookups)
 * @param type - Type of entity
 * @param value - ID or name to resolve
 * @param createIfMissing - If true, create the entity if it doesn't exist (only for tags)
 * @returns The resolved ID
 */
export async function resolveToId(
  projectId: number | undefined,
  type: LookupType,
  value: string,
  createIfMissing: boolean = false
): Promise<number> {
  const numericId = parseIdOrName(value);
  if (numericId !== null) {
    return numericId;
  }

  // Look up by name
  const result = await lookup(projectId, type, value, createIfMissing);
  return result.id;
}

/**
 * Resolve a project ID or name to an ID
 *
 * @param value - Project ID or name
 * @returns The resolved project ID
 */
export async function resolveProjectId(value: string): Promise<number> {
  return resolveToId(undefined, "project", value);
}

/**
 * Parse tags string which can contain IDs or names (comma-separated)
 * Names can be quoted to include commas
 *
 * @param projectId - Project ID for context
 * @param tagsStr - Comma-separated tags (IDs or names, names can be quoted)
 * @returns Array of resolved tag IDs
 */
export async function resolveTags(
  projectId: number,
  tagsStr: string
): Promise<number[]> {
  const tags = parseTagsString(tagsStr);
  const tagIds: number[] = [];

  for (const tag of tags) {
    const id = await resolveToId(projectId, "tag", tag, true); // Create tags if missing
    tagIds.push(id);
  }

  return tagIds;
}

/**
 * Parse a tags string that may contain quoted values
 * Examples:
 *   "1,2,3" -> ["1", "2", "3"]
 *   '"tag one","tag two"' -> ["tag one", "tag two"]
 *   '1,"my tag",3' -> ["1", "my tag", "3"]
 */
export function parseTagsString(input: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (!inQuotes && (char === '"' || char === "'")) {
      inQuotes = true;
      quoteChar = char;
    } else if (inQuotes && char === quoteChar) {
      inQuotes = false;
      quoteChar = "";
    } else if (!inQuotes && char === ",") {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        result.push(trimmed);
      }
      current = "";
    } else {
      current += char;
    }
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) {
    result.push(trimmed);
  }

  return result;
}
