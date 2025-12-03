import { NextRequest, NextResponse } from "next/server";
import {
  loadSpecByCategory,
  getApiCategories,
  API_CATEGORIES,
  type ApiCategory,
} from "~/lib/openapi/merge-specs";

/**
 * GET /api/docs
 * Returns OpenAPI specification as JSON
 *
 * Query params:
 * - category: specific API category (custom, projects, testCases, testRuns, planning, users, attachments)
 * - list: if "true", returns list of available categories instead of spec
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const listCategories = searchParams.get("list") === "true";
    const category = searchParams.get("category") as ApiCategory | null;

    // Return list of available categories
    if (listCategories) {
      return NextResponse.json({
        categories: getApiCategories(),
      });
    }

    // Return specific category spec
    if (category) {
      if (!Object.keys(API_CATEGORIES).includes(category)) {
        return NextResponse.json(
          {
            error: `Invalid category: ${category}`,
            availableCategories: Object.keys(API_CATEGORIES),
          },
          { status: 400 }
        );
      }
      const spec = loadSpecByCategory(category);
      return NextResponse.json(spec);
    }

    // Default: return categories list (don't return full merged spec to avoid crashes)
    return NextResponse.json({
      message:
        "Please specify a category to view API documentation. The full API is too large to load at once.",
      categories: getApiCategories(),
      usage: {
        listCategories: "/api/docs?list=true",
        viewCategory: "/api/docs?category={categoryId}",
        example: "/api/docs?category=custom",
      },
    });
  } catch (error) {
    console.error("Error loading OpenAPI spec:", error);
    return NextResponse.json(
      { error: "Failed to load OpenAPI specification" },
      { status: 500 }
    );
  }
}
