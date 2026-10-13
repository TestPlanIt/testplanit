import { getServerSession } from "next-auth";
import { type NextRequest, NextResponse } from "next/server";
import { getEnhancedDb } from "~/lib/auth/utils";
import { isAccessPolicyError } from "~/lib/utils/errors";
import { authOptions } from "~/server/auth";

/**
 * POST /api/repository-cases/[caseId]/code-pins/[pinId]/stale-dismissal
 * Server-clock dismissal of the stale badge (cleared again by reanchor).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ caseId: string; pinId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { caseId: rawCaseId, pinId: rawPinId } = await params;
  const caseId = Number(rawCaseId);
  const pinId = Number(rawPinId);
  if (!Number.isInteger(caseId) || !Number.isInteger(pinId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const db = await getEnhancedDb(session);
    const pin = await db.repositoryCaseCodePin.findFirst({
      where: { id: pinId, caseId, isDeleted: false },
      select: { id: true },
    });
    if (!pin) {
      return NextResponse.json({ error: "Pin not found" }, { status: 404 });
    }
    const updated = await db.repositoryCaseCodePin.update({
      where: { id: pinId },
      data: { staleDismissedAt: new Date() },
      select: { staleDismissedAt: true },
    });
    return NextResponse.json({ dismissedAt: updated.staleDismissedAt });
  } catch (error) {
    if (isAccessPolicyError(error)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("Code pin stale dismissal error:", error);
    return NextResponse.json(
      { error: "Failed to dismiss stale flag" },
      { status: 500 }
    );
  }
}
