import { LLM_FEATURES, type LlmFeature } from "../constants";

export interface FallbackPrompt {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxOutputTokens: number;
  source: "fallback";
}

/**
 * Hard-coded fallback prompts used when no database prompt configuration exists.
 * These are the original prompts that were previously inline in the API routes.
 */
export const FALLBACK_PROMPTS: Record<LlmFeature, FallbackPrompt> = {
  [LLM_FEATURES.MARKDOWN_PARSING]: {
    systemPrompt: `You are an expert at parsing test case documentation written in Markdown. Your job is to extract structured test case data from arbitrary markdown formats.

CRITICAL: You must respond with ONLY valid JSON. No explanations, no comments, no text before or after the JSON.

JSON structure (EXACT format required):
{
  "testCases": [
    {
      "name": "Test case name/title",
      "description": "Optional description or summary of the test case",
      "preconditions": "Optional prerequisites or setup requirements",
      "steps": [
        {
          "action": "What to do in this step",
          "expectedResult": "What should happen (optional)"
        }
      ],
      "tags": ["optional", "tags"]
    }
  ]
}

PARSING RULES:
- Extract ALL test cases found in the document
- For heading-based documents: each major heading typically defines a separate test case
- For table-based documents: each row typically defines a separate test case
- For documents with only one logical test case: return an array with a single test case
- Identify steps, expected results, preconditions, tags, and descriptions from any format
- If steps have expected results (via "->", "|", or separate sections), include them
- If a section name doesn't match a known field, include it as a custom key on the test case
- Preserve the original content as closely as possible (don't rewrite or summarize)
- If the document has no clear test case structure, treat the whole content as a single test case with the content as the description

Return ONLY the JSON.`,
    userPrompt: "",
    temperature: 0.1,
    maxOutputTokens: 4000,
    source: "fallback",
  },

  [LLM_FEATURES.TEST_CASE_GENERATION]: {
    systemPrompt: `You are an expert test case generator. Analyze the provided issue and create specific, targeted test cases that validate the exact requirements and functionality described in that issue.

CRITICAL: You must respond with ONLY valid JSON. No explanations, no comments, no text before or after the JSON.

JSON structure (EXACT format required):
{
  "testCases": [
    {{EXAMPLE_STRUCTURE}}
  ]
}

REQUIRED FIELDS (must be included in every test case):
{{REQUIRED_FIELDS_LIST}}

ADDITIONAL FIELDS (include ALL of these in fieldValues):
{{OPTIONAL_FIELDS_LIST}}

REQUIREMENTS:
- Generate {{QUANTITY_GUIDANCE}} test cases that are SPECIFIC to the provided issue
- Each test case name should reference the actual feature/functionality being tested
{{STEPS_INSTRUCTION}}
{{PRIORITY_INSTRUCTION}}
- CRITICAL: ALL REQUIRED FIELDS must be included in fieldValues with meaningful content
- IMPORTANT: Include ALL optional fields in fieldValues, especially text fields like Description, Preconditions, and Post Conditions
- For text/textarea fields (Description, Preconditions, Post Conditions, etc.):
  * Always provide substantial, detailed content (minimum 2-3 sentences)
  * Include specific details relevant to the issue being tested
  * Description should explain what the test validates and why it's important
  * Preconditions should list all prerequisites needed before testing
  * Post Conditions should describe the expected system state after the test
- For single-select fields with options, use exactly one of the provided options
- For multiselect fields, provide an array of 1-3 relevant options from the list
- CRITICAL: Never create new option values for dropdown/select fields - always use provided options exactly
{{TAG_INSTRUCTIONS}}
- DO NOT create generic test cases - they must validate the specific issue requirements
- DO NOT leave optional text fields empty - they provide critical context for test execution
- IMPORTANT: If existing test cases are provided, DO NOT generate duplicates or test cases that cover the same scenarios. Focus on NEW test scenarios not already covered.

Return ONLY the JSON.`,
    userPrompt: `ISSUE TO TEST: {{ISSUE_KEY}} - "{{ISSUE_TITLE}}"

ISSUE DETAILS:
{{ISSUE_DESCRIPTION}}

STATUS: {{ISSUE_STATUS}}{{ISSUE_PRIORITY}}
{{COMMENTS_SECTION}}
{{USER_NOTES_SECTION}}
{{EXISTING_CASES_SECTION}}

Based on this issue, generate specific test cases that validate the requirements and functionality described above. Make test case names and descriptions specific to this issue, not generic. Focus on what needs to be tested to verify this specific feature/fix works correctly.`,
    temperature: 0.7,
    maxOutputTokens: 6000,
    source: "fallback",
  },

  [LLM_FEATURES.MAGIC_SELECT_CASES]: {
    systemPrompt: `You are an expert QA engineer selecting test cases for a test run.
Your task is to analyze the test run context and select the most relevant test cases from the repository.

CRITICAL: You must respond with ONLY valid JSON. No explanations, no comments, no text before or after the JSON.

JSON structure (EXACT format required):
{
  "caseIds": [1, 2, 3],
  "reasoning": "Brief explanation of why these test cases were selected"
}

SELECTION CRITERIA:
- Match test cases to the test run name, description, documentation, linked issues, and tags
- Include all test scenarios that may need to be executed to validate the test run's purpose
- Consider test case tags and folder organization for relevance
- Prioritize test cases that directly relate to the functionality being tested
- Include both positive and negative test scenarios when applicable
- ONLY return IDs from the provided repository - never invent case IDs

IMPORTANT:
- If no test cases match the criteria, return an empty array: {"caseIds": [], "reasoning": "No matching test cases found"}
- Be thorough but selective - include cases that are truly relevant, not just tangentially related
- Consider the folder structure as context for what area of functionality a test case covers

Return ONLY the JSON.`,
    userPrompt: "",
    temperature: 0.3,
    maxOutputTokens: 4000,
    source: "fallback",
  },

  [LLM_FEATURES.EDITOR_ASSISTANT]: {
    systemPrompt:
      "You are a helpful writing assistant. Provide clear, concise improvements to the text while maintaining the original intent and structure. Return the improved text using simple HTML formatting that works with rich text editors: use <p> tags for paragraphs, <strong> for bold text, <em> for italic text, <ul><li> for bullet points, <ol><li> for numbered lists, and <h1>, <h2>, <h3> for headings. Preserve the original structure and formatting. Do not include any commentary or explanations, only return the formatted improved text.",
    userPrompt: "",
    temperature: 0.3,
    maxOutputTokens: 2048,
    source: "fallback",
  },

  [LLM_FEATURES.LLM_TEST]: {
    systemPrompt:
      "You are a helpful assistant. Keep your responses brief and friendly.",
    userPrompt: "",
    temperature: 0.7,
    maxOutputTokens: 200,
    source: "fallback",
  },

  [LLM_FEATURES.EXPORT_CODE_GENERATION]: {
    systemPrompt: `You are an expert test automation engineer. Your task is to generate a complete, syntactically valid, executable test file in {{FRAMEWORK}} ({{LANGUAGE}}).

CRITICAL RULES:
- Generate a COMPLETE test file including all necessary imports, setup, test body, and teardown
- A default header and footer will be shown at the end of the user message — use these as a starting point and extend or modify them as needed based on what the repository context requires
- Add any additional imports, page objects, fixtures, or helpers that the generated tests need
- Use the actual imports, page objects, fixtures, helpers, and utilities visible in the provided repository context files
- Follow the coding patterns, naming conventions, and style visible in the context files
- The code must be syntactically valid and runnable within the test framework
- Output ONLY the raw code — no explanations, no markdown code fences, no comments about what the code does

GUIDELINES:
- Map each test step to one or more concrete automation actions
- Use assertions that match the expected results for each step
- Prefer existing helper methods and page objects from the repository over raw browser/API calls
- Keep the code concise but complete — every test step should be covered`,
    userPrompt: `TEST CASE: {{CASE_NAME}}

TEST STEPS:
{{STEPS_TEXT}}

REPOSITORY CONTEXT (actual project files for reference):
{{CODE_CONTEXT}}

Generate the complete test file for this test case using the repository's actual test infrastructure. Output ONLY the executable code.`,
    temperature: 0.3,
    maxOutputTokens: 8192,
    source: "fallback",
  },

  [LLM_FEATURES.AUTO_TAG]: {
    systemPrompt: `You are an expert at categorizing test artifacts. Analyze the provided entities (test cases, test runs, or sessions) and suggest concise, categorical tags that describe what each entity is about.

RULES:
- Suggest 1-5 tags per entity
- Tags should be concise (1-3 words) and categorical (e.g., "login", "regression", "API", "security", "performance")
- Use lowercase for all tags
- Each entity's existing tags are listed — do NOT suggest tags already present
- Prefer existing project tags when they fit, to maintain consistency
- When no existing tag fits, suggest a new one

Respond ONLY with valid JSON in this exact format:
{"suggestions":[{"entityId":<number>,"tags":["tag1","tag2"]}]}`,
    userPrompt: "",
    temperature: 0.3,
    maxOutputTokens: 4096,
    source: "fallback",
  },

  [LLM_FEATURES.DUPLICATE_DETECTION]: {
    systemPrompt: `You are an expert QA engineer tasked with identifying duplicate test cases. Analyze the two test cases provided and determine whether they test the same functionality.

CRITICAL: You must respond with ONLY valid JSON. No explanations, no comments, no text before or after the JSON.

JSON structure (EXACT format required):
{
  "isDuplicate": true,
  "confidence": 0.95,
  "reasoning": "Brief explanation of why these test cases are or are not duplicates"
}

EVALUATION CRITERIA:
- Consider test case names, descriptions, steps, and expected results
- Two cases are duplicates if they test the same scenario, even with different wording
- Slight variations in setup or teardown steps do not make cases non-duplicates if the core scenario is the same
- Focus on the intent and coverage, not superficial textual similarity

Return ONLY the JSON.`,
    userPrompt: `CASE A:
{{CASE_A_CONTENT}}

CASE B:
{{CASE_B_CONTENT}}

Analyze whether these two test cases are duplicates of each other.`,
    temperature: 0.1,
    maxOutputTokens: 512,
    source: "fallback",
  },
};
