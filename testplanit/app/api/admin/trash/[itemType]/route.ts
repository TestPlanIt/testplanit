import { NextResponse, NextRequest } from "next/server";
import { db } from "~/server/db";
import { getServerAuthSession } from "~/server/auth";
import { authenticateApiToken } from "~/lib/api-token-auth";
import { prisma } from "@/lib/prisma";

// Helper to check admin authentication (session or API token)
async function checkAdminAuth(request: NextRequest): Promise<{ error?: NextResponse; userId?: string }> {
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
  }

  if (!userId) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!userAccess) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { access: true },
    });
    userAccess = user?.access;
  }

  if (userAccess !== "ADMIN") {
    return {
      error: NextResponse.json({ error: "Admin access required" }, { status: 403 }),
    };
  }

  return { userId };
}

const itemTypeToModelMap: Record<string, any> = {
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
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ itemType: string }> }
) {
  const auth = await checkAdminAuth(request);
  if (auth.error) return auth.error;

  const routeParams = await context.params;

  const itemType = routeParams.itemType;

  const model = itemTypeToModelMap[itemType];

  if (!model) {
    console.error(
      `[API /api/admin/trash/[itemType]] Invalid item type received: ${itemType}`
    );
    return NextResponse.json({ error: "Invalid item type" }, { status: 404 });
  }

  const { searchParams } = request.nextUrl;
  const skip = parseInt(searchParams.get("skip") || "0", 10);
  const take = parseInt(searchParams.get("take") || "10", 10);
  const sortBy = searchParams.get("sortBy") || "id";
  const sortDir = searchParams.get("sortDir") === "desc" ? "desc" : "asc";
  const search = searchParams.get("search") || "";

  const whereClause: any = { isDeleted: true };

  if (search && model.fields && model.fields.name) {
    whereClause.AND = whereClause.AND || [];
    whereClause.AND.push({
      name: {
        contains: search,
        mode: "insensitive",
      },
    });
  } else if (
    search &&
    itemType === "AppConfig" &&
    model.fields &&
    model.fields.key
  ) {
    whereClause.AND = whereClause.AND || [];
    whereClause.AND.push({
      key: {
        contains: search,
        mode: "insensitive",
      },
    });
  }

  try {
    const totalCount = await model.count({
      where: whereClause,
    });

    const items = await model.findMany({
      where: whereClause,
      orderBy: {
        [sortBy]: sortDir,
      },
      skip: skip,
      take: take,
    });

    // Convert BigInt to string for JSON serialization
    const serializedItems = items.map((item: any) => {
      const serializedItem = { ...item };
      for (const key in serializedItem) {
        if (typeof serializedItem[key] === "bigint") {
          serializedItem[key] = serializedItem[key].toString();
        }
      }
      return serializedItem;
    });

    return NextResponse.json({ items: serializedItems, totalCount });
  } catch (error) {
    console.error(
      `Failed to fetch deleted ${itemType} with pagination/search:`,
      error
    );
    return NextResponse.json(
      { error: `Failed to fetch deleted ${itemType}` },
      { status: 500 }
    );
  }
}
