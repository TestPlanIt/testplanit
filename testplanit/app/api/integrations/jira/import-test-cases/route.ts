import {
  authenticateForgeWrite,
  FORGE_CORS_HEADERS,
} from "@/lib/services/forge-jira-auth";
import {
  loadTemplateData,
  resolveImportTarget,
  templateBelongsToProject,
} from "@/lib/services/jira-panel-generation";
import {
  persistGeneratedTestCases,
  type ImportInput,
} from "@/lib/services/testCaseImport";
import { runWithAuditContext } from "@/lib/auditContext";
import { NextRequest, NextResponse } from "next/server";

interface IncomingCase {
  id: string;
  name: string;
  fieldValues?: Record<string, unknown>;
  tags?: string[];
}

/**
 * Forge (Jira panel) test-case import. Persists the cases the user confirmed
 * in the panel preview and links them to the Jira issue, attributed to the
 * mapped TestPlanIt user. Reuses the same persistence core as the in-app
 * wizard's import server action.
 */
export async function POST(request: NextRequest) {
  let body: {
    projectId?: number;
    templateId?: number;
    issueKey?: string;
    issueId?: string;
    issueTitle?: string;
    issueUrl?: string;
    autoGenerateTags?: boolean;
    testCases?: IncomingCase[];
    folderId?: number;
    newFolderName?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400, headers: FORGE_CORS_HEADERS }
    );
  }

  const {
    projectId,
    templateId,
    issueKey,
    issueId,
    issueTitle,
    issueUrl,
    autoGenerateTags,
    testCases,
    folderId,
    newFolderName,
  } = body;

  if (
    !projectId ||
    !templateId ||
    (!issueKey && !issueId) ||
    !Array.isArray(testCases) ||
    testCases.length === 0
  ) {
    return NextResponse.json(
      {
        error:
          "projectId, templateId, an issue key/id, and a non-empty testCases array are required",
      },
      { status: 400, headers: FORGE_CORS_HEADERS }
    );
  }

  const auth = await authenticateForgeWrite(request, { projectId });
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: FORGE_CORS_HEADERS }
    );
  }

  try {
    if (!(await templateBelongsToProject(templateId, projectId))) {
      return NextResponse.json(
        { error: "Template is not available for this project" },
        { status: 400, headers: FORGE_CORS_HEADERS }
      );
    }

    const loaded = await loadTemplateData(templateId);
    if (!loaded) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 400, headers: FORGE_CORS_HEADERS }
      );
    }

    const target = await resolveImportTarget(projectId, auth.user.id, {
      folderId,
      newFolderName,
    });
    if (!target) {
      return NextResponse.json(
        {
          error:
            "This project isn't set up for generated cases — it needs a repository and a default workflow state.",
        },
        { status: 400, headers: FORGE_CORS_HEADERS }
      );
    }

    // The LLM emits steps inside the Steps field of fieldValues; the
    // persistence core wants them as a top-level `steps` array (it skips the
    // Steps field when writing field values). Lift them out here using the
    // template definition so the panel can send generated cases verbatim.
    const stepsField = loaded.template.fields.find(
      (f) =>
        f.type.toLowerCase() === "steps" ||
        f.name.toLowerCase().includes("step")
    );

    const inputCases: ImportInput["testCases"] = testCases.map((tc) => {
      const rawSteps = stepsField
        ? (tc.fieldValues?.[stepsField.name] as unknown)
        : undefined;
      const steps =
        Array.isArray(rawSteps) && rawSteps.length > 0
          ? rawSteps.map((s: any) => ({
              step: s?.step,
              expectedResult: s?.expectedResult,
            }))
          : undefined;
      return {
        id: tc.id,
        name: tc.name,
        fieldValues: (tc.fieldValues ?? {}) as Record<string, any>,
        ...(tc.tags && tc.tags.length > 0 ? { tags: tc.tags } : {}),
        ...(steps ? { steps } : {}),
      };
    });

    const externalId = issueId || issueKey!;
    const input: ImportInput = {
      projectId,
      projectName: target.projectName,
      repositoryId: target.repositoryId,
      folderId: target.folderId,
      folderName: target.folderName,
      templateId,
      templateName: loaded.template.name,
      stateId: target.stateId,
      stateName: target.stateName,
      maxOrder: target.maxOrder,
      autoGenerateTags: autoGenerateTags === true,
      testCases: inputCases,
      fieldMappings: loaded.fieldMappings,
      issue: {
        externalId,
        integrationId: auth.integrationId,
        issueKey: issueKey || externalId,
        title: issueTitle || issueKey || externalId,
        ...(issueUrl ? { externalUrl: issueUrl } : {}),
      },
    };

    const result = await runWithAuditContext({ userId: auth.user.id }, () =>
      persistGeneratedTestCases(input, {
        userId: auth.user.id,
        userName: auth.user.name,
      })
    );

    return NextResponse.json(result, {
      status: result.status === "error" ? 500 : 200,
      headers: FORGE_CORS_HEADERS,
    });
  } catch (error) {
    console.error(
      "Error in POST /api/integrations/jira/import-test-cases:",
      error
    );
    const details =
      error instanceof Error ? error.message : "Failed to import test cases";
    return NextResponse.json(
      { error: "Failed to import test cases", details },
      { status: 500, headers: FORGE_CORS_HEADERS }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: FORGE_CORS_HEADERS });
}
