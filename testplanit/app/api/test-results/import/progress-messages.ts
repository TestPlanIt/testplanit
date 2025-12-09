// Progress messages for test results import
// These match the keys in messages/en-US.json under common.actions.testResults.import.progress

import { TestResultFormat } from "~/lib/services/testResultsParser";

export const progressMessages = {
  validating: "Validating input data...",
  detectingFormat: "Auto-detecting file format...",
  formatDetected: (format: string) => `Detected format: ${format}`,
  creatingRun: "Creating test run...",
  fetchingTemplate: "Fetching template data...",
  parsing: (format: TestResultFormat) =>
    `Parsing ${format.toUpperCase()} results...`,
  parseWarnings: (count: number) => `Parsed with ${count} warning(s)`,
  countingTests: (count: number, files: number) =>
    `Processing ${count} test cases from ${files} file(s)...`,
  parsingFile: (current: number, total: number) =>
    `Parsing file ${current} of ${total}...`,
  processingSuite: (name: string) => `Processing suite: ${name}`,
  processingCase: (current: number, total: number) =>
    `Processing test case ${current} of ${total}...`,
  finalizing: "Finalizing import...",
  completed: "Import completed successfully!",
  errorParsing: (error: string) => `Error parsing files: ${error}`,
  skippingFile: (index: number) => `Skipping invalid file ${index}`,
};
