import { baseDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { authenticateApiToken } from "~/lib/api-token-auth";
import { enrichFromApiAuth } from "~/lib/auditContextWrappers";
import { getServerAuthSession } from "~/server/auth";
import { db } from "~/server/db";

// Helper to check admin authentication (session or API token)
export async function checkAdminAuth(
  request: NextRequest
): Promise<{ error?: NextResponse; userId?: string }> {
  const session = await getServerAuthSession();
  let userId = session?.user?.id;
  let userAccess: string | undefined = session?.user?.access ?? undefined;

  if (!userId) {
    const apiAuth = await authenticateApiToken(request);
    if (!apiAuth.authenticated) {
      return {
        error: NextResponse.json(
          { error: apiAuth.error, code: apiAuth.errorCode },
          { status: 401 }
        ),
      };
    }
    userId = apiAuth.userId;
    userAccess = apiAuth.access;
    if (apiAuth.userId) {
      // Attribute restore/purge audit rows (CDC GUC actor) to the token owner.
      enrichFromApiAuth({
        userId: apiAuth.userId,
        userName: apiAuth.userName,
        userEmail: apiAuth.userEmail,
        scopes: apiAuth.scopes,
      });
    }
  }

  if (!userId) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!userAccess) {
    const user = await baseDb.user.findUnique({
      where: { id: userId },
      select: { access: true },
    });
    userAccess = user?.access;
  }

  if (userAccess !== "ADMIN") {
    return {
      error: NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      ),
    };
  }

  return { userId };
}

export const itemTypeToModelMap: Record<string, any> = {
  User: db.user,
  Groups: db.groups,
  Roles: db.roles,
  Projects: db.projects,
  Milestones: db.milestones,
  MilestoneTypes: db.milestoneTypes,
  CaseFields: db.caseFields,
  ResultFields: db.resultFields,
  FieldOptions: db.fieldOptions,
  Templates: db.templates,
  Status: db.status,
  Workflows: db.workflows,
  ConfigCategories: db.configCategories,
  ConfigVariants: db.configVariants,
  Configurations: db.configurations,
  Tags: db.tags,
  Repositories: db.repositories,
  RepositoryFolders: db.repositoryFolders,
  RepositoryCaseLink: db.repositoryCaseLink,
  RepositoryCases: db.repositoryCases,
  RepositoryCaseVersions: db.repositoryCaseVersions,
  Attachments: db.attachments,
  Steps: db.steps,
  Sessions: db.sessions,
  SessionResults: db.sessionResults,
  TestRuns: db.testRuns,
  TestRunResults: db.testRunResults,
  TestRunStepResults: db.testRunStepResults,
  Issues: db.issue,
  AppConfig: db.appConfig,
  CodeRepository: db.codeRepository,
  LlmIntegration: db.llmIntegration,
  Integration: db.integration,
  PromptConfig: db.promptConfig,
  CaseExportTemplate: db.caseExportTemplate,
  SharedStepGroup: db.sharedStepGroup,
  DataSet: db.dataSet,
};
