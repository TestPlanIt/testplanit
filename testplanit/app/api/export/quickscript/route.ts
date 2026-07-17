/**
 * Synchronous QuickScript (AI test-script) generation endpoint.
 *
 * The externally-reachable counterpart to the in-app SSE route
 * (`/api/export/ai-stream`): it authenticates via session OR API token, resolves
 * the project's export template + connected repo context server-side, and
 * returns the full generated script text in one response (no streaming). This is
 * what the `@testplanit/api` client's `generateQuickScript()` and the MCP
 * `testplanit_cases_generate_script` tool call.
 *
 * Auth mirrors the other token routes (e.g. cases/bulk-create): a `mode:read`
 * token is rejected on this POST. Project access is enforced with the shared
 * access model, and cases are scoped to the project.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import {
  authenticateApiTokenForMethod,
  extractBearerToken,
} from "~/lib/api-token-auth";
import {
  fetchQuickScriptCases,
  generateQuickScript,
  getQuickScriptReadiness,
  resolveQuickScriptTemplate,
  type QuickScriptResult,
} from "~/lib/services/quickscript-generation";
import { userHasProjectAccess } from "~/lib/services/projectAccess";
import { getServerAuthSession } from "~/server/auth";

// Generation calls an LLM provider and can take tens of seconds; raise the
// platform function ceiling for hosts that honor it (self-hosted is unbounded).
export const maxDuration = 300;

const bodySchema = z.object({
  projectId: z.number().int().positive(),
  caseIds: z.array(z.number().int().positive()).min(1).max(50),
  // Optional — defaults to the project's assigned/default export template.
  templateId: z.number().int().positive().optional(),
  // "combined": one file containing all cases (default). "perCase": one file per case.
  outputMode: z.enum(["combined", "perCase"]).optional().default("combined"),
});

export async function POST(request: NextRequest) {
  // ── Authentication (session, else API token) ──────────────────────────────
  const session = await getServerAuthSession();
  let userId: string | undefined = session?.user?.id;
  let userAccess: string | null | undefined = session?.user?.access;

  if (!userId) {
    const token = extractBearerToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const apiAuth = await authenticateApiTokenForMethod(request);
    if (!apiAuth.authenticated) {
      const status = apiAuth.errorCode === "READ_ONLY_TOKEN" ? 403 : 401;
      return NextResponse.json(
        { error: apiAuth.error, code: apiAuth.errorCode },
        { status }
      );
    }
    userId = apiAuth.userId;
    userAccess = apiAuth.access;
  }

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Validate body ─────────────────────────────────────────────────────────
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { projectId, caseIds, templateId, outputMode } = body;

  // ── Project access ────────────────────────────────────────────────────────
  const hasAccess = await userHasProjectAccess(
    { id: userId, access: userAccess },
    projectId
  );
  if (!hasAccess) {
    return NextResponse.json(
      { error: "Project not found or access denied" },
      { status: 404 }
    );
  }

  // ── Feature gate: QuickScript must be enabled for the project ─────────────
  const readiness = await getQuickScriptReadiness(projectId);
  if (!readiness.quickScriptEnabled) {
    return NextResponse.json(
      { error: "QuickScript is not enabled for this project" },
      { status: 403 }
    );
  }

  // ── Resolve template ──────────────────────────────────────────────────────
  const template = await resolveQuickScriptTemplate(projectId, templateId);
  if (!template) {
    return NextResponse.json(
      {
        error: templateId
          ? "Export template not found or not available for this project"
          : "No export template is available for this project",
      },
      { status: 400 }
    );
  }

  // ── Fetch cases + generate ────────────────────────────────────────────────
  // Case-fetch, repo-context assembly, and the LLM call can all fail at
  // runtime; catch here so a downstream error returns a clean 500 (with a
  // message) instead of leaking an empty server error.
  try {
    const cases = await fetchQuickScriptCases(projectId, caseIds);
    if (cases.length === 0) {
      return NextResponse.json(
        { error: "No matching test cases found in this project" },
        { status: 404 }
      );
    }
    const foundIds = new Set(cases.map((c) => c.id));
    const missingCaseIds = caseIds.filter((id) => !foundIds.has(id));

    let results: QuickScriptResult[];
    if (outputMode === "perCase") {
      results = [];
      for (const c of cases) {
        results.push(
          await generateQuickScript({
            projectId,
            templateId: template.id,
            cases: [c],
            userId,
            mode: "single",
          })
        );
      }
    } else {
      // One combined file. A single case uses the per-case prompt (identical to
      // the in-app single export); multiple cases use the combined prompt.
      results = [
        await generateQuickScript({
          projectId,
          templateId: template.id,
          cases,
          userId,
          mode: cases.length === 1 ? "single" : "batch",
        }),
      ];
    }

    return NextResponse.json({
      projectId,
      templateId: template.id,
      templateName: template.name,
      framework: template.framework,
      language: template.language,
      fileExtension: template.fileExtension,
      outputMode,
      hasCodeContext: readiness.hasCodeContext,
      ...(missingCaseIds.length > 0 ? { missingCaseIds } : {}),
      results,
    });
  } catch (err) {
    console.error("[export/quickscript] Generation failed:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "QuickScript generation failed",
      },
      { status: 500 }
    );
  }
}
