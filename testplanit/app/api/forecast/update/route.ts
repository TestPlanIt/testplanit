import { NextRequest, NextResponse } from "next/server";
import { authenticateApiToken } from "~/lib/api-token-auth";
import { baseDb } from "~/lib/db";
import { getAuthDb } from "~/lib/zenstack";
import { getServerAuthSession } from "~/server/auth";
import { updateRepositoryCaseForecast } from "~/services/forecastService";

/**
 * Recompute a repository case's forecast on demand. Browser surfaces call
 * this after recording a result or changing a link; the forecast worker
 * calls the service directly and never comes through here.
 *
 * Callers must be signed in (session cookie or `tpi_` bearer) and able to
 * read the case through the policy client; anything else is 401/404.
 */
export async function GET(req: NextRequest) {
  const session = await getServerAuthSession();
  let userId: string | undefined = session?.user?.id;
  if (!userId) {
    const apiAuth = await authenticateApiToken(req);
    if (!apiAuth.authenticated) {
      return NextResponse.json(
        { error: apiAuth.error, code: apiAuth.errorCode },
        { status: 401 }
      );
    }
    userId = apiAuth.userId;
  }
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const caseId = req.nextUrl.searchParams.get("caseId");
  if (!caseId || isNaN(Number(caseId))) {
    return NextResponse.json(
      { error: "Missing or invalid caseId" },
      { status: 400 }
    );
  }

  try {
    const user = await baseDb.user.findUnique({
      where: { id: userId },
      include: { role: { include: { rolePermissions: true } } },
    });
    const enhancedDb = await getAuthDb(user ?? undefined);
    const visibleCase = await enhancedDb.repositoryCases.findFirst({
      where: { id: Number(caseId), isDeleted: false },
      select: { id: true },
    });
    if (!visibleCase) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    await updateRepositoryCaseForecast(Number(caseId));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Forecast update error:", error);
    return NextResponse.json(
      { error: "Failed to update forecast" },
      { status: 500 }
    );
  }
}
