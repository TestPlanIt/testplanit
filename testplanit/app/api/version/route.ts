import { NextResponse } from "next/server";
import { getVersionInfo } from "~/lib/version";
import { withRequestRouting } from "~/lib/db/requestRouting";

export const dynamic = "force-dynamic";

/**
 * The build this server is running, for open tabs to compare against their
 * own. Polled from every tab, so it touches no backing service — unlike
 * /api/health. Public, so a tab whose session expired still learns of a deploy.
 */
function handleGET() {
  return NextResponse.json(
    {
      buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? null,
      version: getVersionInfo().version,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export const GET = withRequestRouting(handleGET);
