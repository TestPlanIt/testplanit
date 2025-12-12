import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TestStats, SuiteStats, RunnerStats } from '@wdio/reporter';

// Mock WDIOReporter base class before importing the reporter
vi.mock('@wdio/reporter', () => {
  return {
    default: class MockWDIOReporter {
      options: Record<string, unknown>;
      constructor(options: Record<string, unknown>) {
        this.options = options;
      }
      write() {}
      onRunnerStart() {}
      onSuiteStart() {}
      onSuiteEnd() {}
      onTestStart() {}
      onTestPass() {}
      onTestFail() {}
      onTestSkip() {}
      onRunnerEnd() {}
    },
  };
});

// Mock the API client
vi.mock('@testplanit/api', () => {
  return {
    TestPlanItClient: vi.fn().mockImplementation(() => ({
      getStatuses: vi.fn().mockResolvedValue([
        { id: 1, name: 'Passed', systemName: 'passed', isSuccess: true, isFailure: false },
        { id: 2, name: 'Failed', systemName: 'failed', isSuccess: false, isFailure: true },
        { id: 3, name: 'Skipped', systemName: 'skipped', isSuccess: false, isFailure: false },
      ]),
      getStatusId: vi.fn().mockImplementation(async (_projectId: number, status: string) => {
        const map: Record<string, number> = { passed: 1, failed: 2, skipped: 3 };
        return map[status];
      }),
      createTestRun: vi.fn().mockResolvedValue({ id: 123, name: 'Test Run' }),
      getTestRun: vi.fn().mockResolvedValue({ id: 123, name: 'Test Run' }),
      completeTestRun: vi.fn().mockResolvedValue({ id: 123, isCompleted: true }),
      findOrAddTestCaseToRun: vi.fn().mockResolvedValue({ id: 456 }),
      createTestResult: vi.fn().mockResolvedValue({ id: 789 }),
      uploadAttachment: vi.fn().mockResolvedValue({ id: 1, path: '/attachments/1' }),
    })),
    TestPlanItError: class TestPlanItError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'TestPlanItError';
      }
    },
  };
});

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue(Buffer.from('fake-image-data')),
}));

// Import after mocks are set up
import TestPlanItReporter from './reporter.js';

describe('TestPlanItReporter', () => {
  let reporter: TestPlanItReporter;
  const defaultOptions = {
    domain: 'https://testplanit.example.com',
    apiToken: 'tpi_test_token',
    projectId: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    reporter = new TestPlanItReporter(defaultOptions);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create reporter with valid options', () => {
      const reporter = new TestPlanItReporter(defaultOptions);
      expect(reporter).toBeDefined();
    });

    it('should throw error if domain is missing', () => {
      expect(() => {
        new TestPlanItReporter({
          ...defaultOptions,
          domain: '',
        });
      }).toThrow('domain is required');
    });

    it('should throw error if apiToken is missing', () => {
      expect(() => {
        new TestPlanItReporter({
          ...defaultOptions,
          apiToken: '',
        });
      }).toThrow('apiToken is required');
    });

    it('should throw error if projectId is missing', () => {
      expect(() => {
        new TestPlanItReporter({
          ...defaultOptions,
          projectId: 0,
        });
      }).toThrow('projectId is required');
    });

    it('should use default options', () => {
      const reporter = new TestPlanItReporter(defaultOptions);
      const state = reporter.getState();
      expect(state.initialized).toBe(false);
    });

    it('should use provided testRunId', () => {
      const reporter = new TestPlanItReporter({
        ...defaultOptions,
        testRunId: 999,
      });
      const state = reporter.getState();
      expect(state.testRunId).toBe(999);
    });
  });

  describe('case ID parsing', () => {
    it('should parse single case ID from title with default bracket pattern', () => {
      // Default pattern is /\[(\d+)\]/g
      const result = (reporter as any).parseCaseIds('[12345] should load the page');
      expect(result.caseIds).toEqual([12345]);
      expect(result.cleanTitle).toBe('should load the page');
    });

    it('should parse multiple case IDs from title', () => {
      const result = (reporter as any).parseCaseIds('[123] [456] [789] should work');
      expect(result.caseIds).toEqual([123, 456, 789]);
      expect(result.cleanTitle).toBe('should work');
    });

    it('should handle title without case ID', () => {
      const result = (reporter as any).parseCaseIds('should work without case ID');
      expect(result.caseIds).toEqual([]);
      expect(result.cleanTitle).toBe('should work without case ID');
    });

    it('should handle custom caseIdPattern with C-prefix', () => {
      const customReporter = new TestPlanItReporter({
        ...defaultOptions,
        caseIdPattern: /C(\d+)/g,
      });
      const result = (customReporter as any).parseCaseIds('C12345 should work');
      expect(result.caseIds).toEqual([12345]);
      expect(result.cleanTitle).toBe('should work');
    });

    it('should handle custom caseIdPattern with TC- prefix', () => {
      const customReporter = new TestPlanItReporter({
        ...defaultOptions,
        caseIdPattern: /TC-(\d+)/g,
      });
      const result = (customReporter as any).parseCaseIds('TC-12345 should work');
      expect(result.caseIds).toEqual([12345]);
      expect(result.cleanTitle).toBe('should work');
    });

    it('should handle caseIdPattern as string', () => {
      const customReporter = new TestPlanItReporter({
        ...defaultOptions,
        caseIdPattern: 'TEST-(\\d+)',
      });
      const result = (customReporter as any).parseCaseIds('TEST-99999 should work');
      expect(result.caseIds).toEqual([99999]);
      expect(result.cleanTitle).toBe('should work');
    });

    it('should handle case ID at end of title', () => {
      const result = (reporter as any).parseCaseIds('should load the page [12345]');
      expect(result.caseIds).toEqual([12345]);
      expect(result.cleanTitle).toBe('should load the page');
    });

    it('should handle pattern with multiple capturing groups', () => {
      // Pattern that matches either [123] or C123 format
      const customReporter = new TestPlanItReporter({
        ...defaultOptions,
        caseIdPattern: /(?:\[(\d+)\]|C(\d+))/g,
      });
      const result1 = (customReporter as any).parseCaseIds('[123] should work');
      expect(result1.caseIds).toEqual([123]);

      const result2 = (customReporter as any).parseCaseIds('C456 should work');
      expect(result2.caseIds).toEqual([456]);
    });

    it('should handle plain numeric IDs with custom pattern', () => {
      const customReporter = new TestPlanItReporter({
        ...defaultOptions,
        caseIdPattern: /^(\d+)\s/g,
      });
      const result = (customReporter as any).parseCaseIds('1761 should load the page');
      expect(result.caseIds).toEqual([1761]);
      expect(result.cleanTitle).toBe('should load the page');
    });
  });

  describe('run name formatting', () => {
    it('should replace date placeholder', () => {
      const result = (reporter as any).formatRunName('Test Run - {date}');
      expect(result).toMatch(/Test Run - \d{4}-\d{2}-\d{2}/);
    });

    it('should replace time placeholder', () => {
      const result = (reporter as any).formatRunName('Test Run - {time}');
      expect(result).toMatch(/Test Run - \d{2}:\d{2}:\d{2}/);
    });

    it('should replace browser placeholder', () => {
      (reporter as any).state.capabilities = { browserName: 'chrome' };
      const result = (reporter as any).formatRunName('Test Run - {browser}');
      expect(result).toBe('Test Run - chrome');
    });

    it('should use "unknown" for missing browser', () => {
      const result = (reporter as any).formatRunName('Test Run - {browser}');
      expect(result).toBe('Test Run - unknown');
    });

    it('should replace multiple placeholders', () => {
      (reporter as any).state.capabilities = { browserName: 'firefox' };
      const result = (reporter as any).formatRunName('{browser} Tests - {date}');
      expect(result).toMatch(/firefox Tests - \d{4}-\d{2}-\d{2}/);
    });
  });

  describe('lifecycle hooks', () => {
    it('should handle onRunnerStart', () => {
      const runnerStats = {
        cid: '0-0',
        capabilities: { browserName: 'chrome', platformName: 'macOS' },
      } as RunnerStats;

      reporter.onRunnerStart(runnerStats);
      const state = reporter.getState();
      expect(state.capabilities).toEqual({ browserName: 'chrome', platformName: 'macOS' });
    });

    it('should handle onSuiteStart', () => {
      const suiteStats = { title: 'Login Tests' } as SuiteStats;
      reporter.onSuiteStart(suiteStats);
      // Suite name should be tracked internally
      expect((reporter as any).currentSuite).toContain('Login Tests');
    });

    it('should handle onSuiteEnd', () => {
      const suiteStats = { title: 'Login Tests' } as SuiteStats;
      reporter.onSuiteStart(suiteStats);
      reporter.onSuiteEnd(suiteStats);
      expect((reporter as any).currentSuite).not.toContain('Login Tests');
    });

    it('should handle nested suites', () => {
      reporter.onSuiteStart({ title: 'Parent Suite' } as SuiteStats);
      reporter.onSuiteStart({ title: 'Child Suite' } as SuiteStats);
      expect((reporter as any).getFullSuiteName()).toBe('Parent Suite > Child Suite');

      reporter.onSuiteEnd({ title: 'Child Suite' } as SuiteStats);
      expect((reporter as any).getFullSuiteName()).toBe('Parent Suite');
    });
  });

  describe('test result handling', () => {
    const createTestStats = (overrides: Partial<TestStats> = {}): TestStats => ({
      type: 'test',
      title: '[123] should pass',
      fullTitle: 'Suite > [123] should pass',
      uid: 'test-uid',
      cid: '0-0',
      state: 'passed',
      duration: 1500,
      start: new Date('2024-01-01T00:00:00Z'),
      end: new Date('2024-01-01T00:00:01.5Z'),
      retries: 0,
      ...overrides,
    } as TestStats);

    it('should track passed test', () => {
      reporter.onTestPass(createTestStats());
      const state = reporter.getState();
      expect(state.results.size).toBe(1);

      const result = Array.from(state.results.values())[0];
      expect(result.status).toBe('passed');
      expect(result.caseId).toBe(123);
    });

    it('should track failed test', () => {
      const testStats = createTestStats({
        title: '[456] should fail',
        state: 'failed',
        error: {
          message: 'Assertion failed',
          stack: 'Error: Assertion failed\n  at Test.fn',
        } as Error,
      });

      reporter.onTestFail(testStats);
      const state = reporter.getState();
      const result = Array.from(state.results.values())[0];

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBe('Assertion failed');
      expect(result.stackTrace).toContain('Error: Assertion failed');
    });

    it('should track skipped test', () => {
      reporter.onTestSkip(createTestStats({ title: '[789] should skip', state: 'skipped' }));
      const state = reporter.getState();
      const result = Array.from(state.results.values())[0];
      expect(result.status).toBe('skipped');
    });

    it('should include retry attempt', () => {
      reporter.onTestFail(createTestStats({ retries: 2 }));
      const state = reporter.getState();
      const result = Array.from(state.results.values())[0];
      expect(result.retryAttempt).toBe(2);
    });

    it('should track test without case ID when autoCreateTestCases is false', () => {
      reporter.onTestPass(createTestStats({ title: 'test without case ID' }));
      const state = reporter.getState();
      const result = Array.from(state.results.values())[0];
      expect(result.caseId).toBeUndefined();
    });
  });

  describe('getState', () => {
    it('should return current state', () => {
      const state = reporter.getState();
      expect(state).toHaveProperty('testRunId');
      expect(state).toHaveProperty('results');
      expect(state).toHaveProperty('statusIds');
      expect(state).toHaveProperty('initialized');
    });
  });
});

describe('caseIdPattern edge cases', () => {
  it('should handle complex regex patterns', () => {
    const reporter = new TestPlanItReporter({
      domain: 'https://testplanit.example.com',
      apiToken: 'tpi_test_token',
      projectId: 1,
      caseIdPattern: /\[CASE-(\d+)\]/g,
    });
    const result = (reporter as any).parseCaseIds('[CASE-123] should work');
    expect(result.caseIds).toEqual([123]);
    expect(result.cleanTitle).toBe('should work');
  });

  it('should handle pattern matching at start only', () => {
    const reporter = new TestPlanItReporter({
      domain: 'https://testplanit.example.com',
      apiToken: 'tpi_test_token',
      projectId: 1,
      caseIdPattern: /^#(\d+)/g,
    });
    const result = (reporter as any).parseCaseIds('#1234 should work');
    expect(result.caseIds).toEqual([1234]);
    expect(result.cleanTitle).toBe('should work');
  });
});
