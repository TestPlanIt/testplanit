import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import {
  isRouteResponse,
  providerErrorResponse,
  resolveRepoRouteContext,
} from "~/lib/services/impact/repoRouteContext";

const querySchema = z.object({
  base: z.string().trim().min(1).max(255),
  head: z.string().trim().min(1).max(255),
});

/**
 * GET /api/code-repositories/[id]/merge-base?configId=&base=&head=
 * Where two refs diverged. A pull request is judged from this commit rather
 * than from its target branch tip, so the diff describes what the branch did
 * instead of also reporting, in reverse, what landed on the target meanwhile.
 * `sha` comes back null when the provider cannot answer; callers fall back to
 * the base the provider gave them.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveRepoRouteContext(req, params);
  if (isRouteResponse(ctx)) return ctx;
  const { adapter } = ctx;

  const parsed = querySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries())
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const sha = await adapter.getMergeBase(parsed.data.base, parsed.data.head);
    return NextResponse.json({ sha });
  } catch (error) {
    return providerErrorResponse(error);
  }
}
