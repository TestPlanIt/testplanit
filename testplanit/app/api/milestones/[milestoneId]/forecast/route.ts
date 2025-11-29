import { NextResponse } from "next/server";
import { db } from "~/server/db";
import type { NextRequest } from "next/server";

// Helper function to get all descendant milestone IDs
async function getAllDescendantIds(milestoneId: number): Promise<number[]> {
  const allIds: number[] = [];
  const _getDirectChildren = async (parentId: number) => {
    const children = await db.milestones.findMany({
      where: { parentId: parentId, isDeleted: false },
      select: { id: true },
    });
    for (const child of children) {
      allIds.push(child.id);
      await _getDirectChildren(child.id);
    }
  };
  await _getDirectChildren(milestoneId);
  return allIds;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ milestoneId: string }> }
) {
  const { milestoneId: milestoneIdFromPromise } = await params;
  const numericMilestoneId = parseInt(milestoneIdFromPromise, 10);

  if (isNaN(numericMilestoneId)) {
    return NextResponse.json(
      { error: "Invalid milestoneId. Must be a number." },
      { status: 400 }
    );
  }

  try {
    // 1. Get the current milestone ID and all its descendant IDs
    const descendantIds = await getAllDescendantIds(numericMilestoneId);
    const allRelevantMilestoneIds = [numericMilestoneId, ...descendantIds];

    // 2. Fetch non-deleted TestRuns for all relevant milestones
    const testRuns = await db.testRuns.findMany({
      where: {
        milestoneId: { in: allRelevantMilestoneIds },
        isDeleted: false,
      },
      select: {
        forecastManual: true,
        forecastAutomated: true,
      },
    });

    if (!testRuns || testRuns.length === 0) {
      return NextResponse.json({
        manualEstimate: 0,
        mixedEstimate: 0,
        automatedEstimate: 0,
        areAllCasesAutomated: false,
      });
    }

    let totalManualEstimate = 0;
    let totalAutomatedEstimate = 0;

    for (const run of testRuns) {
      if (run.forecastManual !== null) {
        totalManualEstimate += run.forecastManual;
      }
      if (run.forecastAutomated !== null) {
        totalAutomatedEstimate += run.forecastAutomated;
      }
    }

    // Updated logic for areAllCasesAutomated:
    // True if manual is 0 and automated is > 0.
    // False otherwise (manual > 0, or both are 0).
    const areAllCasesAutomated =
      totalManualEstimate === 0 && totalAutomatedEstimate > 0;

    return NextResponse.json({
      manualEstimate: totalManualEstimate,
      mixedEstimate: totalManualEstimate + totalAutomatedEstimate,
      automatedEstimate: totalAutomatedEstimate,
      areAllCasesAutomated: areAllCasesAutomated,
    });
  } catch (error) {
    console.error(
      "Failed to calculate milestone forecast by summing TestRuns for milestone and descendants:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error while calculating milestone forecast." },
      { status: 500 }
    );
  }
}
