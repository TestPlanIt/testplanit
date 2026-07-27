import * as fs from 'fs/promises';
import * as path from 'path';
import { TestPlanItClient } from '@testplanit/api';
export { TestPlanItClient, TestPlanItError } from '@testplanit/api';

// src/reporter.ts
var ENV_PLACEHOLDER = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;
function applyEnvTemplate(template) {
  const missing = [];
  const value = template.replace(ENV_PLACEHOLDER, (_match, name) => {
    const envValue = process.env[name];
    if (envValue === void 0 || envValue === "") {
      missing.push(name);
      return "";
    }
    return envValue;
  });
  return { value, missing };
}
var MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".html": "text/html",
  ".htm": "text/html",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".json": "application/json",
  ".xml": "application/xml",
  ".csv": "text/csv",
  ".pdf": "application/pdf",
  ".zip": "application/zip"
};
function guessMimeType(fileName) {
  return MIME_TYPES[path.extname(fileName).toLowerCase()] ?? "application/octet-stream";
}
var RUN_LEVEL_ATTACHMENT_PREFIX = "testplanit:run-";
var RUN_LINK_ATTACHMENT = "testplanit:run-link";
var RUN_METADATA_ATTACHMENT = "testplanit:run-metadata";
var RUN_FILE_ATTACHMENT_PREFIX = "testplanit:run-file:";
async function attachToRun(testInfo, input) {
  if ("url" in input && input.url) {
    const { url, name, note } = input;
    await testInfo.attach(RUN_LINK_ATTACHMENT, {
      body: JSON.stringify({ url, name, note }),
      contentType: "application/json"
    });
    return;
  }
  const file = input;
  if (file.buffer) {
    if (!file.name) {
      console.error('[TestPlanIt] attachToRun: "name" is required when attaching a buffer');
      return;
    }
    await testInfo.attach(`${RUN_FILE_ATTACHMENT_PREFIX}${file.name}`, {
      body: file.buffer,
      contentType: file.mimeType ?? guessMimeType(file.name)
    });
    return;
  }
  if (file.path) {
    const name = file.name && file.name.trim() ? file.name : path.basename(file.path);
    await testInfo.attach(`${RUN_FILE_ATTACHMENT_PREFIX}${name}`, {
      path: file.path,
      contentType: file.mimeType ?? guessMimeType(name)
    });
    return;
  }
  console.error('[TestPlanIt] attachToRun: provide a "url", "path", or "buffer"');
}
async function setRunMetadata(testInfo, metadata) {
  await testInfo.attach(RUN_METADATA_ATTACHMENT, {
    body: JSON.stringify(metadata),
    contentType: "application/json"
  });
}
function isRunLevelAttachment(name) {
  return name.startsWith(RUN_LEVEL_ATTACHMENT_PREFIX);
}
function parseRunLevelAttachment(att) {
  if (att.name === RUN_LINK_ATTACHMENT) {
    const parsed = parseJsonBody(att.body);
    const url = typeof parsed?.url === "string" ? parsed.url : "";
    if (!url) return null;
    return {
      kind: "link",
      url,
      name: typeof parsed?.name === "string" ? parsed.name : void 0,
      note: typeof parsed?.note === "string" ? parsed.note : void 0
    };
  }
  if (att.name === RUN_METADATA_ATTACHMENT) {
    const parsed = parseJsonBody(att.body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return { kind: "metadata", metadata: parsed };
  }
  if (att.name.startsWith(RUN_FILE_ATTACHMENT_PREFIX)) {
    const name = att.name.slice(RUN_FILE_ATTACHMENT_PREFIX.length);
    if (!name || !att.path && !att.body) return null;
    return { kind: "file", name, contentType: att.contentType, path: att.path, body: att.body };
  }
  return null;
}
function parseJsonBody(body) {
  if (!body) return null;
  try {
    return JSON.parse(body.toString("utf-8"));
  } catch {
    return null;
  }
}
function runLevelOpKey(op) {
  switch (op.kind) {
    case "link":
      return `link|${op.url}|${op.name ?? ""}`;
    case "file":
      return `file|${op.name}`;
    case "metadata":
      return `metadata|${JSON.stringify(op.metadata)}`;
  }
}

// src/reporter.ts
var ANSI_PATTERN = new RegExp(
  "[\\u001b\\u009b][[\\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-ntqry=><~]",
  "g"
);
function stripAnsi(input) {
  if (!input) return input;
  return input.replace(ANSI_PATTERN, "");
}
var TestPlanItReporter = class {
  client;
  options;
  state;
  /** Memoized initialization (create test run, fetch statuses). */
  initPromise = null;
  /** Memoized JUnit suite creation. */
  suitePromise = null;
  /** In-flight result-reporting / upload operations awaited in onEnd. */
  pendingOperations = /* @__PURE__ */ new Set();
  reportedResultCount = 0;
  /** Run-name placeholder context, captured from reported tests. */
  currentSpec;
  currentProject;
  rootSuiteName;
  /**
   * `runAttachments` entries whose file couldn't be read at initialization
   * (typically artifacts produced by the tests themselves). Retried once in
   * onEnd, before the run is completed.
   */
  deferredRunAttachments = [];
  /**
   * Keys of runtime run-level ops already applied this session, so retried
   * tests (which re-run their attachToRun/setRunMetadata calls) don't create
   * duplicate run attachments.
   */
  appliedRunOps = /* @__PURE__ */ new Set();
  constructor(options) {
    this.options = {
      caseIdPattern: /\[(\d+)\]/g,
      caseIdAnnotation: "testplanit",
      autoCreateTestCases: false,
      captureSteps: true,
      overwriteSteps: false,
      createFolderHierarchy: false,
      uploadAttachments: true,
      includeStackTrace: true,
      completeRunOnFinish: true,
      timeout: 3e4,
      maxRetries: 3,
      verbose: false,
      ...options
    };
    if (!this.options.domain) {
      throw new Error("TestPlanIt reporter: domain is required");
    }
    if (!this.options.apiToken) {
      throw new Error("TestPlanIt reporter: apiToken is required");
    }
    if (!this.options.projectId) {
      throw new Error("TestPlanIt reporter: projectId is required");
    }
    this.client = new TestPlanItClient({
      baseUrl: this.options.domain,
      apiToken: this.options.apiToken,
      timeout: this.options.timeout,
      maxRetries: this.options.maxRetries
    });
    this.state = {
      testRunId: typeof this.options.testRunId === "number" ? this.options.testRunId : void 0,
      resolvedIds: {},
      results: /* @__PURE__ */ new Map(),
      caseIdMap: /* @__PURE__ */ new Map(),
      testRunCaseMap: /* @__PURE__ */ new Map(),
      caseStepsMap: /* @__PURE__ */ new Map(),
      folderPathMap: /* @__PURE__ */ new Map(),
      statusIds: {},
      initialized: false,
      stats: {
        testCasesFound: 0,
        testCasesCreated: 0,
        testCasesMoved: 0,
        testStepsCreated: 0,
        foldersCreated: 0,
        resultsPassed: 0,
        resultsFailed: 0,
        resultsSkipped: 0,
        attachmentsUploaded: 0,
        attachmentsFailed: 0,
        apiErrors: 0,
        startTime: /* @__PURE__ */ new Date()
      }
    };
  }
  /** Tell Playwright this reporter writes to stdout (summary + warnings). */
  printsToStdio() {
    return true;
  }
  log(message, ...args) {
    if (this.options.verbose) {
      console.log(`[TestPlanIt] ${message}`, ...args);
    }
  }
  logError(message, error) {
    const errorMsg = error instanceof Error ? error.message : String(error ?? "");
    const stack = error instanceof Error && error.stack ? `
${error.stack}` : "";
    console.error(`[TestPlanIt] ERROR: ${message}`, errorMsg, stack);
  }
  /**
   * Track an async operation so onEnd waits for it to complete.
   */
  trackOperation(operation) {
    this.pendingOperations.add(operation);
    operation.finally(() => {
      this.pendingOperations.delete(operation);
    });
  }
  // ============================================================================
  // Playwright Reporter hooks
  // ============================================================================
  onBegin(_config, _suite) {
    this.log("Reporter started");
    this.log(`  Domain: ${this.options.domain}`);
    this.log(`  Project ID: ${this.options.projectId}`);
  }
  onTestEnd(test, result) {
    const status = this.normalizeStatus(result.status);
    const { caseIds: titleIds, cleanTitle } = this.parseCaseIds(test.title);
    const caseIds = [
      .../* @__PURE__ */ new Set([
        ...this.getAnnotationCaseIds(test, result),
        ...this.getTagCaseIds(test),
        ...titleIds
      ])
    ];
    const suitePath = this.getSuitePath(test);
    const suiteName = suitePath.join(" > ");
    const fullTitle = suiteName ? `${suiteName} > ${cleanTitle}` : cleanTitle;
    const projectName = this.getProjectName(test);
    const specFile = test.location?.file;
    if (specFile) this.currentSpec = specFile;
    if (projectName) this.currentProject = projectName;
    if (!this.rootSuiteName && suitePath.length > 0) this.rootSuiteName = suitePath[0];
    const startedAt = result.startTime ? new Date(result.startTime) : /* @__PURE__ */ new Date();
    const durationMs = result.duration ?? 0;
    const finishedAt = new Date(startedAt.getTime() + durationMs);
    const uid = `${projectName ?? ""}:${test.id}:${result.retry}`;
    const wantSteps = this.options.autoCreateTestCases === true && this.options.captureSteps !== false || this.options.overwriteSteps === true;
    const stepTitles = wantSteps ? this.extractStepTitles(result.steps) : void 0;
    const tracked = {
      caseId: caseIds[0],
      suiteName,
      suitePath,
      testName: cleanTitle,
      fullTitle,
      originalTitle: test.title,
      status,
      duration: durationMs,
      errorMessage: stripAnsi(result.error?.message),
      stackTrace: this.options.includeStackTrace ? stripAnsi(result.error?.stack) : void 0,
      startedAt,
      finishedAt,
      browser: projectName,
      platform: process.platform,
      retryAttempt: result.retry,
      uid,
      specFile,
      systemOut: this.joinOutput(result.stdout),
      systemErr: this.joinOutput(result.stderr),
      stepTitles
    };
    this.state.results.set(uid, tracked);
    this.log(
      `Test ${status}:`,
      cleanTitle,
      caseIds.length > 0 ? `(Case IDs: ${caseIds.join(", ")})` : ""
    );
    const attachments = [];
    for (const a of result.attachments ?? []) {
      const pending = {
        name: a.name,
        contentType: a.contentType,
        path: a.path,
        body: a.body
      };
      if (isRunLevelAttachment(a.name)) {
        const op = parseRunLevelAttachment(pending);
        if (!op) {
          this.logError(`Ignoring malformed run-level attachment "${a.name}"`);
          continue;
        }
        const key = runLevelOpKey(op);
        if (this.appliedRunOps.has(key)) {
          this.log(`Skipping duplicate run-level operation: ${key}`);
          continue;
        }
        this.appliedRunOps.add(key);
        this.trackOperation(this.applyRunLevelOp(op));
        continue;
      }
      attachments.push(pending);
    }
    const reportPromise = this.reportResult(tracked, caseIds, attachments);
    this.trackOperation(reportPromise);
  }
  onError(error) {
    this.log("Playwright reported an error:", stripAnsi(error.message) ?? error.message);
  }
  async onEnd(_result) {
    if (this.state.results.size === 0 && !this.initPromise) {
      this.log("No test results to report, skipping");
      return;
    }
    this.log("Run ended, waiting for initialization and pending results...");
    if (this.initPromise) {
      try {
        await this.initPromise;
      } catch {
      }
    }
    await Promise.allSettled([...this.pendingOperations]);
    if (this.state.initError) {
      console.error("\n[TestPlanIt] FAILED: Reporter initialization failed");
      console.error(`  Error: ${this.state.initError.message}`);
      console.error("  No results were reported to TestPlanIt.");
      console.error("  Please check your configuration and API connectivity.");
      return;
    }
    if (!this.state.testRunId) {
      this.log("No test run created, skipping summary");
      return;
    }
    await this.applyDeferredRunAttachments();
    if (this.reportedResultCount === 0) {
      this.log("No results were reported to TestPlanIt, skipping summary");
      return;
    }
    if (this.options.completeRunOnFinish) {
      try {
        await this.client.completeTestRun(this.state.testRunId, this.options.projectId);
        this.log("Test run completed:", this.state.testRunId);
      } catch (error) {
        this.logError("Failed to complete test run:", error);
      }
    }
    this.printSummary();
  }
  // ============================================================================
  // Reporting
  // ============================================================================
  async reportResult(result, caseIds, attachments) {
    try {
      if (caseIds.length === 0 && !this.options.autoCreateTestCases) {
        console.warn(
          `[TestPlanIt] WARNING: Skipping "${result.testName}" - no case ID found and autoCreateTestCases is disabled. Set autoCreateTestCases: true to automatically find or create test cases by name.`
        );
        return;
      }
      await this.initialize();
      if (!this.state.testRunId) {
        this.logError("No test run ID available, skipping result");
        return;
      }
      await this.ensureJUnitTestSuite();
      if (!this.state.testSuiteId) {
        this.logError("No test suite ID available, skipping result");
        return;
      }
      let repositoryCaseId;
      if (caseIds.length > 0) {
        repositoryCaseId = caseIds[0];
        if (this.options.overwriteSteps) {
          await this.writeCaseSteps(repositoryCaseId, result.stepTitles, true);
        }
      } else if (this.options.autoCreateTestCases) {
        repositoryCaseId = await this.resolveAutoCreatedCaseId(result);
      }
      if (!repositoryCaseId) {
        this.log("No repository case ID, skipping result");
        return;
      }
      const runCaseKey = `${this.state.testRunId}_${repositoryCaseId}`;
      await this.getTestRunCaseId(runCaseKey, repositoryCaseId);
      const statusId = this.state.statusIds[result.status] ?? this.state.statusIds.failed;
      const junitType = this.mapStatusToJUnitType(result.status);
      const junitResult = await this.client.createJUnitTestResult({
        testSuiteId: this.state.testSuiteId,
        repositoryCaseId,
        type: junitType,
        message: result.errorMessage,
        content: result.stackTrace,
        statusId,
        time: result.duration / 1e3,
        // ms → seconds
        executedAt: result.finishedAt,
        file: result.specFile,
        systemOut: result.systemOut,
        systemErr: result.systemErr
      });
      result.junitResultId = junitResult.id;
      this.reportedResultCount++;
      this.log("Created JUnit test result:", junitResult.id, "(type:", junitType + ")");
      if (result.status === "failed") {
        this.state.stats.resultsFailed++;
      } else if (result.status === "skipped") {
        this.state.stats.resultsSkipped++;
      } else {
        this.state.stats.resultsPassed++;
      }
      await this.uploadAttachments(result, attachments);
    } catch (error) {
      this.state.stats.apiErrors++;
      this.logError(`Failed to report result for ${result.testName}:`, error);
    }
  }
  /**
   * Resolve (and cache) the repository case ID for an auto-created test case,
   * creating the folder hierarchy first when enabled.
   */
  resolveAutoCreatedCaseId(result) {
    const caseKey = this.createCaseKey(result.suiteName, result.testName);
    let promise = this.state.caseIdMap.get(caseKey);
    if (promise) return promise;
    promise = (async () => {
      const templateId = this.state.resolvedIds.templateId;
      if (!this.state.resolvedIds.parentFolderId || !templateId) {
        throw new Error("autoCreateTestCases requires parentFolderId and templateId");
      }
      let folderId = this.state.resolvedIds.parentFolderId;
      if (this.options.createFolderHierarchy && result.suitePath.length > 0) {
        folderId = await this.getFolderId(result.suitePath);
      }
      const { testCase, action } = await this.client.findOrCreateTestCase({
        projectId: this.options.projectId,
        folderId,
        templateId,
        name: result.testName,
        className: result.suiteName || void 0,
        source: "API",
        automated: true
      });
      if (action === "created") {
        this.state.stats.testCasesCreated++;
        if (this.options.captureSteps !== false) {
          await this.writeCaseSteps(testCase.id, result.stepTitles, false);
        }
      } else {
        if (action === "found") this.state.stats.testCasesFound++;
        else this.state.stats.testCasesMoved++;
        if (this.options.overwriteSteps) {
          await this.writeCaseSteps(testCase.id, result.stepTitles, true);
        }
      }
      this.log(`${action} test case:`, testCase.id, testCase.name, "in folder:", folderId);
      return testCase.id;
    })();
    this.state.caseIdMap.set(caseKey, promise);
    promise.catch(() => this.state.caseIdMap.delete(caseKey));
    return promise;
  }
  /**
   * Write captured `test.step()` titles as authored steps on a case (memoized
   * so it runs once per case per run). When `replace` is set, the case's
   * existing steps are soft-deleted first — but a test with no captured steps
   * never clears anything, so an existing case is never accidentally emptied.
   *
   * Best-effort: failures are logged but never bubble up, so result reporting
   * is never blocked by step syncing.
   */
  writeCaseSteps(testCaseId, stepTitles, replace) {
    if (!stepTitles || stepTitles.length === 0) return Promise.resolve();
    let promise = this.state.caseStepsMap.get(testCaseId);
    if (promise) return promise;
    promise = (async () => {
      if (replace) {
        try {
          const removed = await this.client.softDeleteCaseSteps(testCaseId);
          this.log(`Cleared ${removed} existing step(s) on case:`, testCaseId);
        } catch (error) {
          this.logError(
            `Failed to clear existing steps on case ${testCaseId}; skipping step sync:`,
            error
          );
          return;
        }
      }
      try {
        const steps = stepTitles.map((step, order) => ({ step, order }));
        await this.client.createSteps({ testCaseId, steps });
        this.state.stats.testStepsCreated += stepTitles.length;
        this.log(`${replace ? "Replaced" : "Created"} ${stepTitles.length} step(s) on case:`, testCaseId);
      } catch (error) {
        this.logError(`Failed to create steps on case ${testCaseId}:`, error);
      }
    })();
    this.state.caseStepsMap.set(testCaseId, promise);
    promise.catch(() => this.state.caseStepsMap.delete(testCaseId));
    return promise;
  }
  /** Resolve (and cache) the folder ID for a describe path. */
  getFolderId(suitePath) {
    const key = suitePath.join(" > ");
    let promise = this.state.folderPathMap.get(key);
    if (promise) return promise;
    promise = this.client.findOrCreateFolderPath(this.options.projectId, suitePath, this.state.resolvedIds.parentFolderId).then((folder) => {
      this.log("Created/found folder:", folder.name, "(ID:", folder.id + ")");
      return folder.id;
    });
    this.state.folderPathMap.set(key, promise);
    promise.catch(() => this.state.folderPathMap.delete(key));
    return promise;
  }
  /** Add the case to the run once (memoized per case). */
  getTestRunCaseId(runCaseKey, repositoryCaseId) {
    let promise = this.state.testRunCaseMap.get(runCaseKey);
    if (promise) return promise;
    promise = this.client.findOrAddTestCaseToRun({ testRunId: this.state.testRunId, repositoryCaseId }).then((testRunCase) => {
      this.log("Added case to run:", testRunCase.id);
      return testRunCase.id;
    });
    this.state.testRunCaseMap.set(runCaseKey, promise);
    promise.catch(() => this.state.testRunCaseMap.delete(runCaseKey));
    return promise;
  }
  async uploadAttachments(result, attachments) {
    if (!this.options.uploadAttachments || attachments.length === 0 || !result.junitResultId) {
      return;
    }
    const filtered = attachments.filter((a) => this.attachmentMatches(a));
    if (filtered.length === 0) return;
    const sanitizedTestName = result.testName.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 50);
    const note = this.buildAttachmentNote(result);
    const uploads = filtered.map(async (att) => {
      try {
        const buffer = att.body ?? (att.path ? await fs.readFile(att.path) : void 0);
        if (!buffer || buffer.length === 0) {
          this.log(`Skipping empty attachment "${att.name}" for ${result.testName}`);
          return;
        }
        const baseName = att.path ? path.basename(att.path) : `${att.name || "attachment"}${this.extForContentType(att.contentType)}`;
        const fileName = `${sanitizedTestName}_${result.status}_${baseName}`;
        await this.client.uploadJUnitAttachment(
          result.junitResultId,
          buffer,
          fileName,
          att.contentType || "application/octet-stream",
          note
        );
        this.state.stats.attachmentsUploaded++;
        this.log(`Uploaded attachment ${fileName} for ${result.testName}`);
      } catch (error) {
        this.state.stats.attachmentsFailed++;
        this.logError(`Failed to upload attachment "${att.name}":`, error);
      }
    });
    await Promise.allSettled(uploads);
  }
  attachmentMatches(att) {
    const types = this.options.attachmentTypes;
    if (!types || types.length === 0) return true;
    return types.some(
      (t) => att.name === t || (att.contentType ? att.contentType.startsWith(t) : false)
    );
  }
  buildAttachmentNote(result) {
    const parts = [`Test: ${result.testName}`];
    if (result.suiteName) parts.push(`Suite: ${result.suiteName}`);
    parts.push(`Status: ${result.status}`);
    if (result.browser) parts.push(`Browser: ${result.browser}`);
    if (result.errorMessage) {
      const preview = result.errorMessage.length > 200 ? result.errorMessage.substring(0, 200) + "..." : result.errorMessage;
      parts.push(`Error: ${preview}`);
    }
    return parts.join("\n");
  }
  // ============================================================================
  // Run-level attachments (links, files, metadata on the run itself)
  // ============================================================================
  /**
   * Apply one runtime run-level operation (from an attachToRun /
   * setRunMetadata call in a test). Initializes the reporter if needed —
   * an explicit run-level call is a reason to create the run. Failures are
   * logged and swallowed; they never fail the test run.
   */
  async applyRunLevelOp(op) {
    try {
      await this.initialize();
      const testRunId = this.state.testRunId;
      if (!testRunId) return;
      switch (op.kind) {
        case "link": {
          await this.client.addTestRunLink(testRunId, op.url, op.name, op.note);
          this.log(`Attached link to run: ${op.url}`);
          break;
        }
        case "file": {
          const buffer = op.body ?? (op.path ? await fs.readFile(op.path) : void 0);
          if (!buffer || buffer.length === 0) {
            this.log(`Skipping empty run attachment "${op.name}"`);
            return;
          }
          await this.client.uploadTestRunAttachment(
            testRunId,
            buffer,
            op.name,
            op.contentType || guessMimeType(op.name)
          );
          this.log(`Attached file to run: ${op.name}`);
          break;
        }
        case "metadata": {
          await this.client.setTestRunMetadata(testRunId, op.metadata);
          this.log(`Set run metadata: ${Object.keys(op.metadata).join(", ")}`);
          break;
        }
      }
    } catch (error) {
      this.logError(`Failed to apply run-level ${op.kind}:`, error);
    }
  }
  /**
   * Apply the declarative run-level options (`runLinks`, `runMetadata`,
   * `runAttachments`) to the just-created test run. Called once from
   * initialization, and only when the reporter created the run itself —
   * appending to an existing run (`testRunId`) skips this so re-runs don't
   * attach duplicates. Every failure is logged and swallowed.
   */
  async applyRunLevelConfig() {
    const testRunId = this.state.testRunId;
    if (!testRunId) return;
    for (const link of this.options.runLinks ?? []) {
      try {
        const url = applyEnvTemplate(link.url ?? "");
        if (url.missing.length > 0 || !url.value.trim()) {
          this.logError(
            `Skipping run link "${link.url}": unresolved environment variable(s) ${url.missing.join(", ") || "(empty url)"}`
          );
          continue;
        }
        const name = link.name ? applyEnvTemplate(link.name).value.trim() : "";
        const note = link.note ? applyEnvTemplate(link.note).value : void 0;
        await this.client.addTestRunLink(testRunId, url.value, name || void 0, note);
        this.log(`Attached link to run: ${url.value}`);
      } catch (error) {
        this.logError(`Failed to attach run link "${link.url}":`, error);
      }
    }
    const metadata = {};
    for (const [rawKey, rawValue] of Object.entries(this.options.runMetadata ?? {})) {
      const key = applyEnvTemplate(rawKey).value.trim();
      if (!key) continue;
      if (typeof rawValue === "string") {
        const value = applyEnvTemplate(rawValue);
        if (value.missing.length > 0 && !value.value.trim()) {
          this.logError(
            `Skipping run metadata "${rawKey}": unresolved environment variable(s) ${value.missing.join(", ")}`
          );
          continue;
        }
        metadata[key] = value.value;
      } else {
        metadata[key] = rawValue;
      }
    }
    if (Object.keys(metadata).length > 0) {
      try {
        await this.client.setTestRunMetadata(testRunId, metadata);
        this.log(`Set run metadata: ${Object.keys(metadata).join(", ")}`);
      } catch (error) {
        this.logError("Failed to set run metadata:", error);
      }
    }
    for (const attachment of this.options.runAttachments ?? []) {
      try {
        const resolved = { ...attachment };
        if (resolved.name) {
          resolved.name = applyEnvTemplate(resolved.name).value;
        }
        if (!resolved.buffer && resolved.path) {
          const templatedPath = applyEnvTemplate(resolved.path);
          if (templatedPath.missing.length > 0) {
            this.logError(
              `Skipping run attachment "${attachment.path}": unresolved environment variable(s) ${templatedPath.missing.join(", ")}`
            );
            continue;
          }
          resolved.path = templatedPath.value;
        }
        const uploaded = await this.uploadRunFile(testRunId, resolved);
        if (!uploaded && resolved.path && !resolved.buffer) {
          this.log(
            `Run attachment not readable yet, will retry after tests finish: ${resolved.path}`
          );
          this.deferredRunAttachments.push(resolved);
        }
      } catch (error) {
        this.logError(
          `Failed to attach run file "${attachment.name ?? attachment.path}":`,
          error
        );
      }
    }
  }
  /**
   * Read and upload one declarative run attachment. Returns false when a
   * path-based entry can't be read (so the caller can defer it); invalid
   * entries are logged and count as handled (true).
   */
  async uploadRunFile(testRunId, input) {
    let buffer;
    let name;
    if (input.buffer) {
      if (!input.name) {
        this.logError('runAttachments: "name" is required when attaching a buffer');
        return true;
      }
      buffer = input.buffer;
      name = input.name;
    } else if (input.path) {
      try {
        buffer = await fs.readFile(input.path);
      } catch {
        return false;
      }
      name = input.name && input.name.trim() ? input.name : path.basename(input.path);
    } else {
      this.logError('runAttachments: provide a "path" or "buffer"');
      return true;
    }
    const mimeType = input.mimeType ?? guessMimeType(name);
    await this.client.uploadTestRunAttachment(testRunId, buffer, name, mimeType);
    this.log(`Attached file to run: ${name}`);
    return true;
  }
  /**
   * Retry `runAttachments` entries whose file wasn't readable at
   * initialization. Called from onEnd before the run is completed.
   */
  async applyDeferredRunAttachments() {
    const testRunId = this.state.testRunId;
    if (!testRunId || this.deferredRunAttachments.length === 0) return;
    for (const attachment of this.deferredRunAttachments) {
      try {
        const uploaded = await this.uploadRunFile(testRunId, attachment);
        if (!uploaded) {
          this.logError(`Run attachment still not readable, skipping: ${attachment.path}`);
        }
      } catch (error) {
        this.logError(
          `Failed to attach run file "${attachment.name ?? attachment.path}":`,
          error
        );
      }
    }
    this.deferredRunAttachments = [];
  }
  // ============================================================================
  // Initialization
  // ============================================================================
  initialize() {
    if (this.state.initialized) return Promise.resolve();
    if (this.state.initError) return Promise.reject(this.state.initError);
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInitialize();
    return this.initPromise;
  }
  async doInitialize() {
    try {
      this.log("Initializing reporter...");
      await this.resolveOptionIds();
      if (this.options.autoCreateTestCases && (!this.state.resolvedIds.parentFolderId || !this.state.resolvedIds.templateId)) {
        throw new Error("autoCreateTestCases requires parentFolderId and templateId");
      }
      await this.fetchStatusMappings();
      if (!this.state.testRunId) {
        await this.createTestRun();
        this.log(`Created test run with ID: ${this.state.testRunId}`);
        await this.applyRunLevelConfig();
      } else {
        const testRun = await this.client.getTestRun(this.state.testRunId);
        this.log(`Using existing test run: ${testRun.name} (ID: ${testRun.id})`);
      }
      this.state.initialized = true;
      this.log("Reporter initialized successfully");
    } catch (error) {
      this.state.initError = error instanceof Error ? error : new Error(String(error));
      this.logError("Failed to initialize reporter:", error);
      throw this.state.initError;
    }
  }
  async resolveOptionIds() {
    const projectId = this.options.projectId;
    if (typeof this.options.testRunId === "string") {
      const testRun = await this.client.findTestRunByName(projectId, this.options.testRunId);
      if (!testRun) {
        throw new Error(`Test run not found: "${this.options.testRunId}"`);
      }
      this.state.testRunId = testRun.id;
      this.state.resolvedIds.testRunId = testRun.id;
      this.log(`Resolved test run "${this.options.testRunId}" -> ${testRun.id}`);
    }
    if (typeof this.options.configId === "string") {
      const config = await this.client.findConfigurationByName(projectId, this.options.configId);
      if (!config) throw new Error(`Configuration not found: "${this.options.configId}"`);
      this.state.resolvedIds.configId = config.id;
    } else if (typeof this.options.configId === "number") {
      this.state.resolvedIds.configId = this.options.configId;
    }
    if (typeof this.options.milestoneId === "string") {
      const milestone = await this.client.findMilestoneByName(projectId, this.options.milestoneId);
      if (!milestone) throw new Error(`Milestone not found: "${this.options.milestoneId}"`);
      this.state.resolvedIds.milestoneId = milestone.id;
    } else if (typeof this.options.milestoneId === "number") {
      this.state.resolvedIds.milestoneId = this.options.milestoneId;
    }
    if (typeof this.options.stateId === "string") {
      const state = await this.client.findWorkflowStateByName(projectId, this.options.stateId);
      if (!state) throw new Error(`Workflow state not found: "${this.options.stateId}"`);
      this.state.resolvedIds.stateId = state.id;
    } else if (typeof this.options.stateId === "number") {
      this.state.resolvedIds.stateId = this.options.stateId;
    }
    if (typeof this.options.parentFolderId === "string") {
      let folder = await this.client.findFolderByName(projectId, this.options.parentFolderId);
      if (!folder) {
        if (this.options.createFolderHierarchy || this.options.autoCreateTestCases) {
          folder = await this.client.createFolder({ projectId, name: this.options.parentFolderId });
          this.log(`Created parent folder "${this.options.parentFolderId}" -> ${folder.id}`);
        } else {
          throw new Error(`Folder not found: "${this.options.parentFolderId}"`);
        }
      }
      this.state.resolvedIds.parentFolderId = folder.id;
    } else if (typeof this.options.parentFolderId === "number") {
      this.state.resolvedIds.parentFolderId = this.options.parentFolderId;
    }
    if (typeof this.options.templateId === "string") {
      const template = await this.client.findTemplateByName(projectId, this.options.templateId);
      if (!template) throw new Error(`Template not found: "${this.options.templateId}"`);
      this.state.resolvedIds.templateId = template.id;
    } else if (typeof this.options.templateId === "number") {
      this.state.resolvedIds.templateId = this.options.templateId;
    }
    if (this.options.tagIds && this.options.tagIds.length > 0) {
      this.state.resolvedIds.tagIds = await this.client.resolveTagIds(projectId, this.options.tagIds);
      this.log(`Resolved tags: ${this.state.resolvedIds.tagIds.join(", ")}`);
    }
  }
  async fetchStatusMappings() {
    const statuses = ["passed", "failed", "skipped", "blocked"];
    for (const status of statuses) {
      const statusId = await this.client.getStatusId(this.options.projectId, status);
      if (statusId) {
        this.state.statusIds[status] = statusId;
        this.log(`Status mapping: ${status} -> ${statusId}`);
      }
    }
    if (!this.state.statusIds.passed || !this.state.statusIds.failed) {
      throw new Error("Could not find required status mappings (passed/failed) in TestPlanIt");
    }
  }
  async createTestRun() {
    const runName = this.formatRunName(this.options.runName || "{suite} - {date} {time}");
    const testRunType = this.options.testRunType ?? "JUNIT";
    this.log("Creating test run:", runName, "(type:", testRunType + ")");
    const testRun = await this.client.createTestRun({
      projectId: this.options.projectId,
      name: runName,
      testRunType,
      configId: this.state.resolvedIds.configId,
      milestoneId: this.state.resolvedIds.milestoneId,
      stateId: this.state.resolvedIds.stateId,
      tagIds: this.state.resolvedIds.tagIds
    });
    this.state.testRunId = testRun.id;
  }
  ensureJUnitTestSuite() {
    if (this.state.testSuiteId) return Promise.resolve();
    if (!this.suitePromise) this.suitePromise = this.createJUnitTestSuite();
    return this.suitePromise;
  }
  async createJUnitTestSuite() {
    if (!this.state.testRunId) {
      throw new Error("Cannot create JUnit test suite without a test run ID");
    }
    const runName = this.formatRunName(this.options.runName || "{suite} - {date} {time}");
    this.log("Creating JUnit test suite...");
    const testSuite = await this.client.createJUnitTestSuite({
      testRunId: this.state.testRunId,
      name: runName,
      // Suite totals are computed by the backend from JUnitTestResult rows.
      time: 0,
      tests: 0,
      failures: 0,
      errors: 0,
      skipped: 0
    });
    this.state.testSuiteId = testSuite.id;
    this.log("Created JUnit test suite with ID:", testSuite.id);
  }
  // ============================================================================
  // Helpers
  // ============================================================================
  normalizeStatus(status) {
    if (status === "passed") return "passed";
    if (status === "skipped") return "skipped";
    return "failed";
  }
  mapStatusToJUnitType(status) {
    switch (status) {
      case "passed":
        return "PASSED";
      case "skipped":
        return "SKIPPED";
      default:
        return "FAILURE";
    }
  }
  /**
   * Extract case IDs from a test title using the configured pattern.
   * @example "[1761] [1762] should load" -> { caseIds: [1761, 1762], cleanTitle: "should load" }
   */
  parseCaseIds(title) {
    const pattern = this.options.caseIdPattern || /\[(\d+)\]/g;
    const regex = typeof pattern === "string" ? new RegExp(pattern, "g") : new RegExp(pattern.source, "g");
    const caseIds = [];
    let match;
    while ((match = regex.exec(title)) !== null) {
      for (let i = 1; i < match.length; i++) {
        if (match[i]) {
          caseIds.push(parseInt(match[i], 10));
          break;
        }
      }
      if (match.index === regex.lastIndex) regex.lastIndex++;
    }
    const cleanTitle = title.replace(regex, "").trim().replace(/\s+/g, " ");
    return { caseIds, cleanTitle };
  }
  /**
   * Collect case IDs from annotations of the configured type, on the test and
   * the current result. The description holds the ID(s); non-digits are ignored.
   */
  getAnnotationCaseIds(test, result) {
    const type = this.options.caseIdAnnotation;
    if (!type) return [];
    const annotations = [...test.annotations ?? [], ...result.annotations ?? []];
    const ids = [];
    for (const annotation of annotations) {
      if (annotation?.type === type && annotation.description) {
        for (const digits of String(annotation.description).match(/\d+/g) ?? []) {
          ids.push(parseInt(digits, 10));
        }
      }
    }
    return ids;
  }
  /** Collect case IDs from Playwright tags by applying the configured pattern. */
  getTagCaseIds(test) {
    const tags = test.tags ?? [];
    const ids = [];
    for (const tag of tags) {
      ids.push(...this.parseCaseIds(tag).caseIds);
    }
    return ids;
  }
  /** Collect the describe-block titles (outermost first) for a test. */
  getSuitePath(test) {
    const titles = [];
    let suite = test.parent;
    while (suite) {
      if (suite.type === "describe" && suite.title) {
        titles.unshift(suite.title);
      }
      suite = suite.parent;
    }
    return titles;
  }
  /** Resolve the Playwright project name (≈ browser) for a test. */
  getProjectName(test) {
    let suite = test.parent;
    while (suite) {
      if (suite.type === "project" && suite.title) return suite.title;
      suite = suite.parent;
    }
    return void 0;
  }
  joinOutput(chunks) {
    if (!chunks || chunks.length === 0) return void 0;
    const text = chunks.map((c) => typeof c === "string" ? c : c.toString("utf-8")).join("");
    const cleaned = stripAnsi(text);
    return cleaned && cleaned.length > 0 ? cleaned : void 0;
  }
  createCaseKey(suiteName, testName) {
    return `${suiteName}::${testName}`;
  }
  /**
   * Flatten Playwright `test.step()` calls into ordered step titles.
   *
   * Only user steps (`category === 'test.step'`) are kept — auto-instrumented
   * categories (`pw:api`, `expect`, `hook`, `fixture`) are skipped, but we
   * still descend through them so a `test.step()` nested inside one is not
   * lost. Nested user steps are emitted in execution order and prefixed with a
   * depth marker so the hierarchy survives as plain text.
   */
  extractStepTitles(steps, depth = 0) {
    if (!steps || steps.length === 0) return [];
    const titles = [];
    for (const step of steps) {
      if (step.category === "test.step") {
        const title = step.title?.trim();
        if (title) {
          titles.push(`${"\u203A ".repeat(depth)}${title}`);
          titles.push(...this.extractStepTitles(step.steps, depth + 1));
        } else {
          titles.push(...this.extractStepTitles(step.steps, depth));
        }
      } else {
        titles.push(...this.extractStepTitles(step.steps, depth));
      }
    }
    return titles;
  }
  formatRunName(template) {
    const now = /* @__PURE__ */ new Date();
    const date = now.toISOString().split("T")[0];
    const time = now.toTimeString().split(" ")[0];
    const browser = this.currentProject || "unknown";
    const platform = process.platform;
    let spec = "unknown";
    if (this.currentSpec) {
      const parts = this.currentSpec.split(/[\\/]/);
      spec = parts[parts.length - 1] || "unknown";
      spec = spec.replace(/\.(spec|test)\.(ts|js|mjs|cjs|tsx|jsx)$/, "");
    }
    const suite = this.rootSuiteName || (spec !== "unknown" ? spec : "Tests");
    return template.replace("{date}", date).replace("{time}", time).replace("{browser}", browser).replace("{platform}", platform).replace("{spec}", spec).replace("{suite}", suite);
  }
  extForContentType(contentType) {
    switch (contentType) {
      case "image/png":
        return ".png";
      case "image/jpeg":
        return ".jpg";
      case "image/webp":
        return ".webp";
      case "video/webm":
        return ".webm";
      case "application/zip":
        return ".zip";
      case "text/plain":
        return ".txt";
      case "application/json":
        return ".json";
      default:
        return "";
    }
  }
  printSummary() {
    const stats = this.state.stats;
    const duration = ((Date.now() - stats.startTime.getTime()) / 1e3).toFixed(1);
    const totalResults = stats.resultsPassed + stats.resultsFailed + stats.resultsSkipped;
    const totalCases = stats.testCasesFound + stats.testCasesCreated + stats.testCasesMoved;
    console.log("\n[TestPlanIt] \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
    console.log("[TestPlanIt] Results Summary");
    console.log("[TestPlanIt] \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
    console.log(`[TestPlanIt]   Test Run ID: ${this.state.testRunId}`);
    console.log(`[TestPlanIt]   Duration: ${duration}s`);
    console.log("[TestPlanIt]");
    console.log("[TestPlanIt]   Test Results:");
    console.log(`[TestPlanIt]     \u2713 Passed:  ${stats.resultsPassed}`);
    console.log(`[TestPlanIt]     \u2717 Failed:  ${stats.resultsFailed}`);
    console.log(`[TestPlanIt]     \u25CB Skipped: ${stats.resultsSkipped}`);
    console.log(`[TestPlanIt]     Total:     ${totalResults}`);
    if (this.options.autoCreateTestCases && totalCases > 0) {
      console.log("[TestPlanIt]");
      console.log("[TestPlanIt]   Test Cases:");
      console.log(`[TestPlanIt]     Found (existing): ${stats.testCasesFound}`);
      console.log(`[TestPlanIt]     Created (new):    ${stats.testCasesCreated}`);
      if (stats.testCasesMoved > 0) {
        console.log(`[TestPlanIt]     Moved (restored): ${stats.testCasesMoved}`);
      }
      if (stats.testStepsCreated > 0) {
        console.log(`[TestPlanIt]     Steps created:    ${stats.testStepsCreated}`);
      }
    }
    if (this.options.uploadAttachments && (stats.attachmentsUploaded > 0 || stats.attachmentsFailed > 0)) {
      console.log("[TestPlanIt]");
      console.log("[TestPlanIt]   Attachments:");
      console.log(`[TestPlanIt]     Uploaded: ${stats.attachmentsUploaded}`);
      if (stats.attachmentsFailed > 0) {
        console.log(`[TestPlanIt]     Failed:   ${stats.attachmentsFailed}`);
      }
    }
    if (stats.apiErrors > 0) {
      console.log("[TestPlanIt]");
      console.log(`[TestPlanIt]   \u26A0 API Errors: ${stats.apiErrors}`);
    }
    console.log("[TestPlanIt]");
    console.log(
      `[TestPlanIt]   View results: ${this.options.domain}/projects/runs/${this.options.projectId}/${this.state.testRunId}`
    );
    console.log("[TestPlanIt] \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n");
  }
  /** Expose the internal state (for testing/debugging). */
  getState() {
    return this.state;
  }
};

export { TestPlanItReporter, attachToRun, TestPlanItReporter as default, setRunMetadata };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map