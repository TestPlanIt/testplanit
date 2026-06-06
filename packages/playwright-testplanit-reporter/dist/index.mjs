import * as fs from 'fs/promises';
import * as path from 'path';
import { TestPlanItClient } from '@testplanit/api';
export { TestPlanItClient, TestPlanItError } from '@testplanit/api';

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
  constructor(options) {
    this.options = {
      caseIdPattern: /\[(\d+)\]/g,
      caseIdAnnotation: "testplanit",
      autoCreateTestCases: false,
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
      folderPathMap: /* @__PURE__ */ new Map(),
      statusIds: {},
      initialized: false,
      stats: {
        testCasesFound: 0,
        testCasesCreated: 0,
        testCasesMoved: 0,
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
      systemErr: this.joinOutput(result.stderr)
    };
    this.state.results.set(uid, tracked);
    this.log(
      `Test ${status}:`,
      cleanTitle,
      caseIds.length > 0 ? `(Case IDs: ${caseIds.join(", ")})` : ""
    );
    const attachments = (result.attachments ?? []).map((a) => ({
      name: a.name,
      contentType: a.contentType,
      path: a.path,
      body: a.body
    }));
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
      if (action === "found") {
        this.state.stats.testCasesFound++;
      } else if (action === "created") {
        this.state.stats.testCasesCreated++;
      } else if (action === "moved") {
        this.state.stats.testCasesMoved++;
      }
      this.log(`${action} test case:`, testCase.id, testCase.name, "in folder:", folderId);
      return testCase.id;
    })();
    this.state.caseIdMap.set(caseKey, promise);
    promise.catch(() => this.state.caseIdMap.delete(caseKey));
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

export { TestPlanItReporter, TestPlanItReporter as default };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map