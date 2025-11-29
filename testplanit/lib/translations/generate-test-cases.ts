// Utility for Generate Test Cases translation keys
// This handles the translation keys until next-intl types are regenerated

export const generateTestCasesKeys = {
  buttonText: "generateTestCases.buttonText",
  title: "generateTestCases.title", 
  description: "generateTestCases.description",
  steps: {
    selectIssue: "generateTestCases.steps.selectIssue",
    selectTemplate: "generateTestCases.steps.selectTemplate",
    addNotes: "generateTestCases.steps.addNotes",
    reviewGenerated: "generateTestCases.steps.reviewGenerated",
  },
  selectIssue: {
    title: "generateTestCases.selectIssue.title",
    description: "generateTestCases.selectIssue.description",
    searchButton: "generateTestCases.selectIssue.searchButton",
  },
  selectTemplate: {
    title: "generateTestCases.selectTemplate.title",
    description: "generateTestCases.selectTemplate.description",
    placeholder: "generateTestCases.selectTemplate.placeholder",
    fields: "generateTestCases.selectTemplate.fields",
  },
  addNotes: {
    title: "generateTestCases.addNotes.title",
    description: "generateTestCases.addNotes.description",
    placeholder: "generateTestCases.addNotes.placeholder",
    suggestions: "generateTestCases.addNotes.suggestions",
  },
  review: {
    title: "generateTestCases.review.title",
    description: "generateTestCases.review.description",
    selected: "generateTestCases.review.selected",
  },
  generating: "generateTestCases.generating",
  generate: "generateTestCases.generate",
  import: "generateTestCases.import",
  success: {
    imported: "generateTestCases.success.imported",
  },
  errors: {
    generateFailed: "generateTestCases.errors.generateFailed",
    importFailed: "generateTestCases.errors.importFailed",
    noTestCasesSelected: "generateTestCases.errors.noTestCasesSelected",
    noTestCasesGenerated: "generateTestCases.errors.noTestCasesGenerated",
  },
} as const;

// Type-safe translation function
export function getTranslationKey(key: string): any {
  return key;
}