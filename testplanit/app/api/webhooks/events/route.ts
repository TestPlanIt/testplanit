/**
 * Public catalog of webhook event names that TestPlanIt emits.
 *
 * The response is authenticated (session OR Bearer API token) but does not
 * apply any per-project filtering — the catalog is the same for everyone.
 * Consumers building integrations call this to discover available events
 * and the top-level shape of each payload; the per-event JSON schemas live
 * in the user-guide docs.
 *
 * Query params:
 * - `category`  Optional. Restrict to one category
 *               (test-case, test-run, iteration, session, issue, review,
 *               system). Useful when only one feed is being wired.
 *
 * Response shape:
 *   {
 *     generatedAt: string,
 *     count: number,
 *     events: WebhookEventDefinition[]
 *   }
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "~/lib/api-token-auth";
import { authOptions } from "~/server/auth";
import { listEventCatalog } from "~/lib/webhooks/eventCatalog";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const auth = await authenticateRequest(request, session);
  if (!auth.authenticated) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status ?? 401 }
    );
  }

  const url = new URL(request.url);
  const category = url.searchParams.get("category");

  let events = listEventCatalog();
  if (category) {
    events = events.filter((e) => e.category === category);
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    count: events.length,
    events,
  });
}
