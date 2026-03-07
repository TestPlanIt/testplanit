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
  AUTO_TAG: "auto_tag",
} as const;

export type LlmFeature = (typeof LLM_FEATURES)[keyof typeof LLM_FEATURES];

/**
 * Human-readable display names for features (used in admin UI).
 */
export const LLM_FEATURE_LABELS: Record<LlmFeature, string> = {
  [LLM_FEATURES.MARKDOWN_PARSING]: "Markdown Test Case Parsing",
  [LLM_FEATURES.TEST_CASE_GENERATION]: "Test Case Generation",
  [LLM_FEATURES.MAGIC_SELECT_CASES]: "Smart Test Case Selection",
  [LLM_FEATURES.EDITOR_ASSISTANT]: "Editor Writing Assistant",
  [LLM_FEATURES.LLM_TEST]: "LLM Connection Test",
  [LLM_FEATURES.AUTO_TAG]: "AI Tag Suggestions",
};
