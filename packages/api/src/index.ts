/**
 * @testplanit/api - Official JavaScript/TypeScript API client for TestPlanIt
 *
 * @example
 * ```typescript
 * import { TestPlanItClient } from '@testplanit/api';
 *
 * const client = new TestPlanItClient({
 *   baseUrl: 'https://testplanit.example.com',
 *   apiToken: 'tpi_your_token_here',
 * });
 *
 * // Create a test run
 * const testRun = await client.createTestRun({
 *   projectId: 1,
 *   name: 'Automated Test Run',
 * });
 *
 * // Add results
 * const statusId = await client.getStatusId(1, 'passed');
 * await client.createTestResult({
 *   testRunId: testRun.id,
 *   testRunCaseId: 123,
 *   statusId: statusId!,
 *   elapsed: 1500,
 * });
 * ```
 *
 * @packageDocumentation
 */

export { TestPlanItClient, TestPlanItError } from './client.js';

export type {
  // Config
  TestPlanItClientConfig,
  ApiError,

  // Enums
  TestRunType,
  RepositoryCaseSource,
  NormalizedStatus,

  // Models
  Status,
  Project,
  Configuration,
  Milestone,
  WorkflowState,
  RepositoryFolder,
  Template,
  Tag,
  TestRun,
  RepositoryCase,
  TestRunCase,
  TestRunResult,
  TestRunStepResult,
  Attachment,

  // Request/Response types
  CreateTestRunOptions,
  UpdateTestRunOptions,
  CreateTestCaseOptions,
  CreateTagOptions,
  AddTestCaseToRunOptions,
  CreateTestResultOptions,
  ListTestRunsOptions,
  PaginatedResponse,
  FindTestCaseOptions,
  ImportTestResultsOptions,
  ImportProgressEvent,
} from './types.js';
