import { NextResponse } from "next/server";
import { getEnhancedDb } from "~/lib/auth/utils";
import {
  getReleaseCheck,
  getRunningVersion,
  isReleaseCheckEnabled,
} from "~/lib/services/releaseCheck";
import { getServerAuthSession } from "~/server/auth";

export const dynamic = "force-dynamic";

/**
 * What the admin notice shows: the newest release, when it is newer than the
 * running version. Reading refreshes a result that is a day old, which covers
 * an instance whose workers are down. It never creates notifications; the
 * daily job does.
 */
export async function GET() {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.access !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const enabled = isReleaseCheckEnabled();
  const currentVersion = getRunningVersion();
  if (!enabled) {
    return NextResponse.json({
      enabled,
      currentVersion,
      latest: null,
      latestOnLine: null,
      checkedAt: null,
      lastError: null,
    });
  }

  const db = await getEnhancedDb(session);
  const record = await getReleaseCheck(db);
  return NextResponse.json({
    enabled,
    currentVersion,
    latest: record?.latest ?? null,
    latestOnLine: record?.latestOnLine ?? null,
    checkedAt: record?.checkedAt ?? null,
    lastError: record?.lastError ?? null,
  });
}
