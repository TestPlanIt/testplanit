import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TestPlanItClient,
  TestPlanItError,
  isUniqueConstraintViolation,
} from './client.js';

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
      const mockWorkflows = [{ id: 10, name: 'Done', scope: 'RUNS', workflowType: 'DONE' }];
      const mockResponse = {
        id: 123,
        isCompleted: true,
      };

      // First call: get workflows to find DONE state
      mockFetch.mockResolvedValueOnce(zenStackResponse(mockWorkflows));
      // Second call: update test run
      mockFetch.mockResolvedValueOnce(zenStackResponse(mockResponse));

      const result = await client.completeTestRun(123, 1);

      expect(result.isCompleted).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // First call is to get workflows
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('https://testplanit.example.com/api/model/workflows/findMany?q='),
        expect.objectContaining({
          method: 'GET',
        })
      );

      // Second call is to update test run (PATCH)
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://testplanit.example.com/api/model/testRuns/update',
        expect.objectContaining({
          method: 'PATCH',
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

  describe('findTestCaseByCustomField', () => {
    // Decode the ZenStack `?q=` payload back into the query object so tests can
    // assert on the generated `where` clause.
    const decodeQuery = (url: string) =>
      JSON.parse(decodeURIComponent(url.split('q=')[1]));

    it('matches by field display name and both value forms, returning the first case', async () => {
      const mockCase = { id: 30715, name: "Verify 'Relevance' is the default sort order", source: 'MANUAL' };
      mockFetch.mockResolvedValueOnce(zenStackResponse([mockCase]));

      const result = await client.findTestCaseByCustomField({
        projectId: 1,
        fieldName: 'External ID',
        value: 89434,
      });

      expect(result).toEqual(mockCase);
      // findMany uses GET with the query param per ZenStack REST API spec
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/api\/model\/repositoryCases\/findMany\?q=/),
        expect.objectContaining({ method: 'GET' })
      );

      const query = decodeQuery(mockFetch.mock.calls[0][0]);
      expect(query.where.projectId).toBe(1);
      expect(query.where.isDeleted).toBe(false);
      expect(query.where.caseFieldValues.some.field).toEqual({ displayName: 'External ID' });
      // Numeric input matches both the JSON number and string forms.
      expect(query.where.caseFieldValues.some.OR).toEqual([
        { value: { equals: '89434' } },
        { value: { equals: 89434 } },
      ]);
      expect(query.take).toBe(1);
    });

    it('adds the numeric variant for a numeric string value', async () => {
      mockFetch.mockResolvedValueOnce(zenStackResponse([]));

      await client.findTestCaseByCustomField({
        projectId: 2,
        fieldName: 'External ID',
        value: '89434',
      });

      const query = decodeQuery(mockFetch.mock.calls[0][0]);
      expect(query.where.caseFieldValues.some.OR).toEqual([
        { value: { equals: '89434' } },
        { value: { equals: 89434 } },
      ]);
    });

    it('uses only the string variant for a non-numeric value', async () => {
      mockFetch.mockResolvedValueOnce(zenStackResponse([]));

      await client.findTestCaseByCustomField({
        projectId: 3,
        fieldName: 'Legacy Key',
        value: 'TM-89434',
      });

      const query = decodeQuery(mockFetch.mock.calls[0][0]);
      expect(query.where.caseFieldValues.some.OR).toEqual([
        { value: { equals: 'TM-89434' } },
      ]);
    });

    it('returns undefined when no case matches (e.g. the field does not exist)', async () => {
      mockFetch.mockResolvedValueOnce(zenStackResponse([]));

      const result = await client.findTestCaseByCustomField({
        projectId: 1,
        fieldName: 'Nonexistent Field',
        value: 89434,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('updateTestCase', () => {
    it('PATCHes only the provided scalar fields', async () => {
      const updated = { id: 30715, automated: true };
      mockFetch.mockResolvedValueOnce(zenStackResponse(updated));

      const result = await client.updateTestCase(30715, { automated: true });

      expect(result).toEqual(updated);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://testplanit.example.com/api/model/repositoryCases/update',
        expect.objectContaining({ method: 'PATCH' })
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({ where: { id: 30715 }, data: { automated: true } });
    });

    it('omits undefined fields from the update payload', async () => {
      mockFetch.mockResolvedValueOnce(zenStackResponse({ id: 5 }));

      await client.updateTestCase(5, { automated: undefined });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.data).toEqual({});
    });
  });

  describe('findOrCreateTestCase found-flip', () => {
    // findOrCreateTestCase first does a findMany; the returned rows carry a
    // `folder.isDeleted` flag and the case's `automated` value.
    const foundRows = (automated: boolean) =>
      zenStackResponse([
        { id: 42, name: 'T', className: '', source: 'API', automated, folder: { isDeleted: false } },
      ]);
    const baseOpts = {
      projectId: 1,
      folderId: 10,
      templateId: 1,
      name: 'T',
      automated: true,
    };

    it('flips an existing non-automated case to automated on found', async () => {
      mockFetch.mockResolvedValueOnce(foundRows(false)); // findMany
      mockFetch.mockResolvedValueOnce(zenStackResponse({ id: 42, automated: true })); // update

      const { testCase, action } = await client.findOrCreateTestCase(baseOpts);

      expect(action).toBe('found');
      expect(testCase.automated).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      // Second call is the automated flip.
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://testplanit.example.com/api/model/repositoryCases/update',
        expect.objectContaining({ method: 'PATCH' })
      );
      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body).toEqual({ where: { id: 42 }, data: { automated: true } });
    });

    it('does not write when the found case is already automated', async () => {
      mockFetch.mockResolvedValueOnce(foundRows(true)); // findMany only

      const { action } = await client.findOrCreateTestCase(baseOpts);

      expect(action).toBe('found');
      // Only the findMany ran — no update call.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not flip when automated is explicitly false', async () => {
      mockFetch.mockResolvedValueOnce(foundRows(false));

      await client.findOrCreateTestCase({ ...baseOpts, automated: false });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('createStep', () => {
    it('wraps the step text in a TipTap doc and posts to the steps model', async () => {
      mockFetch.mockResolvedValueOnce(zenStackResponse({ id: 7, testCaseId: 42, order: 0 }));

      const result = await client.createStep({ testCaseId: 42, step: 'Click login', order: 0 });

      expect(result).toEqual({ id: 7, testCaseId: 42, order: 0 });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://testplanit.example.com/api/model/steps/create',
        expect.objectContaining({ method: 'POST' })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.data.testCase).toEqual({ connect: { id: 42 } });
      expect(body.data.order).toBe(0);
      // step is a stringified TipTap document
      expect(JSON.parse(body.data.step)).toEqual({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Click login' }] }],
      });
      // expectedResult omitted when not provided
      expect(body.data.expectedResult).toBeUndefined();
    });

    it('includes expectedResult when provided', async () => {
      mockFetch.mockResolvedValueOnce(zenStackResponse({ id: 8 }));

      await client.createStep({ testCaseId: 42, step: 'Act', expectedResult: 'Outcome', order: 1 });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(JSON.parse(body.data.expectedResult)).toEqual({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Outcome' }] }],
      });
    });
  });

  describe('softDeleteCaseSteps', () => {
    it('soft-deletes a case\'s active steps via updateMany and returns the count', async () => {
      mockFetch.mockResolvedValueOnce(zenStackResponse({ count: 4 }));

      const count = await client.softDeleteCaseSteps(42);

      expect(count).toBe(4);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://testplanit.example.com/api/model/steps/updateMany',
        expect.objectContaining({ method: 'PATCH' })
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.where).toEqual({ testCaseId: 42, isDeleted: false });
      expect(body.data).toEqual({ isDeleted: true });
    });
  });

  describe('createSteps', () => {
    it('batches steps into one createMany with scalar testCaseId + TipTap docs', async () => {
      mockFetch.mockResolvedValueOnce(zenStackResponse({ count: 2 }));

      const result = await client.createSteps({
        testCaseId: 42,
        steps: [
          { step: 'First', order: 0 },
          { step: 'Second', order: 1 },
        ],
      });

      expect(result).toEqual({ count: 2 });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://testplanit.example.com/api/model/steps/createMany',
        expect.objectContaining({ method: 'POST' })
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(2);
      // createMany requires scalar FK (no nested connect)
      expect(body.data[0].testCaseId).toBe(42);
      expect(body.data[0].order).toBe(0);
      expect(JSON.parse(body.data[0].step)).toEqual({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }],
      });
    });
  });

  describe('createTestCases (bulk)', () => {
    it('POSTs the batch to the bulk-create endpoint and returns per-case results', async () => {
      const mockResult = {
        success: true,
        importedCount: 2,
        failedCount: 0,
        results: [
          { id: '0', name: 'A', status: 'success', caseId: 101 },
          { id: '1', name: 'B', status: 'success', caseId: 102 },
        ],
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(mockResult));

      const result = await client.createTestCases({
        projectId: 7,
        folderId: 12,
        templateId: 55,
        cases: [
          { name: 'A', steps: [{ text: 'do x', expectedResult: 'y' }], tags: [4, 'Regression'] },
          { name: 'B', customFields: { Priority: 'High' } },
        ],
      });

      expect(result).toEqual(mockResult);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, init] = mockFetch.mock.calls[0];
      // projectId is carried in the URL path, never the body.
      expect(url).toBe(
        'https://testplanit.example.com/api/projects/7/cases/bulk-create'
      );
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer tpi_test_token',
          'Content-Type': 'application/json',
        })
      );
      const body = JSON.parse(init.body);
      expect(body).not.toHaveProperty('projectId');
      expect(body).toMatchObject({
        folderId: 12,
        templateId: 55,
        cases: [
          { name: 'A', steps: [{ text: 'do x', expectedResult: 'y' }], tags: [4, 'Regression'] },
          { name: 'B', customFields: { Priority: 'High' } },
        ],
      });
    });

    it('surfaces partial failures in the per-case results array', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          success: true,
          importedCount: 1,
          failedCount: 1,
          results: [
            { id: '0', name: 'ok', status: 'success', caseId: 5 },
            {
              id: '1',
              name: 'bad',
              status: 'error',
              error: 'Custom field(s) not part of template "Default": Phantom.',
            },
          ],
        })
      );

      const result = await client.createTestCases({
        projectId: 7,
        folderId: 12,
        cases: [{ name: 'ok' }, { name: 'bad', customFields: { Phantom: 'x' } }],
      });

      expect(result.importedCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.results[1].status).toBe('error');
      expect(result.results[1].error).toContain('Phantom');
    });

    it('omits templateId/stateName from the body when not provided', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ success: true, importedCount: 1, failedCount: 0, results: [] })
      );

      await client.createTestCases({
        projectId: 7,
        folderId: 12,
        cases: [{ name: 'A' }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({ folderId: 12, cases: [{ name: 'A' }] });
    });

    it('throws TestPlanItError on a non-2xx response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({
            error: 'Template 99 is not an enabled template assigned to project 7.',
          }),
      });

      await expect(
        client.createTestCases({
          projectId: 7,
          folderId: 12,
          templateId: 99,
          cases: [{ name: 'A' }],
        })
      ).rejects.toThrow(TestPlanItError);
    });
  });

  describe('429 rate-limit handling', () => {
    it('honors Retry-After and retries the request', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: { get: (h: string) => (h.toLowerCase() === 'retry-after' ? '0' : null) },
          text: async () => 'rate limited',
        })
        .mockResolvedValueOnce(zenStackResponse({ id: 7, name: 'After backoff' }));

      const result = await client.getProject(1);

      expect(result).toEqual({ id: 7, name: 'After backoff' });
      expect(mockFetch).toHaveBeenCalledTimes(2);
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

describe('run-level attachments and metadata', () => {
  let client: TestPlanItClient;
  const mockFetchRef = global.fetch as ReturnType<typeof vi.fn>;

  const zenResponse = (data: unknown) => ({
    ok: true,
    text: async () => JSON.stringify({ data }),
  });

  beforeEach(() => {
    mockFetchRef.mockReset();
    client = new TestPlanItClient({
      baseUrl: 'https://testplanit.example.com',
      apiToken: 'tpi_test_token',
    });
  });

  describe('addTestRunLink', () => {
    it('creates a text/uri-list attachment connected to the run', async () => {
      const mockAttachment = { id: 1, name: 'CI Build', url: 'https://ci.example.com/42' };
      mockFetchRef.mockResolvedValueOnce(zenResponse(mockAttachment));

      const result = await client.addTestRunLink(7, 'https://ci.example.com/42', 'CI Build');

      expect(result).toEqual(mockAttachment);
      expect(mockFetchRef).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetchRef.mock.calls[0];
      expect(url).toBe('https://testplanit.example.com/api/model/attachments/create');
      expect(JSON.parse(options.body)).toEqual({
        data: {
          url: 'https://ci.example.com/42',
          name: 'CI Build',
          mimeType: 'text/uri-list',
          size: 0,
          testRuns: { connect: { id: 7 } },
        },
      });
    });

    it('defaults the name to the url and passes a note through', async () => {
      mockFetchRef.mockResolvedValueOnce(zenResponse({ id: 2 }));

      await client.addTestRunLink(7, 'https://ci.example.com/42', undefined, 'nightly');

      const body = JSON.parse(mockFetchRef.mock.calls[0][1].body);
      expect(body.data.name).toBe('https://ci.example.com/42');
      expect(body.data.note).toBe('nightly');
    });

    it('rejects an empty url', async () => {
      await expect(client.addTestRunLink(7, '  ')).rejects.toThrow('url is required');
      expect(mockFetchRef).not.toHaveBeenCalled();
    });
  });

  describe('uploadTestRunAttachment', () => {
    it('uploads the file then creates an attachment connected to the run', async () => {
      // Upload endpoint response
      mockFetchRef.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({ success: { url: '/api/storage/run_7/report.html', key: 'k' } }),
      });
      const mockAttachment = { id: 3, name: 'report.html' };
      mockFetchRef.mockResolvedValueOnce(zenResponse(mockAttachment));

      const buffer = Buffer.from('<html></html>');
      const result = await client.uploadTestRunAttachment(7, buffer, 'report.html', 'text/html');

      expect(result).toEqual(mockAttachment);
      expect(mockFetchRef.mock.calls[0][0]).toBe(
        'https://testplanit.example.com/api/upload-attachment'
      );
      const createBody = JSON.parse(mockFetchRef.mock.calls[1][1].body);
      expect(createBody).toEqual({
        data: {
          url: '/api/storage/run_7/report.html',
          name: 'report.html',
          mimeType: 'text/html',
          size: buffer.length,
          testRuns: { connect: { id: 7 } },
        },
      });
    });
  });

  describe('setTestRunMetadata', () => {
    it('merges metadata into the run docs and updates the run', async () => {
      // getTestRun
      mockFetchRef.mockResolvedValueOnce(zenResponse({ id: 7, docs: null }));
      // updateTestRun
      mockFetchRef.mockResolvedValueOnce(zenResponse({ id: 7 }));

      await client.setTestRunMetadata(7, { version: '1.2.3', ci: true });

      const [updateUrl, updateOptions] = mockFetchRef.mock.calls[1];
      expect(updateUrl).toBe('https://testplanit.example.com/api/model/testRuns/update');
      expect(updateOptions.method).toBe('PATCH');
      const body = JSON.parse(updateOptions.body);
      expect(body.where).toEqual({ id: 7 });
      expect(body.data.docs).toEqual({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'version: ' },
              { type: 'text', text: '1.2.3' },
            ],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'ci: ' },
              { type: 'text', text: 'true' },
            ],
          },
        ],
      });
    });

    it('updates existing keys without duplicating them', async () => {
      const existingDocs = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'version: ' },
              { type: 'text', text: '1.0.0' },
            ],
          },
        ],
      };
      mockFetchRef.mockResolvedValueOnce(zenResponse({ id: 7, docs: existingDocs }));
      mockFetchRef.mockResolvedValueOnce(zenResponse({ id: 7 }));

      await client.setTestRunMetadata(7, { version: '2.0.0' });

      const body = JSON.parse(mockFetchRef.mock.calls[1][1].body);
      expect(body.data.docs.content).toHaveLength(1);
      expect(body.data.docs.content[0].content[1].text).toBe('2.0.0');
    });

    it('throws when the run does not exist', async () => {
      mockFetchRef.mockResolvedValueOnce(zenResponse(null));
      await expect(client.setTestRunMetadata(999, { a: 'b' })).rejects.toThrow(
        'Test run 999 not found'
      );
    });
  });

  describe('getTestRunMetadata', () => {
    it('parses metadata written by setTestRunMetadata', async () => {
      const docs = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'version: ' },
              { type: 'text', text: '1.2.3' },
            ],
          },
        ],
      };
      mockFetchRef.mockResolvedValueOnce(zenResponse({ id: 7, docs }));

      await expect(client.getTestRunMetadata(7)).resolves.toEqual({ version: '1.2.3' });
    });
  });
});

describe('isUniqueConstraintViolation', () => {
  it('matches the Postgres phrasing', () => {
    const error = new TestPlanItError(
      'duplicate key value violates unique constraint "RepositoryFolders_projectId_repositoryId_parentId_name_isDe_key"',
      { statusCode: 400 },
    );
    expect(isUniqueConstraintViolation(error)).toBe(true);
  });

  it('matches the Prisma phrasing', () => {
    const error = new TestPlanItError(
      'Unique constraint failed on the fields: (`projectId`,`repositoryId`,`parentId`,`name`,`isDeleted`)',
    );
    expect(isUniqueConstraintViolation(error)).toBe(true);
  });

  it('matches SQLSTATE 23505 in the error body regardless of message', () => {
    const error = new TestPlanItError('Error occurred while executing the query', {
      statusCode: 400,
      details: {
        error: { message: 'anything', reason: 'db-query-error', dbErrorCode: '23505' },
      },
    });
    expect(isUniqueConstraintViolation(error)).toBe(true);
  });

  it('matches a Prisma P2002 code', () => {
    const error = new TestPlanItError('some message', { code: 'P2002' });
    expect(isUniqueConstraintViolation(error)).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isUniqueConstraintViolation(new TestPlanItError('Not found', { statusCode: 404 }))).toBe(false);
    expect(
      isUniqueConstraintViolation(
        new TestPlanItError('db error', {
          statusCode: 400,
          details: { error: { dbErrorCode: '23503' } },
        }),
      ),
    ).toBe(false);
    expect(isUniqueConstraintViolation(new Error('duplicate key value violates unique constraint'))).toBe(false);
  });
});

describe('findOrCreateFolderPath concurrency', () => {
  const mockFetchRef = global.fetch as ReturnType<typeof vi.fn>;

  const makeClient = () =>
    new TestPlanItClient({
      baseUrl: 'https://testplanit.example.com',
      apiToken: 'tpi_test_token',
    });

  /**
   * In-memory folder store that enforces the (parentId, name) unique
   * constraint the way the real API does, so tests can race real creates.
   */
  const makeFolderStub = (violationBody: () => string) => {
    const folders: Array<{ id: number; name: string; parentId: number | null; projectId: number }> = [];
    const createCalls: string[] = [];
    let nextId = 1;
    const key = (name: string, parentId: number | null) => `${name}:${parentId ?? 'root'}`;

    mockFetchRef.mockImplementation(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/api/model/repositoryFolders/findMany')) {
        return { ok: true, text: async () => JSON.stringify({ data: [...folders] }) };
      }
      if (u.includes('/api/model/repositories/findMany')) {
        return { ok: true, text: async () => JSON.stringify({ data: [{ id: 7 }] }) };
      }
      if (u.includes('/api/model/repositoryFolders/create')) {
        const body = JSON.parse(String(init?.body));
        const name = body.data.name as string;
        const parentId = (body.data.parent?.connect?.id as number | undefined) ?? null;
        createCalls.push(key(name, parentId));
        if (folders.some((f) => key(f.name, f.parentId) === key(name, parentId))) {
          return {
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            text: async () => violationBody(),
          };
        }
        const folder = { id: nextId++, name, parentId, projectId: 1 };
        folders.push(folder);
        return { ok: true, text: async () => JSON.stringify({ data: folder }) };
      }
      throw new Error(`unexpected fetch: ${u}`);
    });

    return { folders, createCalls };
  };

  const postgresViolation = () =>
    JSON.stringify({
      error: {
        message:
          'duplicate key value violates unique constraint "RepositoryFolders_projectId_repositoryId_parentId_name_isDe_key"',
        reason: 'db-query-error',
        dbErrorCode: '23505',
      },
    });

  const prismaViolation = () =>
    JSON.stringify({
      error: {
        message:
          'Unique constraint failed on the fields: (`projectId`,`repositoryId`,`parentId`,`name`,`isDeleted`)',
      },
    });

  beforeEach(() => {
    mockFetchRef.mockReset();
  });

  it.each([
    ['Postgres', postgresViolation],
    ['Prisma', prismaViolation],
  ])('recovers when another process already created the folder (%s phrasing)', async (_label, violation) => {
    const { folders } = makeFolderStub(violation);
    // Simulate the losing side of a cross-process race: the folder appears in
    // the store after this client listed folders (empty) but before it creates.
    const client = makeClient();
    folders.push({ id: 99, name: 'A', parentId: null, projectId: 1 });
    mockFetchRef.mockImplementationOnce(async () =>
      ({ ok: true, text: async () => JSON.stringify({ data: [] }) }));

    const folder = await client.findOrCreateFolderPath(1, ['A']);
    expect(folder.id).toBe(99);
  });

  it('shares one create per folder across concurrent sibling paths', async () => {
    const { createCalls } = makeFolderStub(postgresViolation);
    const client = makeClient();

    const [b, c, d] = await Promise.all([
      client.findOrCreateFolderPath(1, ['A', 'B']),
      client.findOrCreateFolderPath(1, ['A', 'C']),
      client.findOrCreateFolderPath(1, ['A', 'D']),
    ]);

    // One create for the shared ancestor, one per leaf, no rejections.
    expect(createCalls.filter((k) => k === 'A:root')).toHaveLength(1);
    expect(new Set([b.name, c.name, d.name])).toEqual(new Set(['B', 'C', 'D']));
    const parentIds = new Set([b.parentId, c.parentId, d.parentId]);
    expect(parentIds.size).toBe(1);
  });

  it('survives a cross-process race: two clients, same paths, no lost result', async () => {
    const { createCalls, folders } = makeFolderStub(postgresViolation);
    // Two separate client instances (e.g. wdio's one-reporter-per-worker) — no
    // shared memoization, so both try to create "A" and one loses the race.
    const clientA = makeClient();
    const clientB = makeClient();

    const [left, right] = await Promise.all([
      clientA.findOrCreateFolderPath(1, ['A', 'B']),
      clientB.findOrCreateFolderPath(1, ['A', 'C']),
    ]);

    expect(left.name).toBe('B');
    expect(right.name).toBe('C');
    // Both clients attempted "A" but only one row exists.
    expect(createCalls.filter((k) => k === 'A:root').length).toBeGreaterThanOrEqual(1);
    expect(folders.filter((f) => f.name === 'A')).toHaveLength(1);
  });

  it('does not poison the memo when a create fails transiently', async () => {
    const client = new TestPlanItClient({
      baseUrl: 'https://testplanit.example.com',
      apiToken: 'tpi_test_token',
      maxRetries: 0,
    });
    // listFolders → empty; create → 500; retries exhausted inside request()
    mockFetchRef.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/repositoryFolders/findMany')) {
        return { ok: true, text: async () => JSON.stringify({ data: [] }) };
      }
      if (u.includes('/repositories/findMany')) {
        return { ok: true, text: async () => JSON.stringify({ data: [{ id: 7 }] }) };
      }
      return { ok: false, status: 500, statusText: 'Internal Server Error', text: async () => 'boom' };
    });

    await expect(client.findOrCreateFolderPath(1, ['A'])).rejects.toThrow();

    // Second attempt succeeds once the server recovers.
    const { folders } = makeFolderStub(postgresViolation);
    void folders;
    await expect(client.findOrCreateFolderPath(1, ['A'])).resolves.toMatchObject({ name: 'A' });
  });
});
