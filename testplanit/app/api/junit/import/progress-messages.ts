// Progress messages for JUnit import
// These match the keys in messages/en-US.json under common.actions.junit.import.progress

export const progressMessages = {
  validating: "Validating input data...",
  creatingRun: "Creating test run...",
  fetchingTemplate: "Fetching template data...",
  countingTests: (count: number, files: number) => 
    `Processing ${count} test cases from ${files} file(s)...`,
  parsingFile: (current: number, total: number) => 
    `Parsing file ${current} of ${total}...`,
  processingSuite: (name: string) => 
    `Processing suite: ${name}`,
  processingCase: (current: number, total: number) => 
    `Processing test case ${current} of ${total}...`,
  finalizing: "Finalizing import...",
  completed: "Import completed successfully!",
  errorParsing: (index: number, error: string) => 
    `Error parsing file ${index}: ${error}`,
  skippingFile: (index: number) => 
    `Skipping invalid file ${index}`,
};