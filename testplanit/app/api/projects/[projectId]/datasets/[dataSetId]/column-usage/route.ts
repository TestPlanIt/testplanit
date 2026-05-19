import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { getEnhancedDb } from "~/lib/auth/utils";
import { SKIP_MAPPING_SENTINEL } from "~/lib/schemas/sharedDatasetAssignmentSchema";
import { authOptions } from "~/server/auth";

/**
 * Returns the cases whose `CaseSharedDataSetAssignment.mappingJson`
 * references the given column on the given shared dataset.
 *
 * Used by the standalone Shared Dataset editor's column-delete flow:
 * a non-zero usage count blocks the delete and surfaces which cases
 * need their mappings updated first.
 */
export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ projectId: string; dataSetId: string }>;
  },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId: projectIdParam, dataSetId: dataSetIdParam } = await params;
  const projectId = parseInt(projectIdParam, 10);
  const dataSetId = parseInt(dataSetIdParam, 10);
  if (Number.isNaN(projectId) || Number.isNaN(dataSetId)) {
    return NextResponse.json(
      { error: "Invalid path parameter" },
      { status: 400 },
    );
  }

  const column = request.nextUrl.searchParams.get("column")?.trim() ?? "";
  if (column.length === 0 || column.length > 80) {
    return NextResponse.json(
      { error: "Missing or invalid `column` query parameter" },
      { status: 400 },
    );
  }

  const db = await getEnhancedDb(session);

  const dataset = await db.dataSet.findFirst({
    where: { id: dataSetId, projectId, isShared: true, isDeleted: false },
    select: { id: true },
  });
  if (!dataset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // mappingJson is keyed by column name; we fetch all assignments for this
  // dataset and filter in code. The set is bounded by `_count.sharedAssignments`
  // (already a small N — assignments are 1:1 with cases that opted in).
  const assignments = await db.caseSharedDataSetAssignment.findMany({
    where: { sharedDataSetId: dataSetId },
    select: {
      mappingJson: true,
      case: { select: { id: true, name: true } },
    },
  });

  const referencingCases = assignments
    .filter((a) => {
      const map = (a.mappingJson ?? {}) as Record<string, string>;
      const value = map[column];
      return typeof value === "string" && value !== SKIP_MAPPING_SENTINEL;
    })
    .map((a) => a.case)
    .filter((c): c is { id: number; name: string } => c != null);

  return NextResponse.json({
    column,
    count: referencingCases.length,
    sampleCases: referencingCases.slice(0, 10),
  });
}
