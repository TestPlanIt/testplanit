import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth, itemTypeToModelMap } from "../shared";

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

  if (search && model.fields && model.name) {
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
