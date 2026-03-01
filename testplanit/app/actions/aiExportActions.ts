"use server";

import { prisma } from "~/lib/prisma";
import { getServerAuthSession } from "~/server/auth";
import { LlmManager } from "~/lib/llm/services/llm-manager.service";
import { PromptResolver } from "~/lib/llm/services/prompt-resolver.service";
import { LLM_FEATURES } from "~/lib/llm/constants";
import { CodeContextService } from "~/lib/llm/services/code-context.service";
import type { QuickScriptCaseData } from "~/app/actions/quickScriptActions";
import type { LlmRequest } from "~/lib/llm/types";

export interface AiExportResult {
  code: string;
  generatedBy: "ai" | "template";
  error?: string; // Present when generatedBy=template due to failure
  truncated?: boolean; // True when the AI hit its token limit and the output was cut off
  caseId: number;
  caseName: string;
  contextFiles?: string[]; // File paths included in AI context (optional for backward compat)
}

/**
 * Check whether AI export is available for a given project.
 * Requires: active LLM integration + code repository with cached files.
 */
export async function checkAiExportAvailable(args: {
  projectId: number;
}): Promise<{ available: boolean; reason?: string }> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return { available: false, reason: "not_authenticated" };
  }

  // Check 1: Active LLM integration exists for this project
  const llmIntegration = await prisma.projectLlmIntegration.findFirst({
    where: { projectId: args.projectId, isActive: true },
  });

  if (!llmIntegration) {
    return { available: false, reason: "no_llm" };
  }

  // Check 2: Code repository configured with cached files
  const hasCodeContext = await CodeContextService.checkProjectHasCodeContext(
    args.projectId
  );

  if (!hasCodeContext) {
    return { available: false, reason: "no_repo" };
  }

  return { available: true };
}

/**
 * Generate AI-powered export code for a single test case.
 *
 * Orchestrates: prompt resolution -> context assembly -> LLM call -> header/footer wrapping.
 * On LLM failure, falls back to Mustache template rendering (GEN-05).
 * Usage is tracked automatically via LlmManager.chat() with feature="export_code_generation" (GEN-07).
 */
/**
 * Strip markdown code fences from LLM output.
 * Models sometimes wrap responses in ```lang ... ``` despite being told not to.
 */
function stripMarkdownFences(code: string): string {
  return code
    .replace(/^```[\w]*\r?\n?/, "")
    .replace(/\r?\n?```\s*$/, "")
    .trim();
}

/**
 * Build a human-readable error string from a caught value, including the
 * cause chain so "fetch failed" surfaces the underlying reason (e.g. ECONNREFUSED).
 */
function formatAiError(err: unknown): string {
  if (!(err instanceof Error)) return "AI generation failed";

  const parts: string[] = [err.message];
  let cause = (err as { cause?: unknown }).cause;
  while (cause) {
    if (cause instanceof Error) {
      parts.push(cause.message);
      cause = (cause as { cause?: unknown }).cause;
    } else if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause
    ) {
      parts.push(String((cause as { code: unknown }).code));
      break;
    } else {
      break;
    }
  }
  return parts.filter(Boolean).join(": ");
}

/**
 * Generate AI-powered export code for multiple test cases as a single cohesive file.
 *
 * Sends all cases to the LLM in one prompt so it can produce a unified file with
 * a single import block and all tests together. Used when outputMode === "single"
 * and multiple cases are selected.
 * Falls back to Mustache template rendering on LLM failure.
 */
export async function generateAiExportBatch(args: {
  caseIds: number[];
  projectId: number;
  templateId: number;
  cases: QuickScriptCaseData[];
}): Promise<AiExportResult> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    throw new Error("Not authenticated");
  }

  const template = await prisma.caseExportTemplate.findUnique({
    where: { id: args.templateId },
  });

  if (!template) {
    throw new Error(`Export template not found: ${args.templateId}`);
  }

  // Render header/footer and per-case bodies for fallback
  const Mustache = (await import("mustache")).default;
  Mustache.escape = (text: string) =>
    String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const mustacheBodies = args.cases.map((caseData) =>
    Mustache.render(template.templateBody, caseData)
  );
  // Use first case data for header/footer template vars (they're typically file-level)
  const header = template.headerBody
    ? Mustache.render(template.headerBody, args.cases[0])
    : "";
  const footer = template.footerBody
    ? Mustache.render(template.footerBody, args.cases[0])
    : "";
  const mustacheFallback = [header, ...mustacheBodies, footer]
    .filter(Boolean)
    .join("\n\n");

  const caseName = `Combined (${args.cases.length} tests)`;

  // Get repo config
  const repoConfig = await prisma.projectCodeRepositoryConfig.findUnique({
    where: { projectId: args.projectId },
    select: { id: true },
  });

  if (!repoConfig) {
    return {
      code: mustacheFallback,
      generatedBy: "template",
      error: "No code repository configured",
      caseId: args.caseIds[0],
      caseName,
    };
  }

  // Resolve prompt
  const resolver = new PromptResolver(prisma);
  const resolvedPrompt = await resolver.resolve(
    LLM_FEATURES.EXPORT_CODE_GENERATION,
    args.projectId
  );

  // Get LLM integration
  const llmIntegration = await prisma.projectLlmIntegration.findFirst({
    where: { projectId: args.projectId, isActive: true },
    select: { llmIntegrationId: true },
  });

  if (!llmIntegration) {
    return {
      code: mustacheFallback,
      generatedBy: "template",
      error: "No active LLM integration",
      caseId: args.caseIds[0],
      caseName,
    };
  }

  // Determine token budget and assemble code context
  const providerConfig = await prisma.llmProviderConfig.findFirst({
    where: { llmIntegrationId: llmIntegration.llmIntegrationId },
    select: { defaultMaxTokens: true },
  });

  const maxContextTokens = providerConfig?.defaultMaxTokens || 8000;
  // Build relevance hint from all cases
  const relevanceHint = args.cases
    .flatMap((c) => [
      c.name,
      ...c.steps.map((s: any) => `${s.step} ${s.expectedResult}`),
    ])
    .join(" ");

  console.log(
    `[generateAiExportBatch] Assembling context for ${args.cases.length} cases (budget: ${maxContextTokens} tokens)`
  );
  const contextResult = await CodeContextService.assembleContext(
    repoConfig.id,
    maxContextTokens,
    relevanceHint
  );

  // Build system prompt (same as single-case: framework/language context)
  let systemPrompt = resolvedPrompt.systemPrompt;
  systemPrompt = systemPrompt
    .replace(/\{\{FRAMEWORK\}\}/g, template.framework || "unknown")
    .replace(/\{\{LANGUAGE\}\}/g, template.language || "unknown");

  // Build combined cases text
  const casesText = args.cases
    .map((caseData, idx) => {
      const stepsText = caseData.steps
        .map((s) => `${s.order}. ${s.step}\n   Expected: ${s.expectedResult}`)
        .join("\n");
      return `--- Test Case ${idx + 1}: ${caseData.name} ---\n${stepsText}`;
    })
    .join("\n\n");

  // Build user prompt for batch: all cases in one file.
  // Note: resolvedPrompt.userPrompt is intentionally not used here — the single-case
  // placeholders ({{CASE_NAME}}, {{STEPS_TEXT}}) don't map cleanly to multiple cases.
  // The system prompt and temperature from resolvedPrompt still apply.
  let userPrompt = `Generate a single complete ${template.language || ""} test file that contains ALL ${args.cases.length} test cases below. Use a single set of imports at the top of the file — do not repeat imports between tests.\n\n${casesText}\n\nREPOSITORY CONTEXT:\n${contextResult.context}`;

  if (header) {
    userPrompt += `\n\nDEFAULT HEADER (use as a starting point — extend or modify imports/setup as needed based on the repository context):\n\`\`\`\n${header}\n\`\`\``;
  }
  if (footer) {
    userPrompt += `\n\nDEFAULT FOOTER (use as a starting point — extend or modify teardown as needed):\n\`\`\`\n${footer}\n\`\`\``;
  }

  try {
    const llmManager = LlmManager.getInstance(prisma);

    const request: LlmRequest = {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: resolvedPrompt.temperature,
      maxTokens: resolvedPrompt.maxOutputTokens,
      userId: session.user.id,
      projectId: args.projectId,
      feature: LLM_FEATURES.EXPORT_CODE_GENERATION,
    };

    console.log(
      `[generateAiExportBatch] Calling LLM for ${args.cases.length} cases...`
    );
    const response = await llmManager.chat(
      llmIntegration.llmIntegrationId,
      request
    );
    console.log(`[generateAiExportBatch] LLM responded`);

    const fullCode = stripMarkdownFences(response.content);

    return {
      code: fullCode,
      generatedBy: "ai",
      caseId: args.caseIds[0],
      caseName,
      contextFiles: contextResult.filesUsed,
    };
  } catch (err) {
    console.error(
      `[generateAiExportBatch] LLM generation failed, falling back to template:`,
      err
    );

    return {
      code: mustacheFallback,
      generatedBy: "template",
      error: formatAiError(err),
      caseId: args.caseIds[0],
      caseName,
    };
  }
}

export async function generateAiExport(args: {
  caseId: number;
  projectId: number;
  templateId: number;
  caseData: QuickScriptCaseData;
}): Promise<AiExportResult> {
  // 1. Auth check
  const session = await getServerAuthSession();
  if (!session?.user) {
    throw new Error("Not authenticated");
  }

  // 2. Load template
  const template = await prisma.caseExportTemplate.findUnique({
    where: { id: args.templateId },
  });

  if (!template) {
    throw new Error(`Export template not found: ${args.templateId}`);
  }

  // 3. Render header/footer with Mustache (EXP-03 -- deterministic wrapping)
  const Mustache = (await import("mustache")).default;
  // Override escape to handle backslashes and quotes in code output
  Mustache.escape = (text: string) =>
    String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const header = template.headerBody
    ? Mustache.render(template.headerBody, args.caseData)
    : "";
  const footer = template.footerBody
    ? Mustache.render(template.footerBody, args.caseData)
    : "";

  // 4. Render Mustache fallback (needed for GEN-05 fallback path)
  const mustacheFallback = Mustache.render(
    template.templateBody,
    args.caseData
  );

  // 5. Get project code repo config ID
  const repoConfig = await prisma.projectCodeRepositoryConfig.findUnique({
    where: { projectId: args.projectId },
    select: { id: true },
  });

  if (!repoConfig) {
    // No code repo configured -- return template fallback immediately
    const fullCode = [header, mustacheFallback, footer]
      .filter(Boolean)
      .join("\n\n");
    return {
      code: fullCode,
      generatedBy: "template",
      error: "No code repository configured",
      caseId: args.caseId,
      caseName: args.caseData.name,
    };
  }

  // 6. Resolve prompt
  const resolver = new PromptResolver(prisma);
  const resolvedPrompt = await resolver.resolve(
    LLM_FEATURES.EXPORT_CODE_GENERATION,
    args.projectId
  );

  // 7. Get LLM integration
  const llmIntegration = await prisma.projectLlmIntegration.findFirst({
    where: { projectId: args.projectId, isActive: true },
    select: { llmIntegrationId: true },
  });

  if (!llmIntegration) {
    // No active LLM integration -- return template fallback
    const fullCode = [header, mustacheFallback, footer]
      .filter(Boolean)
      .join("\n\n");
    return {
      code: fullCode,
      generatedBy: "template",
      error: "No active LLM integration",
      caseId: args.caseId,
      caseName: args.caseData.name,
    };
  }

  // 8. Determine token budget and assemble code context
  // Load provider config to get the total token budget
  const providerConfig = await prisma.llmProviderConfig.findFirst({
    where: { llmIntegrationId: llmIntegration.llmIntegrationId },
    select: { defaultMaxTokens: true },
  });

  const maxContextTokens = providerConfig?.defaultMaxTokens || 8000;
  const relevanceHint = [
    args.caseData.name,
    ...args.caseData.steps.map((s: any) => `${s.step} ${s.expectedResult}`),
  ].join(" ");
  console.log(
    `[generateAiExport] Assembling context for case ${args.caseId} (budget: ${maxContextTokens} tokens)`
  );
  const contextResult = await CodeContextService.assembleContext(
    repoConfig.id,
    maxContextTokens,
    relevanceHint
  );
  console.log(
    `[generateAiExport] Context assembled: ${contextResult.filesUsed.length} files, ~${contextResult.tokenEstimate} tokens, truncated=${contextResult.truncated}`
  );

  // 9. Build LLM messages with placeholder replacement
  let systemPrompt = resolvedPrompt.systemPrompt;
  systemPrompt = systemPrompt
    .replace(/\{\{FRAMEWORK\}\}/g, template.framework || "unknown")
    .replace(/\{\{LANGUAGE\}\}/g, template.language || "unknown");

  const stepsText = args.caseData.steps
    .map((s) => `${s.order}. ${s.step}\n   Expected: ${s.expectedResult}`)
    .join("\n");

  let userPrompt = resolvedPrompt.userPrompt;
  userPrompt = userPrompt
    .replace(/\{\{CASE_NAME\}\}/g, args.caseData.name)
    .replace(/\{\{STEPS_TEXT\}\}/g, stepsText)
    .replace(/\{\{CODE_CONTEXT\}\}/g, contextResult.context);

  // Show header/footer as a starting point — AI generates the full file and may extend them
  if (header) {
    userPrompt += `\n\nDEFAULT HEADER (use as a starting point — extend or modify imports/setup as needed based on the repository context):\n\`\`\`\n${header}\n\`\`\``;
  }
  if (footer) {
    userPrompt += `\n\nDEFAULT FOOTER (use as a starting point — extend or modify teardown as needed):\n\`\`\`\n${footer}\n\`\`\``;
  }

  // 10. Call LLM (wrapped in try/catch for GEN-05 fallback)
  try {
    const llmManager = LlmManager.getInstance(prisma);

    const request: LlmRequest = {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: resolvedPrompt.temperature,
      maxTokens: resolvedPrompt.maxOutputTokens,
      userId: session.user.id,
      projectId: args.projectId,
      feature: LLM_FEATURES.EXPORT_CODE_GENERATION, // GEN-07: usage tracked automatically
    };

    console.log(`[generateAiExport] Calling LLM for case ${args.caseId}...`);
    const response = await llmManager.chat(
      llmIntegration.llmIntegrationId,
      request
    );
    console.log(`[generateAiExport] LLM responded for case ${args.caseId}`);

    // AI generates the complete file — just strip any markdown fences
    const fullCode = stripMarkdownFences(response.content);

    return {
      code: fullCode,
      generatedBy: "ai",
      caseId: args.caseId,
      caseName: args.caseData.name,
      contextFiles: contextResult.filesUsed,
    };
  } catch (err) {
    // 11. Fallback on failure (GEN-05)
    console.error(
      `[generateAiExport] LLM generation failed for case ${args.caseId}, falling back to template:`,
      err
    );

    const fullCode = [header, mustacheFallback, footer]
      .filter(Boolean)
      .join("\n\n");

    return {
      code: fullCode,
      generatedBy: "template",
      error: formatAiError(err),
      caseId: args.caseId,
      caseName: args.caseData.name,
    };
  }
}
