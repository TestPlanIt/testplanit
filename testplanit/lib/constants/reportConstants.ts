// Report constants refactored to use next-intl translation keys
// All components now use metric IDs with getMetricHelpKey() helper function

// Standardized metric naming map - single source of truth
// Maps all possible metric keys (including duplicates) to their canonical metric ID
export const METRIC_ID_MAP: Record<string, string> = {
  // Test execution metrics - canonical IDs
  testResults: "testResults",
  testResultCount: "testResults", // maps to testResults
  passRate: "passRate",
  avgElapsedTime: "avgElapsedTime",
  avgElapsed: "avgElapsedTime", // maps to avgElapsedTime
  averageElapsed: "avgElapsedTime", // maps to avgElapsedTime
  totalElapsedTime: "totalElapsedTime",
  sumElapsed: "totalElapsedTime", // maps to totalElapsedTime
  executionCount: "executionCount",

  // Repository metrics - canonical IDs
  testCaseCount: "testCaseCount",
  testRunCount: "testRunCount",
  automationRate: "automationRate",
  averageSteps: "averageSteps",
  avgStepsPerCase: "averageSteps", // maps to averageSteps
  automatedCount: "automatedCount",
  manualCount: "manualCount",
  totalSteps: "totalSteps",
  createdCaseCount: "createdCaseCount",

  // Session metrics - canonical IDs
  sessionResultCount: "sessionResultCount",
  sessionCount: "sessionCount",
  activeSessions: "activeSessions",
  averageTimeSpent: "averageTimeSpent",
  sessionParticipation: "sessionParticipation",

  // User engagement metrics - canonical IDs
  lastActiveDate: "lastActiveDate",
  averageAge: "averageAge",

  // Issue tracking metrics - canonical IDs
  issueCount: "issueCount",

  // Project health metrics - canonical IDs
  milestoneCount: "milestoneCount",
  milestoneCompletionRate: "milestoneCompletionRate",
  averageMilestoneDuration: "averageMilestoneDuration",
};

// Map metric translation keys to help keys for help tooltips
// Uses canonical metric IDs only
export const METRIC_HELP_KEYS: Record<string, string> = {
  // Test execution metrics
  "reports.metrics.testResults": "reportMetrics.count",
  "reports.metrics.passRate": "reportMetrics.passRate",
  "reports.metrics.avgElapsedTime": "reportMetrics.avgElapsed",
  "reports.metrics.totalElapsedTime": "reportMetrics.sumElapsed",
  "reports.metrics.executionCount": "reportMetrics.executionCount",

  // Repository metrics
  "reports.metrics.testCaseCount": "reportMetrics.testCaseCount",
  "reports.metrics.testRunCount": "reportMetrics.testRunCount",
  "reports.metrics.automationRate": "reportMetrics.automationRate",
  "reports.metrics.averageSteps": "reportMetrics.averageSteps",
  "reports.metrics.automatedCount": "reportMetrics.automatedCount",
  "reports.metrics.manualCount": "reportMetrics.manualCount",
  "reports.metrics.totalSteps": "reportMetrics.totalSteps",
  "reports.metrics.createdCaseCount": "reportMetrics.createdCaseCount",

  // Session metrics
  "reports.metrics.sessionResultCount": "reportMetrics.sessionResultCount",
  "reports.metrics.sessionCount": "reportMetrics.sessionCount",
  "reports.metrics.activeSessions": "reportMetrics.activeSessions",
  "reports.metrics.averageTimeSpent": "reportMetrics.averageTimeSpent",
  "reports.metrics.sessionParticipation": "reportMetrics.sessionParticipation",

  // User engagement metrics
  "reports.metrics.lastActiveDate": "reportMetrics.lastActiveDate",
  "reports.metrics.averageAge": "reportMetrics.averageAge",

  // Issue tracking metrics
  "reports.metrics.issueCount": "reportMetrics.issueCount",

  // Project health metrics
  "reports.metrics.milestoneCount": "reportMetrics.milestoneCount",
  "reports.metrics.milestoneCompletionRate":
    "reportMetrics.milestoneCompletionRate",
  "reports.metrics.averageMilestoneDuration":
    "reportMetrics.averageMilestoneDuration",

  // Legacy mappings for backward compatibility
  "Test Results Count": "reportMetrics.count",
  "Test Cases": "reportMetrics.testCaseCount",
  "Test Executions": "reportMetrics.executionCount",
  "Test Runs": "reportMetrics.testRunCount",
  "Executed Test Cases": "reportMetrics.testCaseCount",
  "Pass Rate (%)": "reportMetrics.passRate",
  "Avg. Elapsed Time": "reportMetrics.avgElapsed",
  "Total Elapsed Time": "reportMetrics.sumElapsed",
  "Issue Count": "reportMetrics.issueCount",
  "Automation Rate (%)": "reportMetrics.automationRate",
  "Average Steps per Case": "reportMetrics.averageSteps",
  "Created Cases": "reportMetrics.createdCaseCount",
  "Session Results": "reportMetrics.sessionResultCount",
  "Active Sessions": "reportMetrics.activeSessions",
  "Milestone Completion (%)": "reportMetrics.milestoneCompletion",
  "Average Duration": "reportMetrics.averageTimeSpent",
  "Total Duration": "reportMetrics.totalElapsedTime",
  "Last Active Date": "reportMetrics.lastActiveDate",
  "Average Time per Execution (seconds)": "reportMetrics.avgElapsed",
};

// Map dimension value to API keys for ID and label
export const DIMENSION_ID_KEYS: Record<string, string> = {
  user: "userId",
  status: "statusId",
  project: "projectId",
  testRun: "testRunId",
  testCase: "testCaseId",
  milestone: "milestoneId",
  configuration: "configurationId",
  template: "templateId",
  creator: "creatorId",
  state: "stateId",
  role: "roleId",
  group: "groupId",
  folder: "folderId",
  session: "sessionId",
  assignedTo: "assignedToId",
  issueType: "issueTypeName",
  issueTracker: "integrationId",
  issueStatus: "status",
  priority: "priority",
  source: "source",
  date: "date",
};

export const DIMENSION_LABEL_KEYS: Record<string, string> = {
  user: "reports.dimensions.user",
  status: "reports.dimensions.status",
  project: "reports.dimensions.project",
  testRun: "reports.dimensions.testRun",
  testCase: "reports.dimensions.testCase",
  milestone: "reports.dimensions.milestone",
  configuration: "reports.dimensions.configuration",
  template: "reports.dimensions.template",
  creator: "reports.dimensions.creator",
  state: "reports.dimensions.state",
  role: "reports.dimensions.role",
  group: "reports.dimensions.group",
  folder: "reports.dimensions.folder",
  session: "reports.dimensions.session",
  assignedTo: "common.fields.assignedTo",
  issueType: "reports.dimensions.issueType",
  issueTracker: "common.fields.issueTracker",
  issueStatus: "reports.dimensions.issueStatus",
  priority: "reports.dimensions.priority",
  source: "reports.dimensions.source",
  date: "reports.dimensions.date",
};

// Map dimension IDs to help keys for help tooltips
export const DIMENSION_HELP_KEYS: Record<string, string> = {
  user: "reportDimensions.user",
  status: "reportDimensions.status",
  project: "reportDimensions.project",
  testRun: "reportDimensions.testRun",
  testCase: "reportDimensions.testCase",
  milestone: "reportDimensions.milestone",
  configuration: "reportDimensions.configuration",
  template: "reportDimensions.template",
  creator: "reportDimensions.creator",
  state: "reportDimensions.state",
  role: "reportDimensions.role",
  group: "reportDimensions.group",
  folder: "reportDimensions.folder",
  session: "reportDimensions.session",
  assignedTo: "reportDimensions.assignedTo",
  issueType: "reportDimensions.issueType",
  issueTracker: "reportDimensions.issueTracker",
  issueStatus: "reportDimensions.issueStatus",
  priority: "reportDimensions.priority",
  source: "reportDimensions.source",
  date: "reportDimensions.date",
};

// Helper function to normalize metric ID to canonical form
export const normalizeMetricId = (metricId: string): string => {
  return METRIC_ID_MAP[metricId] || metricId;
};

// Helper function to get help key from metric ID
export const getMetricHelpKey = (metricId: string): string => {
  // Normalize the metric ID first
  const normalizedId = normalizeMetricId(metricId);

  // Try direct metric ID mapping first
  const helpKey = METRIC_HELP_KEYS[`reports.metrics.${normalizedId}`];
  if (helpKey) return helpKey;

  // Try with just the metric ID (for backward compatibility)
  const directKey = METRIC_HELP_KEYS[metricId];
  if (directKey) return directKey;

  // Return empty string if no help key found
  return "";
};

// Helper function to get help key from dimension ID
export const getDimensionHelpKey = (dimensionId: string): string => {
  return DIMENSION_HELP_KEYS[dimensionId] || "";
};

// Error message constants for API responses
export const REPORT_ERROR_MESSAGES = {
  MISSING_REQUIRED_FIELDS: "reports.errors.missingRequiredFields",
  UNSUPPORTED_DIMENSION: (dimension: string) =>
    `Unsupported dimension: ${dimension}`,
  UNSUPPORTED_METRIC: (metric: string) => `Unsupported metric: ${metric}`,
  AT_LEAST_ONE_DIMENSION_METRIC_REQUIRED:
    "reports.errors.atLeastOneDimensionMetricRequired",
  INVALID_COMBINATION_DATE_LAST_ACTIVE:
    "reports.errors.invalidCombinationDateLastActive",
} as const;
