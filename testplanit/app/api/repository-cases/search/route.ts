import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { authenticateApiToken } from "~/lib/api-token-auth";
import { getCurrentTenantId } from "~/lib/multiTenantPrisma";
import { getServerAuthSession } from "~/server/auth";
import {
  getSearchSuggestions, searchRepositoryCases, type SearchOptions
} from "~/services/repositoryCaseSearch";

// Search request schema
const searchSchema = z.object({
  query: z.string().optional(),
  filters: z
    .object({
      projectIds: z.array(z.number()).optional(),
      repositoryIds: z.array(z.number()).optional(),
      folderIds: z.array(z.number()).optional(),
      templateIds: z.array(z.number()).optional(),
      stateIds: z.array(z.number()).optional(),
      tagIds: z.array(z.number()).optional(),
      creatorIds: z.array(z.string()).optional(),
      automated: z.boolean().optional(),
      isArchived: z.boolean().optional(),
      dateRange: z
        .object({
          field: z.literal("createdAt"),
          from: z
            .string()
            .transform((str) => new Date(str))
            .optional(),
          to: z
            .string()
            .transform((str) => new Date(str))
            .optional(),
        })
        .optional(),
      customFields: z
        .array(
          z.strictObject({
            fieldId: z.number(),
            value: z.any(),
          })
        )
        .optional(),
    })
    .optional(),
  sort: z
    .array(
      z.object({
        field: z.string(),
        order: z.enum(["asc", "desc"]),
      })
    )
    .optional(),
  pagination: z
    .object({
      page: z.number().min(1).prefault(1),
      size: z.number().min(1).max(100).default(20),
    })
    .optional(),
  highlight: z.boolean().optional(),
  facets: z.array(z.string()).optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Check authentication - try session first, then API token
    const session = await getServerAuthSession();
    let authenticated = !!session?.user;

    if (!authenticated) {
      const apiAuth = await authenticateApiToken(request);
      if (!apiAuth.authenticated) {
        return NextResponse.json(
          { error: apiAuth.error, code: apiAuth.errorCode },
          { status: 401 }
        );
      }
      authenticated = true;
    }

    if (!authenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse and validate request body
    const body = await request.json();
    const validatedData = searchSchema.parse(body);

    // Perform search (tenant-aware for multi-tenant deployments)
    const tenantId = getCurrentTenantId();
    const searchResult = await searchRepositoryCases(
      validatedData as SearchOptions,
      tenantId
    );

    if (!searchResult) {
      return NextResponse.json(
        { error: "Search service unavailable" },
        { status: 503 }
      );
    }

    return NextResponse.json(searchResult);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET endpoint for search suggestions
export async function GET(request: NextRequest) {
  try {
    // Check authentication - try session first, then API token
    const session = await getServerAuthSession();
    let authenticated = !!session?.user;

    if (!authenticated) {
      const apiAuth = await authenticateApiToken(request);
      if (!apiAuth.authenticated) {
        return NextResponse.json(
          { error: apiAuth.error, code: apiAuth.errorCode },
          { status: 401 }
        );
      }
      authenticated = true;
    }

    if (!authenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const prefix = searchParams.get("prefix") || "";
    const field = searchParams.get("field") as "name" | "tags" | undefined;
    const size = parseInt(searchParams.get("size") || "10");

    if (!prefix) {
      return NextResponse.json({ suggestions: [] });
    }

    // Get suggestions (tenant-aware for multi-tenant deployments)
    const tenantId = getCurrentTenantId();
    const suggestions = await getSearchSuggestions(
      prefix,
      field || "name",
      size,
      tenantId
    );

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("Suggestions error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
