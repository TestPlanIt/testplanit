/**
 * Canonical feature identifiers for prompt configurations.
 * These MUST match the `feature` field in the PromptConfigPrompt table.
 */
export const LLM_FEATURES = {
  MARKDOWN_PARSING: "markdown_parsing",
  TEST_CASE_GENERATION: "test_case_generation",
  MAGIC_SELECT_CASES: "magic_select_cases",
  EDITOR_ASSISTANT: "editor_assistant",
  LLM_TEST: "llm_test",
  EXPORT_CODE_GENERATION: "export_code_generation",
  AUTO_TAG: "auto_tag",
  DUPLICATE_DETECTION: "duplicate_detection",
} as const;

export type LlmFeature = (typeof LLM_FEATURES)[keyof typeof LLM_FEATURES];

/**
 * A variable that can be substituted in a prompt template using {{NAME}} syntax.
 */
export interface PromptVariable {
  name: string;
  description: string;
}

/**
 * The runtime variables available for substitution in each feature's prompts.
 * These are injected by the server before the LLM call and shown in the admin
 * prompt editor as an "Insert variable" picker.
 */
export const PROMPT_FEATURE_VARIABLES: Record<LlmFeature, PromptVariable[]> = {
  [LLM_FEATURES.MARKDOWN_PARSING]: [],
  [LLM_FEATURES.TEST_CASE_GENERATION]: [
    { name: "EXAMPLE_STRUCTURE", description: "JSON structure example based on template fields" },
    { name: "REQUIRED_FIELDS_LIST", description: "List of required template fields" },
    { name: "OPTIONAL_FIELDS_LIST", description: "List of optional template fields" },
    { name: "QUANTITY_GUIDANCE", description: "Number range of test cases to generate" },
    { name: "STEPS_INSTRUCTION", description: "Instructions for test steps" },
    { name: "PRIORITY_INSTRUCTION", description: "Instructions for priority field values" },
    { name: "TAG_INSTRUCTIONS", description: "Instructions for auto-generating tags" },
    { name: "ISSUE_KEY", description: "Issue identifier (e.g. PROJ-123)" },
    { name: "ISSUE_TITLE", description: "Issue title" },
    { name: "ISSUE_DESCRIPTION", description: "Issue description text" },
    { name: "ISSUE_STATUS", description: "Current issue status" },
    { name: "ISSUE_PRIORITY", description: "Issue priority level" },
    { name: "COMMENTS_SECTION", description: "Relevant issue comments" },
    { name: "USER_NOTES_SECTION", description: "Additional user-provided notes" },
    { name: "EXISTING_CASES_SECTION", description: "Existing test cases to avoid duplicating" },
  ],
  [LLM_FEATURES.MAGIC_SELECT_CASES]: [],
  [LLM_FEATURES.EDITOR_ASSISTANT]: [],
  [LLM_FEATURES.LLM_TEST]: [],
  [LLM_FEATURES.EXPORT_CODE_GENERATION]: [
    { name: "FRAMEWORK", description: "Target test framework (e.g. Playwright, pytest)" },
    { name: "LANGUAGE", description: "Target programming language (e.g. TypeScript, Python)" },
    { name: "CASE_NAME", description: "Name of the test case being generated" },
    { name: "STEPS_TEXT", description: "Formatted test steps with expected results" },
    { name: "CODE_CONTEXT", description: "Repository file contents for reference" },
  ],
  [LLM_FEATURES.AUTO_TAG]: [],
  [LLM_FEATURES.DUPLICATE_DETECTION]: [],
};

/**
 * Human-readable display names for features (used in admin UI).
 */
export const LLM_FEATURE_LABELS: Record<LlmFeature, string> = {
  [LLM_FEATURES.MARKDOWN_PARSING]: "Markdown Test Case Parsing",
  [LLM_FEATURES.TEST_CASE_GENERATION]: "Test Case Generation",
  [LLM_FEATURES.MAGIC_SELECT_CASES]: "Smart Test Case Selection",
  [LLM_FEATURES.EDITOR_ASSISTANT]: "Editor Writing Assistant",
  [LLM_FEATURES.LLM_TEST]: "LLM Connection Test",
  [LLM_FEATURES.EXPORT_CODE_GENERATION]: "Export Code Generation",
  [LLM_FEATURES.AUTO_TAG]: "AI Tag Suggestions",
  [LLM_FEATURES.DUPLICATE_DETECTION]: "Duplicate Detection",
};
