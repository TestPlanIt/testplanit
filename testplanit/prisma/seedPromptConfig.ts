import { PrismaClient } from "@prisma/client";

const LLM_FEATURES = {
  MARKDOWN_PARSING: "markdown_parsing",
  TEST_CASE_GENERATION: "test_case_generation",
  MAGIC_SELECT_CASES: "magic_select_cases",
  EDITOR_ASSISTANT: "editor_assistant",
  LLM_TEST: "llm_test",
  AUTO_TAG: "auto_tag",
} as const;

/**
 * Seeds the default prompt configuration with prompts for all AI features.
 * These are the original hard-coded prompts from the API routes.
 */
export async function seedDefaultPromptConfig(prisma: PrismaClient) {
  console.log("Seeding default prompt configuration...");

  // Ensure no other config is marked as default (safety measure)
  await prisma.promptConfig.updateMany({
    where: { isDefault: true },
    data: { isDefault: false },
  });

  // Create or update the default prompt config
  const defaultConfig = await prisma.promptConfig.upsert({
    where: { name: "Default" },
    update: { isDefault: true, isActive: true, isDeleted: false },
    create: {
      name: "Default",
      description:
        "Default prompt configuration with standard prompts for all AI features.",
      isDefault: true,
      isActive: true,
      isDeleted: false,
    },
  });

  // Define prompts for each feature
  const featurePrompts = [
    {
      feature: LLM_FEATURES.MARKDOWN_PARSING,
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
      variables: [],
    },
    {
      feature: LLM_FEATURES.TEST_CASE_GENERATION,
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
      variables: [
        { name: "EXAMPLE_STRUCTURE", description: "JSON structure example based on template fields" },
        { name: "REQUIRED_FIELDS_LIST", description: "List of required template fields" },
        { name: "OPTIONAL_FIELDS_LIST", description: "List of optional template fields" },
        { name: "QUANTITY_GUIDANCE", description: "Number range of test cases to generate" },
        { name: "STEPS_INSTRUCTION", description: "Instructions for test steps (if template includes steps)" },
        { name: "PRIORITY_INSTRUCTION", description: "Instructions for priority field values" },
        { name: "TAG_INSTRUCTIONS", description: "Instructions for auto-generating tags" },
        { name: "ISSUE_KEY", description: "Issue identifier (e.g., PROJ-123)" },
        { name: "ISSUE_TITLE", description: "Issue title" },
        { name: "ISSUE_DESCRIPTION", description: "Issue description text" },
        { name: "ISSUE_STATUS", description: "Current issue status" },
        { name: "ISSUE_PRIORITY", description: "Issue priority level" },
        { name: "COMMENTS_SECTION", description: "Relevant issue comments" },
        { name: "USER_NOTES_SECTION", description: "Additional user-provided notes" },
        { name: "EXISTING_CASES_SECTION", description: "Existing test cases to avoid duplicating" },
      ],
    },
    {
      feature: LLM_FEATURES.MAGIC_SELECT_CASES,
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
      variables: [],
    },
    {
      feature: LLM_FEATURES.EDITOR_ASSISTANT,
      systemPrompt:
        "You are a helpful writing assistant. Provide clear, concise improvements to the text while maintaining the original intent and structure. Return the improved text using simple HTML formatting that works with rich text editors: use <p> tags for paragraphs, <strong> for bold text, <em> for italic text, <ul><li> for bullet points, <ol><li> for numbered lists, and <h1>, <h2>, <h3> for headings. Preserve the original structure and formatting. Do not include any commentary or explanations, only return the formatted improved text.",
      userPrompt: "",
      temperature: 0.3,
      maxOutputTokens: 2048,
      variables: [],
    },
    {
      feature: LLM_FEATURES.LLM_TEST,
      systemPrompt:
        "You are a helpful assistant. Keep your responses brief and friendly.",
      userPrompt: "",
      temperature: 0.7,
      maxOutputTokens: 200,
      variables: [],
    },
    {
      feature: LLM_FEATURES.AUTO_TAG,
      systemPrompt: `You are an expert at categorizing test artifacts. Analyze the provided entities (test cases, test runs, or sessions) and suggest concise, categorical tags that describe what each entity is about.

RULES:
- Suggest 1-5 tags per entity
- Tags should be concise (1-3 words) and categorical (e.g., "login", "regression", "API", "security", "performance")
- Use lowercase for all tags
- Each entity's existing tags are listed — do NOT suggest tags already present
- Only suggest tags that are clearly relevant to the entity content
- Prefer reusing tags from the "Available project tags" list when they fit

CRITICAL: You must respond with ONLY valid JSON. No explanations, no comments, no text before or after the JSON.

JSON structure (EXACT format required):
{
  "suggestions": [
    {
      "entityId": 123,
      "tags": ["tag1", "tag2"]
    }
  ]
}

Return ONLY the JSON.`,
      userPrompt: "",
      temperature: 0.3,
      maxOutputTokens: 4096,
      variables: [],
    },
  ];

  // Backfill missing feature prompts into ALL prompt configs (including
  // Default). Only creates prompts that don't exist yet — never overwrites
  // user-customized prompts.
  const allConfigs = await prisma.promptConfig.findMany({
    select: { id: true, name: true },
  });

  for (const config of allConfigs) {
    const existingPrompts = await prisma.promptConfigPrompt.findMany({
      where: { promptConfigId: config.id },
      select: { feature: true },
    });
    const existingFeatures = new Set(existingPrompts.map((p) => p.feature));

    for (const prompt of featurePrompts) {
      if (!existingFeatures.has(prompt.feature)) {
        await prisma.promptConfigPrompt.create({
          data: {
            promptConfigId: config.id,
            feature: prompt.feature,
            systemPrompt: prompt.systemPrompt,
            userPrompt: prompt.userPrompt,
            temperature: prompt.temperature,
            maxOutputTokens: prompt.maxOutputTokens,
            variables: prompt.variables,
          },
        });
        console.log(
          `Seeded "${prompt.feature}" prompt into config "${config.name}" (ID: ${config.id})`
        );
      }
    }
  }

  console.log(
    `Prompt config seeding complete. Checked ${allConfigs.length} config(s) for ${featurePrompts.length} features.`
  );
}
