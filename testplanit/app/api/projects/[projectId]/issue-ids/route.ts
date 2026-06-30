import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getProjectRelevantIssueIds } from "~/lib/projectIssueIds";
import { authOptions } from "~/server/auth";

/**
 * Returns the IDs of issues relevant to a project (filed under it, or linked
 * to any of its cases / sessions / runs / results). Computed efficiently from
 * the small issue<->entity join tables so the client can filter issues with
 * `id: { in: [...] }` instead of a `{ relation: { some } }` filter that
 * ZenStack v3 compiles to correlated EXISTS scans of the large tables.
 *
 * Access policy is still enforced when the client subsequently queries the
 * issues themselves via the policy-enabled client; this endpoint only narrows
 * the candidate set to the project.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;
  const projectIdNum = Number(projectId);
  if (!Number.isInteger(projectIdNum)) {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }

  try {
    const issueIds = await getProjectRelevantIssueIds(projectIdNum);
    return NextResponse.json({ issueIds });
  } catch (error) {
    console.error("Error fetching project issue ids:", error);
    return NextResponse.json(
      { error: "Failed to fetch issue ids" },
      { status: 500 }
    );
  }
}
