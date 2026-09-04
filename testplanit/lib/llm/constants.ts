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
  GENERATE_FROM_URL: "generate_from_url",
  GENERATE_FROM_URL_APP: "generate_from_url_app",
  AUTOMATION_CANDIDATES: "automation_candidates",
  DERIVE_CASE_STEPS: "derive_case_steps",
  IMPACT_ANALYSIS: "impact_analysis",
} as const;

export type LlmFeature = (typeof LLM_FEATURES)[keyof typeof LLM_FEATURES];

/**
 * Sync-safe retry profile for API routes that respond synchronously.
 * Workers use provider-config retryAttempts (typically 3-7); sync routes cap
 * at 1 retry with short backoff to avoid blocking the HTTP response.
 *
 * Note: maxDelayMs is not yet wired to manager.chat() — with maxRetries=1 and
 * baseDelayMs=1000, backoff never exceeds 1000ms regardless. The field
 * documents the design constraint for future readers.
 */
export const SYNC_RETRY_PROFILE = {
  maxRetries: 1,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
} as const;

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
    {
      name: "EXAMPLE_STRUCTURE",
      description: "JSON structure example based on template fields",
    },
    {
      name: "REQUIRED_FIELDS_LIST",
      description: "List of required template fields",
    },
    {
      name: "OPTIONAL_FIELDS_LIST",
      description: "List of optional template fields",
    },
    {
      name: "EXCLUDED_FIELDS_LIST",
      description:
        "List of template fields the user deselected — instruct the model never to emit these",
    },
    {
      name: "QUANTITY_GUIDANCE",
      description:
        "Quantity of test cases to generate (e.g. '4-6 test cases' or 'as many test cases as needed for comprehensive coverage')",
    },
    { name: "STEPS_INSTRUCTION", description: "Instructions for test steps" },
    {
      name: "PRIORITY_INSTRUCTION",
      description: "Instructions for priority field values",
    },
    {
      name: "TAG_INSTRUCTIONS",
      description: "Instructions for auto-generating tags",
    },
    { name: "ISSUE_KEY", description: "Issue identifier (e.g. PROJ-123)" },
    { name: "ISSUE_TITLE", description: "Issue title" },
    { name: "ISSUE_DESCRIPTION", description: "Issue description text" },
    { name: "ISSUE_STATUS", description: "Current issue status" },
    { name: "ISSUE_PRIORITY", description: "Issue priority level" },
    { name: "COMMENTS_SECTION", description: "Relevant issue comments" },
    {
      name: "USER_NOTES_SECTION",
      description: "Additional user-provided notes",
    },
    {
      name: "EXISTING_CASES_SECTION",
      description: "Existing test cases to avoid duplicating",
    },
  ],
  [LLM_FEATURES.MAGIC_SELECT_CASES]: [],
  [LLM_FEATURES.EDITOR_ASSISTANT]: [],
  [LLM_FEATURES.LLM_TEST]: [],
  [LLM_FEATURES.EXPORT_CODE_GENERATION]: [
    {
      name: "FRAMEWORK",
      description: "Target test framework (e.g. Playwright, pytest)",
    },
    {
      name: "LANGUAGE",
      description: "Target programming language (e.g. TypeScript, Python)",
    },
    { name: "CASE_NAME", description: "Name of the test case being generated" },
    {
      name: "CASE_ID",
      description:
        "TestPlanIt ID of the test case being generated — put it in square brackets in test names so imported results match the existing case",
    },
    {
      name: "STEPS_TEXT",
      description: "Formatted test steps with expected results",
    },
    {
      name: "CODE_CONTEXT",
      description: "Repository file contents for reference",
    },
  ],
  [LLM_FEATURES.AUTO_TAG]: [],
  [LLM_FEATURES.DUPLICATE_DETECTION]: [],
  [LLM_FEATURES.GENERATE_FROM_URL]: [],
  [LLM_FEATURES.GENERATE_FROM_URL_APP]: [],
  [LLM_FEATURES.AUTOMATION_CANDIDATES]: [
    {
      name: "PROJECT_NAME",
      description: "Display name of the project the report is being run for",
    },
    {
      name: "CASE_COUNT",
      description: "Number of manual test cases being ranked",
    },
    {
      name: "CASES_JSON",
      description:
        "Newline-delimited JSON: one row per manual case, each carrying id, name, description, steps summary, automation status, custom field values keyed by field name, and drilled-down linked-issue metadata (provider-agnostic — labels/components/priority etc. when present)",
    },
  ],
  [LLM_FEATURES.DERIVE_CASE_STEPS]: [
    {
      name: "TEST_NAME",
      description: "Name of the automated test being enriched",
    },
    {
      name: "CLASS_NAME",
      description: "Suite/class the test belongs to (may be empty)",
    },
    {
      name: "FAILURE",
      description: "Failure message from the result, if any (may be empty)",
    },
    {
      name: "SYSTEM_OUT",
      description:
        "Captured stdout/output from the result, if any (may be empty)",
    },
    {
      name: "COMMANDS",
      description:
        "Ordered low-level automation commands the test executed (navigation, clicks, input, assertions), if captured — may be empty",
    },
  ],
  [LLM_FEATURES.IMPACT_ANALYSIS]: [
    { name: "BASE_SHA", description: "Short SHA of the base commit" },
    { name: "HEAD_SHA", description: "Short SHA of the head commit" },
    {
      name: "USER_NOTES_SECTION",
      description: "Tester-provided notes about the change (may be empty)",
    },
    {
      name: "CHANGED_FILE_COUNT",
      description: "Number of changed files included in the diff summary",
    },
    {
      name: "EXCLUDED_FILE_NOTE",
      description:
        "Note about files left out of the summary (lockfiles, generated, binary) — empty when none",
    },
    {
      name: "DIFF_SUMMARY",
      description:
        "Per-file summary of the diff: path, status, changed symbols, and patch excerpts within budget",
    },
    {
      name: "PINNED_CASES_NOTE",
      description:
        "Case ids already selected by Code Pins so the model does not re-select them — empty when none",
    },
    {
      name: "CANDIDATE_COUNT",
      description: "Number of candidate cases in this batch",
    },
    {
      name: "BATCH_NOTE",
      description:
        "Batch position when candidates span several batches (e.g. ', batch 2 of 3') — empty for a single batch",
    },
    {
      name: "CANDIDATE_CASES",
      description:
        "Newline-delimited positional JSON rows: [id, name, folder?, tags[]?, fields?]",
    },
  ],
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
  [LLM_FEATURES.GENERATE_FROM_URL]:
    "Generate Test Cases from URL (Requirements)",
  [LLM_FEATURES.GENERATE_FROM_URL_APP]:
    "Generate Test Cases from URL (Application Testing)",
  [LLM_FEATURES.AUTOMATION_CANDIDATES]: "Automation Candidates Report",
  [LLM_FEATURES.DERIVE_CASE_STEPS]: "AI Step Derivation",
  [LLM_FEATURES.IMPACT_ANALYSIS]: "Impact: Affected Test Selection",
};
