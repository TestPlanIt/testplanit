"use server";

import { baseDb } from "~/lib/db";
import { CodeContextService } from "~/lib/llm/services/code-context.service";
import {
  generateQuickScript,
  type QuickScriptCaseData,
  type QuickScriptResult,
} from "~/lib/services/quickscript-generation";
import { getServerAuthSession } from "~/server/auth";

/** @deprecated Prefer `QuickScriptResult` from `~/lib/services/quickscript-generation`. */
export type AiExportResult = QuickScriptResult;

/**
 * Check whether AI export is available for a given project.
 * Requires: active LLM integration. Code repository is optional — when
 * absent the LLM still generates code using standard framework patterns.
 */
export async function checkAiExportAvailable(args: {
  projectId: number;
}): Promise<{ available: boolean; reason?: string; hasCodeContext?: boolean }> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return { available: false, reason: "not_authenticated" };
  }

  // Active LLM integration is the only hard requirement
  const llmIntegration = await baseDb.projectLlmIntegration.findFirst({
    where: { projectId: args.projectId, isActive: true },
  });

  if (!llmIntegration) {
    return { available: false, reason: "no_llm" };
  }

  // Code context is informational — not a gate
  const hasCodeContext = await CodeContextService.checkProjectHasCodeContext(
    args.projectId
  );

  return { available: true, hasCodeContext };
}

/**
 * Generate AI-powered export code for multiple test cases as a single cohesive
 * file. Thin session-authed wrapper over the shared QuickScript service.
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

  return generateQuickScript({
    projectId: args.projectId,
    templateId: args.templateId,
    cases: args.cases,
    userId: session.user.id,
    mode: "batch",
  });
}

/**
 * Generate AI-powered export code for a single test case. Thin session-authed
 * wrapper over the shared QuickScript service.
 */
export async function generateAiExport(args: {
  caseId: number;
  projectId: number;
  templateId: number;
  caseData: QuickScriptCaseData;
}): Promise<AiExportResult> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    throw new Error("Not authenticated");
  }

  return generateQuickScript({
    projectId: args.projectId,
    templateId: args.templateId,
    cases: [args.caseData],
    userId: session.user.id,
    mode: "single",
  });
}
