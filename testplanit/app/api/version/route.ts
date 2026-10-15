import { NextResponse } from "next/server";
import { getVersionInfo } from "~/lib/version";

export const dynamic = "force-dynamic";

/**
 * The build this server is running, for open tabs to compare against their
 * own. Polled from every tab, so it touches no backing service — unlike
 * /api/health. Public, so a tab whose session expired still learns of a deploy.
 */
export function GET() {
  return NextResponse.json(
    {
      buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? null,
      version: getVersionInfo().version,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
