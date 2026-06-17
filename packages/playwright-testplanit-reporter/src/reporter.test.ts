import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FullResult, Suite, TestCase, TestResult, TestStep } from '@playwright/test/reporter';

// ---------------------------------------------------------------------------
// Mock @testplanit/api — a single shared client instance, implementations
// (re-)applied in beforeEach so per-test overrides never leak across tests.
// ---------------------------------------------------------------------------
const clientMock = vi.hoisted(() => ({
  getStatusId: vi.fn(),
  createTestRun: vi.fn(),
  getTestRun: vi.fn(),
  completeTestRun: vi.fn(),
  createJUnitTestSuite: vi.fn(),
  createJUnitTestResult: vi.fn(),
  findOrAddTestCaseToRun: vi.fn(),
  uploadJUnitAttachment: vi.fn(),
  findOrCreateTestCase: vi.fn(),
  createStep: vi.fn(),
  createSteps: vi.fn(),
  softDeleteCaseSteps: vi.fn(),
  findOrCreateFolderPath: vi.fn(),
  findTestRunByName: vi.fn(),
  findConfigurationByName: vi.fn(),
  findMilestoneByName: vi.fn(),
  findWorkflowStateByName: vi.fn(),
  findFolderByName: vi.fn(),
  createFolder: vi.fn(),
  findTemplateByName: vi.fn(),
  resolveTagIds: vi.fn(),
}));

vi.mock('@testplanit/api', () => ({
  TestPlanItClient: class {
    constructor() {
      return clientMock as unknown as object;
    }
  },
  TestPlanItError: class TestPlanItError extends Error {},
}));

// Mock fs/promises so the "read attachment from disk" path is testable.
const readFileMock = vi.hoisted(() => vi.fn());
vi.mock('fs/promises', () => ({ readFile: readFileMock }));

import TestPlanItReporter from './reporter.js';

const STATUS_IDS: Record<string, number> = { passed: 1, failed: 2, skipped: 3, blocked: 4 };

function applyBaseImpls() {
  clientMock.getStatusId.mockImplementation(async (_p: number, s: string) => STATUS_IDS[s]);
  clientMock.createTestRun.mockImplementation(async () => ({ id: 123, name: 'Test Run' }));
  clientMock.getTestRun.mockImplementation(async () => ({ id: 999, name: 'Existing Run', isCompleted: false, isDeleted: false }));
  clientMock.completeTestRun.mockImplementation(async () => ({ id: 123, isCompleted: true }));
  clientMock.createJUnitTestSuite.mockImplementation(async () => ({ id: 1, name: 'Suite' }));
  clientMock.createJUnitTestResult.mockImplementation(async () => ({ id: 789 }));
  clientMock.findOrAddTestCaseToRun.mockImplementation(async () => ({ id: 456 }));
  clientMock.uploadJUnitAttachment.mockImplementation(async () => ({ id: 1 }));
  clientMock.findOrCreateTestCase.mockImplementation(async () => ({ testCase: { id: 4567, name: 'TC' }, action: 'created' }));
  clientMock.createStep.mockImplementation(async () => ({ id: 1 }));
  clientMock.createSteps.mockImplementation(async (o: any) => ({ count: o?.steps?.length ?? 0 }));
  clientMock.softDeleteCaseSteps.mockImplementation(async () => 3);
  clientMock.findOrCreateFolderPath.mockImplementation(async () => ({ id: 77, name: 'Folder' }));
  clientMock.findTestRunByName.mockImplementation(async () => ({ id: 555, name: 'By Name' }));
  clientMock.findConfigurationByName.mockImplementation(async () => ({ id: 11, name: 'Config' }));
  clientMock.findMilestoneByName.mockImplementation(async () => ({ id: 22, name: 'Milestone' }));
  clientMock.findWorkflowStateByName.mockImplementation(async () => ({ id: 33, name: 'State' }));
  clientMock.findFolderByName.mockImplementation(async () => ({ id: 44, name: 'Parent' }));
  clientMock.createFolder.mockImplementation(async () => ({ id: 88, name: 'Created Parent' }));
  clientMock.findTemplateByName.mockImplementation(async () => ({ id: 55, name: 'Template' }));
  clientMock.resolveTagIds.mockImplementation(async () => [7, 8, 9]);
  readFileMock.mockImplementation(async () => Buffer.from('FILEDATA'));
}

// ---------------------------------------------------------------------------
// Playwright object factories
// ---------------------------------------------------------------------------
function buildParent(opts: { project?: string; file?: string; describes?: string[] } = {}): Suite {
  const describes = opts.describes ?? [];
  let current: any = { type: 'root', title: '', parent: undefined };
  if (opts.project !== undefined) current = { type: 'project', title: opts.project, parent: current };
  current = { type: 'file', title: opts.file ?? 'login.spec.ts', parent: current };
  for (const d of describes) current = { type: 'describe', title: d, parent: current };
  return current as Suite;
}

function makeTest(title: string, parent: Suite, file = '/repo/tests/login.spec.ts'): TestCase {
  return { id: `id-${title}`, title, location: { file, line: 1, column: 1 }, parent } as unknown as TestCase;
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

// Build a Playwright TestStep. `category` defaults to a user 'test.step';
// pass children to model nested steps.
function makeStep(
  title: string,
  opts: { category?: string; steps?: TestStep[] } = {},
): TestStep {
  return {
    title,
    category: opts.category ?? 'test.step',
    steps: opts.steps ?? [],
    duration: 1,
    startTime: new Date('2025-01-01T00:00:00.000Z'),
  } as unknown as TestStep;
}

function withMeta(
  test: TestCase,
  meta: { annotations?: { type: string; description?: string }[]; tags?: string[] },
): TestCase {
  return { ...(test as any), ...meta } as unknown as TestCase;
}

const FULL_RESULT = { status: 'passed' } as unknown as FullResult;
const defaultOptions = { domain: 'https://testplanit.example.com', apiToken: 'tpi_test_token', projectId: 1 };
const autoOptions = { ...defaultOptions, autoCreateTestCases: true, parentFolderId: 10, templateId: 5 };

const calls = (fn: any): any[][] => fn.mock.calls;
const lastArg = (fn: any, callIdx = 0): any => fn.mock.calls[callIdx]?.[0];

// Drive a single test through onTestEnd + onEnd.
async function run(reporter: TestPlanItReporter, test: TestCase, result: TestResult) {
  reporter.onTestEnd(test, result);
  await reporter.onEnd(FULL_RESULT);
}

describe('TestPlanItReporter (Playwright)', () => {
  let reporter: TestPlanItReporter;

  beforeEach(() => {
    vi.clearAllMocks();
    applyBaseImpls();
    reporter = new TestPlanItReporter({ ...defaultOptions });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
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
      expect(new TestPlanItReporter({ ...defaultOptions, testRunId: 999 }).getState().testRunId).toBe(999);
    });
    it('printsToStdio returns true', () => {
      expect(reporter.printsToStdio()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('case ID parsing', () => {
    it('parses a single bracketed case ID', () => {
      const r = (reporter as any).parseCaseIds('[12345] should load the page');
      expect(r.caseIds).toEqual([12345]);
      expect(r.cleanTitle).toBe('should load the page');
    });
    it('parses multiple case IDs', () => {
      expect((reporter as any).parseCaseIds('[123] [456] works').caseIds).toEqual([123, 456]);
    });
    it('handles a title without a case ID', () => {
      const r = (reporter as any).parseCaseIds('no case id');
      expect(r.caseIds).toEqual([]);
      expect(r.cleanTitle).toBe('no case id');
    });
    it('supports a custom C-prefix RegExp pattern', () => {
      const r = new TestPlanItReporter({ ...defaultOptions, caseIdPattern: /C(\d+)/g });
      expect((r as any).parseCaseIds('C12345 works').caseIds).toEqual([12345]);
    });
    it('supports a string pattern', () => {
      const r = new TestPlanItReporter({ ...defaultOptions, caseIdPattern: 'TC-(\\d+)' });
      const parsed = (r as any).parseCaseIds('TC-99 works');
      expect(parsed.caseIds).toEqual([99]);
      expect(parsed.cleanTitle).toBe('works');
    });
  });

  // -------------------------------------------------------------------------
  describe('case ID linking (annotations & tags)', () => {
    it('links via a testplanit annotation without touching the title', async () => {
      const test = withMeta(makeTest('logs in successfully', buildParent({ project: 'chromium' })), {
        annotations: [{ type: 'testplanit', description: '1234' }],
      });
      await run(reporter, test, makeResult());
      expect(lastArg(clientMock.createJUnitTestResult).repositoryCaseId).toBe(1234);
    });

    it('ignores non-digits in the annotation description', async () => {
      const test = withMeta(makeTest('logs in', buildParent({ project: 'chromium' })), {
        annotations: [{ type: 'testplanit', description: 'C1234' }],
      });
      await run(reporter, test, makeResult());
      expect(lastArg(clientMock.createJUnitTestResult).repositoryCaseId).toBe(1234);
    });

    it('links to multiple cases from multiple annotations', async () => {
      const test = withMeta(makeTest('covers two cases', buildParent({ project: 'chromium' })), {
        annotations: [
          { type: 'testplanit', description: '1234' },
          { type: 'testplanit', description: '5678' },
        ],
      });
      await run(reporter, test, makeResult());
      // Primary case id is the first; case is added to the run for the primary id
      expect(clientMock.findOrAddTestCaseToRun).toHaveBeenCalledWith({ testRunId: 123, repositoryCaseId: 1234 });
      expect(lastArg(clientMock.createJUnitTestResult).repositoryCaseId).toBe(1234);
    });

    it('honors a custom caseIdAnnotation type', async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, caseIdAnnotation: 'tms' });
      const test = withMeta(makeTest('logs in', buildParent({ project: 'chromium' })), {
        annotations: [{ type: 'tms', description: '4321' }],
      });
      await run(r, test, makeResult());
      expect(lastArg(clientMock.createJUnitTestResult).repositoryCaseId).toBe(4321);
    });

    it('reads annotations added at runtime on the result', async () => {
      const test = makeTest('logs in', buildParent({ project: 'chromium' }));
      const result = makeResult({ annotations: [{ type: 'testplanit', description: '999' }] } as any);
      await run(reporter, test, result);
      expect(lastArg(clientMock.createJUnitTestResult).repositoryCaseId).toBe(999);
    });

    it('links via a Playwright tag matched by caseIdPattern', async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, caseIdPattern: /C(\d+)/g });
      const test = withMeta(makeTest('logs in', buildParent({ project: 'chromium' })), { tags: ['@smoke', '@C777'] });
      await run(r, test, makeResult());
      expect(lastArg(clientMock.createJUnitTestResult).repositoryCaseId).toBe(777);
    });

    it('dedupes an ID that appears in both an annotation and the title', async () => {
      const test = withMeta(makeTest('[1234] logs in', buildParent({ project: 'chromium' })), {
        annotations: [{ type: 'testplanit', description: '1234' }],
      });
      await run(reporter, test, makeResult());
      expect(clientMock.createJUnitTestResult).toHaveBeenCalledTimes(1);
      expect(clientMock.findOrAddTestCaseToRun).toHaveBeenCalledTimes(1);
      expect(lastArg(clientMock.createJUnitTestResult).repositoryCaseId).toBe(1234);
    });

    it('does not link from annotations when caseIdAnnotation is disabled', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const r = new TestPlanItReporter({ ...defaultOptions, caseIdAnnotation: '' });
      const test = withMeta(makeTest('logs in', buildParent({ project: 'chromium' })), {
        annotations: [{ type: 'testplanit', description: '1234' }],
      });
      await run(r, test, makeResult());
      expect(clientMock.createJUnitTestResult).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('suite + project resolution', () => {
    it('collects describe titles outermost-first', () => {
      const t = makeTest('[1] works', buildParent({ project: 'chromium', describes: ['Auth', 'Login'] }));
      expect((reporter as any).getSuitePath(t)).toEqual(['Auth', 'Login']);
    });
    it('returns an empty suite path with no describe blocks', () => {
      expect((reporter as any).getSuitePath(makeTest('[1] works', buildParent({ project: 'chromium' })))).toEqual([]);
    });
    it('resolves the Playwright project name', () => {
      expect((reporter as any).getProjectName(makeTest('[1] x', buildParent({ project: 'firefox' })))).toBe('firefox');
    });
    it('returns undefined project name when there is no project suite', () => {
      expect((reporter as any).getProjectName(makeTest('[1] x', buildParent({})))).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  describe('status mapping', () => {
    it('normalizes Playwright statuses', () => {
      const n = (reporter as any).normalizeStatus.bind(reporter);
      expect([n('passed'), n('skipped'), n('failed'), n('timedOut'), n('interrupted')]).toEqual([
        'passed', 'skipped', 'failed', 'failed', 'failed',
      ]);
    });
    it('maps normalized statuses to JUnit types', () => {
      const m = (reporter as any).mapStatusToJUnitType.bind(reporter);
      expect([m('passed'), m('failed'), m('skipped')]).toEqual(['PASSED', 'FAILURE', 'SKIPPED']);
    });
  });

  // -------------------------------------------------------------------------
  describe('reporting flow', () => {
    it('creates the run, suite, and JUnit result for a linked test', async () => {
      reporter.onBegin({} as any, {} as any);
      await run(reporter, makeTest('[12345] logs in', buildParent({ project: 'chromium', describes: ['Auth'] })), makeResult());

      expect(clientMock.createTestRun).toHaveBeenCalledTimes(1);
      expect(clientMock.createJUnitTestSuite).toHaveBeenCalledTimes(1);
      expect(clientMock.findOrAddTestCaseToRun).toHaveBeenCalledWith({ testRunId: 123, repositoryCaseId: 12345 });
      const arg = lastArg(clientMock.createJUnitTestResult);
      expect(arg.repositoryCaseId).toBe(12345);
      expect(arg.type).toBe('PASSED');
      expect(arg.statusId).toBe(1);
      expect(arg.time).toBe(1);
      expect(clientMock.completeTestRun).toHaveBeenCalledWith(123, 1);
    });

    it('defaults testRunType to JUNIT', async () => {
      await run(reporter, makeTest('[1] x', buildParent({ project: 'chromium' })), makeResult());
      expect(lastArg(clientMock.createTestRun).testRunType).toBe('JUNIT');
    });

    it('skips tests with no case ID when autoCreateTestCases is off', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await run(reporter, makeTest('untagged', buildParent({ project: 'chromium' })), makeResult());
      expect(clientMock.createTestRun).not.toHaveBeenCalled();
      expect(clientMock.createJUnitTestResult).not.toHaveBeenCalled();
      expect(clientMock.completeTestRun).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
    });

    it('passes captured stdout/stderr as systemOut/systemErr', async () => {
      const result = makeResult({ stdout: ['line1\n', Buffer.from('line2')], stderr: ['err'] });
      await run(reporter, makeTest('[1] x', buildParent({ project: 'chromium' })), result);
      const arg = lastArg(clientMock.createJUnitTestResult);
      expect(arg.systemOut).toBe('line1\nline2');
      expect(arg.systemErr).toBe('err');
    });

    it('reports every retry attempt but adds the case to the run once', async () => {
      const t = makeTest('[12345] flaky', buildParent({ project: 'chromium', describes: ['Auth'] }));
      reporter.onTestEnd(t, makeResult({ status: 'failed', retry: 0 }));
      reporter.onTestEnd(t, makeResult({ status: 'passed', retry: 1 }));
      await reporter.onEnd(FULL_RESULT);
      expect(clientMock.createJUnitTestResult).toHaveBeenCalledTimes(2);
      expect(clientMock.findOrAddTestCaseToRun).toHaveBeenCalledTimes(1);
    });

    it('creates the run and suite once across many concurrent tests', async () => {
      const parent = buildParent({ project: 'chromium', describes: ['Auth'] });
      for (let i = 0; i < 5; i++) reporter.onTestEnd(makeTest(`[${1000 + i}] c${i}`, parent), makeResult());
      await reporter.onEnd(FULL_RESULT);
      expect(clientMock.createTestRun).toHaveBeenCalledTimes(1);
      expect(clientMock.createJUnitTestSuite).toHaveBeenCalledTimes(1);
      expect(clientMock.createJUnitTestResult).toHaveBeenCalledTimes(5);
    });

    it('validates an existing numeric testRunId instead of creating one', async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, testRunId: 999 });
      await run(r, makeTest('[1] x', buildParent({ project: 'chromium' })), makeResult());
      expect(clientMock.getTestRun).toHaveBeenCalledWith(999);
      expect(clientMock.createTestRun).not.toHaveBeenCalled();
    });

    it('resolves a testRunId provided by name', async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, testRunId: 'Nightly' });
      await run(r, makeTest('[1] x', buildParent({ project: 'chromium' })), makeResult());
      expect(clientMock.findTestRunByName).toHaveBeenCalledWith(1, 'Nightly');
      expect(r.getState().testRunId).toBe(555);
    });

    it('does not complete the run when completeRunOnFinish is false', async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, completeRunOnFinish: false });
      await run(r, makeTest('[1] x', buildParent({ project: 'chromium' })), makeResult());
      expect(clientMock.createJUnitTestResult).toHaveBeenCalledTimes(1);
      expect(clientMock.completeTestRun).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('auto-create test cases', () => {
    it('auto-creates a case and reports against it', async () => {
      const r = new TestPlanItReporter({ ...autoOptions });
      await run(r, makeTest('untagged', buildParent({ project: 'chromium', describes: ['Auth'] })), makeResult());
      expect(clientMock.findOrCreateTestCase).toHaveBeenCalledTimes(1);
      const created = lastArg(clientMock.findOrCreateTestCase);
      expect(created.folderId).toBe(10);
      expect(created.templateId).toBe(5);
      expect(created.name).toBe('untagged');
      expect(lastArg(clientMock.createJUnitTestResult).repositoryCaseId).toBe(4567);
    });

    it('creates a folder hierarchy from the describe path', async () => {
      const r = new TestPlanItReporter({ ...autoOptions, createFolderHierarchy: true });
      await run(r, makeTest('auto', buildParent({ project: 'chromium', describes: ['Auth', 'Login'] })), makeResult());
      expect(clientMock.findOrCreateFolderPath).toHaveBeenCalledWith(1, ['Auth', 'Login'], 10);
      expect(lastArg(clientMock.findOrCreateTestCase).folderId).toBe(77);
    });

    it('caches the case across tests with the same suite + name', async () => {
      const r = new TestPlanItReporter({ ...autoOptions });
      const parent = buildParent({ project: 'chromium', describes: ['Auth'] });
      r.onTestEnd(makeTest('same name', parent), makeResult({ status: 'passed' }));
      r.onTestEnd(makeTest('same name', parent), makeResult({ status: 'failed', retry: 1 }));
      await r.onEnd(FULL_RESULT);
      expect(clientMock.findOrCreateTestCase).toHaveBeenCalledTimes(1);
    });

    it('tracks found vs created vs moved actions', async () => {
      clientMock.findOrCreateTestCase
        .mockResolvedValueOnce({ testCase: { id: 1, name: 'a' }, action: 'found' })
        .mockResolvedValueOnce({ testCase: { id: 2, name: 'b' }, action: 'moved' });
      const r = new TestPlanItReporter({ ...autoOptions });
      r.onTestEnd(makeTest('a', buildParent({ project: 'chromium', describes: ['G'] })), makeResult());
      r.onTestEnd(makeTest('b', buildParent({ project: 'chromium', describes: ['G'] })), makeResult());
      await r.onEnd(FULL_RESULT);
      const stats = r.getState().stats;
      expect(stats.testCasesFound).toBe(1);
      expect(stats.testCasesMoved).toBe(1);
    });

    it('fails fast (no empty run) when auto-create lacks parentFolderId/templateId', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const r = new TestPlanItReporter({ ...defaultOptions, autoCreateTestCases: true }); // no parentFolderId/templateId
      await run(r, makeTest('untagged', buildParent({ project: 'chromium' })), makeResult());
      // Init fails before any run/suite is created — no empty run is left behind.
      expect(clientMock.createTestRun).not.toHaveBeenCalled();
      expect(clientMock.createJUnitTestSuite).not.toHaveBeenCalled();
      expect(clientMock.createJUnitTestResult).not.toHaveBeenCalled();
      expect(err.mock.calls.flat().join(' ')).toContain('FAILED');
    });

    it('fails fast when only templateId is provided (parentFolderId missing)', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const r = new TestPlanItReporter({ ...defaultOptions, autoCreateTestCases: true, templateId: 5 });
      await run(r, makeTest('untagged', buildParent({ project: 'chromium' })), makeResult());
      expect(clientMock.createTestRun).not.toHaveBeenCalled();
      expect(err.mock.calls.flat().join(' ')).toContain('FAILED');
    });
  });

  // -------------------------------------------------------------------------
  describe('capturing test.step() as authored steps', () => {
    // Steps are written with a single batched createSteps() call per case.
    const stepTexts = (callIdx = 0): string[] =>
      (lastArg(clientMock.createSteps, callIdx)?.steps ?? []).map((s: any) => s.step);

    it('seeds ordered steps on a newly created case in one batched call', async () => {
      const r = new TestPlanItReporter({ ...autoOptions });
      const result = makeResult({ steps: [makeStep('Open login page'), makeStep('Submit credentials')] });
      await run(r, makeTest('logs in', buildParent({ project: 'chromium', describes: ['Auth'] })), result);

      expect(clientMock.createSteps).toHaveBeenCalledTimes(1);
      expect(lastArg(clientMock.createSteps)).toEqual({
        testCaseId: 4567,
        steps: [
          { step: 'Open login page', order: 0 },
          { step: 'Submit credentials', order: 1 },
        ],
      });
      expect(r.getState().stats.testStepsCreated).toBe(2);
    });

    it('flattens nested steps recursively with a depth prefix', async () => {
      const r = new TestPlanItReporter({ ...autoOptions });
      const result = makeResult({
        steps: [
          makeStep('Parent', {
            steps: [makeStep('Child', { steps: [makeStep('Grandchild')] }), makeStep('Sibling child')],
          }),
        ],
      });
      await run(r, makeTest('nested', buildParent({ project: 'chromium' })), result);

      expect(stepTexts()).toEqual(['Parent', '› Child', '› › Grandchild', '› Sibling child']);
    });

    it('ignores non-test.step categories but descends through them', async () => {
      const r = new TestPlanItReporter({ ...autoOptions });
      const result = makeResult({
        steps: [
          makeStep('locator.click', { category: 'pw:api' }),
          makeStep('expect', { category: 'expect' }),
          // A user step nested inside a hook is kept, un-indented (hook skipped).
          makeStep('beforeEach hook', { category: 'hook', steps: [makeStep('Real user step')] }),
        ],
      });
      await run(r, makeTest('mixed', buildParent({ project: 'chromium' })), result);

      expect(stepTexts()).toEqual(['Real user step']);
    });

    it('skips untitled steps but keeps their children at the same depth', async () => {
      const r = new TestPlanItReporter({ ...autoOptions });
      const result = makeResult({
        steps: [
          // Empty/whitespace titles produce no row; their children are not
          // indented under a phantom parent.
          makeStep('   ', { steps: [makeStep('Orphaned child')] }),
          makeStep('Real parent', { steps: [makeStep('Real child')] }),
        ],
      });
      await run(r, makeTest('untitled', buildParent({ project: 'chromium' })), result);

      expect(stepTexts()).toEqual(['Orphaned child', 'Real parent', '› Real child']);
    });

    it('skips fixture-category steps', async () => {
      const r = new TestPlanItReporter({ ...autoOptions });
      const result = makeResult({
        steps: [makeStep('worker fixture', { category: 'fixture' }), makeStep('Actual step')],
      });
      await run(r, makeTest('fixtures', buildParent({ project: 'chromium' })), result);
      expect(stepTexts()).toEqual(['Actual step']);
    });

    it('does not create steps for found or moved cases', async () => {
      clientMock.findOrCreateTestCase.mockResolvedValueOnce({ testCase: { id: 1, name: 'a' }, action: 'found' });
      const r = new TestPlanItReporter({ ...autoOptions });
      await run(r, makeTest('existing', buildParent({ project: 'chromium' })), makeResult({ steps: [makeStep('Step')] }));
      expect(clientMock.createSteps).not.toHaveBeenCalled();
    });

    it('does not create steps when captureSteps is disabled', async () => {
      const r = new TestPlanItReporter({ ...autoOptions, captureSteps: false });
      await run(r, makeTest('no capture', buildParent({ project: 'chromium' })), makeResult({ steps: [makeStep('Step')] }));
      expect(clientMock.createSteps).not.toHaveBeenCalled();
    });

    it('does not create steps for linked (non-auto-created) cases', async () => {
      // Default options: no autoCreateTestCases, case linked via the title.
      await run(reporter, makeTest('[1234] linked', buildParent({ project: 'chromium' })), makeResult({ steps: [makeStep('Step')] }));
      expect(clientMock.createSteps).not.toHaveBeenCalled();
      expect(clientMock.findOrCreateTestCase).not.toHaveBeenCalled();
    });

    it('creates the case once and seeds its steps once across retries', async () => {
      const r = new TestPlanItReporter({ ...autoOptions });
      const parent = buildParent({ project: 'chromium', describes: ['Auth'] });
      r.onTestEnd(makeTest('flaky', parent), makeResult({ status: 'failed', retry: 0, steps: [makeStep('Step')] }));
      r.onTestEnd(makeTest('flaky', parent), makeResult({ status: 'passed', retry: 1, steps: [makeStep('Step')] }));
      await r.onEnd(FULL_RESULT);
      expect(clientMock.findOrCreateTestCase).toHaveBeenCalledTimes(1);
      expect(clientMock.createSteps).toHaveBeenCalledTimes(1);
    });

    it('still reports the result when step creation fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      clientMock.createSteps.mockRejectedValueOnce(new Error('boom'));
      const r = new TestPlanItReporter({ ...autoOptions });
      await run(r, makeTest('resilient', buildParent({ project: 'chromium' })), makeResult({ steps: [makeStep('Step')] }));
      expect(clientMock.createJUnitTestResult).toHaveBeenCalledTimes(1);
      expect(r.getState().stats.testStepsCreated).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('overwriting steps to keep cases in sync (overwriteSteps)', () => {
    it('overwrites steps on a case linked by ID', async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, overwriteSteps: true });
      const result = makeResult({ steps: [makeStep('New step A'), makeStep('New step B')] });
      await run(r, makeTest('[1234] linked', buildParent({ project: 'chromium' })), result);

      // Existing steps cleared first, then the new ones written in one batch.
      expect(clientMock.softDeleteCaseSteps).toHaveBeenCalledWith(1234);
      expect(lastArg(clientMock.createSteps)).toEqual({
        testCaseId: 1234,
        steps: [
          { step: 'New step A', order: 0 },
          { step: 'New step B', order: 1 },
        ],
      });
    });

    it('overwrites steps on an auto-create match (found)', async () => {
      clientMock.findOrCreateTestCase.mockResolvedValueOnce({ testCase: { id: 99, name: 'a' }, action: 'found' });
      const r = new TestPlanItReporter({ ...autoOptions, overwriteSteps: true });
      await run(r, makeTest('existing', buildParent({ project: 'chromium' })), makeResult({ steps: [makeStep('S')] }));
      expect(clientMock.softDeleteCaseSteps).toHaveBeenCalledWith(99);
      expect(lastArg(clientMock.createSteps).testCaseId).toBe(99);
    });

    it('does not touch existing steps when overwriteSteps is off (default)', async () => {
      await run(reporter, makeTest('[1234] linked', buildParent({ project: 'chromium' })), makeResult({ steps: [makeStep('S')] }));
      expect(clientMock.softDeleteCaseSteps).not.toHaveBeenCalled();
      expect(clientMock.createSteps).not.toHaveBeenCalled();
    });

    it('never clears steps when the test has no test.step() calls', async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, overwriteSteps: true });
      await run(r, makeTest('[1234] no steps', buildParent({ project: 'chromium' })), makeResult({ steps: [] }));
      expect(clientMock.softDeleteCaseSteps).not.toHaveBeenCalled();
      expect(clientMock.createSteps).not.toHaveBeenCalled();
    });

    it('syncs a linked case once across retries', async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, overwriteSteps: true });
      const parent = buildParent({ project: 'chromium' });
      r.onTestEnd(makeTest('[1234] flaky', parent), makeResult({ status: 'failed', retry: 0, steps: [makeStep('S')] }));
      r.onTestEnd(makeTest('[1234] flaky', parent), makeResult({ status: 'passed', retry: 1, steps: [makeStep('S')] }));
      await r.onEnd(FULL_RESULT);
      expect(clientMock.softDeleteCaseSteps).toHaveBeenCalledTimes(1);
      expect(clientMock.createSteps).toHaveBeenCalledTimes(1);
    });

    it('skips creating steps (no duplicates) when clearing fails, but still reports', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      clientMock.softDeleteCaseSteps.mockRejectedValueOnce(new Error('boom'));
      const r = new TestPlanItReporter({ ...defaultOptions, overwriteSteps: true });
      await run(r, makeTest('[1234] linked', buildParent({ project: 'chromium' })), makeResult({ steps: [makeStep('S')] }));
      expect(clientMock.createSteps).not.toHaveBeenCalled();
      expect(clientMock.createJUnitTestResult).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('attachments', () => {
    it('uploads an attachment from its in-memory body', async () => {
      const result = makeResult({
        status: 'failed',
        attachments: [{ name: 'screenshot', contentType: 'image/png', body: Buffer.from('PNG') }] as any,
      });
      await run(reporter, makeTest('[1] fails', buildParent({ project: 'chromium' })), result);
      expect(clientMock.uploadJUnitAttachment).toHaveBeenCalledTimes(1);
      const [junitId, buffer, fileName, contentType] = calls(clientMock.uploadJUnitAttachment)[0];
      expect(junitId).toBe(789);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(fileName).toContain('.png');
      expect(contentType).toBe('image/png');
    });

    it('reads an attachment from disk when only a path is given', async () => {
      readFileMock.mockResolvedValueOnce(Buffer.from('FROMDISK'));
      const result = makeResult({
        status: 'failed',
        attachments: [{ name: 'trace', contentType: 'application/zip', path: '/tmp/trace.zip' }] as any,
      });
      await run(reporter, makeTest('[1] fails', buildParent({ project: 'chromium' })), result);
      expect(readFileMock).toHaveBeenCalledWith('/tmp/trace.zip');
      const [, buffer, fileName] = calls(clientMock.uploadJUnitAttachment)[0];
      expect(buffer.toString()).toBe('FROMDISK');
      expect(fileName).toContain('trace.zip');
    });

    it('skips empty attachments', async () => {
      readFileMock.mockResolvedValueOnce(Buffer.alloc(0));
      const result = makeResult({
        attachments: [{ name: 'video', contentType: 'video/webm', path: '/tmp/v.webm' }] as any,
      });
      await run(reporter, makeTest('[1] x', buildParent({ project: 'chromium' })), result);
      expect(clientMock.uploadJUnitAttachment).not.toHaveBeenCalled();
    });

    it('records a failed upload without throwing', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      clientMock.uploadJUnitAttachment.mockRejectedValueOnce(new Error('upload boom'));
      const result = makeResult({
        attachments: [{ name: 'screenshot', contentType: 'image/png', body: Buffer.from('x') }] as any,
      });
      await run(reporter, makeTest('[1] x', buildParent({ project: 'chromium' })), result);
      expect(reporter.getState().stats.attachmentsFailed).toBe(1);
      expect(clientMock.completeTestRun).toHaveBeenCalled(); // run still completes
    });

    it('uploads multiple attachments for one test', async () => {
      const result = makeResult({
        status: 'failed',
        attachments: [
          { name: 'screenshot', contentType: 'image/png', body: Buffer.from('a') },
          { name: 'video', contentType: 'video/webm', body: Buffer.from('b') },
        ] as any,
      });
      await run(reporter, makeTest('[1] x', buildParent({ project: 'chromium' })), result);
      expect(clientMock.uploadJUnitAttachment).toHaveBeenCalledTimes(2);
      expect(reporter.getState().stats.attachmentsUploaded).toBe(2);
    });

    it('respects the attachmentTypes filter (content-type prefix)', async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, attachmentTypes: ['video/'] });
      const result = makeResult({
        attachments: [{ name: 'screenshot', contentType: 'image/png', body: Buffer.from('x') }] as any,
      });
      await run(r, makeTest('[1] x', buildParent({ project: 'chromium' })), result);
      expect(clientMock.uploadJUnitAttachment).not.toHaveBeenCalled();
    });

    it('respects the attachmentTypes filter (by attachment name)', async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, attachmentTypes: ['trace'] });
      const result = makeResult({
        attachments: [
          { name: 'screenshot', contentType: 'image/png', body: Buffer.from('x') },
          { name: 'trace', contentType: 'application/zip', body: Buffer.from('z') },
        ] as any,
      });
      await run(r, makeTest('[1] x', buildParent({ project: 'chromium' })), result);
      expect(clientMock.uploadJUnitAttachment).toHaveBeenCalledTimes(1);
      expect(calls(clientMock.uploadJUnitAttachment)[0][2]).toContain('.zip');
    });

    it('does not upload when uploadAttachments is disabled', async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, uploadAttachments: false });
      const result = makeResult({
        attachments: [{ name: 'screenshot', contentType: 'image/png', body: Buffer.from('x') }] as any,
      });
      await run(r, makeTest('[1] x', buildParent({ project: 'chromium' })), result);
      expect(clientMock.uploadJUnitAttachment).not.toHaveBeenCalled();
    });

    it('derives a file extension from the content type when there is no path', () => {
      const ext = (reporter as any).extForContentType.bind(reporter);
      expect(ext('image/png')).toBe('.png');
      expect(ext('image/jpeg')).toBe('.jpg');
      expect(ext('image/webp')).toBe('.webp');
      expect(ext('video/webm')).toBe('.webm');
      expect(ext('application/zip')).toBe('.zip');
      expect(ext('text/plain')).toBe('.txt');
      expect(ext('application/json')).toBe('.json');
      expect(ext('application/x-unknown')).toBe('');
      expect(ext(undefined)).toBe('');
    });

    it('builds an attachment note with test context', async () => {
      const result = makeResult({
        status: 'failed',
        error: { message: 'boom' } as any,
        attachments: [{ name: 'screenshot', contentType: 'image/png', body: Buffer.from('x') }] as any,
      });
      await run(reporter, makeTest('[1] fails', buildParent({ project: 'chromium', describes: ['Auth'] })), result);
      const note = calls(clientMock.uploadJUnitAttachment)[0][4] as string;
      expect(note).toContain('Test: fails');
      expect(note).toContain('Suite: Auth');
      expect(note).toContain('Status: failed');
      expect(note).toContain('Browser: chromium');
      expect(note).toContain('Error: boom');
    });
  });

  // -------------------------------------------------------------------------
  describe('error message handling', () => {
    it('strips ANSI codes from the error message but preserves brackets', async () => {
      const coloured = '\u001b[31mexpected locator [data-testid=submit] to be visible\u001b[39m';
      await run(
        reporter,
        makeTest('[1] fails', buildParent({ project: 'chromium' })),
        makeResult({ status: 'failed', error: { message: coloured } as any }),
      );
      expect(lastArg(clientMock.createJUnitTestResult).message).toBe('expected locator [data-testid=submit] to be visible');
    });

    it('includes the stack trace by default and omits it when disabled', async () => {
      await run(
        reporter,
        makeTest('[1] fails', buildParent({ project: 'chromium' })),
        makeResult({ status: 'failed', error: { message: 'boom', stack: 'at foo' } as any }),
      );
      expect(lastArg(clientMock.createJUnitTestResult).content).toBe('at foo');

      vi.clearAllMocks();
      applyBaseImpls();
      const r = new TestPlanItReporter({ ...defaultOptions, includeStackTrace: false });
      await run(r, makeTest('[1] fails', buildParent({ project: 'chromium' })), makeResult({ status: 'failed', error: { message: 'boom', stack: 'at foo' } as any }));
      expect(lastArg(clientMock.createJUnitTestResult).content).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  describe('initialization & onEnd guards', () => {
    it('does nothing when no tests were reported', async () => {
      await reporter.onEnd(FULL_RESULT);
      expect(clientMock.createTestRun).not.toHaveBeenCalled();
      expect(clientMock.completeTestRun).not.toHaveBeenCalled();
    });

    it('prints FAILED and skips the run when status mappings are missing', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      clientMock.getStatusId.mockImplementation(async (_p: number, s: string) => (s === 'passed' ? undefined : 2));
      await run(reporter, makeTest('[1] x', buildParent({ project: 'chromium' })), makeResult());
      expect(clientMock.createTestRun).not.toHaveBeenCalled();
      expect(clientMock.completeTestRun).not.toHaveBeenCalled();
      expect(err.mock.calls.flat().join(' ')).toContain('FAILED');
    });

    it('reports an API error but skips completion when the only result fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      clientMock.createJUnitTestResult.mockRejectedValueOnce(new Error('result boom'));
      await run(reporter, makeTest('[1] x', buildParent({ project: 'chromium' })), makeResult());
      expect(reporter.getState().stats.apiErrors).toBe(1);
      // reportedResultCount stayed 0 → completion is skipped
      expect(clientMock.completeTestRun).not.toHaveBeenCalled();
    });

    it('swallows a completeTestRun failure', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      clientMock.completeTestRun.mockRejectedValueOnce(new Error('complete boom'));
      await expect(
        run(reporter, makeTest('[1] x', buildParent({ project: 'chromium' })), makeResult()),
      ).resolves.toBeUndefined();
    });

    it('prints the API-error count in the summary when some results fail', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      clientMock.createJUnitTestResult.mockResolvedValueOnce({ id: 789 }).mockRejectedValueOnce(new Error('boom'));
      const parent = buildParent({ project: 'chromium', describes: ['Auth'] });
      reporter.onTestEnd(makeTest('[1] ok', parent), makeResult());
      reporter.onTestEnd(makeTest('[2] bad', parent), makeResult());
      await reporter.onEnd(FULL_RESULT);
      expect(reporter.getState().stats.apiErrors).toBe(1);
      expect(logSpy.mock.calls.flat().join(' ')).toContain('API Errors');
    });
  });

  // -------------------------------------------------------------------------
  describe('option resolution', () => {
    it('resolves config/milestone/state names and passes the IDs to createTestRun', async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, configId: 'Cfg', milestoneId: 'M', stateId: 'S', tagIds: ['a', 'b'] });
      await run(r, makeTest('[1] x', buildParent({ project: 'chromium' })), makeResult());
      expect(clientMock.findConfigurationByName).toHaveBeenCalledWith(1, 'Cfg');
      expect(clientMock.findMilestoneByName).toHaveBeenCalledWith(1, 'M');
      expect(clientMock.findWorkflowStateByName).toHaveBeenCalledWith(1, 'S');
      expect(clientMock.resolveTagIds).toHaveBeenCalledWith(1, ['a', 'b']);
      const arg = lastArg(clientMock.createTestRun);
      expect(arg.configId).toBe(11);
      expect(arg.milestoneId).toBe(22);
      expect(arg.stateId).toBe(33);
      expect(arg.tagIds).toEqual([7, 8, 9]);
    });

    it('passes through numeric config/milestone/state without a lookup', async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, configId: 5, milestoneId: 6, stateId: 7 });
      await run(r, makeTest('[1] x', buildParent({ project: 'chromium' })), makeResult());
      expect(clientMock.findConfigurationByName).not.toHaveBeenCalled();
      const arg = lastArg(clientMock.createTestRun);
      expect([arg.configId, arg.milestoneId, arg.stateId]).toEqual([5, 6, 7]);
    });

    it('fails initialization when a configuration name is not found', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      clientMock.findConfigurationByName.mockResolvedValueOnce(null);
      const r = new TestPlanItReporter({ ...defaultOptions, configId: 'Nope' });
      await run(r, makeTest('[1] x', buildParent({ project: 'chromium' })), makeResult());
      expect(clientMock.createTestRun).not.toHaveBeenCalled();
      expect(err.mock.calls.flat().join(' ')).toContain('FAILED');
    });

    it('fails initialization when a testRunId name is not found', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      clientMock.findTestRunByName.mockResolvedValueOnce(null);
      const r = new TestPlanItReporter({ ...defaultOptions, testRunId: 'Ghost Run' });
      await run(r, makeTest('[1] x', buildParent({ project: 'chromium' })), makeResult());
      expect(clientMock.createTestRun).not.toHaveBeenCalled();
      expect(err.mock.calls.flat().join(' ')).toContain('FAILED');
    });

    it('resolves parentFolderId/templateId by name for auto-create', async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, autoCreateTestCases: true, parentFolderId: 'My Folder', templateId: 'My Template' });
      await run(r, makeTest('untagged', buildParent({ project: 'chromium' })), makeResult());
      expect(clientMock.findFolderByName).toHaveBeenCalledWith(1, 'My Folder');
      expect(clientMock.findTemplateByName).toHaveBeenCalledWith(1, 'My Template');
      const created = lastArg(clientMock.findOrCreateTestCase);
      expect(created.folderId).toBe(44);
      expect(created.templateId).toBe(55);
    });

    it('creates the parent folder when its name is missing and auto-create is on', async () => {
      clientMock.findFolderByName.mockResolvedValueOnce(null);
      const r = new TestPlanItReporter({ ...defaultOptions, autoCreateTestCases: true, parentFolderId: 'New Folder', templateId: 1 });
      await run(r, makeTest('untagged', buildParent({ project: 'chromium' })), makeResult());
      expect(clientMock.createFolder).toHaveBeenCalledWith({ projectId: 1, name: 'New Folder' });
      expect(lastArg(clientMock.findOrCreateTestCase).folderId).toBe(88);
    });

    it('fails initialization when a folder name is missing and auto-create is off', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      clientMock.findFolderByName.mockResolvedValueOnce(null);
      const r = new TestPlanItReporter({ ...defaultOptions, parentFolderId: 'Ghost' });
      await run(r, makeTest('[1] x', buildParent({ project: 'chromium' })), makeResult());
      expect(clientMock.createTestRun).not.toHaveBeenCalled();
      expect(err.mock.calls.flat().join(' ')).toContain('FAILED');
    });
  });

  // -------------------------------------------------------------------------
  describe('run name formatting', () => {
    it('fills placeholders from the first reported test', () => {
      (reporter as any).currentProject = 'chromium';
      (reporter as any).currentSpec = '/repo/tests/login.spec.ts';
      (reporter as any).rootSuiteName = 'Auth';
      expect((reporter as any).formatRunName('{suite} - {browser} - {spec}')).toBe('Auth - chromium - login');
    });
    it('falls back to unknown/Tests when context is missing', () => {
      expect((reporter as any).formatRunName('{suite}|{browser}|{spec}')).toBe('Tests|unknown|unknown');
    });
    it('falls back the suite to the spec base name when there is no describe', () => {
      (reporter as any).currentSpec = '/repo/tests/checkout.test.ts';
      expect((reporter as any).formatRunName('{suite}')).toBe('checkout');
    });
    it('uses the configured runName when creating the run', async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, runName: 'Run {browser}' });
      await run(r, makeTest('[1] x', buildParent({ project: 'webkit' })), makeResult());
      expect(lastArg(clientMock.createTestRun).name).toBe('Run webkit');
    });
  });

  // -------------------------------------------------------------------------
  describe('misc hooks', () => {
    it('onError does not throw', () => {
      expect(() => reporter.onError({ message: 'global boom' } as any)).not.toThrow();
    });
    it('onBegin does not initialize or call the API', () => {
      reporter.onBegin({} as any, {} as any);
      expect(clientMock.createTestRun).not.toHaveBeenCalled();
      expect(reporter.getState().initialized).toBe(false);
    });
    it('exposes internal state via getState', () => {
      expect(reporter.getState().results).toBeInstanceOf(Map);
    });
    it('emits verbose logs when verbose is enabled', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const r = new TestPlanItReporter({ ...defaultOptions, verbose: true });
      await run(r, makeTest('[1] x', buildParent({ project: 'chromium' })), makeResult());
      expect(clientMock.createTestRun).toHaveBeenCalled();
      expect(logSpy.mock.calls.flat().join(' ')).toContain('[TestPlanIt]');
    });
  });
});
