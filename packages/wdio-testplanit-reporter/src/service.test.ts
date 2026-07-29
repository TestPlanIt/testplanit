import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock the API client - must use class syntax for `new` to work
const mockClientInstance = {
  createTestRun: vi.fn().mockResolvedValue({ id: 100, name: 'Test Run' }),
  createJUnitTestSuite: vi.fn().mockResolvedValue({ id: 200, name: 'Test Suite' }),
  completeTestRun: vi.fn().mockResolvedValue({ id: 100, isCompleted: true }),
  findConfigurationByName: vi.fn().mockResolvedValue({ id: 10, name: 'Config' }),
  findMilestoneByName: vi.fn().mockResolvedValue({ id: 20, name: 'Milestone' }),
  findWorkflowStateByName: vi.fn().mockResolvedValue({ id: 30, name: 'State' }),
  resolveTagIds: vi.fn().mockResolvedValue([1, 2, 3]),
  addTestRunLink: vi.fn().mockResolvedValue({ id: 300, name: 'link' }),
  uploadTestRunAttachment: vi.fn().mockResolvedValue({ id: 301, name: 'file' }),
  setTestRunMetadata: vi.fn().mockResolvedValue({ id: 100 }),
};

vi.mock('@testplanit/api', () => {
  return {
    TestPlanItClient: class MockTestPlanItClient {
      constructor() {
        return mockClientInstance;
      }
    },
  };
});

// Mock shared state utilities
vi.mock('./shared.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./shared.js')>();
  return {
    RUN_ID_ENV_VAR: actual.RUN_ID_ENV_VAR,
    parseEnvTestRunId: actual.parseEnvTestRunId,
    writeSharedState: vi.fn(),
    deleteSharedState: vi.fn(),
    readSharedState: vi.fn().mockReturnValue(null),
  };
});

import TestPlanItService from './service.js';
import {
  writeSharedState,
  deleteSharedState,
  readSharedState,
  RUN_ID_ENV_VAR,
} from './shared.js';

const mockedWriteSharedState = vi.mocked(writeSharedState);
const mockedDeleteSharedState = vi.mocked(deleteSharedState);
const mockedReadSharedState = vi.mocked(readSharedState);

describe('TestPlanItService', () => {
  const defaultOptions = {
    domain: 'https://testplanit.example.com',
    apiToken: 'tpi_test_token',
    projectId: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create service with valid options', () => {
      const service = new TestPlanItService(defaultOptions);
      expect(service).toBeDefined();
    });

    it('should throw if domain is missing', () => {
      expect(() => {
        new TestPlanItService({ ...defaultOptions, domain: '' });
      }).toThrow('domain is required');
    });

    it('should throw if apiToken is missing', () => {
      expect(() => {
        new TestPlanItService({ ...defaultOptions, apiToken: '' });
      }).toThrow('apiToken is required');
    });

    it('should throw if projectId is missing', () => {
      expect(() => {
        new TestPlanItService({ ...defaultOptions, projectId: 0 });
      }).toThrow('projectId is required');
    });

    it('should use default values for optional fields', () => {
      const service = new TestPlanItService(defaultOptions);
      // Just verify it doesn't throw — defaults are applied internally
      expect(service).toBeDefined();
    });
  });

  describe('onPrepare', () => {
    it('should create test run and JUnit test suite', async () => {
      const service = new TestPlanItService(defaultOptions);
      await service.onPrepare();

      // Should have called createTestRun and createJUnitTestSuite
      const clientInstance = mockClientInstance;
      expect(clientInstance.createTestRun).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 1,
        })
      );
      expect(clientInstance.createJUnitTestSuite).toHaveBeenCalledWith(
        expect.objectContaining({
          testRunId: 100,
        })
      );
    });

    it('should write shared state with managedByService: true', async () => {
      const service = new TestPlanItService(defaultOptions);
      await service.onPrepare();

      expect(mockedWriteSharedState).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          testRunId: 100,
          testSuiteId: 200,
          managedByService: true,
          activeWorkers: 0,
        })
      );
    });

    it('should clean up stale shared state before creating run', async () => {
      const service = new TestPlanItService(defaultOptions);
      await service.onPrepare();

      // deleteSharedState should be called before writeSharedState
      const deleteCallOrder = mockedDeleteSharedState.mock.invocationCallOrder[0];
      const writeCallOrder = mockedWriteSharedState.mock.invocationCallOrder[0];
      expect(deleteCallOrder).toBeLessThan(writeCallOrder);
    });

    it('should resolve string configId', async () => {
      const service = new TestPlanItService({
        ...defaultOptions,
        configId: 'My Config',
      });
      await service.onPrepare();

      const clientInstance = mockClientInstance;
      expect(clientInstance.findConfigurationByName).toHaveBeenCalledWith(1, 'My Config');
      expect(clientInstance.createTestRun).toHaveBeenCalledWith(
        expect.objectContaining({
          configId: 10,
        })
      );
    });

    it('should resolve string milestoneId', async () => {
      const service = new TestPlanItService({
        ...defaultOptions,
        milestoneId: 'Sprint 1',
      });
      await service.onPrepare();

      const clientInstance = mockClientInstance;
      expect(clientInstance.findMilestoneByName).toHaveBeenCalledWith(1, 'Sprint 1');
      expect(clientInstance.createTestRun).toHaveBeenCalledWith(
        expect.objectContaining({
          milestoneId: 20,
        })
      );
    });

    it('should format run name with placeholders', async () => {
      const service = new TestPlanItService({
        ...defaultOptions,
        runName: 'Tests - {date}',
      });
      await service.onPrepare();

      const clientInstance = mockClientInstance;
      const callArg = clientInstance.createTestRun.mock.calls[0][0];
      expect(callArg.name).toMatch(/Tests - \d{4}-\d{2}-\d{2}/);
    });

    it('should replace unavailable placeholders with fallbacks', async () => {
      const service = new TestPlanItService({
        ...defaultOptions,
        runName: '{browser} - {spec} - {suite}',
      });
      await service.onPrepare();

      const clientInstance = mockClientInstance;
      const callArg = clientInstance.createTestRun.mock.calls[0][0];
      expect(callArg.name).toBe('unknown - unknown - Tests');
    });

    it('should throw when string configId is not found', async () => {
      mockClientInstance.findConfigurationByName.mockResolvedValueOnce(null);

      const service = new TestPlanItService({
        ...defaultOptions,
        configId: 'Nonexistent Config',
      });

      await expect(service.onPrepare()).rejects.toThrow('Configuration not found: "Nonexistent Config"');
    });

    it('should throw when string milestoneId is not found', async () => {
      mockClientInstance.findMilestoneByName.mockResolvedValueOnce(null);

      const service = new TestPlanItService({
        ...defaultOptions,
        milestoneId: 'Nonexistent Milestone',
      });

      await expect(service.onPrepare()).rejects.toThrow('Milestone not found: "Nonexistent Milestone"');
    });

    it('should throw when string stateId is not found', async () => {
      mockClientInstance.findWorkflowStateByName.mockResolvedValueOnce(null);

      const service = new TestPlanItService({
        ...defaultOptions,
        stateId: 'Nonexistent State',
      });

      await expect(service.onPrepare()).rejects.toThrow('Workflow state not found: "Nonexistent State"');
    });

    it('should resolve string stateId', async () => {
      const service = new TestPlanItService({
        ...defaultOptions,
        stateId: 'In Progress',
      });
      await service.onPrepare();

      expect(mockClientInstance.findWorkflowStateByName).toHaveBeenCalledWith(1, 'In Progress');
      expect(mockClientInstance.createTestRun).toHaveBeenCalledWith(
        expect.objectContaining({
          stateId: 30,
        })
      );
    });

    it('should pass through numeric configId directly', async () => {
      const service = new TestPlanItService({
        ...defaultOptions,
        configId: 42,
      });
      await service.onPrepare();

      expect(mockClientInstance.findConfigurationByName).not.toHaveBeenCalled();
      expect(mockClientInstance.createTestRun).toHaveBeenCalledWith(
        expect.objectContaining({
          configId: 42,
        })
      );
    });

    it('should pass through numeric milestoneId directly', async () => {
      const service = new TestPlanItService({
        ...defaultOptions,
        milestoneId: 55,
      });
      await service.onPrepare();

      expect(mockClientInstance.findMilestoneByName).not.toHaveBeenCalled();
      expect(mockClientInstance.createTestRun).toHaveBeenCalledWith(
        expect.objectContaining({
          milestoneId: 55,
        })
      );
    });

    it('should pass through numeric stateId directly', async () => {
      const service = new TestPlanItService({
        ...defaultOptions,
        stateId: 77,
      });
      await service.onPrepare();

      expect(mockClientInstance.findWorkflowStateByName).not.toHaveBeenCalled();
      expect(mockClientInstance.createTestRun).toHaveBeenCalledWith(
        expect.objectContaining({
          stateId: 77,
        })
      );
    });

    it('should resolve tagIds', async () => {
      const service = new TestPlanItService({
        ...defaultOptions,
        tagIds: ['tag1', 'tag2'],
      });
      await service.onPrepare();

      expect(mockClientInstance.resolveTagIds).toHaveBeenCalledWith(1, ['tag1', 'tag2']);
      expect(mockClientInstance.createTestRun).toHaveBeenCalledWith(
        expect.objectContaining({
          tagIds: [1, 2, 3],
        })
      );
    });

    it('should not resolve tagIds when empty', async () => {
      const service = new TestPlanItService({
        ...defaultOptions,
        tagIds: [],
      });
      await service.onPrepare();

      expect(mockClientInstance.resolveTagIds).not.toHaveBeenCalled();
    });

    it('should clean up shared state and re-throw on API failure', async () => {
      // Temporarily make createTestRun fail
      mockClientInstance.createTestRun.mockRejectedValueOnce(new Error('API error'));

      const service = new TestPlanItService(defaultOptions);

      await expect(service.onPrepare()).rejects.toThrow('API error');
      // deleteSharedState called twice: once at start (cleanup), once on error
      expect(mockedDeleteSharedState).toHaveBeenCalledTimes(2);
    });
  });

  describe('onComplete', () => {
    it('should complete test run when completeRunOnFinish is true', async () => {
      const service = new TestPlanItService({
        ...defaultOptions,
        completeRunOnFinish: true,
      });
      await service.onPrepare();
      mockClientInstance.completeTestRun.mockClear();

      await service.onComplete(0);
      expect(mockClientInstance.completeTestRun).toHaveBeenCalledWith(100, 1);
    });

    it('should not complete test run when completeRunOnFinish is false', async () => {
      const service = new TestPlanItService({
        ...defaultOptions,
        completeRunOnFinish: false,
      });
      await service.onPrepare();
      mockClientInstance.completeTestRun.mockClear();

      await service.onComplete(0);
      expect(mockClientInstance.completeTestRun).not.toHaveBeenCalled();
    });

    it('should always delete shared state file', async () => {
      const service = new TestPlanItService(defaultOptions);
      await service.onPrepare();
      mockedDeleteSharedState.mockClear();

      await service.onComplete(0);
      expect(mockedDeleteSharedState).toHaveBeenCalledWith(1);
    });

    it('should not throw on API failure', async () => {
      const service = new TestPlanItService(defaultOptions);
      await service.onPrepare();

      mockClientInstance.completeTestRun.mockRejectedValueOnce(new Error('Network error'));

      // Should not throw
      await expect(service.onComplete(0)).resolves.toBeUndefined();
    });

    it('should handle case where onPrepare was never called', async () => {
      const service = new TestPlanItService(defaultOptions);
      // No onPrepare call — testRunId is undefined
      await expect(service.onComplete(1)).resolves.toBeUndefined();
    });
  });

  describe('afterTest', () => {
    const mockTakeScreenshot = vi.fn().mockResolvedValue('base64data');

    beforeEach(() => {
      (globalThis as Record<string, any>).browser = { takeScreenshot: mockTakeScreenshot };
    });

    afterEach(() => {
      delete (globalThis as Record<string, any>).browser;
    });

    it('should capture screenshot on failure when captureScreenshots is enabled', async () => {
      const service = new TestPlanItService({ ...defaultOptions, captureScreenshots: true });
      await service.afterTest({}, {}, { passed: false });
      expect(mockTakeScreenshot).toHaveBeenCalled();
    });

    it('should not capture screenshot on pass', async () => {
      const service = new TestPlanItService({ ...defaultOptions, captureScreenshots: true });
      await service.afterTest({}, {}, { passed: true });
      expect(mockTakeScreenshot).not.toHaveBeenCalled();
    });

    it('should not capture screenshot when captureScreenshots is disabled', async () => {
      const service = new TestPlanItService(defaultOptions);
      await service.afterTest({}, {}, { passed: false });
      expect(mockTakeScreenshot).not.toHaveBeenCalled();
    });

    it('should not throw when screenshot capture fails', async () => {
      mockTakeScreenshot.mockRejectedValueOnce(new Error('No browser'));
      const service = new TestPlanItService({ ...defaultOptions, captureScreenshots: true });
      await expect(service.afterTest({}, {}, { passed: false })).resolves.toBeUndefined();
    });
  });

  describe('run-level declarative options', () => {
    const ENV_KEYS = ['TPI_SVC_BUILD_URL', 'TPI_SVC_JOB', 'TPI_SVC_VERSION'];

    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      for (const key of ENV_KEYS) delete process.env[key];
    });

    it('attaches runLinks with resolved env placeholders after run creation', async () => {
      process.env.TPI_SVC_BUILD_URL = 'https://ci.example.com/job/42';
      process.env.TPI_SVC_JOB = 'nightly';

      const service = new TestPlanItService({
        ...defaultOptions,
        runLinks: [{ url: '{env:TPI_SVC_BUILD_URL}', name: '{env:TPI_SVC_JOB} build' }],
      });
      await service.onPrepare();

      expect(mockClientInstance.addTestRunLink).toHaveBeenCalledWith(
        100,
        'https://ci.example.com/job/42',
        'nightly build',
        undefined
      );
    });

    it('skips links whose url references unset env vars', async () => {
      const service = new TestPlanItService({
        ...defaultOptions,
        runLinks: [{ url: '{env:TPI_SVC_BUILD_URL}', name: 'CI Build' }],
      });
      await service.onPrepare();

      expect(mockClientInstance.addTestRunLink).not.toHaveBeenCalled();
    });

    it('passes name as undefined when it resolves to empty', async () => {
      const service = new TestPlanItService({
        ...defaultOptions,
        runLinks: [{ url: 'https://example.com', name: '{env:TPI_SVC_JOB}' }],
      });
      await service.onPrepare();

      expect(mockClientInstance.addTestRunLink).toHaveBeenCalledWith(
        100,
        'https://example.com',
        undefined,
        undefined
      );
    });

    it('sets run metadata, resolving env values and skipping unresolved ones', async () => {
      process.env.TPI_SVC_VERSION = '1.2.3';

      const service = new TestPlanItService({
        ...defaultOptions,
        runMetadata: {
          version: '{env:TPI_SVC_VERSION}',
          missing: '{env:TPI_SVC_JOB}',
          retries: 2,
          ci: true,
        },
      });
      await service.onPrepare();

      expect(mockClientInstance.setTestRunMetadata).toHaveBeenCalledWith(100, {
        version: '1.2.3',
        retries: 2,
        ci: true,
      });
    });

    it('does not call setTestRunMetadata when no metadata survives', async () => {
      const service = new TestPlanItService({
        ...defaultOptions,
        runMetadata: { missing: '{env:TPI_SVC_JOB}' },
      });
      await service.onPrepare();

      expect(mockClientInstance.setTestRunMetadata).not.toHaveBeenCalled();
    });

    it('uploads buffer runAttachments during onPrepare', async () => {
      const buffer = Buffer.from('log content');
      const service = new TestPlanItService({
        ...defaultOptions,
        runAttachments: [{ buffer, name: 'startup.log' }],
      });
      await service.onPrepare();

      expect(mockClientInstance.uploadTestRunAttachment).toHaveBeenCalledWith(
        100,
        buffer,
        'startup.log',
        'text/plain'
      );
    });

    it('uploads existing path attachments with a guessed mime type', async () => {
      const filePath = path.join(os.tmpdir(), `tpi-service-${process.pid}.html`);
      fs.writeFileSync(filePath, '<html></html>');
      try {
        const service = new TestPlanItService({
          ...defaultOptions,
          runAttachments: [{ path: filePath }],
        });
        await service.onPrepare();

        expect(mockClientInstance.uploadTestRunAttachment).toHaveBeenCalledWith(
          100,
          Buffer.from('<html></html>'),
          path.basename(filePath),
          'text/html'
        );
      } finally {
        fs.unlinkSync(filePath);
      }
    });

    it('defers missing path attachments and uploads them in onComplete before completing', async () => {
      const filePath = path.join(os.tmpdir(), `tpi-service-deferred-${process.pid}.log`);
      const service = new TestPlanItService({
        ...defaultOptions,
        runAttachments: [{ path: filePath }],
      });
      await service.onPrepare();
      expect(mockClientInstance.uploadTestRunAttachment).not.toHaveBeenCalled();

      // The tests "produce" the artifact between onPrepare and onComplete
      fs.writeFileSync(filePath, 'produced during the run');
      try {
        await service.onComplete(0);

        expect(mockClientInstance.uploadTestRunAttachment).toHaveBeenCalledWith(
          100,
          Buffer.from('produced during the run'),
          path.basename(filePath),
          'text/plain'
        );
        // Attachment must land before the run is completed
        const uploadOrder =
          mockClientInstance.uploadTestRunAttachment.mock.invocationCallOrder[0];
        const completeOrder =
          mockClientInstance.completeTestRun.mock.invocationCallOrder[0];
        expect(uploadOrder).toBeLessThan(completeOrder);
      } finally {
        fs.unlinkSync(filePath);
      }
    });

    it('skips deferred attachments still missing at onComplete', async () => {
      const service = new TestPlanItService({
        ...defaultOptions,
        runAttachments: [{ path: '/nonexistent/never-created.log' }],
      });
      await service.onPrepare();
      await service.onComplete(0);

      expect(mockClientInstance.uploadTestRunAttachment).not.toHaveBeenCalled();
      expect(mockClientInstance.completeTestRun).toHaveBeenCalled();
    });

    it('swallows run-level failures without failing onPrepare', async () => {
      mockClientInstance.addTestRunLink.mockRejectedValueOnce(new Error('link boom'));
      mockClientInstance.setTestRunMetadata.mockRejectedValueOnce(new Error('meta boom'));

      const service = new TestPlanItService({
        ...defaultOptions,
        runLinks: [{ url: 'https://example.com' }],
        runMetadata: { version: '1.0.0' },
      });

      await expect(service.onPrepare()).resolves.toBeUndefined();
      expect(mockedWriteSharedState).toHaveBeenCalled();
    });
  });

  describe('before (runtime API install)', () => {
    beforeEach(() => {
      mockedReadSharedState.mockReturnValue({
        testRunId: 100,
        createdAt: new Date().toISOString(),
        activeWorkers: 0,
        managedByService: true,
      });
    });

    afterEach(() => {
      mockedReadSharedState.mockReturnValue(null);
    });

    it('installs browser.testplanit on the provided browser object', async () => {
      const browser: Record<string, any> = {};
      const service = new TestPlanItService(defaultOptions);
      service.before(undefined, undefined, browser);

      expect(browser.testplanit).toBeDefined();
      expect(browser.testplanit.getRunId()).toBe(100);
    });

    it('runtime attachToRun resolves the shared run', async () => {
      const browser: Record<string, any> = {};
      const service = new TestPlanItService(defaultOptions);
      service.before(undefined, undefined, browser);

      await browser.testplanit.attachToRun({ url: 'https://example.com', name: 'CI' });
      expect(mockClientInstance.addTestRunLink).toHaveBeenCalledWith(
        100,
        'https://example.com',
        'CI',
        undefined
      );
    });

    it('falls back to the global browser object', () => {
      const globalBrowser: Record<string, any> = {};
      (globalThis as Record<string, any>).browser = globalBrowser;
      try {
        const service = new TestPlanItService(defaultOptions);
        service.before(undefined, undefined, undefined);
        expect(globalBrowser.testplanit).toBeDefined();
      } finally {
        delete (globalThis as Record<string, any>).browser;
      }
    });

    it('does nothing when no browser object exists', () => {
      const service = new TestPlanItService(defaultOptions);
      expect(() => service.before(undefined, undefined, undefined)).not.toThrow();
    });
  });
});

describe('externally managed test run (service)', () => {
  const defaultOptions = {
    domain: 'https://testplanit.example.com',
    apiToken: 'tpi_test_token',
    projectId: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedReadSharedState.mockReturnValue(null);
    delete process.env[RUN_ID_ENV_VAR];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env[RUN_ID_ENV_VAR];
  });

  it('pins the run from TESTPLANIT_RUN_ID and never creates one', async () => {
    process.env[RUN_ID_ENV_VAR] = '984';
    const service = new TestPlanItService(defaultOptions);

    await service.onPrepare();

    expect(mockClientInstance.createTestRun).not.toHaveBeenCalled();
    expect(mockClientInstance.createJUnitTestSuite).toHaveBeenCalledWith(
      expect.objectContaining({ testRunId: 984 }),
    );
  });

  it('prefers the testRunId option over the environment variable', async () => {
    process.env[RUN_ID_ENV_VAR] = '984';
    const service = new TestPlanItService({ ...defaultOptions, testRunId: 42 });

    await service.onPrepare();

    expect(mockClientInstance.createJUnitTestSuite).toHaveBeenCalledWith(
      expect.objectContaining({ testRunId: 42 }),
    );
  });

  it('ignores a non-numeric environment variable', async () => {
    process.env[RUN_ID_ENV_VAR] = 'not-a-run';
    const service = new TestPlanItService(defaultOptions);

    await service.onPrepare();

    expect(mockClientInstance.createTestRun).toHaveBeenCalled();
  });

  it('tells workers the pinned run is service-managed', async () => {
    process.env[RUN_ID_ENV_VAR] = '984';
    const service = new TestPlanItService(defaultOptions);

    await service.onPrepare();

    expect(mockedWriteSharedState).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ testRunId: 984, testSuiteId: 200, managedByService: true }),
    );
  });

  it('does not resolve configuration, milestone, state or tags', async () => {
    process.env[RUN_ID_ENV_VAR] = '984';
    const service = new TestPlanItService({
      ...defaultOptions,
      configId: 'Chrome / macOS',
      milestoneId: 'Release 2.0',
      stateId: 'In Progress',
      tagIds: ['regression'],
    });

    await service.onPrepare();

    expect(mockClientInstance.findConfigurationByName).not.toHaveBeenCalled();
    expect(mockClientInstance.findMilestoneByName).not.toHaveBeenCalled();
    expect(mockClientInstance.findWorkflowStateByName).not.toHaveBeenCalled();
    expect(mockClientInstance.resolveTagIds).not.toHaveBeenCalled();
  });

  it('does not complete the run, even with completeRunOnFinish enabled', async () => {
    process.env[RUN_ID_ENV_VAR] = '984';
    const service = new TestPlanItService({ ...defaultOptions, completeRunOnFinish: true });

    await service.onPrepare();
    await service.onComplete(0);

    expect(mockClientInstance.completeTestRun).not.toHaveBeenCalled();
  });

  it('names the suite from testSuiteName so shards are distinguishable', async () => {
    process.env[RUN_ID_ENV_VAR] = '984';
    const service = new TestPlanItService({
      ...defaultOptions,
      runName: 'Web Regression',
      testSuiteName: 'Shard A - {platform}',
    });

    await service.onPrepare();

    expect(mockClientInstance.createJUnitTestSuite).toHaveBeenCalledWith(
      expect.objectContaining({ name: `Shard A - ${process.platform}` }),
    );
  });

  it('resolves {env:VAR} in the suite name, which is how shards are labelled', async () => {
    process.env[RUN_ID_ENV_VAR] = '984';
    process.env.TPI_SVC_SHARD = 'shard-3';
    try {
      const service = new TestPlanItService({
        ...defaultOptions,
        testSuiteName: 'Shard {env:TPI_SVC_SHARD}',
      });

      await service.onPrepare();

      expect(mockClientInstance.createJUnitTestSuite).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Shard shard-3' }),
      );
    } finally {
      delete process.env.TPI_SVC_SHARD;
    }
  });

  it('skips run links and metadata, which belong to the pipeline', async () => {
    process.env[RUN_ID_ENV_VAR] = '984';
    const service = new TestPlanItService({
      ...defaultOptions,
      runLinks: [{ url: 'https://ci.example.com/job/42', name: 'Build' }],
      runMetadata: { branch: 'main' },
    });

    await service.onPrepare();

    expect(mockClientInstance.addTestRunLink).not.toHaveBeenCalled();
    expect(mockClientInstance.setTestRunMetadata).not.toHaveBeenCalled();
  });

  it('still applies run links and metadata to a run it created', async () => {
    const service = new TestPlanItService({
      ...defaultOptions,
      runLinks: [{ url: 'https://ci.example.com/job/42', name: 'Build' }],
      runMetadata: { branch: 'main' },
    });

    await service.onPrepare();

    expect(mockClientInstance.addTestRunLink).toHaveBeenCalled();
    expect(mockClientInstance.setTestRunMetadata).toHaveBeenCalled();
  });

  it('creates and completes a run when nothing pins one', async () => {
    const service = new TestPlanItService({ ...defaultOptions, completeRunOnFinish: true });

    await service.onPrepare();
    await service.onComplete(0);

    expect(mockClientInstance.createTestRun).toHaveBeenCalled();
    expect(mockClientInstance.completeTestRun).toHaveBeenCalledWith(100, 1);
  });
});
