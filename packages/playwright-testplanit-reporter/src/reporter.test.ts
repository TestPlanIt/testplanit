import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FullResult, Suite, TestCase, TestResult } from '@playwright/test/reporter';

// Shared mock client instance — every `new TestPlanItClient()` returns this.
const clientMock = vi.hoisted(() => ({
  getStatusId: vi.fn(async (_projectId: number, status: string) =>
    (({ passed: 1, failed: 2, skipped: 3, blocked: 4 }) as Record<string, number>)[status],
  ),
  createTestRun: vi.fn(async () => ({ id: 123, name: 'Test Run' })),
  getTestRun: vi.fn(async () => ({ id: 999, name: 'Existing Run', isCompleted: false, isDeleted: false })),
  completeTestRun: vi.fn(async () => ({ id: 123, isCompleted: true })),
  createJUnitTestSuite: vi.fn(async () => ({ id: 1, name: 'Suite' })),
  createJUnitTestResult: vi.fn(async () => ({ id: 789 })),
  findOrAddTestCaseToRun: vi.fn(async () => ({ id: 456 })),
  uploadJUnitAttachment: vi.fn(async () => ({ id: 1 })),
  findOrCreateTestCase: vi.fn(async () => ({ testCase: { id: 4567, name: 'TC' }, action: 'created' })),
  findOrCreateFolderPath: vi.fn(async () => ({ id: 77, name: 'Folder' })),
  findTestRunByName: vi.fn(async () => ({ id: 555, name: 'By Name' })),
  findConfigurationByName: vi.fn(async () => ({ id: 11, name: 'Config' })),
  findMilestoneByName: vi.fn(async () => ({ id: 22, name: 'Milestone' })),
  findWorkflowStateByName: vi.fn(async () => ({ id: 33, name: 'State' })),
  findFolderByName: vi.fn(async () => ({ id: 44, name: 'Parent' })),
  createFolder: vi.fn(async () => ({ id: 44, name: 'Parent' })),
  findTemplateByName: vi.fn(async () => ({ id: 55, name: 'Template' })),
  resolveTagIds: vi.fn(async () => [1, 2, 3]),
}));

vi.mock('@testplanit/api', () => ({
  TestPlanItClient: class {
    constructor() {
      return clientMock as unknown as object;
    }
  },
  TestPlanItError: class TestPlanItError extends Error {},
}));

import TestPlanItReporter from './reporter.js';

// ---------------------------------------------------------------------------
// Playwright object factories
// ---------------------------------------------------------------------------

function buildParent(opts: { project?: string; file?: string; describes?: string[] } = {}): Suite {
  const fileTitle = opts.file ?? 'login.spec.ts';
  const describes = opts.describes ?? [];
  let current: any = { type: 'root', title: '', parent: undefined };
  if (opts.project !== undefined) {
    current = { type: 'project', title: opts.project, parent: current };
  }
  current = { type: 'file', title: fileTitle, parent: current };
  for (const d of describes) {
    current = { type: 'describe', title: d, parent: current };
  }
  return current as Suite;
}

function makeTest(title: string, parent: Suite, file = '/repo/tests/login.spec.ts'): TestCase {
  return {
    id: `id-${title}`,
    title,
    location: { file, line: 1, column: 1 },
    parent,
  } as unknown as TestCase;
}

function makeResult(partial: Partial<TestResult> = {}): TestResult {
  return {
    status: 'passed',
    duration: 1000,
    startTime: new Date('2025-01-01T00:00:00.000Z'),
    retry: 0,
    attachments: [],
    stdout: [],
    stderr: [],
    errors: [],
    steps: [],
    ...partial,
  } as unknown as TestResult;
}

const FULL_RESULT = { status: 'passed' } as unknown as FullResult;

const defaultOptions = {
  domain: 'https://testplanit.example.com',
  apiToken: 'tpi_test_token',
  projectId: 1,
};

describe('TestPlanItReporter (Playwright)', () => {
  let reporter: TestPlanItReporter;

  beforeEach(() => {
    vi.clearAllMocks();
    reporter = new TestPlanItReporter({ ...defaultOptions });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates a reporter with valid options', () => {
      expect(new TestPlanItReporter({ ...defaultOptions })).toBeDefined();
    });

    it('throws if domain is missing', () => {
      expect(() => new TestPlanItReporter({ ...defaultOptions, domain: '' })).toThrow('domain is required');
    });

    it('throws if apiToken is missing', () => {
      expect(() => new TestPlanItReporter({ ...defaultOptions, apiToken: '' })).toThrow('apiToken is required');
    });

    it('throws if projectId is missing', () => {
      expect(() => new TestPlanItReporter({ ...defaultOptions, projectId: 0 })).toThrow('projectId is required');
    });

    it('starts uninitialized', () => {
      expect(reporter.getState().initialized).toBe(false);
    });

    it('seeds testRunId when a numeric id is provided', () => {
      const r = new TestPlanItReporter({ ...defaultOptions, testRunId: 999 });
      expect(r.getState().testRunId).toBe(999);
    });
  });

  describe('case ID parsing', () => {
    it('parses a single bracketed case ID', () => {
      const r = (reporter as any).parseCaseIds('[12345] should load the page');
      expect(r.caseIds).toEqual([12345]);
      expect(r.cleanTitle).toBe('should load the page');
    });

    it('parses multiple case IDs', () => {
      const r = (reporter as any).parseCaseIds('[123] [456] should work');
      expect(r.caseIds).toEqual([123, 456]);
      expect(r.cleanTitle).toBe('should work');
    });

    it('handles a title without a case ID', () => {
      const r = (reporter as any).parseCaseIds('no case id here');
      expect(r.caseIds).toEqual([]);
      expect(r.cleanTitle).toBe('no case id here');
    });

    it('supports a custom C-prefix pattern', () => {
      const r = new TestPlanItReporter({ ...defaultOptions, caseIdPattern: /C(\d+)/g });
      const parsed = (r as any).parseCaseIds('C12345 should work');
      expect(parsed.caseIds).toEqual([12345]);
      expect(parsed.cleanTitle).toBe('should work');
    });
  });

  describe('suite + project resolution', () => {
    it('collects describe titles (outermost first) as the suite path', () => {
      const parent = buildParent({ project: 'chromium', describes: ['Auth', 'Login'] });
      const test = makeTest('[1] works', parent);
      expect((reporter as any).getSuitePath(test)).toEqual(['Auth', 'Login']);
    });

    it('returns an empty suite path when there are no describe blocks', () => {
      const parent = buildParent({ project: 'chromium' });
      const test = makeTest('[1] works', parent);
      expect((reporter as any).getSuitePath(test)).toEqual([]);
    });

    it('resolves the Playwright project name', () => {
      const parent = buildParent({ project: 'firefox', describes: ['Auth'] });
      const test = makeTest('[1] works', parent);
      expect((reporter as any).getProjectName(test)).toBe('firefox');
    });
  });

  describe('status mapping', () => {
    it('normalizes Playwright statuses', () => {
      const n = (reporter as any).normalizeStatus.bind(reporter);
      expect(n('passed')).toBe('passed');
      expect(n('skipped')).toBe('skipped');
      expect(n('failed')).toBe('failed');
      expect(n('timedOut')).toBe('failed');
      expect(n('interrupted')).toBe('failed');
    });

    it('maps normalized statuses to JUnit result types', () => {
      const m = (reporter as any).mapStatusToJUnitType.bind(reporter);
      expect(m('passed')).toBe('PASSED');
      expect(m('failed')).toBe('FAILURE');
      expect(m('skipped')).toBe('SKIPPED');
    });
  });

  describe('reporting flow', () => {
    it('creates the run, suite, and JUnit result for a linked test', async () => {
      const parent = buildParent({ project: 'chromium', describes: ['Auth'] });
      reporter.onBegin({} as any, {} as any);
      reporter.onTestEnd(makeTest('[12345] logs in', parent), makeResult({ status: 'passed' }));
      await reporter.onEnd(FULL_RESULT);

      expect(clientMock.createTestRun).toHaveBeenCalledTimes(1);
      expect(clientMock.createJUnitTestSuite).toHaveBeenCalledTimes(1);
      expect(clientMock.findOrAddTestCaseToRun).toHaveBeenCalledWith({ testRunId: 123, repositoryCaseId: 12345 });
      expect(clientMock.createJUnitTestResult).toHaveBeenCalledTimes(1);

      const arg = (clientMock.createJUnitTestResult.mock.calls as any[])[0][0] as any;
      expect(arg.repositoryCaseId).toBe(12345);
      expect(arg.type).toBe('PASSED');
      expect(arg.statusId).toBe(1);
      expect(arg.time).toBe(1); // 1000ms → 1s
      expect(clientMock.completeTestRun).toHaveBeenCalledWith(123, 1);
    });

    it('skips tests with no case ID when autoCreateTestCases is off', async () => {
      const parent = buildParent({ project: 'chromium' });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      reporter.onTestEnd(makeTest('untagged test', parent), makeResult());
      await reporter.onEnd(FULL_RESULT);

      expect(clientMock.createTestRun).not.toHaveBeenCalled();
      expect(clientMock.createJUnitTestResult).not.toHaveBeenCalled();
      expect(clientMock.completeTestRun).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
    });

    it('auto-creates a test case and reports against it', async () => {
      const r = new TestPlanItReporter({
        ...defaultOptions,
        autoCreateTestCases: true,
        parentFolderId: 10,
        templateId: 5,
      });
      const parent = buildParent({ project: 'chromium', describes: ['Auth'] });
      r.onTestEnd(makeTest('untagged but auto', parent), makeResult());
      await r.onEnd(FULL_RESULT);

      expect(clientMock.findOrCreateTestCase).toHaveBeenCalledTimes(1);
      const created = (clientMock.findOrCreateTestCase.mock.calls as any[])[0][0] as any;
      expect(created.folderId).toBe(10);
      expect(created.templateId).toBe(5);
      expect(created.name).toBe('untagged but auto');
      const junit = (clientMock.createJUnitTestResult.mock.calls as any[])[0][0] as any;
      expect(junit.repositoryCaseId).toBe(4567);
    });

    it('creates a folder hierarchy from the describe path', async () => {
      const r = new TestPlanItReporter({
        ...defaultOptions,
        autoCreateTestCases: true,
        createFolderHierarchy: true,
        parentFolderId: 10,
        templateId: 5,
      });
      const parent = buildParent({ project: 'chromium', describes: ['Auth', 'Login'] });
      r.onTestEnd(makeTest('auto with folders', parent), makeResult());
      await r.onEnd(FULL_RESULT);

      expect(clientMock.findOrCreateFolderPath).toHaveBeenCalledWith(1, ['Auth', 'Login'], 10);
      const created = (clientMock.findOrCreateTestCase.mock.calls as any[])[0][0] as any;
      expect(created.folderId).toBe(77); // from findOrCreateFolderPath
    });

    it('reports every retry attempt as its own result', async () => {
      const parent = buildParent({ project: 'chromium', describes: ['Auth'] });
      const test = makeTest('[12345] flaky', parent);
      reporter.onTestEnd(test, makeResult({ status: 'failed', retry: 0 }));
      reporter.onTestEnd(test, makeResult({ status: 'passed', retry: 1 }));
      await reporter.onEnd(FULL_RESULT);

      // Two results, but the case is added to the run only once.
      expect(clientMock.createJUnitTestResult).toHaveBeenCalledTimes(2);
      expect(clientMock.findOrAddTestCaseToRun).toHaveBeenCalledTimes(1);
    });

    it('creates the run and suite once across many concurrent tests', async () => {
      const parent = buildParent({ project: 'chromium', describes: ['Auth'] });
      for (let i = 0; i < 5; i++) {
        reporter.onTestEnd(makeTest(`[${1000 + i}] case ${i}`, parent), makeResult());
      }
      await reporter.onEnd(FULL_RESULT);

      expect(clientMock.createTestRun).toHaveBeenCalledTimes(1);
      expect(clientMock.createJUnitTestSuite).toHaveBeenCalledTimes(1);
      expect(clientMock.createJUnitTestResult).toHaveBeenCalledTimes(5);
    });

    it('validates an existing numeric testRunId instead of creating one', async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, testRunId: 999 });
      const parent = buildParent({ project: 'chromium' });
      r.onTestEnd(makeTest('[1] works', parent), makeResult());
      await r.onEnd(FULL_RESULT);

      expect(clientMock.getTestRun).toHaveBeenCalledWith(999);
      expect(clientMock.createTestRun).not.toHaveBeenCalled();
      const junit = (clientMock.createJUnitTestResult.mock.calls as any[])[0][0] as any;
      expect(junit.testSuiteId).toBe(1);
    });

    it('resolves a testRunId provided by name', async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, testRunId: 'Nightly' });
      const parent = buildParent({ project: 'chromium' });
      r.onTestEnd(makeTest('[1] works', parent), makeResult());
      await r.onEnd(FULL_RESULT);

      expect(clientMock.findTestRunByName).toHaveBeenCalledWith(1, 'Nightly');
      expect(r.getState().testRunId).toBe(555);
    });
  });

  describe('attachments', () => {
    it('uploads attachments to the JUnit result', async () => {
      const parent = buildParent({ project: 'chromium' });
      const result = makeResult({
        status: 'failed',
        attachments: [
          { name: 'screenshot', contentType: 'image/png', body: Buffer.from('PNGDATA') },
        ] as any,
      });
      reporter.onTestEnd(makeTest('[1] fails', parent), result);
      await reporter.onEnd(FULL_RESULT);

      expect(clientMock.uploadJUnitAttachment).toHaveBeenCalledTimes(1);
      const [junitResultId, buffer, fileName, contentType] = (clientMock.uploadJUnitAttachment.mock.calls as any[])[0];
      expect(junitResultId).toBe(789);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(fileName).toContain('.png');
      expect(contentType).toBe('image/png');
    });

    it('respects the attachmentTypes filter', async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, attachmentTypes: ['video/'] });
      const parent = buildParent({ project: 'chromium' });
      const result = makeResult({
        attachments: [{ name: 'screenshot', contentType: 'image/png', body: Buffer.from('x') }] as any,
      });
      r.onTestEnd(makeTest('[1] works', parent), result);
      await r.onEnd(FULL_RESULT);

      expect(clientMock.uploadJUnitAttachment).not.toHaveBeenCalled();
    });

    it('does not upload when uploadAttachments is disabled', async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, uploadAttachments: false });
      const parent = buildParent({ project: 'chromium' });
      const result = makeResult({
        attachments: [{ name: 'screenshot', contentType: 'image/png', body: Buffer.from('x') }] as any,
      });
      r.onTestEnd(makeTest('[1] works', parent), result);
      await r.onEnd(FULL_RESULT);

      expect(clientMock.uploadJUnitAttachment).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('strips ANSI codes from the error message but preserves brackets', async () => {
      const parent = buildParent({ project: 'chromium' });
      const coloured = '\u001b[31mexpected locator [data-testid=submit] to be visible\u001b[39m';
      reporter.onTestEnd(
        makeTest('[1] fails', parent),
        makeResult({ status: 'failed', error: { message: coloured } as any }),
      );
      await reporter.onEnd(FULL_RESULT);

      const junit = (clientMock.createJUnitTestResult.mock.calls as any[])[0][0] as any;
      expect(junit.message).toBe('expected locator [data-testid=submit] to be visible');
    });

    it('omits the stack trace when includeStackTrace is false', async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, includeStackTrace: false });
      const parent = buildParent({ project: 'chromium' });
      r.onTestEnd(
        makeTest('[1] fails', parent),
        makeResult({ status: 'failed', error: { message: 'boom', stack: 'at foo' } as any }),
      );
      await r.onEnd(FULL_RESULT);

      const junit = (clientMock.createJUnitTestResult.mock.calls as any[])[0][0] as any;
      expect(junit.content).toBeUndefined();
    });
  });

  describe('run name formatting', () => {
    it('fills placeholders from the first reported test', () => {
      (reporter as any).currentProject = 'chromium';
      (reporter as any).currentSpec = '/repo/tests/login.spec.ts';
      (reporter as any).rootSuiteName = 'Auth';
      const formatted = (reporter as any).formatRunName('{suite} - {browser} - {spec}');
      expect(formatted).toBe('Auth - chromium - login');
    });
  });
});
