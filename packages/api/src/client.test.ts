import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestPlanItClient, TestPlanItError } from './client.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Helper to create ZenStack response
const zenStackResponse = (data: unknown) => ({
  ok: true,
  text: async () => JSON.stringify({ data }),
});

// Helper to create regular response
const jsonResponse = (data: unknown) => ({
  ok: true,
  text: async () => JSON.stringify(data),
});

describe('TestPlanItClient', () => {
  let client: TestPlanItClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new TestPlanItClient({
      baseUrl: 'https://testplanit.example.com',
      apiToken: 'tpi_test_token',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create a client with valid config', () => {
      const client = new TestPlanItClient({
        baseUrl: 'https://testplanit.example.com',
        apiToken: 'tpi_test_token',
      });
      expect(client.getBaseUrl()).toBe('https://testplanit.example.com');
    });

    it('should normalize base URL by removing trailing slash', () => {
      const client = new TestPlanItClient({
        baseUrl: 'https://testplanit.example.com/',
        apiToken: 'tpi_test_token',
      });
      expect(client.getBaseUrl()).toBe('https://testplanit.example.com');
    });

    it('should throw error if baseUrl is missing', () => {
      expect(() => {
        new TestPlanItClient({
          baseUrl: '',
          apiToken: 'tpi_test_token',
        });
      }).toThrow('baseUrl is required');
    });

    it('should throw error if apiToken is missing', () => {
      expect(() => {
        new TestPlanItClient({
          baseUrl: 'https://testplanit.example.com',
          apiToken: '',
        });
      }).toThrow('apiToken is required');
    });
  });

  describe('createTestRun', () => {
    it('should create a test run successfully', async () => {
      const mockWorkflows = [{ id: 5, name: 'New', scope: 'RUNS' }];
      const mockTestRun = {
        id: 123,
        projectId: 1,
        name: 'Test Run',
        testRunType: 'REGULAR',
        isCompleted: false,
        createdAt: '2024-01-01T00:00:00Z',
      };

      // First call: get workflows
      mockFetch.mockResolvedValueOnce(zenStackResponse(mockWorkflows));
      // Second call: create test run
      mockFetch.mockResolvedValueOnce(zenStackResponse(mockTestRun));

      const result = await client.createTestRun({
        projectId: 1,
        name: 'Test Run',
      });

      expect(result).toEqual(mockTestRun);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // First call is to get workflows (GET with query param)
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('https://testplanit.example.com/api/model/workflows/findMany?q='),
        expect.objectContaining({
          method: 'GET',
        })
      );

      // Second call is to create test run (POST)
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://testplanit.example.com/api/model/testRuns/create',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer tpi_test_token',
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => JSON.stringify({ message: 'Invalid project ID' }),
      });

      await expect(
        client.createTestRun({ projectId: 999, name: 'Test' })
      ).rejects.toThrow(TestPlanItError);
    });
  });

  describe('getTestRun', () => {
    it('should get a test run by ID', async () => {
      const mockResponse = {
        id: 123,
        projectId: 1,
        name: 'Test Run',
        testRunType: 'REGULAR',
        isCompleted: false,
      };

      mockFetch.mockResolvedValueOnce(zenStackResponse(mockResponse));

      const result = await client.getTestRun(123);

      expect(result).toEqual(mockResponse);
      // Read operations use GET with query param
      const query = encodeURIComponent(JSON.stringify({ where: { id: 123 } }));
      expect(mockFetch).toHaveBeenCalledWith(
        `https://testplanit.example.com/api/model/testRuns/findUnique?q=${query}`,
        expect.objectContaining({
          method: 'GET',
        })
      );
    });
  });

  describe('completeTestRun', () => {
    it('should mark a test run as completed', async () => {
      const mockResponse = {
        id: 123,
        isCompleted: true,
      };

      mockFetch.mockResolvedValueOnce(zenStackResponse(mockResponse));

      const result = await client.completeTestRun(123);

      expect(result.isCompleted).toBe(true);
      // Update uses PATCH
      expect(mockFetch).toHaveBeenCalledWith(
        'https://testplanit.example.com/api/model/testRuns/update',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ where: { id: 123 }, data: { isCompleted: true } }),
        })
      );
    });
  });

  describe('getStatuses', () => {
    it('should fetch and cache statuses', async () => {
      const mockStatuses = [
        { id: 1, name: 'Passed', systemName: 'passed', isSuccess: true, isFailure: false, isCompleted: true },
        { id: 2, name: 'Failed', systemName: 'failed', isSuccess: false, isFailure: true, isCompleted: true },
      ];

      mockFetch.mockResolvedValueOnce(zenStackResponse(mockStatuses));

      // First call should fetch from API
      const result1 = await client.getStatuses(1);
      expect(result1).toEqual(mockStatuses);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const result2 = await client.getStatuses(1);
      expect(result2).toEqual(mockStatuses);
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('should clear cache when requested', async () => {
      const mockStatuses = [
        { id: 1, name: 'Passed', systemName: 'passed', isSuccess: true, isFailure: false, isCompleted: true },
      ];

      mockFetch.mockResolvedValue(zenStackResponse(mockStatuses));

      await client.getStatuses(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      client.clearStatusCache();

      await client.getStatuses(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getStatusId', () => {
    it('should return status ID for normalized status name', async () => {
      const mockStatuses = [
        { id: 1, name: 'Passed', systemName: 'passed', isSuccess: true, isFailure: false, isCompleted: true },
        { id: 2, name: 'Failed', systemName: 'failed', isSuccess: false, isFailure: true, isCompleted: true },
        { id: 3, name: 'Skipped', systemName: 'skipped', isSuccess: false, isFailure: false, isCompleted: true },
      ];

      mockFetch.mockResolvedValueOnce(zenStackResponse(mockStatuses));

      const passedId = await client.getStatusId(1, 'passed');
      expect(passedId).toBe(1);

      const failedId = await client.getStatusId(1, 'failed');
      expect(failedId).toBe(2);

      const skippedId = await client.getStatusId(1, 'skipped');
      expect(skippedId).toBe(3);
    });

    it('should match status aliases', async () => {
      const mockStatuses = [
        { id: 1, name: 'Pass', systemName: 'pass', aliases: 'passed,success', isSuccess: true, isFailure: false, isCompleted: true },
      ];

      mockFetch.mockResolvedValueOnce(zenStackResponse(mockStatuses));

      const statusId = await client.getStatusId(1, 'passed');
      expect(statusId).toBe(1);
    });

    it('should return undefined for unknown status', async () => {
      const mockStatuses = [
        { id: 1, name: 'Passed', systemName: 'passed', isSuccess: true, isFailure: false, isCompleted: true },
      ];

      mockFetch.mockResolvedValueOnce(zenStackResponse(mockStatuses));

      const statusId = await client.getStatusId(1, 'blocked');
      expect(statusId).toBeUndefined();
    });
  });

  describe('createTestResult', () => {
    it('should create a test result', async () => {
      const mockResponse = {
        id: 456,
        testRunId: 123,
        testRunCaseId: 789,
        statusId: 1,
        elapsed: 1500,
      };

      mockFetch.mockResolvedValueOnce(zenStackResponse(mockResponse));

      const result = await client.createTestResult({
        testRunId: 123,
        testRunCaseId: 789,
        statusId: 1,
        elapsed: 1500,
      });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://testplanit.example.com/api/model/testRunResults/create',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('findTestCases', () => {
    it('should find test cases with query parameters', async () => {
      const mockCases = [
        { id: 1, name: 'Test Case 1', className: 'TestSuite' },
        { id: 2, name: 'Test Case 2', className: 'TestSuite' },
      ];

      mockFetch.mockResolvedValueOnce(zenStackResponse(mockCases));

      const result = await client.findTestCases({
        projectId: 1,
        className: 'TestSuite',
      });

      expect(result).toEqual(mockCases);
      // findMany uses GET with query parameter per ZenStack REST API spec
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/api\/model\/repositoryCases\/findMany\?q=/),
        expect.objectContaining({
          method: 'GET',
        })
      );
    });
  });

  describe('addTestCaseToRun', () => {
    it('should add a test case to a run', async () => {
      const mockResponse = {
        id: 100,
        testRunId: 123,
        repositoryCaseId: 456,
      };

      mockFetch.mockResolvedValueOnce(zenStackResponse(mockResponse));

      const result = await client.addTestCaseToRun({
        testRunId: 123,
        repositoryCaseId: 456,
      });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://testplanit.example.com/api/model/testRunCases/create',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('lookup', () => {
    it('should look up entities by name', async () => {
      const mockResponse = { id: 10, name: 'Sprint 1' };

      mockFetch.mockResolvedValueOnce(jsonResponse(mockResponse));

      const result = await client.lookup({
        projectId: 1,
        type: 'milestone',
        name: 'Sprint 1',
      });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://testplanit.example.com/api/cli/lookup',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            projectId: 1,
            type: 'milestone',
            name: 'Sprint 1',
          }),
        })
      );
    });

    it('should support createIfMissing for tags', async () => {
      const mockResponse = { id: 5, name: 'automation', created: true };

      mockFetch.mockResolvedValueOnce(jsonResponse(mockResponse));

      const result = await client.lookup({
        type: 'tag',
        name: 'automation',
        createIfMissing: true,
      });

      expect(result).toEqual(mockResponse);
      expect(result.created).toBe(true);
    });
  });

  describe('testConnection', () => {
    it('should return true for successful connection', async () => {
      mockFetch.mockResolvedValueOnce(zenStackResponse([]));

      const result = await client.testConnection();
      expect(result).toBe(true);
    });

    it('should return false for failed connection', async () => {
      // Create client with no retries for this test
      const noRetryClient = new TestPlanItClient({
        baseUrl: 'https://testplanit.example.com',
        apiToken: 'tpi_test_token',
        maxRetries: 0,
        timeout: 100,
      });

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await noRetryClient.testConnection();
      expect(result).toBe(false);
    });
  });

  describe('retry logic', () => {
    it('should retry on server errors', async () => {
      const client = new TestPlanItClient({
        baseUrl: 'https://testplanit.example.com',
        apiToken: 'tpi_test_token',
        maxRetries: 2,
        retryDelay: 10, // Short delay for tests
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'Server Error',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'Server Error',
        })
        .mockResolvedValueOnce(zenStackResponse({ id: 1 }));

      const result = await client.getTestRun(1);
      expect(result).toEqual({ id: 1 });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should not retry on client errors (4xx except 429)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not found',
      });

      await expect(client.getTestRun(999)).rejects.toThrow(TestPlanItError);
      expect(mockFetch).toHaveBeenCalledTimes(1); // No retries
    });
  });

  describe('findOrAddTestCaseToRun', () => {
    it('should upsert a test case in a run', async () => {
      const mockResponse = {
        id: 100,
        testRunId: 123,
        repositoryCaseId: 456,
      };

      mockFetch.mockResolvedValueOnce(zenStackResponse(mockResponse));

      const result = await client.findOrAddTestCaseToRun({
        testRunId: 123,
        repositoryCaseId: 456,
      });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://testplanit.example.com/api/model/testRunCases/upsert',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('resolveTagIds', () => {
    it('should resolve numeric IDs directly', async () => {
      const result = await client.resolveTagIds(1, [1, 2, 3]);
      expect(result).toEqual([1, 2, 3]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should look up string names', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 10, name: 'tag1' }));
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 20, name: 'tag2' }));

      const result = await client.resolveTagIds(1, ['tag1', 'tag2']);
      expect(result).toEqual([10, 20]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle mixed numeric and string IDs', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 10, name: 'tag1' }));

      const result = await client.resolveTagIds(1, [1, 'tag1', 2]);
      expect(result).toEqual([1, 10, 2]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});

describe('importTestResults', () => {
  let client: TestPlanItClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new TestPlanItClient({
      baseUrl: 'https://testplanit.example.com',
      apiToken: 'tpi_test_token',
    });
  });

  // Helper to create a mock SSE ReadableStream
  const createSSEStream = (events: string[]) => {
    let index = 0;
    return {
      getReader: () => ({
        read: async () => {
          if (index >= events.length) {
            return { done: true, value: undefined };
          }
          const encoder = new TextEncoder();
          return { done: false, value: encoder.encode(events[index++]) };
        },
      }),
    };
  };

  const mockFile = new File(['<testsuites></testsuites>'], 'results.xml');

  it('should process SSE events and return testRunId', async () => {
    const sseEvents = [
      'data: {"progress":50}\n',
      'data: {"complete":true,"testRunId":123}\n',
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createSSEStream(sseEvents),
    });

    const onProgress = vi.fn();
    const result = await client.importTestResults(
      { files: [mockFile], projectId: 1 },
      onProgress
    );

    expect(result.testRunId).toBe(123);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, { progress: 50 });
    expect(onProgress).toHaveBeenNthCalledWith(2, { complete: true, testRunId: 123 });
  });

  it('should handle data split across multiple chunks', async () => {
    // Simulate data being split mid-line across chunks
    const sseEvents = [
      'data: {"prog',  // First chunk - incomplete line
      'ress":25}\ndata: {"complete":true,"testRunId":456}\n',  // Second chunk completes first line and adds another
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createSSEStream(sseEvents),
    });

    const onProgress = vi.fn();
    const result = await client.importTestResults(
      { files: [mockFile], projectId: 1 },
      onProgress
    );

    expect(result.testRunId).toBe(456);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, { progress: 25 });
  });

  it('should throw error for malformed JSON data', async () => {
    const sseEvents = [
      'data: {invalid json}\n',
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createSSEStream(sseEvents),
    });

    await expect(
      client.importTestResults({ files: [mockFile], projectId: 1 })
    ).rejects.toThrow(SyntaxError);
  });

  it('should throw TestPlanItError when event contains error', async () => {
    const sseEvents = [
      'data: {"error":"Import failed: invalid format"}\n',
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createSSEStream(sseEvents),
    });

    await expect(
      client.importTestResults({ files: [mockFile], projectId: 1 })
    ).rejects.toThrow(TestPlanItError);
  });

  it('should throw error if no testRunId is returned', async () => {
    const sseEvents = [
      'data: {"progress":100}\n',
      'data: {"complete":true}\n',  // Missing testRunId
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createSSEStream(sseEvents),
    });

    await expect(
      client.importTestResults({ files: [mockFile], projectId: 1 })
    ).rejects.toThrow('Import completed but no test run ID returned');
  });

  it('should handle remaining buffer data after stream ends', async () => {
    // Stream ends with data that doesn't have a trailing newline
    const sseEvents = [
      'data: {"complete":true,"testRunId":789}',  // No trailing newline
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createSSEStream(sseEvents),
    });

    const onProgress = vi.fn();
    const result = await client.importTestResults(
      { files: [mockFile], projectId: 1 },
      onProgress
    );

    expect(result.testRunId).toBe(789);
    expect(onProgress).toHaveBeenCalledWith({ complete: true, testRunId: 789 });
  });

  it('should throw error for HTTP errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad request',
    });

    await expect(
      client.importTestResults({ files: [mockFile], projectId: 1 })
    ).rejects.toThrow(TestPlanItError);
  });

  it('should throw error if response has no body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: null,
    });

    await expect(
      client.importTestResults({ files: [mockFile], projectId: 1 })
    ).rejects.toThrow('No response body');
  });
});

describe('TestPlanItError', () => {
  it('should create error with message', () => {
    const error = new TestPlanItError('Test error');
    expect(error.message).toBe('Test error');
    expect(error.name).toBe('TestPlanItError');
  });

  it('should include status code and details', () => {
    const error = new TestPlanItError('Not found', {
      statusCode: 404,
      details: { resource: 'test-run' },
    });
    expect(error.statusCode).toBe(404);
    expect(error.details).toEqual({ resource: 'test-run' });
  });
});
