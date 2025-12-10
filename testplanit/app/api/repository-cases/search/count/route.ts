import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSession } from "~/server/auth";
import { authenticateApiToken } from "~/lib/api-token-auth";
import {
  countRepositoryCases,
  type SearchOptions,
} from "~/services/repositoryCaseSearch";
import { z } from "zod/v4";

// Count request schema
const countSchema = z.object({
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
    const validatedData = countSchema.parse(body);

    // Get count
    const count = await countRepositoryCases(
      validatedData as Omit<
        SearchOptions,
        "pagination" | "sort" | "highlight" | "facets"
      >
    );

    return NextResponse.json({ count });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Count error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
