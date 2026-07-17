/**
 * Shared, auth-agnostic core for QuickScript (AI test-script) generation.
 *
 * This is the single source of truth previously duplicated across the in-app
 * server actions (`app/actions/aiExportActions.ts`) and the SSE route
 * (`app/api/export/ai-stream/route.ts`). It takes an explicit `userId` (for LLM
 * usage attribution) and never touches the session, so it can be driven by the
 * session-authed modal, the API-token route (MCP / external clients), and the
 * Forge (Jira panel) streaming route alike.
 *
 * Generation resolves the project's assigned export template and — when the
 * project has a connected code repository — pulls repo context so the LLM
 * follows the repo's existing framework/fixtures/page objects. With no repo it
 * falls back to standard patterns for the template's framework. On any LLM
 * failure (or when no LLM integration resolves) it falls back to the
 * deterministic Mustache-rendered template.
 */

import { format } from "date-fns";
import { baseDb } from "~/lib/db";
import { LLM_FEATURES } from "~/lib/llm/constants";
import { CodeContextService } from "~/lib/llm/services/code-context.service";
import { LlmManager } from "~/lib/llm/services/llm-manager.service";
import { PromptResolver } from "~/lib/llm/services/prompt-resolver.service";
import type { LlmRequest } from "~/lib/llm/types";
import { formatRecordKey, RECORD_TYPES } from "~/lib/recordKey";
import { readRecordKeyConfig } from "~/lib/services/recordKeyConfig";
import { resolveSharedSteps } from "~/lib/utils/resolveSharedSteps";
import { formatAiError, stripMarkdownFences } from "~/utils/ai-export-helpers";
import { extractTextFromNode } from "~/utils/extractTextFromJson";

/** Canonical shape passed to the generation prompt for a single test case. */
export interface QuickScriptCaseData {
  name: string;
  id: number;
  displayKey: string | null;
  folder: string;
  state: string;
  estimate: number | null;
  automated: boolean;
  tags: string;
  createdBy: string;
  createdAt: string;
  steps: Array<{
    order: number;
    step: string;
    expectedResult: string;
  }>;
  fields: Record<string, string>;
}

/** Result of a QuickScript generation for one output file. */
export interface QuickScriptResult {
  code: string;
  generatedBy: "ai" | "template";
  /** Present when generatedBy=template due to failure / no LLM integration. */
  error?: string;
  /** True when the AI hit its token limit and output was cut off. */
  truncated?: boolean;
  caseId: number;
  caseName: string;
  /** File paths included in AI context (absent when no repo is connected). */
  contextFiles?: string[];
}

/**
 * `single` renders one case using the resolved prompt's per-case placeholders
 * ({{CASE_NAME}}/{{STEPS_TEXT}}/{{CODE_CONTEXT}}). `batch` combines all cases
 * into one file via a dedicated combined prompt.
 */
export type QuickScriptMode = "single" | "batch";

export interface QuickScriptGenerationInput {
  projectId: number;
  templateId: number;
  cases: QuickScriptCaseData[];
  /** LLM usage is attributed to this user. */
  userId: string;
  mode: QuickScriptMode;
}

type ExportTemplate = NonNullable<
  Awaited<ReturnType<typeof baseDb.caseExportTemplate.findUnique>>
>;

const EMPTY_CONTEXT = {
  context: "",
  filesUsed: [] as string[],
  tokenEstimate: 0,
  truncated: false,
};

function noContextNote(framework: string | null): string {
  return `No repository context available. Generate test code using standard ${
    framework || "framework"
  } patterns and best practices.`;
}

/**
 * Load Mustache and configure escaping so backslashes/quotes in generated code
 * survive template rendering (matches the previous in-app behavior).
 */
async function getMustache() {
  const Mustache = (await import("mustache")).default;
  Mustache.escape = (text: string) =>
    String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return Mustache;
}

/** Rendered Mustache pieces used for the deterministic fallback + syntax hint. */
interface RenderedTemplate {
  header: string;
  footer: string;
  /** Full deterministic fallback (header + body/bodies + footer). */
  fallback: string;
  /** One rendered body, used as the FRAMEWORK SYNTAX EXAMPLE in the prompt. */
  syntaxExample: string;
}

async function renderTemplate(
  template: ExportTemplate,
  cases: QuickScriptCaseData[],
  mode: QuickScriptMode
): Promise<RenderedTemplate> {
  const Mustache = await getMustache();
  const first = cases[0];
  const header = template.headerBody
    ? Mustache.render(template.headerBody, first)
    : "";
  const footer = template.footerBody
    ? Mustache.render(template.footerBody, first)
    : "";

  if (mode === "single") {
    const body = Mustache.render(template.templateBody, first);
    return {
      header,
      footer,
      fallback: [header, body, footer].filter(Boolean).join("\n\n"),
      syntaxExample: body,
    };
  }

  const bodies = cases.map((c) => Mustache.render(template.templateBody, c));
  return {
    header,
    footer,
    fallback: [header, ...bodies, footer].filter(Boolean).join("\n\n"),
    syntaxExample: bodies[0] ?? "",
  };
}

function stepsText(caseData: QuickScriptCaseData): string {
  return caseData.steps
    .map((s) => `${s.order}. ${s.step}\n   Expected: ${s.expectedResult}`)
    .join("\n");
}

/** Assemble the system + user prompts, mirroring the previous in-app logic. */
function buildPrompts(args: {
  template: ExportTemplate;
  cases: QuickScriptCaseData[];
  mode: QuickScriptMode;
  rendered: RenderedTemplate;
  context: string;
  resolvedSystemPrompt: string;
  resolvedUserPrompt: string;
}): { systemPrompt: string; userPrompt: string } {
  const { template, cases, mode, rendered, context } = args;

  const systemPrompt = args.resolvedSystemPrompt
    .replace(/\{\{FRAMEWORK\}\}/g, template.framework || "unknown")
    .replace(/\{\{LANGUAGE\}\}/g, template.language || "unknown");

  let userPrompt: string;
  if (mode === "single") {
    userPrompt = args.resolvedUserPrompt
      .replace(/\{\{CASE_NAME\}\}/g, cases[0].name)
      .replace(/\{\{STEPS_TEXT\}\}/g, stepsText(cases[0]))
      .replace(
        /\{\{CODE_CONTEXT\}\}/g,
        context || noContextNote(template.framework)
      );
  } else {
    const casesText = cases
      .map(
        (caseData, idx) =>
          `--- Test Case ${idx + 1}: ${caseData.name} ---\n${stepsText(
            caseData
          )}`
      )
      .join("\n\n");
    const contextSection = context
      ? `REPOSITORY CONTEXT:\n${context}`
      : noContextNote(template.framework);
    userPrompt = `Generate a single complete ${
      template.language || ""
    } test file that contains ALL ${
      cases.length
    } test cases below. Use a single set of imports at the top of the file — do not repeat imports between tests.\n\n${casesText}\n\n${contextSection}`;
  }

  if (rendered.header) {
    userPrompt += `\n\nDEFAULT HEADER (use as a starting point — extend or modify imports/setup as needed based on the repository context):\n\`\`\`\n${rendered.header}\n\`\`\``;
  }
  if (rendered.footer) {
    userPrompt += `\n\nDEFAULT FOOTER (use as a starting point — extend or modify teardown as needed):\n\`\`\`\n${rendered.footer}\n\`\`\``;
  }
  // FRAMEWORK SYNTAX EXAMPLE — the rendered template body shows the framework's
  // actual API shape (fixture destructuring, locator helpers, assertion style).
  // Without it the model only sees the framework name + a one-line import, and
  // for niche/new frameworks (or any whose package name resembles a
  // more-popular neighbor's) it silently substitutes the neighbor's API.
  if (rendered.syntaxExample) {
    userPrompt += `\n\nFRAMEWORK SYNTAX EXAMPLE — this is what one rendered test from the template looks like. Match this API shape (imports, fixtures, locators, action methods, assertion style) when writing the cases above. Do not substitute APIs from a similarly-named framework you happen to know better:\n\`\`\`\n${rendered.syntaxExample}\n\`\`\``;
  }

  return { systemPrompt, userPrompt };
}

type PreparedQuickScript =
  | { status: "fallback"; result: QuickScriptResult }
  | {
      status: "ready";
      request: LlmRequest;
      integrationId: number;
      mustacheFallback: string;
      contextFiles: string[];
      caseId: number;
      caseName: string;
    };

function outputMeta(
  cases: QuickScriptCaseData[],
  mode: QuickScriptMode
): { caseId: number; caseName: string } {
  return {
    caseId: cases[0].id,
    caseName:
      mode === "batch" ? `Combined (${cases.length} tests)` : cases[0].name,
  };
}

/**
 * Resolve everything needed to run generation: template render, prompt
 * resolution, LLM integration, token budget, repo context, and the assembled
 * LlmRequest. Returns a `fallback` result when no LLM integration resolves.
 */
async function prepareQuickScript(
  input: QuickScriptGenerationInput
): Promise<PreparedQuickScript> {
  const { projectId, templateId, cases, mode, userId } = input;
  const { caseId, caseName } = outputMeta(cases, mode);

  const template = await baseDb.caseExportTemplate.findUnique({
    where: { id: templateId },
  });
  if (!template) {
    throw new Error(`Export template not found: ${templateId}`);
  }

  const rendered = await renderTemplate(template, cases, mode);

  const resolver = new PromptResolver(baseDb);
  const resolvedPrompt = await resolver.resolve(
    LLM_FEATURES.EXPORT_CODE_GENERATION,
    projectId
  );

  const llmManager = LlmManager.getInstance(baseDb);
  const resolved = await llmManager.resolveIntegration(
    LLM_FEATURES.EXPORT_CODE_GENERATION,
    projectId,
    resolvedPrompt
  );

  if (!resolved) {
    return {
      status: "fallback",
      result: {
        code: rendered.fallback,
        generatedBy: "template",
        error: "No active LLM integration",
        caseId,
        caseName,
      },
    };
  }

  // Token budget. maxTokensPerRequest is the hard ceiling enforced by the base
  // adapter's validateRequest(); defaultMaxTokens is the context budget.
  const providerConfig = await baseDb.llmProviderConfig.findFirst({
    where: { llmIntegrationId: resolved.integrationId },
    select: { defaultMaxTokens: true, maxTokensPerRequest: true },
  });
  const maxContextTokens = providerConfig?.defaultMaxTokens || 8000;
  const outputTokenCap = providerConfig?.maxTokensPerRequest ?? Infinity;

  // Assemble code context when the project has a connected repository.
  const repoConfig = await baseDb.projectCodeRepositoryConfig.findUnique({
    where: { projectId },
    select: { id: true },
  });

  let contextResult = EMPTY_CONTEXT;
  if (repoConfig) {
    const relevanceHint = cases
      .flatMap((c) => [
        c.name,
        ...c.steps.map((s) => `${s.step} ${s.expectedResult}`),
      ])
      .join(" ");
    try {
      contextResult = await CodeContextService.assembleContext(
        repoConfig.id,
        maxContextTokens,
        relevanceHint
      );
    } catch (err) {
      // Repo context is an optional enhancement — a provider hiccup (e.g. the
      // git host rate-limiting a live content fetch when the cache is sparse)
      // must degrade to no-context generation, not fail the whole request.
      console.warn(
        "[quickscript-generation] repo context unavailable, generating without it:",
        err
      );
      contextResult = EMPTY_CONTEXT;
    }
  }

  const { systemPrompt, userPrompt } = buildPrompts({
    template,
    cases,
    mode,
    rendered,
    context: contextResult.context,
    resolvedSystemPrompt: resolvedPrompt.systemPrompt,
    resolvedUserPrompt: resolvedPrompt.userPrompt,
  });

  const request: LlmRequest = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: resolvedPrompt.temperature,
    // Cap output at the provider's hard ceiling so we never throw MAX_TOKENS_EXCEEDED.
    maxTokens: Math.min(resolvedPrompt.maxOutputTokens, outputTokenCap),
    userId,
    projectId,
    feature: LLM_FEATURES.EXPORT_CODE_GENERATION,
    ...(resolved.model ? { model: resolved.model } : {}),
  };

  return {
    status: "ready",
    request,
    integrationId: resolved.integrationId,
    mustacheFallback: rendered.fallback,
    contextFiles: contextResult.filesUsed,
    caseId,
    caseName,
  };
}

/**
 * Generate a QuickScript synchronously (full script text in one response).
 * Falls back to the deterministic Mustache render on LLM failure / no integration.
 */
export async function generateQuickScript(
  input: QuickScriptGenerationInput
): Promise<QuickScriptResult> {
  const prepared = await prepareQuickScript(input);
  if (prepared.status === "fallback") {
    return prepared.result;
  }

  const llmManager = LlmManager.getInstance(baseDb);
  try {
    const response = await llmManager.chat(
      prepared.integrationId,
      prepared.request
    );
    return {
      code: stripMarkdownFences(response.content),
      generatedBy: "ai",
      caseId: prepared.caseId,
      caseName: prepared.caseName,
      contextFiles: prepared.contextFiles,
    };
  } catch (err) {
    console.error(
      "[quickscript-generation] LLM generation failed, falling back to template:",
      err
    );
    return {
      code: prepared.mustacheFallback,
      generatedBy: "template",
      error: formatAiError(err),
      caseId: prepared.caseId,
      caseName: prepared.caseName,
    };
  }
}

export type QuickScriptStreamEvent =
  | { type: "chunk"; delta: string }
  | { type: "fallback"; code: string; error?: string }
  | {
      type: "done";
      generatedBy: "ai";
      contextFiles: string[];
      finishReason?: string;
    }
  | { type: "error"; message: string };

/**
 * Generate a QuickScript as a stream of events. Setup failures surface as an
 * `error` event; LLM failures fall back to the Mustache render via a `fallback`
 * event, matching the in-app SSE route's contract.
 */
export async function* streamQuickScript(
  input: QuickScriptGenerationInput
): AsyncGenerator<QuickScriptStreamEvent> {
  let prepared: PreparedQuickScript;
  try {
    prepared = await prepareQuickScript(input);
  } catch (err) {
    yield {
      type: "error",
      message: err instanceof Error ? err.message : "Internal server error",
    };
    return;
  }

  if (prepared.status === "fallback") {
    yield {
      type: "fallback",
      code: prepared.result.code,
      error: prepared.result.error,
    };
    return;
  }

  const llmManager = LlmManager.getInstance(baseDb);
  try {
    let finishReason: string | undefined;
    for await (const chunk of llmManager.chatStream(prepared.integrationId, {
      ...prepared.request,
      timeout: 0, // No timeout for streaming — allow the full response to arrive.
    })) {
      if (chunk.finishReason) finishReason = chunk.finishReason;
      if (chunk.delta) yield { type: "chunk", delta: chunk.delta };
    }
    yield {
      type: "done",
      generatedBy: "ai",
      contextFiles: prepared.contextFiles,
      finishReason,
    };
  } catch (err) {
    console.error("[quickscript-generation] LLM stream failed:", err);
    yield {
      type: "fallback",
      code: prepared.mustacheFallback,
      error: formatAiError(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Resolvers used by the external entry points (they have no session and can't
// use the in-app ZenStack hooks the modal relies on).
// ---------------------------------------------------------------------------

/**
 * Resolve the export template a QuickScript should use for a project, mirroring
 * the in-app modal's precedence:
 *   explicit templateId → project default → global isDefault → first available.
 * Candidate set is the project's assigned enabled templates, or every enabled
 * template when the project has no assignments (backward-compatible default).
 * Returns null when nothing usable resolves, or when an explicit template isn't
 * available for the project.
 */
export async function resolveQuickScriptTemplate(
  projectId: number,
  templateId?: number | null
): Promise<ExportTemplate | null> {
  const assignments = await baseDb.caseExportTemplateProjectAssignment.findMany(
    {
      where: { projectId },
      select: { templateId: true },
    }
  );
  const assignedIds = new Set(assignments.map((a) => a.templateId));

  if (templateId != null) {
    const explicit = await baseDb.caseExportTemplate.findFirst({
      where: { id: templateId, isDeleted: false, isEnabled: true },
    });
    if (!explicit) return null;
    // When the project scopes templates, the explicit id must be in scope.
    if (assignedIds.size > 0 && !assignedIds.has(explicit.id)) return null;
    return explicit;
  }

  const candidates = await baseDb.caseExportTemplate.findMany({
    where: {
      isDeleted: false,
      isEnabled: true,
      ...(assignedIds.size > 0 ? { id: { in: [...assignedIds] } } : {}),
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  if (candidates.length === 0) return null;

  const project = await baseDb.projects.findUnique({
    where: { id: projectId },
    select: { defaultCaseExportTemplateId: true },
  });
  if (project?.defaultCaseExportTemplateId) {
    const projectDefault = candidates.find(
      (t) => t.id === project.defaultCaseExportTemplateId
    );
    if (projectDefault) return projectDefault;
  }

  return candidates.find((t) => t.isDefault) ?? candidates[0];
}

export interface QuickScriptReadiness {
  quickScriptEnabled: boolean;
  hasActiveLlm: boolean;
  hasCodeContext: boolean;
}

/**
 * Whether a project can run QuickScript generation: the feature must be enabled
 * and a reachable LLM integration (project-scoped or a global fallback) must
 * exist. `hasCodeContext` is informational (a connected repo improves output
 * but is not required).
 */
export async function getQuickScriptReadiness(
  projectId: number
): Promise<QuickScriptReadiness> {
  const [project, projectLlmCount, globalLlmCount, hasCodeContext] =
    await Promise.all([
      baseDb.projects.findUnique({
        where: { id: projectId },
        select: { quickScriptEnabled: true },
      }),
      baseDb.projectLlmIntegration.count({
        where: {
          projectId,
          isActive: true,
          llmIntegration: { status: "ACTIVE", isDeleted: false },
        },
      }),
      baseDb.llmIntegration.count({
        where: { status: "ACTIVE", isDeleted: false },
      }),
      CodeContextService.checkProjectHasCodeContext(projectId),
    ]);

  return {
    quickScriptEnabled: project?.quickScriptEnabled ?? false,
    hasActiveLlm: projectLlmCount > 0 || globalLlmCount > 0,
    hasCodeContext,
  };
}

/**
 * Build `QuickScriptCaseData` for the given cases without a session. Shared
 * step references are expanded and custom field values are flattened to display
 * strings. Returns only non-deleted cases in the project (silently omits ids
 * that don't match, so callers should enforce their own ownership guard).
 */
export async function fetchQuickScriptCases(
  projectId: number,
  caseIds: number[]
): Promise<QuickScriptCaseData[]> {
  const cases = (await baseDb.repositoryCases.findMany({
    where: {
      id: { in: caseIds },
      projectId,
      isDeleted: false,
    },
    include: {
      folder: true,
      state: true,
      creator: true,
      project: { select: { key: true } },
      caseTags: {
        where: { tag: { isDeleted: false } },
        include: { tag: true },
      },
      steps: {
        where: { isDeleted: false },
        orderBy: { order: "asc" },
        select: {
          id: true,
          step: true,
          expectedResult: true,
          order: true,
          isDeleted: true,
          sharedStepGroupId: true,
        },
      },
      caseFieldValues: {
        include: {
          field: {
            include: {
              type: true,
              fieldOptions: { include: { fieldOption: true } },
            },
          },
        },
      },
    },
  })) as any[];

  const resolvedCases = await resolveSharedSteps(cases);

  const { enabled: recordKeyEnabled, tokens: recordKeyTokens } =
    await readRecordKeyConfig(baseDb);

  return resolvedCases.map((c: any) => {
    const fields: Record<string, string> = {};

    for (const cfv of c.caseFieldValues || []) {
      const fieldType = cfv.field?.type?.type;
      const systemName = cfv.field?.systemName;
      if (!systemName) continue;

      let displayValue = "";

      if (cfv.value === null || cfv.value === undefined) {
        displayValue = "";
      } else if (fieldType === "Dropdown" || fieldType === "Multi Select") {
        const optionMap = new Map<number, string>(
          (cfv.field.fieldOptions || []).map((fo: any) => [
            fo.fieldOption.id,
            fo.fieldOption.name,
          ])
        );
        if (Array.isArray(cfv.value)) {
          displayValue = (cfv.value as number[])
            .map((id: number) => optionMap.get(id) || String(id))
            .join(", ");
        } else {
          displayValue =
            optionMap.get(cfv.value as number) || String(cfv.value);
        }
      } else if (
        fieldType === "Step Editor" ||
        fieldType === "Text Long" ||
        fieldType === "Text"
      ) {
        displayValue = extractTextFromNode(cfv.value);
      } else if (fieldType === "Checkbox") {
        displayValue = cfv.value ? "Yes" : "No";
      } else if (fieldType === "Date") {
        try {
          displayValue = format(new Date(cfv.value as string), "yyyy-MM-dd");
        } catch {
          displayValue = String(cfv.value);
        }
      } else {
        displayValue = String(cfv.value);
      }

      fields[systemName] = displayValue;
    }

    return {
      name: c.name,
      id: c.id,
      displayKey: recordKeyEnabled
        ? formatRecordKey({
            projectKey: c.project?.key ?? null,
            type: RECORD_TYPES.TEST_CASE,
            id: c.id,
            tokens: recordKeyTokens,
          })
        : null,
      folder: c.folder?.name || "",
      state: c.state?.name || "",
      estimate: c.estimate,
      automated: c.automated,
      tags: (c.caseTags || []).map((ct: any) => ct.tag.name).join(", "),
      createdBy: c.creator?.name || c.creator?.email || "",
      createdAt: format(c.createdAt, "yyyy-MM-dd"),
      steps: (c.steps || []).map((s: any) => ({
        order: s.order + 1,
        step: extractTextFromNode(s.step),
        expectedResult: extractTextFromNode(s.expectedResult),
      })),
      fields,
    };
  });
}
