import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import { LlmManager } from "@/lib/llm/services/llm-manager.service";
import type { LlmRequest } from "@/lib/llm/types";
import { ProjectAccessType } from "@prisma/client";

interface IssueData {
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

interface TemplateData {
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

interface GenerationContext {
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

interface GeneratedTestCase {
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

function buildSystemPrompt(
  template: TemplateData,
  _context: GenerationContext,
  quantity?: string,
  autoGenerateTags?: boolean
): string {
  // Separate required and optional fields
  const requiredFields = template.fields.filter((f) => f.required);
  const optionalFields = template.fields.filter((f) => !f.required);

  // Build the fieldValues object with proper handling for different field types
  const fieldValuesExample = template.fields.reduce(
    (acc, field) => {
      let exampleValue: any;

      if (field.options && field.options.length > 0) {
        // Handle different field types with options
        // Database field types: "Dropdown" or "Multi-Select"
        const fieldType = field.type.toLowerCase();
        if (fieldType === "multi-select") {
          // For multiselect fields, provide an array of 2-3 options
          exampleValue = field.options.slice(
            0,
            Math.min(3, field.options.length)
          );
        } else {
          // Single select (Dropdown) - use the first option
          exampleValue = field.options[0];
        }
      } else {
        // Provide type-appropriate example values for fields without options
        const fieldNameLower = field.name.toLowerCase();

        // Provide more detailed examples for common text fields
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
          // Field types match the exact database values (case-insensitive)
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
              // Multi-select without options (shouldn't happen, but handle gracefully)
              exampleValue = ["Option 1", "Option 2"];
              break;
            case "dropdown":
              // Dropdown without options (shouldn't happen, but handle gracefully)
              exampleValue = "Option 1";
              break;
            case "steps":
              // Steps field (usually handled separately in baseStructure)
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

  // Determine quantity guidance
  const quantityGuidance = quantity ? getQuantityGuidance(quantity) : "3-5";

  // Only include steps if there's actually a Steps field in the selected template fields
  // Check by field type (more reliable) or by field name (fallback)
  const hasStepsField = template.fields.some(
    (f) =>
      f.type.toLowerCase() === "steps" ||
      f.name.toLowerCase().includes("step") ||
      f.name.toLowerCase() === "steps"
  );
  const includeSteps = hasStepsField;

  // Build the base test case structure
  const baseStructure: any = {
    id: "tc_1",
    name: "Specific test case name based on the issue",
    fieldValues: JSON.parse(fieldValuesJson.trim()),
    automated: false,
  };

  // Only include tags if auto-generation is enabled
  if (autoGenerateTags) {
    baseStructure.tags = ["UI", "Functional", "Smoke"];
  }

  // Only include steps if there's a Steps field in the selected template fields
  if (includeSteps) {
    baseStructure.steps = [
      {
        step: "Specific action to perform for this feature/requirement",
        expectedResult: "Expected outcome specific to this issue",
      },
    ];
  }

  // Only include priority if there's no Priority field in the template
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

  return `You are an expert test case generator. Analyze the provided issue and create specific, targeted test cases that validate the exact requirements and functionality described in that issue.

CRITICAL: You must respond with ONLY valid JSON. No explanations, no comments, no text before or after the JSON.

JSON structure (EXACT format required):
{
  "testCases": [
${exampleStructureJson.substring(exampleStructureJson.indexOf("{"))}
  ]
}

REQUIRED FIELDS (must be included in every test case):
${requiredFields.map((f) => `- ${f.name} (${f.type})${f.options ? ` - options: [${f.options.join(", ")}]` : ""}${f.type.toLowerCase() === "multi-select" ? " - provide array of selected options" : ""}`).join("\n")}

ADDITIONAL FIELDS (include ALL of these in fieldValues):
${optionalFields.map((f) => `- ${f.name} (${f.type})${f.options ? ` - options: [${f.options.join(", ")}]` : ""}${f.type.toLowerCase() === "multi-select" ? " - provide array of selected options" : ""}`).join("\n")}

REQUIREMENTS:
- Generate ${quantityGuidance} test cases that are SPECIFIC to the provided issue
- Each test case name should reference the actual feature/functionality being tested${includeSteps ? "\n- Test steps must be detailed and actionable for the specific issue requirements" : ""}${!priorityField ? '\n- Use priority: "High", "Medium", or "Low"' : priorityField?.options ? `\n- For Priority field, use ONLY these values: [${priorityField.options.join(", ")}]` : ""}
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
${autoGenerateTags ? '- TAGS: Include 2-4 relevant tags per test case that categorize the test (e.g., "UI", "API", "Security", "Performance", "Integration", "Smoke", "Regression", "Functional", "Edge Case", "Mobile", "Desktop", etc.)' : ""}
- DO NOT create generic test cases - they must validate the specific issue requirements
- DO NOT leave optional text fields empty - they provide critical context for test execution
- IMPORTANT: If existing test cases are provided, DO NOT generate duplicates or test cases that cover the same scenarios. Focus on NEW test scenarios not already covered.

Return ONLY the JSON.`;
}

function buildUserPrompt(issue: IssueData, context: GenerationContext): string {
  let prompt = `ISSUE TO TEST: ${issue.key} - "${issue.title}"

ISSUE DETAILS:
${issue.description || "No description provided"}

STATUS: ${issue.status}${issue.priority ? ` | PRIORITY: ${issue.priority}` : ""}`;

  if (issue.comments && issue.comments.length > 0) {
    prompt += `\n\nRELEVANT COMMENTS:`;
    issue.comments.slice(0, 3).forEach((c, i) => {
      prompt += `\n${i + 1}. ${c.author}: ${c.body.substring(0, 300)}`;
    });
  }

  if (context.userNotes) {
    prompt += `\n\nADDITIONAL TESTING GUIDANCE: ${context.userNotes}`;
  }

  if (context.existingTestCases && context.existingTestCases.length > 0) {
    prompt += `\n\nEXISTING TEST CASES IN FOLDER - DO NOT DUPLICATE THESE:`;
    context.existingTestCases.forEach((tc, i) => {
      prompt += `\n${i + 1}. ${tc.name}`;
      if (tc.description) {
        prompt += `\n   Description: ${tc.description}`;
      }
      if (tc.steps && tc.steps.length > 0) {
        prompt += `\n   Steps:`;
        tc.steps.forEach((step, stepIndex) => {
          prompt += `\n     ${stepIndex + 1}. ${step.step}`;
          if (step.expectedResult) {
            prompt += ` → Expected: ${step.expectedResult}`;
          }
        });
      }
    });
    prompt += `\n\nCRITICAL: Do NOT generate test cases that duplicate or substantially overlap with the existing test cases listed above. Each new test case must cover different functionality, scenarios, or edge cases not already tested.`;
  }

  prompt += `\n\nBased on this issue, generate specific test cases that validate the requirements and functionality described above. Make test case names and descriptions specific to this issue, not generic. Focus on what needs to be tested to verify this specific feature/fix works correctly.`;

  return prompt;
}

function getQuantityGuidance(quantity: string): string {
  switch (quantity.toLowerCase()) {
    case "few":
      return "2-3";
    case "several":
      return "4-6";
    case "many":
      return "7-10";
    case "just_one":
      return "1";
    case "couple":
      return "2";
    case "all":
    case "maximum":
      return "10-15";
    default:
      return "3-5"; // default
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, issue, template, context, quantity, autoGenerateTags } =
      body as {
        projectId: number;
        issue: IssueData;
        template: TemplateData;
        context: GenerationContext;
        quantity?: string;
        autoGenerateTags?: boolean;
      };

    if (!projectId || !issue || !template) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    // Verify user has access to the project and check for active LLM integration
    const isAdmin = session.user.access === "ADMIN";
    const isProjectAdmin = session.user.access === "PROJECTADMIN";

    // Build the where clause for project access
    // This needs to account for all access paths: userPermissions, groupPermissions,
    // assignedUsers, and project defaultAccessType (GLOBAL_ROLE)
    const projectAccessWhere = isAdmin
      ? { id: projectId, isDeleted: false }
      : {
          id: projectId,
          isDeleted: false,
          OR: [
            // Direct user permissions
            {
              userPermissions: {
                some: {
                  userId: session.user.id,
                  accessType: { not: ProjectAccessType.NO_ACCESS },
                },
              },
            },
            // Group permissions
            {
              groupPermissions: {
                some: {
                  group: {
                    assignedUsers: {
                      some: {
                        userId: session.user.id,
                      },
                    },
                  },
                  accessType: { not: ProjectAccessType.NO_ACCESS },
                },
              },
            },
            // Project default GLOBAL_ROLE (any authenticated user with a role)
            {
              defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
            },
            // Direct assignment to project with PROJECTADMIN access
            ...(isProjectAdmin
              ? [
                  {
                    assignedUsers: {
                      some: {
                        userId: session.user.id,
                      },
                    },
                  },
                ]
              : []),
          ],
        };

    const project = await prisma.projects.findFirst({
      where: projectAccessWhere,
      include: {
        projectLlmIntegrations: {
          where: { isActive: true },
          include: {
            llmIntegration: {
              include: {
                llmProviderConfig: true,
              },
            },
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found or access denied" },
        { status: 404 }
      );
    }

    const activeLlmIntegration = project.projectLlmIntegrations[0];
    if (!activeLlmIntegration) {
      return NextResponse.json(
        { error: "No active LLM integration found for this project" },
        { status: 400 }
      );
    }

    const manager = LlmManager.getInstance(prisma);

    // Build the prompts
    const systemPrompt = buildSystemPrompt(
      template,
      context,
      quantity,
      autoGenerateTags
    );
    const userPrompt = buildUserPrompt(issue, context);

    // Use the configured max tokens from the LLM provider, but ensure it's at least 6000
    const configuredMaxTokens =
      activeLlmIntegration.llmIntegration.llmProviderConfig?.defaultMaxTokens ||
      4000;
    const maxTokens = Math.max(configuredMaxTokens, 6000);

    const llmRequest: LlmRequest = {
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      temperature: 0.7, // Some creativity but not too random
      maxTokens, // Use the higher of configured or minimum required
      userId: session.user.id,
      feature: "test_case_generation",
      metadata: {
        projectId,
        issueKey: issue.key,
        templateId: template.id,
        timestamp: new Date().toISOString(),
      },
    };

    const response = await manager.chat(
      activeLlmIntegration.llmIntegrationId,
      llmRequest
    );

    // Parse the LLM response
    let parsedResponse: { testCases: GeneratedTestCase[] } = { testCases: [] };
    try {
      // Clean the response content
      const cleanContent = response.content.trim();

      // Try to extract JSON from various formats
      let jsonMatch = cleanContent.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        // Try to find JSON between code blocks
        const codeBlockMatch = cleanContent.match(
          /```(?:json)?\s*(\{[\s\S]*?\})[\s\S]*?```/
        );
        if (codeBlockMatch) {
          jsonMatch = [codeBlockMatch[1]];
        } else {
          // Try to find incomplete JSON starting with {
          let incompleteMatch = cleanContent.match(/\{[\s\S]*$/);

          // Also try to find JSON that starts after ```json
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

            // If the JSON ends mid-string (common with truncation), try to close it
            if (
              incompleteJson.includes('"step":') &&
              !incompleteJson.endsWith('"')
            ) {
              // Find the last incomplete string and close it
              const lastQuoteIndex = incompleteJson.lastIndexOf('"');
              const beforeLastQuote = incompleteJson.substring(
                0,
                lastQuoteIndex + 1
              );
              const afterLastQuote = incompleteJson.substring(
                lastQuoteIndex + 1
              );

              // If there's content after the quote that doesn't end with a quote, close it
              if (
                afterLastQuote.trim() &&
                !afterLastQuote.trim().endsWith('"')
              ) {
                incompleteJson =
                  beforeLastQuote + afterLastQuote.split(/[,}\]]/)[0] + '"';
              }
            }

            // Count open braces vs closed braces
            const openBraces = (incompleteJson.match(/\{/g) || []).length;
            const closeBraces = (incompleteJson.match(/\}/g) || []).length;
            const bracesNeeded = openBraces - closeBraces;

            // Count open brackets vs closed brackets
            const openBrackets = (incompleteJson.match(/\[/g) || []).length;
            const closeBrackets = (incompleteJson.match(/\]/g) || []).length;
            const bracketsNeeded = openBrackets - closeBrackets;

            // Try to close the JSON structure intelligently
            if (incompleteJson.includes('"steps":') && bracketsNeeded > 0) {
              // We're likely in the middle of a steps array, close it properly
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
        // Parse the matched JSON
        const rawParsed = JSON.parse(jsonMatch[0]);

        // Handle different response formats
        if (rawParsed.testCases && Array.isArray(rawParsed.testCases)) {
          // Correct format
          parsedResponse = rawParsed;
        } else if (
          rawParsed.testCase ||
          rawParsed.testCase1 ||
          rawParsed.testCase2
        ) {
          // Handle individual testCase objects
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
          // Unknown format, try to wrap it
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
      console.error("Raw response length:", response.content.length);
      console.error(
        "Raw response preview:",
        response.content.substring(0, 500)
      );

      // Analyze the error to provide specific user guidance
      let userError = "Failed to parse AI response";
      let userSuggestions: string[] = [];
      const errorMessage =
        parseError instanceof Error ? parseError.message : String(parseError);

      // Check if response was likely truncated
      const responseLength = response.content.length;
      const seemsTruncated =
        responseLength > 20000 ||
        !response.content.trim().endsWith("}") ||
        errorMessage.includes("Unexpected end") ||
        (errorMessage.includes("Expected") && errorMessage.includes("JSON"));

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

      return NextResponse.json(
        {
          error: userError,
          suggestions: userSuggestions,
          details: errorMessage,
          responseLength,
          context: {
            quantity: quantity || "several",
            fieldsCount: template.fields?.length || 0,
            autoTagsEnabled: !!autoGenerateTags,
            issueLength: issue.description?.length || 0,
          },
          technical: {
            parseError: errorMessage,
            responsePreview: response.content.substring(0, 1000),
            seemsTruncated,
          },
        },
        { status: 500 }
      );
    }

    // Find priority field in template to get valid options
    const priorityField = template.fields.find((f) =>
      f.name.toLowerCase().includes("priority")
    );
    const validPriorityOptions = priorityField?.options || [
      "High",
      "Medium",
      "Low",
    ];

    // Validate and sanitize the generated test cases
    const testCases =
      parsedResponse.testCases?.map((tc, index) => {
        // Validate priority against template options
        let validatedPriority = tc.priority;
        if (tc.priority && !validPriorityOptions.includes(tc.priority)) {
          // If LLM generated invalid priority, try to map it to a valid option
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

        // Validate all field values against template options
        const validatedFieldValues = { ...tc.fieldValues };

        template.fields.forEach((field) => {
          if (field.options && validatedFieldValues[field.name]) {
            const fieldValue = validatedFieldValues[field.name];

            if (Array.isArray(fieldValue)) {
              // For multiselect fields, filter out invalid options
              validatedFieldValues[field.name] = fieldValue.filter((value) =>
                field.options!.includes(value)
              );
            } else if (
              typeof fieldValue === "string" &&
              !field.options.includes(fieldValue)
            ) {
              // For single select fields, map to valid option or use first option
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

    if (testCases.length === 0) {
      return NextResponse.json(
        {
          error: "No valid test cases generated",
          rawLlmResponse: response.content.substring(0, 2000), // Include raw response for debugging
          parsedResponse: parsedResponse,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      testCases,
      metadata: {
        issueKey: issue.key,
        templateName: template.name,
        generatedCount: testCases.length,
        model: response.model,
        tokens: {
          prompt: response.promptTokens,
          completion: response.completionTokens,
          total: response.totalTokens,
        },
      },
    });
  } catch (error) {
    console.error("Error in POST /api/llm/generate-test-cases:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to generate test cases";
    const errorStack = error instanceof Error ? error.stack : "";

    return NextResponse.json(
      {
        error: "Failed to generate test cases",
        details: errorMessage,
        stack: errorStack?.substring(0, 1000), // Include stack trace for debugging
      },
      { status: 500 }
    );
  }
}
