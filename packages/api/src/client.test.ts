import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestPlanItClient, TestPlanItError } from './client.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

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
      const mockResponse = {
        id: 123,
        projectId: 1,
        name: 'Test Run',
        testRunType: 'REGULAR',
        isCompleted: false,
        createdAt: '2024-01-01T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockResponse),
      });

      const result = await client.createTestRun({
        projectId: 1,
        name: 'Test Run',
      });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://testplanit.example.com/api/test-runs',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer tpi_test_token',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            projectId: 1,
            name: 'Test Run',
            testRunType: 'REGULAR',
            configId: undefined,
            milestoneId: undefined,
            stateId: undefined,
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockResponse),
      });

      const result = await client.getTestRun(123);

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://testplanit.example.com/api/test-runs/123',
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockResponse),
      });

      const result = await client.completeTestRun(123);

      expect(result.isCompleted).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://testplanit.example.com/api/test-runs/123',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ isCompleted: true }),
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockStatuses),
      });

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

      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify(mockStatuses),
      });

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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockStatuses),
      });

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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockStatuses),
      });

      const statusId = await client.getStatusId(1, 'passed');
      expect(statusId).toBe(1);
    });

    it('should return undefined for unknown status', async () => {
      const mockStatuses = [
        { id: 1, name: 'Passed', systemName: 'passed', isSuccess: true, isFailure: false, isCompleted: true },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockStatuses),
      });

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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockResponse),
      });

      const result = await client.createTestResult({
        testRunId: 123,
        testRunCaseId: 789,
        statusId: 1,
        elapsed: 1500,
      });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://testplanit.example.com/api/test-run-results',
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockCases),
      });

      const result = await client.findTestCases({
        projectId: 1,
        className: 'TestSuite',
      });

      expect(result).toEqual(mockCases);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('projectId=1'),
        expect.anything()
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('className=TestSuite'),
        expect.anything()
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockResponse),
      });

      const result = await client.addTestCaseToRun({
        testRunId: 123,
        repositoryCaseId: 456,
      });

      expect(result).toEqual(mockResponse);
    });
  });

  describe('testConnection', () => {
    it('should return true for successful connection', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ status: 'ok' }),
      });

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
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ id: 1 }),
        });

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
