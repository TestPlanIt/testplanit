/**
 * Shared types and functions used by both the sync and streaming
 * test-case-generation endpoints.
 */

export interface IssueData {
  key: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  comments?: Array<{
    author: string;
    body: string;
    created: string;
  }>;
}

export interface TemplateData {
  id: number;
  name: string;
  fields: Array<{
    id: number;
    name: string;
    type: string;
    required: boolean;
    options?: string[];
  }>;
}

export interface GenerationContext {
  userNotes?: string;
  existingTestCases?: Array<{
    name: string;
    template: string;
    description?: string;
    steps?: Array<{
      step: string;
      expectedResult: string;
    }>;
  }>;
  folderContext: number;
}

export interface GeneratedTestCase {
  id: string;
  name: string;
  description?: string;
  steps?: Array<{
    step: string;
    expectedResult: string;
  }>;
  fieldValues: Record<string, any>;
  priority?: string;
  automated: boolean;
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Server-side context: fetch test cases from folder hierarchy
// ---------------------------------------------------------------------------

/** A single existing test case as context for the LLM prompt. */
export interface ExistingTestCaseContext {
  name: string;
  template: string;
  description?: string;
  steps?: Array<{ step: string; expectedResult: string }>;
}

/** Extract plain text from a TipTap JSON or string value. */
function extractPlainText(value: any): string {
  if (!value) return "";
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed?.type === "doc" && parsed?.content) {
        return extractPlainText(parsed);
      }
    } catch {
      return value;
    }
    return value;
  }
  if (typeof value === "object" && value?.content) {
    return value.content
      .map((node: any) => {
        if (node.type === "text") return node.text || "";
        if (node.content) return extractPlainText(node);
        return "";
      })
      .join(" ")
      .trim();
  }
  return "";
}

/** Map a raw DB case row to the lightweight context shape. */
function toCaseContext(row: any): ExistingTestCaseContext {
  const textField = row.caseFieldValues?.find((cfv: any) => {
    const t = cfv.field?.type?.type?.toLowerCase();
    return (t === "text long" || t === "text string") && cfv.value;
  });

  return {
    name: row.name,
    template: row.template?.templateName ?? "",
    description: textField?.value
      ? extractPlainText(textField.value).substring(0, 200)
      : undefined,
    steps:
      row.steps && row.steps.length > 0
        ? row.steps.map((s: any) => ({
            step: extractPlainText(s.step),
            expectedResult: extractPlainText(s.expectedResult),
          }))
        : undefined,
  };
}

/** Rough token estimate for a single context case. */
function estimateCaseTokens(c: ExistingTestCaseContext): number {
  let chars = c.name.length + (c.template?.length ?? 0) + (c.description?.length ?? 0);
  if (c.steps) {
    for (const s of c.steps) {
      chars += s.step.length + s.expectedResult.length;
    }
  }
  return Math.ceil(chars / 4);
}

/**
 * Fetch existing test cases from the folder hierarchy as context for LLM
 * generation, prioritised:  current folder → ancestors → descendants.
 *
 * Returns at most `tokenBudget` estimated tokens worth of cases.
 * `prisma` must be the *raw* (non-enhanced) client so access control
 * does not interfere — the caller has already verified project access.
 */
export async function fetchHierarchyContext(
  prisma: any,
  projectId: number,
  folderId: number,
  tokenBudget: number,
): Promise<ExistingTestCaseContext[]> {
  // Shared select shape for case queries
  const caseSelect = {
    name: true,
    template: { select: { templateName: true } },
    caseFieldValues: {
      select: {
        value: true,
        field: { select: { displayName: true, type: { select: { type: true } } } },
      },
    },
    steps: {
      select: { step: true, expectedResult: true, order: true },
      orderBy: { order: "asc" as const },
    },
  };

  const caseWhere = {
    projectId,
    isDeleted: false,
    isArchived: false,
  };

  // 1. Load all folder ids + parentIds for the project (lightweight)
  const allFolders: { id: number; parentId: number | null }[] =
    await prisma.repositoryFolders.findMany({
      where: { projectId, isDeleted: false },
      select: { id: true, parentId: true },
    });

  const folderMap = new Map(allFolders.map((f) => [f.id, f]));

  // 2. Walk up to collect ancestor folder IDs (nearest parent first)
  const ancestorIds: number[] = [];
  let current = folderMap.get(folderId);
  while (current?.parentId) {
    ancestorIds.push(current.parentId);
    current = folderMap.get(current.parentId);
  }

  // 3. BFS down to collect descendant folder IDs
  const descendantIds: number[] = [];
  const childrenMap = new Map<number, number[]>();
  for (const f of allFolders) {
    if (f.parentId !== null) {
      const list = childrenMap.get(f.parentId);
      if (list) list.push(f.id);
      else childrenMap.set(f.parentId, [f.id]);
    }
  }
  const queue = childrenMap.get(folderId) ?? [];
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    descendantIds.push(id);
    const kids = childrenMap.get(id);
    if (kids) queue.push(...kids);
  }

  // 4. Fetch cases in priority order. We batch into one query per group
  //    to avoid N+1, then concatenate in priority order.
  const groups: number[][] = [
    [folderId],              // highest priority
    ancestorIds,             // next
    descendantIds,           // lowest
  ];

  const results: ExistingTestCaseContext[] = [];
  let tokensUsed = 0;

  for (const folderIds of groups) {
    if (folderIds.length === 0 || tokensUsed >= tokenBudget) continue;

    const rows = await prisma.repositoryCases.findMany({
      where: { ...caseWhere, folderId: { in: folderIds } },
      select: { ...caseSelect, folderId: true },
      take: 100, // generous upper bound; token budget will trim
    });

    // For ancestors, sort nearest-first (match ancestorIds order)
    if (folderIds === ancestorIds && ancestorIds.length > 1) {
      const orderMap = new Map(ancestorIds.map((id, i) => [id, i]));
      rows.sort((a: any, b: any) =>
        (orderMap.get(a.folderId) ?? 999) - (orderMap.get(b.folderId) ?? 999)
      );
    }

    for (const row of rows) {
      const ctx = toCaseContext(row);
      const tokens = estimateCaseTokens(ctx);
      if (tokensUsed + tokens > tokenBudget) break;
      results.push(ctx);
      tokensUsed += tokens;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

export function buildSystemPrompt(
  template: TemplateData,
  _context: GenerationContext,
  quantity?: string,
  autoGenerateTags?: boolean,
  baseTemplate?: string
): string {
  // Separate required and optional fields
  const requiredFields = template.fields.filter((f) => f.required);
  const optionalFields = template.fields.filter((f) => !f.required);

  // Build the fieldValues object with proper handling for different field types
  const fieldValuesExample = template.fields.reduce(
    (acc, field) => {
      let exampleValue: any;

      if (field.options && field.options.length > 0) {
        const fieldType = field.type.toLowerCase();
        if (fieldType === "multi-select") {
          exampleValue = field.options.slice(
            0,
            Math.min(3, field.options.length)
          );
        } else {
          exampleValue = field.options[0];
        }
      } else {
        const fieldNameLower = field.name.toLowerCase();

        if (fieldNameLower.includes("description")) {
          exampleValue =
            "Comprehensive description explaining what this test case validates, including the specific functionality, expected behavior, and how it relates to the issue requirements. Should be 2-3 sentences minimum.";
        } else if (
          fieldNameLower.includes("precondition") ||
          fieldNameLower.includes("pre-condition")
        ) {
          exampleValue =
            "List of prerequisites that must be met before executing this test, such as: user authentication status, required test data, system configuration, or dependencies on other features.";
        } else if (
          fieldNameLower.includes("postcondition") ||
          fieldNameLower.includes("post-condition") ||
          fieldNameLower.includes("post condition")
        ) {
          exampleValue =
            "Expected state of the system after test execution, including: data changes, UI state, logged events, or cleanup actions required.";
        } else {
          switch (field.type.toLowerCase()) {
            case "text string":
              exampleValue = `Specific ${field.name.toLowerCase()} value relevant to this issue`;
              break;
            case "number":
            case "integer":
              exampleValue = 1;
              break;
            case "checkbox":
              exampleValue = false;
              break;
            case "date":
              exampleValue = "2024-01-01";
              break;
            case "text long":
              exampleValue = `Detailed ${field.name.toLowerCase()} with comprehensive information relevant to this specific issue. Include multiple sentences with specific details.`;
              break;
            case "multi-select":
              exampleValue = ["Option 1", "Option 2"];
              break;
            case "dropdown":
              exampleValue = "Option 1";
              break;
            case "steps":
              exampleValue = [];
              break;
            default:
              exampleValue = `${field.name} value for this specific issue`;
          }
        }
      }

      acc[field.name] = exampleValue;
      return acc;
    },
    {} as Record<string, any>
  );

  const fieldValuesJson = JSON.stringify(fieldValuesExample, null, 8).replace(
    /^/gm,
    "        "
  );

  const quantityGuidance = quantity ? getQuantityGuidance(quantity) : "3-5";

  const hasStepsField = template.fields.some(
    (f) =>
      f.type.toLowerCase() === "steps" ||
      f.name.toLowerCase().includes("step") ||
      f.name.toLowerCase() === "steps"
  );
  const includeSteps = hasStepsField;

  const baseStructure: any = {
    id: "tc_1",
    name: "Specific test case name based on the issue",
    fieldValues: JSON.parse(fieldValuesJson.trim()),
    automated: false,
  };

  if (autoGenerateTags) {
    baseStructure.tags = ["UI", "Functional", "Smoke"];
  }

  if (includeSteps) {
    baseStructure.steps = [
      {
        step: "Specific action to perform for this feature/requirement",
        expectedResult: "Expected outcome specific to this issue",
      },
    ];
  }

  const priorityField = template.fields.find((f) =>
    f.name.toLowerCase().includes("priority")
  );
  if (!priorityField) {
    baseStructure.priority = "High";
  }

  const exampleStructureJson = JSON.stringify(baseStructure, null, 8).replace(
    /^/gm,
    "    "
  );

  const exampleStructure = exampleStructureJson.substring(
    exampleStructureJson.indexOf("{")
  );
  const requiredFieldsList = requiredFields
    .map(
      (f) =>
        `- ${f.name} (${f.type})${f.options ? ` - options: [${f.options.join(", ")}]` : ""}${f.type.toLowerCase() === "multi-select" ? " - provide array of selected options" : ""}`
    )
    .join("\n");
  const optionalFieldsList = optionalFields
    .map(
      (f) =>
        `- ${f.name} (${f.type})${f.options ? ` - options: [${f.options.join(", ")}]` : ""}${f.type.toLowerCase() === "multi-select" ? " - provide array of selected options" : ""}`
    )
    .join("\n");
  const stepsInstruction = includeSteps
    ? "\n- Test steps must be detailed and actionable for the specific issue requirements"
    : "";
  const priorityInstruction = !priorityField
    ? '\n- Use priority: "High", "Medium", or "Low"'
    : priorityField?.options
      ? `\n- For Priority field, use ONLY these values: [${priorityField.options.join(", ")}]`
      : "";
  const tagInstructions = autoGenerateTags
    ? '- TAGS: Include 2-4 relevant tags per test case that categorize the test (e.g., "UI", "API", "Security", "Performance", "Integration", "Smoke", "Regression", "Functional", "Edge Case", "Mobile", "Desktop", etc.)'
    : "";

  if (baseTemplate) {
    return baseTemplate
      .replace("{{EXAMPLE_STRUCTURE}}", exampleStructure)
      .replace("{{REQUIRED_FIELDS_LIST}}", requiredFieldsList)
      .replace("{{OPTIONAL_FIELDS_LIST}}", optionalFieldsList)
      .replace("{{QUANTITY_GUIDANCE}}", quantityGuidance)
      .replace("{{STEPS_INSTRUCTION}}", stepsInstruction)
      .replace("{{PRIORITY_INSTRUCTION}}", priorityInstruction)
      .replace("{{TAG_INSTRUCTIONS}}", tagInstructions);
  }

  return `You are an expert test case generator. Analyze the provided issue and create specific, targeted test cases that validate the exact requirements and functionality described in that issue.

CRITICAL: You must respond with ONLY valid JSON. No explanations, no comments, no text before or after the JSON.

JSON structure (EXACT format required):
{
  "testCases": [
${exampleStructure}
  ]
}

REQUIRED FIELDS (must be included in every test case):
${requiredFieldsList}

ADDITIONAL FIELDS (include ALL of these in fieldValues):
${optionalFieldsList}

REQUIREMENTS:
- Generate ${quantityGuidance} that are SPECIFIC to the provided issue
- Each test case name should reference the actual feature/functionality being tested${stepsInstruction}${priorityInstruction}
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
${tagInstructions}
- DO NOT create generic test cases - they must validate the specific issue requirements
- DO NOT leave optional text fields empty - they provide critical context for test execution
- IMPORTANT: If existing test cases are provided, DO NOT generate duplicates or test cases that cover the same scenarios. Focus on NEW test scenarios not already covered.

Return ONLY the JSON.`;
}

export function buildUserPrompt(
  issue: IssueData,
  context: GenerationContext,
  baseTemplate?: string
): string {
  let commentsSection = "";
  if (issue.comments && issue.comments.length > 0) {
    commentsSection = `\n\nRELEVANT COMMENTS:`;
    issue.comments.slice(0, 3).forEach((c, i) => {
      commentsSection += `\n${i + 1}. ${c.author}: ${c.body.substring(0, 300)}`;
    });
  }

  let userNotesSection = "";
  if (context.userNotes) {
    userNotesSection = `\n\nADDITIONAL TESTING GUIDANCE: ${context.userNotes}`;
  }

  let existingCasesSection = "";
  if (context.existingTestCases && context.existingTestCases.length > 0) {
    existingCasesSection = `\n\nEXISTING TEST CASES IN FOLDER - DO NOT DUPLICATE THESE:`;
    context.existingTestCases.forEach((tc, i) => {
      existingCasesSection += `\n${i + 1}. ${tc.name}`;
      if (tc.description) {
        existingCasesSection += `\n   Description: ${tc.description}`;
      }
      if (tc.steps && tc.steps.length > 0) {
        existingCasesSection += `\n   Steps:`;
        tc.steps.forEach((step, stepIndex) => {
          existingCasesSection += `\n     ${stepIndex + 1}. ${step.step}`;
          if (step.expectedResult) {
            existingCasesSection += ` → Expected: ${step.expectedResult}`;
          }
        });
      }
    });
    existingCasesSection += `\n\nCRITICAL: Do NOT generate test cases that duplicate or substantially overlap with the existing test cases listed above. Each new test case must cover different functionality, scenarios, or edge cases not already tested.`;
  }

  if (baseTemplate) {
    return baseTemplate
      .replace("{{ISSUE_KEY}}", issue.key)
      .replace("{{ISSUE_TITLE}}", issue.title)
      .replace(
        "{{ISSUE_DESCRIPTION}}",
        issue.description || "No description provided"
      )
      .replace("{{ISSUE_STATUS}}", issue.status)
      .replace(
        "{{ISSUE_PRIORITY}}",
        issue.priority ? ` | PRIORITY: ${issue.priority}` : ""
      )
      .replace("{{COMMENTS_SECTION}}", commentsSection)
      .replace("{{USER_NOTES_SECTION}}", userNotesSection)
      .replace("{{EXISTING_CASES_SECTION}}", existingCasesSection);
  }

  let prompt = `ISSUE TO TEST: ${issue.key} - "${issue.title}"

ISSUE DETAILS:
${issue.description || "No description provided"}

STATUS: ${issue.status}${issue.priority ? ` | PRIORITY: ${issue.priority}` : ""}`;

  prompt += commentsSection;
  prompt += userNotesSection;
  prompt += existingCasesSection;

  prompt += `\n\nBased on this issue, generate specific test cases that validate the requirements and functionality described above. Make test case names and descriptions specific to this issue, not generic. Focus on what needs to be tested to verify this specific feature/fix works correctly.`;

  return prompt;
}

export function getQuantityGuidance(quantity: string): string {
  switch (quantity.toLowerCase()) {
    case "just_one":
      return "1 test case";
    case "couple":
      return "2 test cases";
    case "few":
      return "2-3 test cases";
    case "several":
      return "4-6 test cases";
    case "many":
      return "7-10 test cases";
    case "all":
    case "maximum":
      return "as many test cases as needed for comprehensive coverage — the user wants full coverage including edge cases, error scenarios, and boundary conditions";
    default:
      return "3-5 test cases";
  }
}

// ---------------------------------------------------------------------------
// Response parsing & validation
// ---------------------------------------------------------------------------

/**
 * Parse the raw LLM text into a testCases array and validate field values
 * against the template definition.
 *
 * Returns `{ testCases, parseError }`.  When `parseError` is set the caller
 * should decide how to surface it (JSON 500 vs SSE error event, etc.).
 */
export function parseAndValidateTestCases(
  rawContent: string,
  template: TemplateData,
  issue: IssueData,
  autoGenerateTags?: boolean,
  quantity?: string,
): {
  testCases: GeneratedTestCase[];
  parseError?: {
    userError: string;
    userSuggestions: string[];
    errorMessage: string;
    responseLength: number;
    seemsTruncated: boolean;
    responsePreview: string;
  };
} {
  let parsedResponse: { testCases: GeneratedTestCase[] } = { testCases: [] };

  try {
    const cleanContent = rawContent.trim();

    let jsonMatch = cleanContent.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      const codeBlockMatch = cleanContent.match(
        /```(?:json)?\s*(\{[\s\S]*?\})[\s\S]*?```/
      );
      if (codeBlockMatch) {
        jsonMatch = [codeBlockMatch[1]];
      } else {
        let incompleteMatch = cleanContent.match(/\{[\s\S]*$/);

        if (!incompleteMatch) {
          const afterCodeBlock = cleanContent.match(
            /```(?:json)?\s*(\{[\s\S]*)/
          );
          if (afterCodeBlock) {
            incompleteMatch = [afterCodeBlock[1]];
          }
        }

        if (incompleteMatch) {
          let incompleteJson = incompleteMatch[0];

          if (
            incompleteJson.includes('"step":') &&
            !incompleteJson.endsWith('"')
          ) {
            const lastQuoteIndex = incompleteJson.lastIndexOf('"');
            const beforeLastQuote = incompleteJson.substring(
              0,
              lastQuoteIndex + 1
            );
            const afterLastQuote = incompleteJson.substring(
              lastQuoteIndex + 1
            );

            if (
              afterLastQuote.trim() &&
              !afterLastQuote.trim().endsWith('"')
            ) {
              incompleteJson =
                beforeLastQuote + afterLastQuote.split(/[,}\]]/)[0] + '"';
            }
          }

          const openBraces = (incompleteJson.match(/\{/g) || []).length;
          const closeBraces = (incompleteJson.match(/\}/g) || []).length;
          const bracesNeeded = openBraces - closeBraces;

          const openBrackets = (incompleteJson.match(/\[/g) || []).length;
          const closeBrackets = (incompleteJson.match(/\]/g) || []).length;
          const bracketsNeeded = openBrackets - closeBrackets;

          if (incompleteJson.includes('"steps":') && bracketsNeeded > 0) {
            incompleteJson += "        }\n      ]";
            const newBracketsNeeded = bracketsNeeded - 1;
            if (newBracketsNeeded > 0) {
              incompleteJson += "]".repeat(newBracketsNeeded);
            }
          } else if (bracketsNeeded > 0) {
            incompleteJson += "]".repeat(bracketsNeeded);
          }

          if (bracesNeeded > 0) {
            incompleteJson += "    }\n  ]".repeat(Math.min(bracesNeeded, 2));
            const remainingBraces = bracesNeeded - 2;
            if (remainingBraces > 0) {
              incompleteJson += "}".repeat(remainingBraces);
            }
          }

          jsonMatch = [incompleteJson];
        } else {
          parsedResponse = {
            testCases: [
              {
                id: "fallback_tc_1",
                name: `Test case for ${issue.title.substring(0, 50)}`,
                description:
                  "Fallback test case generated when LLM response wasn't in expected JSON format",
                steps: [
                  {
                    step: "Review the issue requirements and acceptance criteria",
                    expectedResult:
                      "Requirements are clearly understood and testable scenarios are identified",
                  },
                  {
                    step: "Execute the primary functionality described in the issue",
                    expectedResult:
                      "Functionality works as described in the issue",
                  },
                ],
                fieldValues: template.fields.reduce(
                  (acc, field) => {
                    acc[field.name] =
                      field.options?.[0] || "To be determined";
                    return acc;
                  },
                  {} as Record<string, string>
                ),
                priority: issue.priority || "Medium",
                automated: false,
                ...(autoGenerateTags && {
                  tags: ["Fallback", "Manual", "Review"],
                }),
              },
            ],
          };
        }
      }
    }

    if (jsonMatch) {
      const rawParsed = JSON.parse(jsonMatch[0]);

      if (rawParsed.testCases && Array.isArray(rawParsed.testCases)) {
        parsedResponse = rawParsed;
      } else if (
        rawParsed.testCase ||
        rawParsed.testCase1 ||
        rawParsed.testCase2
      ) {
        const testCases: GeneratedTestCase[] = [];
        for (const [key, value] of Object.entries(rawParsed)) {
          if (
            key.startsWith("testCase") &&
            typeof value === "object" &&
            value !== null
          ) {
            testCases.push(value as GeneratedTestCase);
          }
        }
        parsedResponse = { testCases };
      } else {
        parsedResponse = {
          testCases: Array.isArray(rawParsed)
            ? (rawParsed as GeneratedTestCase[])
            : [rawParsed as GeneratedTestCase],
        };
      }
    }
  } catch (parseError) {
    console.error("\n=== PARSE ERROR ===");
    console.error("Failed to parse LLM response:", parseError);
    console.error("Raw response length:", rawContent.length);
    console.error("Raw response preview:", rawContent.substring(0, 500));

    const errorMessage =
      parseError instanceof Error ? parseError.message : String(parseError);

    const responseLength = rawContent.length;
    const seemsTruncated =
      responseLength > 20000 ||
      !rawContent.trim().endsWith("}") ||
      errorMessage.includes("Unexpected end") ||
      (errorMessage.includes("Expected") && errorMessage.includes("JSON"));

    let userError: string;
    let userSuggestions: string[];

    if (seemsTruncated) {
      userError = "AI response was too long and got truncated";
      userSuggestions = [
        `Try reducing the number of test cases (currently "${quantity}" - try "Few" or "Couple")`,
        "Simplify your requirements or notes to generate shorter test cases",
        "Select fewer template fields to populate",
        "Break down complex requirements into smaller, separate generation requests",
        "Disable auto-tagging to reduce response length",
      ];
    } else if (
      errorMessage.includes("JSON") ||
      errorMessage.includes("parse")
    ) {
      userError = "AI generated invalid response format";
      userSuggestions = [
        "Try regenerating with different notes or guidance",
        "Ensure your issue description is clear and well-formatted",
        "Try generating fewer test cases at once",
      ];
    } else {
      userError = "Unexpected error processing AI response";
      userSuggestions = [
        "Try generating again - this was likely a temporary issue",
        "If the problem persists, try with fewer test cases or simpler requirements",
      ];
    }

    return {
      testCases: [],
      parseError: {
        userError,
        userSuggestions,
        errorMessage,
        responseLength,
        seemsTruncated,
        responsePreview: rawContent.substring(0, 1000),
      },
    };
  }

  // Validate and sanitize
  const priorityField = template.fields.find((f) =>
    f.name.toLowerCase().includes("priority")
  );
  const validPriorityOptions = priorityField?.options || [
    "High",
    "Medium",
    "Low",
  ];

  const testCases =
    parsedResponse.testCases?.map((tc, index) => {
      let validatedPriority = tc.priority;
      if (tc.priority && !validPriorityOptions.includes(tc.priority)) {
        const lowerPriority = tc.priority.toLowerCase();
        const mappedPriority = validPriorityOptions.find(
          (option) =>
            option.toLowerCase() === lowerPriority ||
            option.toLowerCase().includes(lowerPriority) ||
            lowerPriority.includes(option.toLowerCase())
        );
        validatedPriority =
          mappedPriority || validPriorityOptions[0] || "Medium";
      }

      const validatedFieldValues = { ...tc.fieldValues };

      template.fields.forEach((field) => {
        if (field.options && validatedFieldValues[field.name]) {
          const fieldValue = validatedFieldValues[field.name];

          if (Array.isArray(fieldValue)) {
            validatedFieldValues[field.name] = fieldValue.filter((value) =>
              field.options!.includes(value)
            );
          } else if (
            typeof fieldValue === "string" &&
            !field.options.includes(fieldValue)
          ) {
            const lowerValue = fieldValue.toLowerCase();
            const mappedOption = field.options.find(
              (option) =>
                option.toLowerCase() === lowerValue ||
                option.toLowerCase().includes(lowerValue) ||
                lowerValue.includes(option.toLowerCase())
            );
            validatedFieldValues[field.name] =
              mappedOption || field.options[0];
          }
        }
      });

      return {
        id: tc.id || `generated_${Date.now()}_${index}`,
        name: tc.name || `Test Case ${index + 1}`,
        description: tc.description,
        steps: Array.isArray(tc.steps)
          ? tc.steps.filter(
              (step) =>
                step &&
                typeof step.step === "string" &&
                typeof step.expectedResult === "string"
            )
          : [],
        fieldValues: validatedFieldValues,
        priority: validatedPriority || validPriorityOptions[0] || "Medium",
        automated: Boolean(tc.automated),
        tags: Array.isArray(tc.tags)
          ? tc.tags
              .filter(
                (tag) => typeof tag === "string" && tag.trim().length > 0
              )
              .map((tag) => tag.trim())
          : [],
      };
    }) || [];

  return { testCases };
}

// ---------------------------------------------------------------------------
// Incremental (streaming) extraction
// ---------------------------------------------------------------------------

/**
 * Scan `text` for top-level `{…}` blocks inside a `"testCases": [` array,
 * respecting JSON string escaping. Returns the raw substring of each complete
 * object *without* attempting to close incomplete trailing content.
 *
 * This is intentionally separate from `parseAndValidateTestCases` because the
 * latter tries to recover from truncated JSON (closing unbalanced braces,
 * etc.) — exactly the behaviour that breaks mid-stream incremental parsing.
 */
function extractRawTestCaseStrings(text: string): string[] {
  // Find the start of the testCases array
  const arrayStart = text.indexOf("[", text.indexOf("testCases"));
  if (arrayStart === -1) return [];

  const results: string[] = [];
  let i = arrayStart + 1;
  const len = text.length;

  while (i < len) {
    // Skip whitespace and commas between objects
    while (i < len && (text[i] === " " || text[i] === "\n" || text[i] === "\r" || text[i] === "\t" || text[i] === ",")) i++;
    if (i >= len || text[i] !== "{") break;

    // Track brace depth to find the matching closing brace
    const objStart = i;
    let depth = 0;
    let inString = false;
    let escaped = false;

    while (i < len) {
      const ch = text[i];

      if (escaped) {
        escaped = false;
        i++;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        i++;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        i++;
        continue;
      }

      if (!inString) {
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            // Complete object found
            results.push(text.substring(objStart, i + 1));
            i++;
            break;
          }
        }
      }
      i++;
    }

    // If we exited the inner loop without depth reaching 0, the object is
    // incomplete — stop (don't include it).
    if (depth !== 0) break;
  }

  return results;
}

/**
 * Validate and sanitize a single raw test case object against the template.
 */
export function validateTestCase(
  tc: GeneratedTestCase,
  index: number,
  template: TemplateData,
): GeneratedTestCase {
  const priorityField = template.fields.find((f) =>
    f.name.toLowerCase().includes("priority")
  );
  const validPriorityOptions = priorityField?.options || [
    "High",
    "Medium",
    "Low",
  ];

  let validatedPriority = tc.priority;
  if (tc.priority && !validPriorityOptions.includes(tc.priority)) {
    const lowerPriority = tc.priority.toLowerCase();
    const mappedPriority = validPriorityOptions.find(
      (option) =>
        option.toLowerCase() === lowerPriority ||
        option.toLowerCase().includes(lowerPriority) ||
        lowerPriority.includes(option.toLowerCase())
    );
    validatedPriority = mappedPriority || validPriorityOptions[0] || "Medium";
  }

  const validatedFieldValues = { ...tc.fieldValues };
  template.fields.forEach((field) => {
    if (field.options && validatedFieldValues[field.name]) {
      const fieldValue = validatedFieldValues[field.name];
      if (Array.isArray(fieldValue)) {
        validatedFieldValues[field.name] = fieldValue.filter((value) =>
          field.options!.includes(value)
        );
      } else if (
        typeof fieldValue === "string" &&
        !field.options.includes(fieldValue)
      ) {
        const lowerValue = fieldValue.toLowerCase();
        const mappedOption = field.options.find(
          (option) =>
            option.toLowerCase() === lowerValue ||
            option.toLowerCase().includes(lowerValue) ||
            lowerValue.includes(option.toLowerCase())
        );
        validatedFieldValues[field.name] = mappedOption || field.options[0];
      }
    }
  });

  return {
    id: tc.id || `generated_${Date.now()}_${index}`,
    name: tc.name || `Test Case ${index + 1}`,
    description: tc.description,
    steps: Array.isArray(tc.steps)
      ? tc.steps.filter(
          (step) =>
            step &&
            typeof step.step === "string" &&
            typeof step.expectedResult === "string"
        )
      : [],
    fieldValues: validatedFieldValues,
    priority: validatedPriority || validPriorityOptions[0] || "Medium",
    automated: Boolean(tc.automated),
    tags: Array.isArray(tc.tags)
      ? tc.tags
          .filter((tag) => typeof tag === "string" && tag.trim().length > 0)
          .map((tag) => tag.trim())
      : [],
  };
}

/**
 * Extract and validate complete test cases from a *still-growing* SSE stream.
 *
 * Unlike `parseAndValidateTestCases` (which tries to recover truncated JSON),
 * this function only returns test cases whose JSON object is fully closed.
 * It is safe to call repeatedly as `accumulated` grows — just pass
 * `alreadyYielded` to skip previously returned cases.
 */
export function extractStreamedTestCases(
  accumulated: string,
  template: TemplateData,
  alreadyYielded: number,
): GeneratedTestCase[] {
  const rawStrings = extractRawTestCaseStrings(accumulated);

  // Only process objects beyond what we've already yielded
  const newStrings = rawStrings.slice(alreadyYielded);
  const results: GeneratedTestCase[] = [];

  for (let i = 0; i < newStrings.length; i++) {
    try {
      const raw = JSON.parse(newStrings[i]);
      results.push(validateTestCase(raw, alreadyYielded + i, template));
    } catch {
      // Malformed object — skip it (shouldn't happen since we only
      // extract brace-balanced substrings, but be defensive).
    }
  }

  return results;
}
