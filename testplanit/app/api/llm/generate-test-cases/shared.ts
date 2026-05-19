/**
 * Shared types and functions used by both the sync and streaming
 * test-case-generation endpoints.
 */

import { z } from "zod/v4";
import type {
  IssueAdapter,
  IssueComment,
  LinkedIssueRef,
} from "~/lib/integrations/adapters/IssueAdapter";
import { parameterCreateSchema } from "~/lib/schemas/parameterSchema";

// Hard cap on starter dataset rows emitted by the LLM (DoS guard).
// Rows beyond this index are truncated with a `dataset_capped` warning.
const STARTER_DATASET_ROW_CAP = 50;

// Names the LLM is never allowed to propose as a parameter name (JS
// prototype-pollution defense in depth on top of the snake_case regex).
const RESERVED_PARAMETER_NAMES = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

// LLM-side superset of parameterCreateSchema (testCaseId is injected at save
// time, not by the LLM). Mirrors the Phase 1 canonical export from
// ~/lib/schemas/parameterSchema verbatim for SELECT-XOR semantics and the
// exact field name `allowedValuesJson`. Keep in sync with that file —
// the type-only assertion below catches drift at compile time.
const llmParameterSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9_]*$/, {
        message: "name must be snake_case lowercase (a-z, 0-9, _)",
      })
      .refine((v) => !RESERVED_PARAMETER_NAMES.has(v), {
        message: "reserved name",
      }),
    type: z.enum(["STRING", "INTEGER", "BOOLEAN", "SELECT"]),
    sensitive: z.boolean().default(false),
    allowedValuesJson: z.array(z.string()).optional(),
  })
  .superRefine((val, ctx) => {
    const isSelect = val.type === "SELECT";
    const hasInline =
      val.allowedValuesJson != null && val.allowedValuesJson.length > 0;
    if (isSelect && !hasInline) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "SELECT parameters require a non-empty allowedValuesJson array",
        path: ["allowedValuesJson"],
      });
    }
    if (!isSelect && val.allowedValuesJson != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Non-SELECT parameters must not specify allowedValuesJson",
        path: ["allowedValuesJson"],
      });
    }
  });

// Type-only assertion: LLM-side shape must structurally subset the Phase 1
// canonical type (sans testCaseId, which is injected at save time). This is
// load-bearing — if parameterCreateSchema is renamed or its fields change,
// this assertion breaks the build and forces a deliberate sync here.
type _PhaseOneShape = Omit<z.infer<typeof parameterCreateSchema>, "testCaseId">;
type _LlmShape = z.infer<typeof llmParameterSchema>;
// Field-by-field structural check: every LLM-side field must be assignable
// to the same field on the Phase 1 schema (modulo nullish ⇄ optional).
type _AssertNameCompatible = _LlmShape["name"] extends _PhaseOneShape["name"]
  ? true
  : never;
type _AssertTypeCompatible = _LlmShape["type"] extends _PhaseOneShape["type"]
  ? true
  : never;
type _AssertSensitiveCompatible =
  _LlmShape["sensitive"] extends _PhaseOneShape["sensitive"] ? true : never;
// Force evaluation so unused-type lints don't strip the assertions away.
const _llmShapeAssertion: _AssertNameCompatible &
  _AssertTypeCompatible &
  _AssertSensitiveCompatible = true;
void _llmShapeAssertion;

const llmStarterDatasetRowSchema = z.object({
  label: z.string().optional(),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export interface ParseWarning {
  caseIndex: number;
  message: string;
}

export interface LlmParameter {
  name: string;
  type: "STRING" | "INTEGER" | "BOOLEAN" | "SELECT";
  sensitive: boolean;
  allowedValuesJson?: string[];
}

export interface LlmStarterDatasetRow {
  label?: string;
  values: Record<string, string | number | boolean>;
}

export interface IssueData {
  key: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  comments?: IssueComment[];
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
  linkedIssues?: LinkedIssueContext[];
}

/**
 * One linked issue's title + body + comments, suitable for slotting into
 * the LLM prompt's RELATED LINKED ISSUES section.
 */
export interface LinkedIssueContext {
  ref: LinkedIssueRef;
  title: string;
  body?: string;
  comments: IssueComment[];
}

export interface GeneratedTestCase {
  id: string;
  name: string;
  /** @deprecated Use fieldValues instead */
  description?: string;
  /** @deprecated Steps now live inside fieldValues */
  steps?: Array<{
    step: string;
    expectedResult: string;
  }>;
  fieldValues: Record<string, any>;
  /** @deprecated Priority now lives inside fieldValues */
  priority?: string;
  /** @deprecated No longer produced by LLM */
  automated?: boolean;
  tags?: string[];
  /**
   * INT-06: optional parameter schema proposed by the LLM. Present only when
   * the route was called with includeParameters=true. Validated via the
   * LLM-side superset of parameterCreateSchema; SELECT entries always carry
   * an inline `allowedValuesJson` (the LLM has no knowledge of existing
   * project DataSets, so it never proposes a `lookupDataSetId`).
   */
  parameters?: LlmParameter[];
  /**
   * INT-06: optional starter dataset rows proposed by the LLM. Row count is
   * LLM-decided (D-11). Hard cap at STARTER_DATASET_ROW_CAP — excess rows are
   * truncated with a `dataset_capped` warning.
   */
  starterDataset?: LlmStarterDatasetRow[];
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
  let chars =
    c.name.length + (c.template?.length ?? 0) + (c.description?.length ?? 0);
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
  tokenBudget: number
): Promise<ExistingTestCaseContext[]> {
  // Shared select shape for case queries
  const caseSelect = {
    name: true,
    template: { select: { templateName: true } },
    caseFieldValues: {
      select: {
        value: true,
        field: {
          select: { displayName: true, type: { select: { type: true } } },
        },
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
    [folderId], // highest priority
    ancestorIds, // next
    descendantIds, // lowest
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
      rows.sort(
        (a: any, b: any) =>
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
// Server-side context: fetch linked issues (refs + bodies + comments)
// ---------------------------------------------------------------------------

/** Per-issue char count -> token estimate (consistent with fetchHierarchyContext). */
function estimateLinkedIssueTokens(c: LinkedIssueContext): number {
  let chars = c.title.length + (c.body?.length ?? 0);
  for (const cmt of c.comments) {
    chars += cmt.body.length;
  }
  return Math.ceil(chars / 4);
}

function sumLinkedTokens(items: LinkedIssueContext[]): number {
  let total = 0;
  for (const item of items) {
    total += estimateLinkedIssueTokens(item);
  }
  return total;
}

/**
 * Fetch linked-issue context (title + body + comments per ref) within a
 * token budget. Mirrors `fetchHierarchyContext` — same char/4 token heuristic,
 * same accumulator style.
 *
 * `tokensUsed` is the accumulator across all `included` items
 * (`ceil((title + body + comments-bodies-concat) / 4)`). Callers use it to
 * compute downstream budgets without recomputing.
 */
export async function fetchLinkedIssuesContext(
  adapter: IssueAdapter,
  sourceIssueKey: string,
  tokenBudget: number
): Promise<{
  included: LinkedIssueContext[];
  dropped: LinkedIssueRef[];
  tokensUsed: number;
}> {
  if (!adapter.getLinkedIssues) {
    return { included: [], dropped: [], tokensUsed: 0 };
  }

  let refs: LinkedIssueRef[];
  try {
    refs = await adapter.getLinkedIssues(sourceIssueKey);
  } catch {
    return { included: [], dropped: [], tokensUsed: 0 };
  }

  if (!Array.isArray(refs) || refs.length === 0) {
    return { included: [], dropped: [], tokensUsed: 0 };
  }

  // Fetch issue + comments for every ref in parallel, preserving array order.
  const issuePromises = refs.map((ref) =>
    adapter.getIssue
      ? adapter.getIssue(ref.id).then(
          (i) => i,
          () => null
        )
      : Promise.resolve(null)
  );
  const commentsPromises = refs.map((ref) =>
    adapter.getIssueComments
      ? adapter.getIssueComments(ref.id).then(
          (c) => c,
          () => [] as IssueComment[]
        )
      : Promise.resolve([] as IssueComment[])
  );

  let issues: Array<Awaited<
    ReturnType<NonNullable<IssueAdapter["getIssue"]>>
  > | null>;
  let commentLists: IssueComment[][];
  try {
    issues = await Promise.all(issuePromises);
    commentLists = await Promise.all(commentsPromises);
  } catch {
    // Should not happen — per-ref handlers swallow rejections — but be defensive.
    return { included: [], dropped: [], tokensUsed: 0 };
  }

  const included: LinkedIssueContext[] = refs.map((ref, i) => {
    const issue = issues[i];
    return {
      ref,
      title: issue?.title ?? ref.key ?? ref.id,
      body: issue?.description,
      comments: commentLists[i] ?? [],
    };
  });

  const dropped: LinkedIssueRef[] = [];

  // Apply drop policy until under budget.
  // Bound the loop conservatively: at worst we drop every comment + every issue.
  let totalSafetyIterations = 0;
  let initialCommentCount = 0;
  for (const item of included) {
    initialCommentCount += item.comments.length;
  }
  const maxIterations = initialCommentCount + included.length + 1;

  while (
    sumLinkedTokens(included) > tokenBudget &&
    included.length > 0 &&
    totalSafetyIterations < maxIterations
  ) {
    totalSafetyIterations++;

    // Tier 2: any included issue still has comments -> drop one from the
    // issue with the largest comment count (tied -> longest comment among ties).
    const withComments = included.filter((c) => c.comments.length > 0);
    if (withComments.length > 0) {
      let target = withComments[0];
      let targetLongest = target.comments.reduce(
        (m, cmt) => (cmt.body.length > m ? cmt.body.length : m),
        0
      );
      for (let i = 1; i < withComments.length; i++) {
        const candidate = withComments[i];
        if (candidate.comments.length > target.comments.length) {
          target = candidate;
          targetLongest = candidate.comments.reduce(
            (m, cmt) => (cmt.body.length > m ? cmt.body.length : m),
            0
          );
        } else if (candidate.comments.length === target.comments.length) {
          const candidateLongest = candidate.comments.reduce(
            (m, cmt) => (cmt.body.length > m ? cmt.body.length : m),
            0
          );
          if (candidateLongest > targetLongest) {
            target = candidate;
            targetLongest = candidateLongest;
          }
        }
      }
      // Within target, drop the longest comment first.
      let longestIdx = 0;
      for (let i = 1; i < target.comments.length; i++) {
        if (
          target.comments[i].body.length >
          target.comments[longestIdx].body.length
        ) {
          longestIdx = i;
        }
      }
      target.comments.splice(longestIdx, 1);
      continue;
    }

    // Tier 3: all comments exhausted -> drop the LAST linked-issue context
    // (tracker iteration order — last-returned first per D-04).
    const removed = included.pop();
    if (removed) {
      dropped.push(removed.ref);
    } else {
      break;
    }
  }

  return { included, dropped, tokensUsed: sumLinkedTokens(included) };
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

export function buildSystemPrompt(
  template: TemplateData,
  _context: GenerationContext,
  quantity?: string,
  autoGenerateTags?: boolean,
  baseTemplate?: string,
  includeParameters?: boolean
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
              exampleValue = [
                {
                  step: "Specific action to perform",
                  expectedResult: "Expected outcome",
                },
                {
                  step: "Another action to verify",
                  expectedResult: "Another expected outcome",
                },
              ];
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

  // Build the example structure with ONLY the fields the template defines.
  // No hardcoded priority, automated, or top-level steps — these only appear
  // if the template includes corresponding fields in fieldValues.
  const baseStructure: any = {
    id: "tc_1",
    name: "Specific test case name based on the issue",
    fieldValues: JSON.parse(fieldValuesJson.trim()),
  };

  if (autoGenerateTags) {
    baseStructure.tags = ["UI", "Functional", "Smoke"];
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
    ? "\n- For the Steps field in fieldValues, provide detailed step objects with 'step' and 'expectedResult' keys"
    : "";
  const priorityField = template.fields.find((f) =>
    f.name.toLowerCase().includes("priority")
  );
  const priorityInstruction = priorityField?.options
    ? `\n- For the ${priorityField.name} field in fieldValues, use ONLY these values: [${priorityField.options.join(", ")}]`
    : "";
  const tagInstructions = autoGenerateTags
    ? '- TAGS: Include 2-4 relevant tags per test case that categorize the test (e.g., "UI", "API", "Security", "Performance", "Integration", "Smoke", "Regression", "Functional", "Edge Case", "Mobile", "Desktop", etc.)'
    : "";

  // INT-06: parameter + starter dataset extension. The block is APPENDED
  // (not interleaved) so omitted/false produces byte-identical output to
  // legacy callers. CRITICAL: emit `parameters` BEFORE `starterDataset` in
  // the per-case JSON output — truncation degrades params-last, not first
  // (Pitfall 6 mitigation).
  const parameterInstructions = includeParameters
    ? buildParameterInstructionBlock(STARTER_DATASET_ROW_CAP)
    : "";

  if (baseTemplate) {
    const rendered = baseTemplate
      .replace("{{EXAMPLE_STRUCTURE}}", exampleStructure)
      .replace("{{REQUIRED_FIELDS_LIST}}", requiredFieldsList)
      .replace("{{OPTIONAL_FIELDS_LIST}}", optionalFieldsList)
      .replace("{{QUANTITY_GUIDANCE}}", quantityGuidance)
      .replace("{{STEPS_INSTRUCTION}}", stepsInstruction)
      .replace("{{PRIORITY_INSTRUCTION}}", priorityInstruction)
      .replace("{{TAG_INSTRUCTIONS}}", tagInstructions);
    return parameterInstructions
      ? `${rendered}\n\n${parameterInstructions}`
      : rendered;
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
- Each test case object must contain ONLY: id, name, fieldValues${autoGenerateTags ? ", tags" : ""}. Do NOT include priority, automated, steps, or any other top-level keys.
- ALL data belongs inside fieldValues using the exact field names shown above
- Each test case name should reference the actual feature/functionality being tested${stepsInstruction}${priorityInstruction}
- CRITICAL: ALL REQUIRED FIELDS must be included in fieldValues with meaningful content
- IMPORTANT: Include ALL optional fields in fieldValues
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
- IMPORTANT: If existing test cases are provided, use them to understand the testing patterns, step granularity, and domain terminology used in this project. Generate new cases that complement the existing coverage — do NOT duplicate or substantially overlap with them.
${parameterInstructions ? `\n${parameterInstructions}\n` : ""}
Return ONLY the JSON.`;
}

/**
 * INT-06: append parameter + starterDataset instructions to the case-generation
 * prompt. Pitfall 6: instructs the LLM to emit `parameters` BEFORE
 * `starterDataset` so truncation drops the dataset (recoverable) rather than
 * the parameter schema (foundational).
 */
function buildParameterInstructionBlock(rowCap: number): string {
  return `PARAMETERS AND STARTER DATASET (additional per-case keys):
- For EACH test case object, add two NEW top-level keys AFTER fieldValues:
  1. "parameters": an array of parameter objects (emit this BEFORE starterDataset).
  2. "starterDataset": an array of dataset rows that exercise the parameters.
- CRITICAL: emit "parameters" BEFORE "starterDataset" in the JSON. If the
  response is truncated, parameters must still parse — the dataset can be
  rebuilt manually but the schema cannot.

Parameter object shape (per entry in parameters[]):
{
  "name": "snake_case_lowercase",          // letters/digits/underscores, starts with a letter
  "type": "STRING" | "INTEGER" | "BOOLEAN" | "SELECT",
  "sensitive": false,                       // true ONLY for secrets/PII
  "allowedValuesJson": ["a", "b", "c"]     // REQUIRED for SELECT, OMIT for non-SELECT
}

- Use snake_case lowercase names (e.g., "user_role", "max_attempts").
- For SELECT type, "allowedValuesJson" MUST be a non-empty array of strings —
  the values the SELECT can take. Use the field name "allowedValuesJson"
  exactly (NOT "allowedValues").
- For STRING, INTEGER, BOOLEAN: OMIT "allowedValuesJson" entirely.
- Mark "sensitive": true ONLY if the parameter carries credentials, tokens,
  PII, or similar — sensitive values render as [REDACTED] in audit logs.

Starter dataset row shape (per entry in starterDataset[]):
{
  "label": "optional human-readable label",
  "values": { "param_name_1": <value>, "param_name_2": <value> }
}

- Row count is your call based on coverage needs:
  * 2-10 rows for simple scenarios (happy path + one-or-two edge cases).
  * Up to 20 rows for combinatorial cases that exercise multiple params.
  * Hard cap: ${rowCap} rows. Anything beyond will be truncated.
- "values" keys MUST match the "name" fields you defined in parameters[].
- Value types must match the parameter type: STRING → string, INTEGER → number,
  BOOLEAN → true/false, SELECT → one of the allowedValuesJson strings.

Worked example (single test case for a login feature with a "role" SELECT and a "remember_me" BOOLEAN):
{
  "id": "tc_1",
  "name": "Login succeeds for each role with remember-me toggled",
  "fieldValues": { /* template fields here */ },
  "parameters": [
    { "name": "role", "type": "SELECT", "sensitive": false, "allowedValuesJson": ["admin", "user", "guest"] },
    { "name": "remember_me", "type": "BOOLEAN", "sensitive": false }
  ],
  "starterDataset": [
    { "label": "admin, remember on",  "values": { "role": "admin", "remember_me": true } },
    { "label": "user, remember off",  "values": { "role": "user",  "remember_me": false } },
    { "label": "guest, remember off", "values": { "role": "guest", "remember_me": false } }
  ]
}`;
}

export function buildUserPrompt(
  issue: IssueData,
  context: GenerationContext,
  baseTemplate?: string
): string {
  let commentsSection = "";
  if (issue.comments && issue.comments.length > 0) {
    commentsSection = `\n\nRELEVANT COMMENTS:`;
    issue.comments.forEach((c, i) => {
      commentsSection += `\n${i + 1}. ${c.author}: ${c.body}`;
    });
  }

  let linkedIssuesSection = "";
  if (context.linkedIssues && context.linkedIssues.length > 0) {
    linkedIssuesSection = `\n\nRELATED LINKED ISSUES:`;
    context.linkedIssues.forEach((li, i) => {
      const idLabel = li.ref.key ?? li.ref.id;
      linkedIssuesSection += `\n${i + 1}. ${idLabel} (${li.ref.linkType}, ${li.ref.direction}): ${li.title}`;
      if (li.body) {
        linkedIssuesSection += `\n   Body: ${li.body}`;
      }
      if (li.comments.length > 0) {
        li.comments.forEach((c, ci) => {
          linkedIssuesSection += `\n   Comment ${ci + 1} (${c.author}): ${c.body}`;
        });
      }
    });
  }

  let userNotesSection = "";
  if (context.userNotes) {
    userNotesSection = `\n\nADDITIONAL TESTING GUIDANCE: ${context.userNotes}`;
  }

  let existingCasesSection = "";
  if (context.existingTestCases && context.existingTestCases.length > 0) {
    existingCasesSection = `\n\nEXISTING TEST CASES IN FOLDER:`;
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
    existingCasesSection += `\n\nUse these existing test cases to understand the testing patterns, step granularity, and domain terminology used in this project. Generate new cases that complement — not duplicate — the existing coverage. Each new test case must cover different functionality, scenarios, or edge cases not already tested.`;
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
      .replace("{{LINKED_ISSUES_SECTION}}", linkedIssuesSection)
      .replace("{{USER_NOTES_SECTION}}", userNotesSection)
      .replace("{{EXISTING_CASES_SECTION}}", existingCasesSection);
  }

  let prompt = `ISSUE TO TEST: ${issue.key} - "${issue.title}"

ISSUE DETAILS:
${issue.description || "No description provided"}

STATUS: ${issue.status}${issue.priority ? ` | PRIORITY: ${issue.priority}` : ""}`;

  prompt += commentsSection;
  prompt += linkedIssuesSection;
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
// Two-phase generation: outline + expand
// ---------------------------------------------------------------------------

export interface TestCaseOutline {
  title: string;
  summary: string;
}

export function buildOutlineSystemPrompt(quantity?: string): string {
  const quantityGuidance = quantity ? getQuantityGuidance(quantity) : "3-5";
  return `You are a test case planning assistant. Given a software issue, generate a concise list of test case titles and one-sentence summaries.

CRITICAL: Respond with ONLY valid JSON. No explanations, no text before or after.

JSON structure (EXACT format required):
{
  "outlines": [
    { "title": "Descriptive test case name", "summary": "One sentence describing what this test validates." }
  ]
}

REQUIREMENTS:
- Generate ${quantityGuidance}
- Each title must be specific to the issue — no generic names
- Each summary must be a single sentence explaining what the test validates
- Titles and summaries must be distinct — no duplicates or overlapping coverage
- Do NOT include field values, steps, or any other detail — only title and summary

Return ONLY the JSON.`;
}

export function buildOutlineUserPrompt(
  issue: IssueData,
  context: GenerationContext
): string {
  let prompt = `ISSUE TO TEST: ${issue.key} - "${issue.title}"

ISSUE DETAILS:
${issue.description || "No description provided"}

STATUS: ${issue.status}${issue.priority ? ` | PRIORITY: ${issue.priority}` : ""}`;

  if (context.userNotes) {
    prompt += `\n\nADDITIONAL TESTING GUIDANCE: ${context.userNotes}`;
  }

  prompt += `\n\nGenerate a list of test case titles and one-sentence summaries that cover the key scenarios for this issue.`;
  return prompt;
}

export function buildExpandSystemPrompt(
  template: TemplateData,
  autoGenerateTags?: boolean,
  baseTemplate?: string,
  includeParameters?: boolean
): string {
  return buildSystemPrompt(
    template,
    { folderContext: 0 },
    "just_one",
    autoGenerateTags,
    baseTemplate,
    includeParameters
  );
}

export function buildExpandUserPrompt(
  issue: IssueData,
  outline: TestCaseOutline,
  context: GenerationContext,
  baseTemplate?: string
): string {
  const outlineSection = `\n\nTEST CASE TO GENERATE:\nTitle: "${outline.title}"\nSummary: ${outline.summary}\n\nGenerate a complete test case for the title and summary above. The test case must match that title exactly.`;

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
      .replace("{{COMMENTS_SECTION}}", "")
      .replace("{{LINKED_ISSUES_SECTION}}", "")
      .replace(
        "{{USER_NOTES_SECTION}}",
        context.userNotes
          ? `\n\nADDITIONAL TESTING GUIDANCE: ${context.userNotes}`
          : ""
      )
      .replace("{{EXISTING_CASES_SECTION}}", outlineSection);
  }

  let prompt = `ISSUE TO TEST: ${issue.key} - "${issue.title}"

ISSUE DETAILS:
${issue.description || "No description provided"}

STATUS: ${issue.status}${issue.priority ? ` | PRIORITY: ${issue.priority}` : ""}`;

  if (context.userNotes) {
    prompt += `\n\nADDITIONAL TESTING GUIDANCE: ${context.userNotes}`;
  }

  prompt += outlineSection;
  return prompt;
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
  quantity?: string
): {
  testCases: GeneratedTestCase[];
  warnings?: ParseWarning[];
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
            const afterLastQuote = incompleteJson.substring(lastQuoteIndex + 1);

            if (afterLastQuote.trim() && !afterLastQuote.trim().endsWith('"')) {
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
                fieldValues: template.fields.reduce(
                  (acc, field) => {
                    acc[field.name] = field.options?.[0] || "To be determined";
                    return acc;
                  },
                  {} as Record<string, string>
                ),
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
  const warnings: ParseWarning[] = [];
  const testCases =
    parsedResponse.testCases?.map((tc, index) => {
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

      // If the LLM put steps at the top level instead of in fieldValues,
      // move them into fieldValues for any Steps-type field
      if (Array.isArray(tc.steps) && tc.steps.length > 0) {
        const stepsFieldDef = template.fields.find(
          (f) =>
            f.type.toLowerCase() === "steps" || f.name.toLowerCase() === "steps"
        );
        if (stepsFieldDef && !validatedFieldValues[stepsFieldDef.name]) {
          validatedFieldValues[stepsFieldDef.name] = tc.steps;
        }
      }

      // If the LLM put priority at the top level instead of in fieldValues,
      // move it into fieldValues for any priority-like field
      if (tc.priority && typeof tc.priority === "string") {
        const priorityFieldDef = template.fields.find((f) =>
          f.name.toLowerCase().includes("priority")
        );
        if (priorityFieldDef && !validatedFieldValues[priorityFieldDef.name]) {
          validatedFieldValues[priorityFieldDef.name] = tc.priority;
        }
      }

      // INT-06: extract + validate parameters and starterDataset when
      // present. ABSENT keys preserve legacy behavior (no fields, no
      // warnings). PRESENT-but-invalid degrades per Pitfall 6.
      const rawTc = tc as GeneratedTestCase & {
        parameters?: unknown;
        starterDataset?: unknown;
      };
      const out: GeneratedTestCase = {
        id: tc.id || `generated_${Date.now()}_${index}`,
        name: tc.name || `Test Case ${index + 1}`,
        fieldValues: validatedFieldValues,
        tags: Array.isArray(tc.tags)
          ? tc.tags
              .filter((tag) => typeof tag === "string" && tag.trim().length > 0)
              .map((tag) => tag.trim())
          : [],
      };

      if (rawTc.parameters !== undefined) {
        const { parameters, paramWarnings } = validateLlmParameters(
          rawTc.parameters,
          index
        );
        out.parameters = parameters;
        warnings.push(...paramWarnings);
      }

      if (rawTc.starterDataset !== undefined) {
        const { rows, datasetWarnings } = validateLlmStarterDataset(
          rawTc.starterDataset,
          index
        );
        out.starterDataset = rows;
        warnings.push(...datasetWarnings);
      }

      return out;
    }) || [];

  return warnings.length > 0 ? { testCases, warnings } : { testCases };
}

/**
 * INT-06: validate the LLM-emitted parameters[] array against the LLM-side
 * superset of parameterCreateSchema. Per-parameter validation failures
 * surface as `invalid_parameter:<name>` warnings and the bad entry is
 * dropped — they do NOT reject the whole case (per Pitfall 6 / D-12).
 */
function validateLlmParameters(
  raw: unknown,
  caseIndex: number
): { parameters: LlmParameter[]; paramWarnings: ParseWarning[] } {
  const paramWarnings: ParseWarning[] = [];
  if (!Array.isArray(raw)) {
    paramWarnings.push({
      caseIndex,
      message: "parameters_truncated",
    });
    return { parameters: [], paramWarnings };
  }

  const parameters: LlmParameter[] = [];
  for (const entry of raw) {
    const parsed = llmParameterSchema.safeParse(entry);
    if (parsed.success) {
      const value: LlmParameter = {
        name: parsed.data.name,
        type: parsed.data.type,
        sensitive: parsed.data.sensitive,
      };
      if (parsed.data.allowedValuesJson) {
        value.allowedValuesJson = parsed.data.allowedValuesJson;
      }
      parameters.push(value);
    } else {
      const name =
        entry && typeof entry === "object" && "name" in entry
          ? String((entry as { name: unknown }).name)
          : "<unknown>";
      paramWarnings.push({
        caseIndex,
        message: `invalid_parameter:${name}`,
      });
    }
  }

  return { parameters, paramWarnings };
}

/**
 * INT-06: validate the LLM-emitted starterDataset[] array. Pitfall 6:
 * a structurally-broken dataset (truncation) surfaces a `dataset_truncated`
 * warning and returns an empty array — the parameters survive. Excess
 * rows beyond the cap are truncated with a `dataset_capped` warning.
 */
function validateLlmStarterDataset(
  raw: unknown,
  caseIndex: number
): { rows: LlmStarterDatasetRow[]; datasetWarnings: ParseWarning[] } {
  const datasetWarnings: ParseWarning[] = [];
  if (!Array.isArray(raw)) {
    datasetWarnings.push({
      caseIndex,
      message: "dataset_truncated",
    });
    return { rows: [], datasetWarnings };
  }

  const rows: LlmStarterDatasetRow[] = [];
  const cap = STARTER_DATASET_ROW_CAP;
  let capped = false;
  for (let i = 0; i < raw.length; i++) {
    if (rows.length >= cap) {
      capped = true;
      break;
    }
    const parsed = llmStarterDatasetRowSchema.safeParse(raw[i]);
    if (parsed.success) {
      const row: LlmStarterDatasetRow = { values: parsed.data.values };
      if (parsed.data.label !== undefined) row.label = parsed.data.label;
      rows.push(row);
    } else {
      datasetWarnings.push({
        caseIndex,
        message: `invalid_dataset_row:${i}`,
      });
    }
  }

  if (capped) {
    datasetWarnings.push({ caseIndex, message: "dataset_capped" });
  }

  return { rows, datasetWarnings };
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
    while (
      i < len &&
      (text[i] === " " ||
        text[i] === "\n" ||
        text[i] === "\r" ||
        text[i] === "\t" ||
        text[i] === ",")
    )
      i++;
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
  template: TemplateData
): GeneratedTestCase {
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

  // If the LLM put steps at the top level, move into fieldValues
  if (Array.isArray(tc.steps) && tc.steps.length > 0) {
    const stepsFieldDef = template.fields.find(
      (f) =>
        f.type.toLowerCase() === "steps" || f.name.toLowerCase() === "steps"
    );
    if (stepsFieldDef && !validatedFieldValues[stepsFieldDef.name]) {
      validatedFieldValues[stepsFieldDef.name] = tc.steps;
    }
  }

  // If the LLM put priority at the top level, move into fieldValues
  if (tc.priority && typeof tc.priority === "string") {
    const priorityFieldDef = template.fields.find((f) =>
      f.name.toLowerCase().includes("priority")
    );
    if (priorityFieldDef && !validatedFieldValues[priorityFieldDef.name]) {
      validatedFieldValues[priorityFieldDef.name] = tc.priority;
    }
  }

  return {
    id: tc.id || `generated_${Date.now()}_${index}`,
    name: tc.name || `Test Case ${index + 1}`,
    fieldValues: validatedFieldValues,
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
  alreadyYielded: number
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
