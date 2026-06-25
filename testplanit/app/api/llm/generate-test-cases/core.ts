/**
 * Shared test-case generation pipeline. This is the LLM half of
 * `/api/llm/generate-test-cases` — everything after the caller has verified
 * that the (authenticated) user may generate into `projectId`. The session
 * route and the Forge-API-key Jira panel route both call this so the prompt
 * building, token budgeting, retry profile, and parse/validate behavior stay
 * identical regardless of how the caller was authenticated.
 *
 * The caller owns access control and the `includeParameters` admin gate;
 * this core assumes both have already been enforced.
 */

import { LLM_FEATURES, SYNC_RETRY_PROFILE } from "@/lib/llm/constants";
import { LlmManager } from "@/lib/llm/services/llm-manager.service";
import { PromptResolver } from "@/lib/llm/services/prompt-resolver.service";
import type { LlmRequest } from "@/lib/llm/types";
import { baseDb } from "@/lib/db";
import {
  buildSystemPrompt,
  buildUserPrompt,
  fetchHierarchyContext,
  parseAndValidateTestCases,
  type GeneratedTestCase,
  type GenerationContext,
  type IssueData,
  type ParseWarning,
  type TemplateData,
} from "./shared";

export interface GenerateTestCasesParams {
  projectId: number;
  issue: IssueData;
  template: TemplateData;
  context: GenerationContext;
  quantity?: string;
  autoGenerateTags?: boolean;
  includeParameters?: boolean;
  /** Used for LLM usage attribution (LlmRequest.userId). */
  userId: string;
}

export interface GenerateTestCasesMetadata {
  issueKey: string;
  templateName: string;
  generatedCount: number;
  model?: string;
  tokens: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
  truncated: boolean;
  truncationNote?: string;
}

export type GenerateTestCasesOutcome =
  | {
      ok: true;
      testCases: GeneratedTestCase[];
      warnings?: ParseWarning[];
      metadata: GenerateTestCasesMetadata;
    }
  | { ok: false; status: number; body: Record<string, unknown> };

export async function generateTestCasesForProject(
  params: GenerateTestCasesParams
): Promise<GenerateTestCasesOutcome> {
  const {
    projectId,
    issue,
    template,
    context,
    quantity,
    autoGenerateTags,
    includeParameters,
    userId,
  } = params;

  const manager = LlmManager.getInstance(baseDb);

  // Resolve prompt template from database (falls back to hard-coded default)
  const resolver = new PromptResolver(baseDb);
  const resolvedPrompt = await resolver.resolve(
    LLM_FEATURES.TEST_CASE_GENERATION,
    projectId
  );

  // Resolve LLM integration via 3-tier chain
  const resolved = await manager.resolveIntegration(
    LLM_FEATURES.TEST_CASE_GENERATION,
    projectId,
    resolvedPrompt
  );
  if (!resolved) {
    return {
      ok: false,
      status: 400,
      body: { error: "No active LLM integration found for this project" },
    };
  }

  // Build the prompts using resolved template as base (or fall back to hard-coded)
  const systemPromptBase =
    resolvedPrompt.source !== "fallback"
      ? resolvedPrompt.systemPrompt
      : undefined;
  const userPromptBase =
    resolvedPrompt.source !== "fallback"
      ? resolvedPrompt.userPrompt || undefined
      : undefined;

  const systemPrompt = buildSystemPrompt(
    template,
    context,
    quantity,
    autoGenerateTags,
    systemPromptBase,
    includeParameters === true
  );

  // TOKEN-02: Read provider config from the resolved integration (not projectLlmIntegrations[0])
  let maxTokensPerRequest = 4096;
  let maxTokens = resolvedPrompt.maxOutputTokens ?? 4096;

  const providerConfig = await (baseDb as any).llmProviderConfig.findFirst({
    where: { llmIntegrationId: resolved.integrationId },
  });
  if (providerConfig) {
    maxTokensPerRequest = providerConfig.maxTokensPerRequest ?? 4096;
    maxTokens =
      providerConfig.defaultMaxTokens ?? resolvedPrompt.maxOutputTokens ?? 4096;
  }

  // TOKEN-05: Calculate content budget
  const CONTENT_BUDGET_RATIO = 0.65;
  const systemPromptTokens = Math.ceil(systemPrompt.length / 4);
  const contentBudget =
    Math.floor(maxTokensPerRequest * CONTENT_BUDGET_RATIO) - systemPromptTokens;

  // Build a base user prompt WITHOUT existing test cases to measure its size
  const contextWithoutCases: GenerationContext = {
    ...context,
    existingTestCases: [],
  };
  const baseUserPrompt = buildUserPrompt(
    issue,
    contextWithoutCases,
    userPromptBase
  );
  const basePromptTokens = Math.ceil(baseUserPrompt.length / 4);

  // Allocate remaining token budget to existing test case context
  const contextTokenBudget = Math.max(0, contentBudget - basePromptTokens);

  // Fetch prioritised context from folder hierarchy (server-side)
  const hierarchyContext =
    contextTokenBudget > 0
      ? await fetchHierarchyContext(
          baseDb,
          projectId,
          context.folderContext,
          contextTokenBudget
        )
      : [];

  const enrichedContext: GenerationContext = {
    ...context,
    existingTestCases: hierarchyContext,
  };
  let userPrompt = buildUserPrompt(issue, enrichedContext, userPromptBase);
  let wasTruncated = false;

  // If still over budget (large issue comments), truncate comments
  let estimatedUserTokens = Math.ceil(userPrompt.length / 4);
  if (estimatedUserTokens > contentBudget) {
    const truncatedIssue = { ...issue };
    if (truncatedIssue.comments && truncatedIssue.comments.length > 0) {
      let comments = [...truncatedIssue.comments];
      while (comments.length > 0) {
        comments = comments.slice(0, -1);
        truncatedIssue.comments = comments;
        userPrompt = buildUserPrompt(
          truncatedIssue,
          enrichedContext,
          userPromptBase
        );
        estimatedUserTokens = Math.ceil(userPrompt.length / 4);
        if (estimatedUserTokens <= contentBudget) break;
      }
      wasTruncated = true;
    }
  }

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
    temperature: resolvedPrompt.temperature,
    maxTokens, // from provider config defaultMaxTokens (TOKEN-02)
    userId,
    feature: "test_case_generation",
    ...(resolved.model ? { model: resolved.model } : {}),
    metadata: {
      projectId,
      issueKey: issue.key,
      templateId: template.id,
      timestamp: new Date().toISOString(),
    },
  };

  const { maxRetries, baseDelayMs } = SYNC_RETRY_PROFILE;
  const response = await manager.chat(resolved.integrationId, llmRequest, {
    maxRetries,
    baseDelayMs,
  });

  // RETRY-03: Check truncation BEFORE JSON parse
  if (response.finishReason === "length") {
    return {
      ok: false,
      status: 422,
      body: {
        error: `Response was truncated (used ${response.totalTokens ?? 0}/${maxTokens} tokens). Try reducing input size or increasing token limit.`,
        truncated: true,
        tokens: {
          used: response.totalTokens ?? 0,
          limit: maxTokens,
          prompt: response.promptTokens ?? 0,
          completion: response.completionTokens ?? 0,
        },
      },
    };
  }

  // Parse & validate the LLM response using shared logic
  const { testCases, parseError, warnings } = parseAndValidateTestCases(
    response.content,
    template,
    issue,
    autoGenerateTags,
    quantity
  );

  if (parseError) {
    return {
      ok: false,
      status: 500,
      body: {
        error: parseError.userError,
        suggestions: parseError.userSuggestions,
        details: parseError.errorMessage,
        responseLength: parseError.responseLength,
        context: {
          quantity: quantity || "several",
          fieldsCount: template.fields?.length || 0,
          autoTagsEnabled: !!autoGenerateTags,
          issueLength: issue.description?.length || 0,
        },
        technical: {
          parseError: parseError.errorMessage,
          responsePreview: parseError.responsePreview,
          seemsTruncated: parseError.seemsTruncated,
        },
      },
    };
  }

  if (testCases.length === 0) {
    return {
      ok: false,
      status: 500,
      body: {
        error: "No valid test cases generated",
        rawLlmResponse: response.content.substring(0, 2000),
      },
    };
  }

  return {
    ok: true,
    testCases,
    ...(warnings && warnings.length > 0 ? { warnings } : {}),
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
      truncated: wasTruncated,
      ...(wasTruncated && {
        truncationNote:
          "Existing test cases and/or comments were trimmed to fit token budget",
      }),
    },
  };
}
