#!/usr/bin/env node

// src/index.ts
import { Command as Command3 } from "commander";
import { createRequire } from "module";

// src/commands/config.ts
import { Command } from "commander";

// src/lib/config.ts
import Conf from "conf";
var config = new Conf({
  projectName: "testplanit-cli",
  schema: {
    url: {
      type: "string"
    },
    token: {
      type: "string"
    }
  }
});
function getUrl() {
  return process.env.TESTPLANIT_URL || config.get("url");
}
function getToken() {
  return process.env.TESTPLANIT_TOKEN || config.get("token");
}
function setUrl(url) {
  config.set("url", url);
}
function setToken(token) {
  config.set("token", token);
}
function getConfig() {
  return {
    url: getUrl(),
    token: getToken()
  };
}
function getStoredConfig() {
  return {
    url: config.get("url"),
    token: config.get("token")
  };
}
function clearConfig() {
  config.clear();
}
function getConfigPath() {
  return config.path;
}
function validateConfig() {
  const url = getUrl();
  const token = getToken();
  if (!url) {
    return "TestPlanIt URL is not configured. Run `testplanit config set --url <url>` or set TESTPLANIT_URL environment variable.";
  }
  if (!token) {
    return "API token is not configured. Run `testplanit config set --token <token>` or set TESTPLANIT_TOKEN environment variable.";
  }
  return null;
}

// src/lib/logger.ts
import chalk from "chalk";
import ora from "ora";
var currentSpinner = null;
function info(message) {
  console.log(chalk.blue("\u2139"), message);
}
function success(message) {
  console.log(chalk.green("\u2714"), message);
}
function warn(message) {
  console.log(chalk.yellow("\u26A0"), message);
}
function error(message) {
  console.error(chalk.red("\u2716"), message);
}
function dim(message) {
  console.log(chalk.dim(message));
}
function startSpinner(message) {
  if (currentSpinner) {
    currentSpinner.stop();
  }
  currentSpinner = ora(message).start();
  return currentSpinner;
}
function updateSpinner(message) {
  if (currentSpinner) {
    currentSpinner.text = message;
  }
}
function succeedSpinner(message) {
  if (currentSpinner) {
    currentSpinner.succeed(message);
    currentSpinner = null;
  }
}
function failSpinner(message) {
  if (currentSpinner) {
    currentSpinner.fail(message);
    currentSpinner = null;
  }
}
function formatUrl(url) {
  return chalk.cyan.underline(url);
}
function formatNumber(num) {
  return chalk.bold(num.toString());
}
function formatToken(token) {
  if (token.length <= 8) {
    return chalk.dim("****");
  }
  return chalk.dim(token.substring(0, 8) + "..." + token.substring(token.length - 4));
}

// src/commands/config.ts
function createConfigCommand() {
  const cmd = new Command("config").description("Manage CLI configuration").addHelpText("after", `
Examples:

  Set URL and token:
    $ testplanit config set --url https://testplanit.example.com --token tpi_xxx

  Set URL only:
    $ testplanit config set -u https://testplanit.example.com

  Set token only:
    $ testplanit config set -t tpi_your_api_token_here

  Show current configuration:
    $ testplanit config show

  Clear stored configuration:
    $ testplanit config clear

  Show config file path:
    $ testplanit config path

Note: Environment variables TESTPLANIT_URL and TESTPLANIT_TOKEN take precedence
over stored configuration.
`);
  cmd.command("set").description("Set configuration values").option("-u, --url <url>", "TestPlanIt instance URL").option("-t, --token <token>", "API token").action((options) => {
    let updated = false;
    if (options.url) {
      let url = options.url.trim();
      if (url.endsWith("/")) {
        url = url.slice(0, -1);
      }
      try {
        new URL(url);
      } catch {
        error(`Invalid URL: ${options.url}`);
        process.exit(1);
      }
      setUrl(url);
      success(`URL set to ${formatUrl(url)}`);
      updated = true;
    }
    if (options.token) {
      const token = options.token.trim();
      if (!token.startsWith("tpi_")) {
        warn("Token should start with 'tpi_'. Are you sure this is a valid TestPlanIt API token?");
      }
      setToken(token);
      success(`Token set to ${formatToken(token)}`);
      updated = true;
    }
    if (!updated) {
      warn("No configuration values provided. Use --url or --token options.");
      cmd.help();
    }
  });
  cmd.command("show").description("Show current configuration").action(() => {
    const storedConfig = getStoredConfig();
    const effectiveConfig = getConfig();
    console.log();
    console.log("Configuration file:", getConfigPath());
    console.log();
    console.log("URL:");
    if (process.env.TESTPLANIT_URL) {
      console.log(`  Stored:    ${storedConfig.url ? formatUrl(storedConfig.url) : "(not set)"}`);
      console.log(`  Env var:   ${formatUrl(process.env.TESTPLANIT_URL)} (active)`);
    } else if (storedConfig.url) {
      console.log(`  ${formatUrl(storedConfig.url)}`);
    } else {
      console.log("  (not set)");
    }
    console.log();
    console.log("Token:");
    if (process.env.TESTPLANIT_TOKEN) {
      console.log(`  Stored:    ${storedConfig.token ? formatToken(storedConfig.token) : "(not set)"}`);
      console.log(`  Env var:   ${formatToken(process.env.TESTPLANIT_TOKEN)} (active)`);
    } else if (storedConfig.token) {
      console.log(`  ${formatToken(storedConfig.token)}`);
    } else {
      console.log("  (not set)");
    }
    console.log();
    const validationError = validateConfig();
    if (validationError) {
      warn(validationError);
    } else {
      success("Configuration is complete");
    }
  });
  cmd.command("clear").description("Clear all stored configuration").action(() => {
    clearConfig();
    success("Configuration cleared");
  });
  cmd.command("path").description("Show configuration file path").action(() => {
    console.log(getConfigPath());
  });
  return cmd;
}

// src/commands/import.ts
import { Command as Command2 } from "commander";
import { glob } from "glob";
import * as fs3 from "fs";
import * as path3 from "path";

// src/lib/api.ts
import FormData from "form-data";
import * as fs from "fs";
import * as path from "path";
function formatNetworkError(error2, url, operation) {
  const baseUrl = new URL(url).origin;
  if (error2 instanceof TypeError) {
    const message = error2.message.toLowerCase();
    if (message.includes("fetch failed") || message.includes("econnrefused")) {
      return new Error(
        `Failed to connect to TestPlanIt server at ${baseUrl}
  \u2192 Is the server running?
  \u2192 Check your URL with: testplanit config`
      );
    }
    if (message.includes("enotfound") || message.includes("getaddrinfo")) {
      return new Error(
        `Could not resolve hostname for ${baseUrl}
  \u2192 Check that the URL is correct
  \u2192 Verify your network connection`
      );
    }
    if (message.includes("etimedout") || message.includes("timeout")) {
      return new Error(
        `Request timed out while ${operation}
  \u2192 The server at ${baseUrl} may be slow or unresponsive
  \u2192 Check your network connection`
      );
    }
    if (message.includes("econnreset") || message.includes("socket hang up")) {
      return new Error(
        `Connection was reset while ${operation}
  \u2192 The server at ${baseUrl} closed the connection unexpectedly
  \u2192 Try again, or check server logs`
      );
    }
    if (message.includes("cert") || message.includes("ssl") || message.includes("tls")) {
      return new Error(
        `SSL/TLS certificate error connecting to ${baseUrl}
  \u2192 The server's certificate may be invalid or self-signed
  \u2192 Check your TESTPLANIT_URL configuration`
      );
    }
  }
  const originalMessage = error2 instanceof Error ? error2.message : String(error2);
  return new Error(
    `Network error while ${operation}: ${originalMessage}
  \u2192 Server: ${baseUrl}`
  );
}
async function importTestResults(files, options, onProgress) {
  const url = getUrl();
  const token = getToken();
  if (!url) {
    throw new Error("TestPlanIt URL is not configured");
  }
  if (!token) {
    throw new Error("API token is not configured");
  }
  const form = new FormData();
  form.append("projectId", options.projectId.toString());
  form.append("format", options.format || "auto");
  if (options.name) {
    form.append("name", options.name);
  }
  if (options.stateId !== void 0) {
    form.append("stateId", options.stateId.toString());
  }
  if (options.configId !== void 0) {
    form.append("configId", options.configId.toString());
  }
  if (options.milestoneId !== void 0) {
    form.append("milestoneId", options.milestoneId.toString());
  }
  if (options.parentFolderId !== void 0) {
    form.append("parentFolderId", options.parentFolderId.toString());
  }
  if (options.testRunId !== void 0) {
    form.append("testRunId", options.testRunId.toString());
  }
  if (options.tagIds && options.tagIds.length > 0) {
    for (const tagId of options.tagIds) {
      form.append("tagIds", tagId.toString());
    }
  }
  for (const filePath of files) {
    const absolutePath = path.resolve(filePath);
    const fileName = path.basename(absolutePath);
    const fileBuffer = fs.readFileSync(absolutePath);
    form.append("files", fileBuffer, { filename: fileName });
  }
  const apiUrl = new URL("/api/test-results/import", url).toString();
  let response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...form.getHeaders()
      },
      body: new Uint8Array(form.getBuffer())
    });
  } catch (error2) {
    throw formatNetworkError(error2, apiUrl, "importing test results");
  }
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const errorBody = await response.json();
      if (errorBody.error) {
        errorMessage = errorBody.error;
        if (errorBody.code) {
          errorMessage += ` (${errorBody.code})`;
        }
      }
    } catch {
    }
    throw new Error(errorMessage);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let result;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.substring(6));
          if (data.error) {
            throw new Error(data.error);
          }
          if (onProgress) {
            onProgress(data);
          }
          if (data.complete && data.testRunId !== void 0) {
            result = {
              testRunId: data.testRunId,
              attachmentMappings: data.attachmentMappings
            };
          }
        } catch (e) {
          if (e instanceof SyntaxError) {
          } else {
            throw e;
          }
        }
      }
    }
  }
  if (!result) {
    throw new Error("Import completed but no test run ID was returned");
  }
  return result;
}
async function lookup(projectId, type, name, createIfMissing = false) {
  const url = getUrl();
  const token = getToken();
  if (!url) {
    throw new Error("TestPlanIt URL is not configured");
  }
  if (!token) {
    throw new Error("API token is not configured");
  }
  const apiUrl = new URL("/api/cli/lookup", url).toString();
  const requestBody = {
    type,
    name,
    createIfMissing
  };
  if (projectId !== void 0) {
    requestBody.projectId = projectId;
  }
  let response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
  } catch (error2) {
    throw formatNetworkError(error2, apiUrl, `looking up ${type} "${name}"`);
  }
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const errorBody = await response.json();
      if (errorBody.error) {
        errorMessage = errorBody.error;
      }
    } catch {
    }
    throw new Error(errorMessage);
  }
  return await response.json();
}
function isNumericId(value) {
  return /^\d+$/.test(value.trim());
}
function parseIdOrName(value) {
  const trimmed = value.trim();
  if (isNumericId(trimmed)) {
    return parseInt(trimmed, 10);
  }
  return null;
}
async function resolveToId(projectId, type, value, createIfMissing = false) {
  const numericId = parseIdOrName(value);
  if (numericId !== null) {
    return numericId;
  }
  const result = await lookup(projectId, type, value, createIfMissing);
  return result.id;
}
async function resolveProjectId(value) {
  return resolveToId(void 0, "project", value);
}
async function resolveTags(projectId, tagsStr) {
  const tags = parseTagsString(tagsStr);
  const tagIds = [];
  for (const tag of tags) {
    const id = await resolveToId(projectId, "tag", tag, true);
    tagIds.push(id);
  }
  return tagIds;
}
function parseTagsString(input) {
  const result = [];
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
      const trimmed2 = current.trim();
      if (trimmed2.length > 0) {
        result.push(trimmed2);
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
async function uploadAttachmentsBulk(attachments, onProgress) {
  const url = getUrl();
  const token = getToken();
  if (!url) {
    throw new Error("TestPlanIt URL is not configured");
  }
  if (!token) {
    throw new Error("API token is not configured");
  }
  const existingAttachments = attachments.filter(
    (a) => a.exists && a.resolvedPath
  );
  if (existingAttachments.length === 0) {
    return {
      summary: { total: 0, success: 0, failed: 0 },
      results: []
    };
  }
  const form = new FormData();
  const mappings = [];
  for (const attachment of existingAttachments) {
    if (!attachment.resolvedPath) continue;
    const uniqueFileName = `${attachment.junitTestResultId}_${attachment.name}`;
    const fileBuffer = fs.readFileSync(attachment.resolvedPath);
    form.append("files", fileBuffer, {
      filename: uniqueFileName,
      contentType: attachment.mimeType || "application/octet-stream"
    });
    mappings.push({
      fileName: uniqueFileName,
      junitTestResultId: attachment.junitTestResultId
    });
  }
  form.append("mappings", JSON.stringify(mappings));
  const apiUrl = new URL("/api/junit/attachments/bulk", url).toString();
  let response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...form.getHeaders()
      },
      body: new Uint8Array(form.getBuffer())
    });
  } catch (error2) {
    throw formatNetworkError(error2, apiUrl, "uploading attachments");
  }
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const errorBody = await response.json();
      if (errorBody.error) {
        errorMessage = errorBody.error;
        if (errorBody.code) {
          errorMessage += ` (${errorBody.code})`;
        }
      }
    } catch {
    }
    throw new Error(errorMessage);
  }
  const result = await response.json();
  if (onProgress) {
    onProgress(result.summary.success, result.summary.total);
  }
  return result;
}
async function uploadTestRunAttachments(testRunId, attachments) {
  const url = getUrl();
  const token = getToken();
  if (!url) {
    throw new Error("TestPlanIt URL is not configured");
  }
  if (!token) {
    throw new Error("API token is not configured");
  }
  if (attachments.length === 0) {
    return {
      summary: { total: 0, success: 0, failed: 0 },
      results: []
    };
  }
  const form = new FormData();
  form.append("testRunId", testRunId.toString());
  for (const attachment of attachments) {
    const fileBuffer = fs.readFileSync(attachment.filePath);
    form.append("files", fileBuffer, {
      filename: attachment.name,
      contentType: attachment.mimeType
    });
  }
  const apiUrl = new URL("/api/test-runs/attachments", url).toString();
  let response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...form.getHeaders()
      },
      body: new Uint8Array(form.getBuffer())
    });
  } catch (error2) {
    throw formatNetworkError(error2, apiUrl, "uploading test run attachments");
  }
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const errorBody = await response.json();
      if (errorBody.error) {
        errorMessage = errorBody.error;
        if (errorBody.code) {
          errorMessage += ` (${errorBody.code})`;
        }
      }
    } catch {
    }
    throw new Error(errorMessage);
  }
  return await response.json();
}

// src/lib/attachments.ts
import * as fs2 from "fs";
import * as path2 from "path";
var MIME_TYPES = {
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
  ".zip": "application/zip"
};
function getMimeType(filePath) {
  const ext = path2.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}
function resolveAttachmentPath(attachmentPath, baseDir) {
  if (!attachmentPath) {
    return null;
  }
  if (path2.isAbsolute(attachmentPath)) {
    return attachmentPath;
  }
  return path2.resolve(baseDir, attachmentPath);
}
function resolveAttachments(mappings, xmlFilePaths, attachmentsBaseDir) {
  const resolved = [];
  let baseDir;
  if (attachmentsBaseDir) {
    baseDir = path2.resolve(attachmentsBaseDir);
  } else if (xmlFilePaths.length > 0) {
    baseDir = path2.dirname(path2.resolve(xmlFilePaths[0]));
  } else {
    baseDir = process.cwd();
  }
  for (const mapping of mappings) {
    for (const attachment of mapping.attachments) {
      const resolvedPath = resolveAttachmentPath(attachment.path, baseDir);
      const info2 = {
        name: attachment.name,
        originalPath: attachment.path,
        resolvedPath,
        exists: false,
        junitTestResultId: mapping.junitTestResultId
      };
      if (resolvedPath) {
        try {
          const stats = fs2.statSync(resolvedPath);
          if (stats.isFile()) {
            info2.exists = true;
            info2.size = stats.size;
            info2.mimeType = getMimeType(resolvedPath);
          }
        } catch {
          info2.exists = false;
        }
      }
      resolved.push(info2);
    }
  }
  return resolved;
}
function filterExistingAttachments(attachments) {
  const existing = [];
  const missing = [];
  for (const attachment of attachments) {
    if (attachment.exists && attachment.resolvedPath) {
      existing.push(attachment);
    } else {
      missing.push(attachment);
    }
  }
  return { existing, missing };
}
function getAttachmentSummary(attachments) {
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
    totalSize
  };
}
function formatFileSize(bytes) {
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
function getMimeTypeForFile(filePath) {
  const ext = path2.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}
function resolveTestRunAttachmentFiles(filePaths) {
  const files = [];
  const missing = [];
  let totalSize = 0;
  for (const filePath of filePaths) {
    const absolutePath = path2.resolve(filePath);
    try {
      const stats = fs2.statSync(absolutePath);
      if (stats.isFile()) {
        const file = {
          filePath: absolutePath,
          name: path2.basename(absolutePath),
          size: stats.size,
          mimeType: getMimeTypeForFile(absolutePath)
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

// src/types.ts
var TEST_RESULT_FORMATS = {
  junit: { label: "JUnit XML", extensions: [".xml"] },
  testng: { label: "TestNG XML", extensions: [".xml"] },
  xunit: { label: "xUnit XML", extensions: [".xml"] },
  nunit: { label: "NUnit XML", extensions: [".xml"] },
  mstest: { label: "MSTest TRX", extensions: [".trx", ".xml"] },
  mocha: { label: "Mocha JSON", extensions: [".json"] },
  cucumber: { label: "Cucumber JSON", extensions: [".json"] }
};

// src/commands/import.ts
var VALID_FORMATS = ["auto", ...Object.keys(TEST_RESULT_FORMATS)];
function createImportCommand() {
  const cmd = new Command2("import").description("Import test results into TestPlanIt").argument("<files...>", "Test result files or glob patterns (e.g., ./results/*.xml)").requiredOption("-p, --project <value>", "Project (ID or exact name)").option("-n, --name <name>", "Test run name (required unless appending to existing run with -r)").option(
    "-F, --format <format>",
    `File format: ${VALID_FORMATS.join(", ")} (default: auto-detect)`,
    "auto"
  ).option("-s, --state <value>", "Workflow state (ID or exact name)").option("-c, --config <value>", "Configuration (ID or exact name)").option("-m, --milestone <value>", "Milestone (ID or exact name)").option("-f, --folder <value>", "Parent folder for test cases (ID or exact name)").option("-t, --tags <values>", "Tags (comma-separated IDs or names, use quotes for names with commas)").option("-r, --test-run <value>", "Existing test run to append results (ID or exact name)").option("-d, --attachments-dir <path>", "Base directory for resolving attachment paths (default: directory of test result file)").option("--no-attachments", "Skip uploading attachments").option("-a, --run-attachments <files...>", "Files to attach to the test run (e.g., test plans, reports)").addHelpText("after", `
Examples:

  Minimal example (required options only):
    $ testplanit import ./results.xml -p "My Project" -n "Nightly Build #123"

  Using IDs instead of names:
    $ testplanit import ./results.xml -p 1 -n "Build #123"

  Import multiple files with glob pattern:
    $ testplanit import "./test-results/**/*.xml" -p "My Project" -n "Full Test Suite"

  Append results to an existing test run (no -n needed):
    $ testplanit import ./results.xml -p "My Project" -r "Existing Test Run"

  All options with names:
    $ testplanit import ./results/*.xml \\
        --project "My Project" \\
        --name "Release 2.0 - Regression" \\
        --format junit \\
        --state "In Progress" \\
        --config "Chrome - Production" \\
        --milestone "Sprint 15" \\
        --folder "Automated Tests" \\
        --tags "regression,automated,ci"

  All options with IDs:
    $ testplanit import ./results.xml -p 1 -n "Build" -F junit -s 5 -c 10 -m 3 -f 42 -t 1,2,3

  CI/CD with environment variables:
    $ TESTPLANIT_URL=https://testplanit.example.com \\
      TESTPLANIT_TOKEN=tpi_xxx \\
      testplanit import ./junit.xml -p 1 -n "CI Build $BUILD_NUMBER"

  Import with attachments from a custom directory:
    $ testplanit import ./results.xml -p "My Project" -n "Build" -d ./test-artifacts

  Import without uploading attachments:
    $ testplanit import ./results.xml -p "My Project" -n "Build" --no-attachments

  Attach files to the test run (test plans, reports, etc.):
    $ testplanit import ./results.xml -p "My Project" -n "Build" -a ./test-plan.pdf ./coverage-report.html
`).action(async (filePatterns, options) => {
    const validationError = validateConfig();
    if (validationError) {
      error(validationError);
      process.exit(1);
    }
    if (!options.name && !options.testRun) {
      error("Option -n, --name is required when not appending to an existing test run");
      info("Either provide --name for a new test run, or --test-run to append to an existing one");
      process.exit(1);
    }
    const format = options.format.toLowerCase();
    if (!VALID_FORMATS.includes(format)) {
      error(`Invalid format: ${options.format}`);
      info(`Valid formats: ${VALID_FORMATS.join(", ")}`);
      process.exit(1);
    }
    const files = [];
    for (const pattern of filePatterns) {
      const matches = await glob(pattern, { nodir: true });
      if (matches.length === 0) {
        if (fs3.existsSync(pattern)) {
          files.push(pattern);
        } else {
          warn(`No files matched pattern: ${pattern}`);
        }
      } else {
        files.push(...matches);
      }
    }
    let filteredFiles = files;
    if (format !== "auto") {
      const expectedExtensions = TEST_RESULT_FORMATS[format].extensions;
      filteredFiles = files.filter((file) => {
        const ext = path3.extname(file).toLowerCase();
        return expectedExtensions.includes(ext);
      });
      if (filteredFiles.length < files.length) {
        const skipped = files.length - filteredFiles.length;
        warn(`Skipped ${skipped} file(s) with unexpected extensions for ${TEST_RESULT_FORMATS[format].label}`);
      }
    }
    if (filteredFiles.length === 0) {
      error("No matching files found to import");
      process.exit(1);
    }
    for (const file of filteredFiles) {
      try {
        fs3.accessSync(file, fs3.constants.R_OK);
      } catch {
        error(`Cannot read file: ${file}`);
        process.exit(1);
      }
    }
    const formatLabel = format === "auto" ? "auto-detect" : TEST_RESULT_FORMATS[format].label;
    info(`Found ${formatNumber(filteredFiles.length)} file(s) to import (format: ${formatLabel})`);
    const spinner = startSpinner("Resolving options...");
    try {
      updateSpinner("Resolving project...");
      const projectId = await resolveProjectId(options.project);
      const importOptions = {
        projectId,
        name: options.name,
        format
      };
      if (options.state) {
        updateSpinner("Resolving workflow state...");
        importOptions.stateId = await resolveToId(projectId, "state", options.state);
      }
      if (options.config) {
        updateSpinner("Resolving configuration...");
        importOptions.configId = await resolveToId(projectId, "config", options.config);
      }
      if (options.milestone) {
        updateSpinner("Resolving milestone...");
        importOptions.milestoneId = await resolveToId(projectId, "milestone", options.milestone);
      }
      if (options.folder) {
        updateSpinner("Resolving folder...");
        importOptions.parentFolderId = await resolveToId(projectId, "folder", options.folder);
      }
      if (options.tags) {
        updateSpinner("Resolving tags...");
        importOptions.tagIds = await resolveTags(projectId, options.tags);
      }
      if (options.testRun) {
        updateSpinner("Resolving test run...");
        importOptions.testRunId = await resolveToId(projectId, "testRun", options.testRun);
      }
      updateSpinner("Starting import...");
      const result = await importTestResults(
        filteredFiles,
        importOptions,
        (event) => {
          if (event.status) {
            updateSpinner(`[${event.progress || 0}%] ${event.status}`);
          }
        }
      );
      succeedSpinner("Import completed successfully!");
      const url = getUrl();
      console.log();
      success(`Test run created with ID: ${formatNumber(result.testRunId)}`);
      if (options.attachments !== false && result.attachmentMappings && result.attachmentMappings.length > 0) {
        console.log();
        info("Processing attachments...");
        const resolvedAttachments = resolveAttachments(
          result.attachmentMappings,
          filteredFiles,
          options.attachmentsDir
        );
        const summary = getAttachmentSummary(resolvedAttachments);
        if (summary.total > 0) {
          info(`  Found: ${formatNumber(summary.existing)} attachment(s)`);
          if (summary.missing > 0) {
            warn(`  Missing: ${formatNumber(summary.missing)} attachment(s) (skipped)`);
            const { missing } = filterExistingAttachments(resolvedAttachments);
            for (const attachment of missing.slice(0, 5)) {
              dim(`    - ${attachment.name}`);
            }
            if (missing.length > 5) {
              dim(`    ... and ${missing.length - 5} more`);
            }
          }
          if (summary.existing > 0) {
            const attachSpinner = startSpinner(
              `Uploading ${summary.existing} attachment(s) (${formatFileSize(summary.totalSize)})...`
            );
            try {
              const { existing } = filterExistingAttachments(resolvedAttachments);
              const uploadResult = await uploadAttachmentsBulk(existing);
              if (uploadResult.summary.failed > 0) {
                succeedSpinner(
                  `Uploaded ${formatNumber(uploadResult.summary.success)} attachment(s), ${formatNumber(uploadResult.summary.failed)} failed`
                );
                for (const r of uploadResult.results.filter((r2) => !r2.success)) {
                  warn(`  Failed: ${r.fileName} - ${r.error || "Unknown error"}`);
                }
              } else {
                succeedSpinner(
                  `Uploaded ${formatNumber(uploadResult.summary.success)} attachment(s)`
                );
              }
            } catch (attachError) {
              failSpinner("Attachment upload failed");
              if (attachError instanceof Error) {
                warn(`  ${attachError.message}`);
              }
            }
          }
        }
      }
      if (options.runAttachments && options.runAttachments.length > 0) {
        console.log();
        info("Processing test run attachments...");
        const runAttachmentPaths = [];
        for (const pattern of options.runAttachments) {
          const matches = await glob(pattern, { nodir: true });
          if (matches.length === 0) {
            if (fs3.existsSync(pattern)) {
              runAttachmentPaths.push(pattern);
            } else {
              warn(`  No files matched pattern: ${pattern}`);
            }
          } else {
            runAttachmentPaths.push(...matches);
          }
        }
        if (runAttachmentPaths.length > 0) {
          const { files: runAttachmentFiles, missing, totalSize } = resolveTestRunAttachmentFiles(runAttachmentPaths);
          if (missing.length > 0) {
            warn(`  Missing: ${formatNumber(missing.length)} file(s) (skipped)`);
            for (const missingPath of missing.slice(0, 5)) {
              dim(`    - ${missingPath}`);
            }
            if (missing.length > 5) {
              dim(`    ... and ${missing.length - 5} more`);
            }
          }
          if (runAttachmentFiles.length > 0) {
            const runAttachSpinner = startSpinner(
              `Uploading ${runAttachmentFiles.length} test run attachment(s) (${formatFileSize(totalSize)})...`
            );
            try {
              const uploadResult = await uploadTestRunAttachments(result.testRunId, runAttachmentFiles);
              if (uploadResult.summary.failed > 0) {
                succeedSpinner(
                  `Uploaded ${formatNumber(uploadResult.summary.success)} test run attachment(s), ${formatNumber(uploadResult.summary.failed)} failed`
                );
                for (const r of uploadResult.results.filter((r2) => !r2.success)) {
                  warn(`  Failed: ${r.fileName} - ${r.error || "Unknown error"}`);
                }
              } else {
                succeedSpinner(
                  `Uploaded ${formatNumber(uploadResult.summary.success)} test run attachment(s)`
                );
              }
            } catch (runAttachError) {
              failSpinner("Test run attachment upload failed");
              if (runAttachError instanceof Error) {
                warn(`  ${runAttachError.message}`);
              }
            }
          }
        }
      }
      if (url) {
        console.log();
        const testRunUrl = `${url}/projects/runs/${projectId}/${result.testRunId}`;
        info(`View at: ${formatUrl(testRunUrl)}`);
      }
    } catch (error2) {
      failSpinner("Import failed");
      if (error2 instanceof Error) {
        const lines = error2.message.split("\n");
        for (const line of lines) {
          if (line.trim()) {
            error(line);
          }
        }
      } else {
        error("Unknown error occurred");
      }
      process.exit(1);
    }
  });
  return cmd;
}

// src/index.ts
var require2 = createRequire(import.meta.url);
var packageJson = require2("../package.json");
var program = new Command3();
program.name("testplanit").description("CLI tool for TestPlanIt - import test results and manage test data").version(packageJson.version).addHelpText("after", `
Examples:

  Configure the CLI:
    $ testplanit config set --url https://testplanit.example.com --token tpi_xxx

  Import test results (minimal):
    $ testplanit import ./results.xml -p "My Project" -n "Build #123"

  Import with all options:
    $ testplanit import ./results/*.xml -p "My Project" -n "Release Test" \\
        -s "In Progress" -c "Chrome" -m "Sprint 1" -t "regression,ci"

Run 'testplanit <command> --help' for more information on a command.
`);
program.addCommand(createConfigCommand());
program.addCommand(createImportCommand());
program.parse();
