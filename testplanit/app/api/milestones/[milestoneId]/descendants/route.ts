import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { getAllDescendantMilestoneIds } from "~/lib/services/milestoneDescendants";
import { getVisibleMilestone } from "~/lib/services/milestoneAccess";
import { authOptions } from "~/server/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ milestoneId: string }> }
) {
  const { milestoneId: milestoneIdParam } = await params;
  const milestoneId = Number(milestoneIdParam);

  if (isNaN(milestoneId)) {
    return NextResponse.json(
      { error: "Invalid milestone ID" },
      { status: 400 }
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Policy-scoped visibility gate: unauthorized users get the same 404
    // as a missing milestone.
    const milestone = await getVisibleMilestone(session, milestoneId);
    if (!milestone) {
      return NextResponse.json(
        { error: "Milestone not found" },
        { status: 404 }
      );
    }

    const descendantIds = await getAllDescendantMilestoneIds(milestoneId);
    return NextResponse.json({ descendantIds });
  } catch (error) {
    console.error("Failed to fetch milestone descendants:", error);
    return NextResponse.json(
      { error: "Failed to fetch milestone descendants" },
      { status: 500 }
    );
  }
}
