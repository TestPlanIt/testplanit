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

export {
  TestPlanItClient,
  TestPlanItError,
  isUniqueConstraintViolation,
} from './client.js';

// Shared plain-text → TipTap-JSON helper and the automation-step mapper.
export { tipTapDoc } from './tipTapDoc.js';
export { automationStepsToCaseSteps, deriveCaseStepsIfFresh } from './mapper.js';

// Run-level metadata helpers (TipTap docs field rendering/parsing).
export {
  mergeRunMetadataIntoDoc,
  parseRunMetadataFromDoc,
} from './runMetadata.js';
export type { RunMetadata, RunMetadataValue } from './runMetadata.js';

export type {
  // Config
  TestPlanItClientConfig,
  ApiError,

  // Enums
  TestRunType,
  RepositoryCaseSource,
  NormalizedStatus,
  JUnitResultType,

  // Core Models
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
  Step,
  TestRunCase,
  TestRunResult,
  TestRunStepResult,
  Attachment,
  User,
  Comment,
  Issue,

  // JUnit Models
  JUnitTestSuite,
  JUnitTestResult,
  JUnitProperty,
  JUnitTestStep,

  // Request/Response types
  CreateTestRunOptions,
  UpdateTestRunOptions,
  CreateTestCaseOptions,
  UpdateTestCaseOptions,
  CreateTestCasesOptions,
  CreateTestCasesResult,
  BulkTestCaseInput,
  BulkTestCaseStep,
  BulkTestCaseResult,
  CreateStepOptions,
  CreateStepsOptions,
  RequestStepDerivationOptions,
  RequestStepDerivationCase,
  AutomationStep,
  CaseStepRow,
  CreateTagOptions,
  CreateFolderOptions,
  AddTestCaseToRunOptions,
  CreateTestResultOptions,
  CreateJUnitTestSuiteOptions,
  CreateJUnitTestResultOptions,
  UpdateJUnitTestSuiteOptions,
  CreateJUnitPropertyOptions,
  CreateJUnitTestStepOptions,
  UploadAttachmentOptions,
  ListTestRunsOptions,
  PaginatedResponse,
  FindTestCaseOptions,
  FindTestCaseByCustomFieldOptions,
  FindOrCreateTestCaseResult,
  ImportTestResultsOptions,
  ImportProgressEvent,
} from './types.js';
